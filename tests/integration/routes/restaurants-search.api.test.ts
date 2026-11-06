import { type Collection, type MongoClient, MongoNetworkError } from 'mongodb';
import request from 'supertest';
import { RESTAURANTS_COLLECTION } from '../../../src/config/database';
import type { RestaurantDocument } from '../../../src/models/restaurant.model';
import type { SearchExecutor } from '../../../src/models/search.model';
import { MongoRestaurantRepository } from '../../../src/repositories/restaurant.repository';
import { RuleBasedQueryInterpreter } from '../../../src/services/query-interpreter.service';
import { DefaultRestaurantService } from '../../../src/services/restaurant.service';
import { CachedVocabularyService } from '../../../src/services/vocabulary.service';
import { ANCHOR } from '../../fixtures/restaurants.fixture';
import { S, SEARCH_FIXTURE_TENANT } from '../../fixtures/search.fixture';
import { createTestApp } from '../../helpers/app';
import { expectDocumentedResponse } from '../../helpers/openapi-contract';
import {
  TEST_DB_NAME,
  TEST_SEARCH_INDEX_NAME,
  connectTestClient,
} from '../../helpers/test-database';
import { waitForSearch } from '../../helpers/wait-for-search';

const ids = (docs: RestaurantDocument[]) =>
  docs.map((d) => d._id.toHexString());
const AT_ANCHOR = `lat=${ANCHOR.lat}&lng=${ANCHOR.lng}`;

interface SearchPage {
  data: {
    id: string;
    name: string;
    distanceKm?: number;
    features: { onlineDelivery: boolean | null };
  }[];
  nextCursor: string | null;
  interpretation: { notes: string[] } & Record<string, unknown>;
}

describe('GET /v1/restaurants/search against Atlas Search (search fixtures)', () => {
  let client: MongoClient;
  let collection: Collection<RestaurantDocument>;

  beforeAll(async () => {
    client = await connectTestClient();
    collection = client
      .db(TEST_DB_NAME)
      .collection<RestaurantDocument>(RESTAURANTS_COLLECTION);
  });
  afterAll(() => client.close());

  async function appFor(tenantId: string, executor?: SearchExecutor) {
    const repository = new MongoRestaurantRepository(
      collection,
      { tenantId, maxTimeMS: 2000, searchIndexName: TEST_SEARCH_INDEX_NAME },
      executor,
    );
    const vocabulary = new CachedVocabularyService(repository, {
      refreshMs: 60_000,
      onError: () => undefined,
    });
    await vocabulary.load();
    return {
      vocabulary,
      app: createTestApp({
        restaurantService: new DefaultRestaurantService(repository, {
          vocabulary,
          interpreter: new RuleBasedQueryInterpreter({ bestMinVotes: 20 }),
        }),
      }),
    };
  }

  let app: Awaited<ReturnType<typeof appFor>>['app'];
  beforeAll(async () => {
    ({ app } = await appFor(SEARCH_FIXTURE_TENANT));
  });

  async function search(query: string): Promise<SearchPage> {
    const response = await request(app).get(`/v1/restaurants/search?${query}`);
    expect(response.status).toBe(200);
    expectDocumentedResponse(response, 'GET', '/v1/restaurants/search');
    return response.body as SearchPage;
  }
  const searchIds = async (query: string) =>
    (await search(query)).data.map((item) => item.id);
  const q = (text: string) => `q=${encodeURIComponent(text)}`;

  describe('the three brief queries', () => {
    it('Best restaurants in Gurgaon with South Indian Food: by rating, at least 20 votes', async () => {
      const page = await search(
        q('Best restaurants in Gurgaon with South Indian Food'),
      );

      expect(page.data.map((item) => item.id)).toEqual(
        ids([S.sagarRatna, S.dakshin]),
      );
      expect(page.interpretation).toMatchObject({
        city: 'gurgaon',
        cuisines: ['south indian'],
        sort: 'rating',
        minVotes: 20,
      });
    });

    it('Restaurants in Gurgaon under Rs. 1000 for two: INR filter, default rating order', async () => {
      expect(
        await searchIds(q('Restaurants in Gurgaon under Rs. 1000 for two')),
      ).toEqual(
        ids([
          S.idliCorner, // 4.5
          S.bhelJunction, // 4.3
          S.chaatStreet, // 4.1
          S.sagarRatna, // 4.0
          S.yetiMomos, // 3.9
          S.tikkiPoint, // 3.8
          S.dakshin, // 3.7
          S.goliFar, // 3.6
          S.goliNear, // 3.4
        ]),
      );
    });

    it('Nearest place that serves Vada Pav, with coordinates: pure distance order', async () => {
      const page = await search(
        `${q('Nearest place that serves Vada Pav')}&${AT_ANCHOR}`,
      );

      expect(page.data.map((item) => item.id)).toEqual(
        ids([
          S.chaatStreet,
          S.goliNear,
          S.tikkiPoint,
          S.bhelJunction,
          S.goliFar,
        ]),
      );
      expect(page.data.map((item) => item.distanceKm)).toEqual([
        0.2, 0.4, 1, 2, 3,
      ]);
    });

    it('Nearest place that serves Vada Pav, no coordinates: name matches first, then by rating', async () => {
      const page = await search(q('Nearest place that serves Vada Pav'));

      expect(page.data.map((item) => item.id)).toEqual(
        // Equal scores within each group, so rating decides (the relevance
        // tie-break): the two name matches, then street food.
        ids([
          S.goliFar, // 3.6
          S.goliNear, // 3.4
          S.bhelJunction, // 4.3
          S.chaatStreet, // 4.1
          S.tikkiPoint, // 3.8
        ]),
      );
      expect(page.interpretation.notes).toContain(
        'nearest needs lat/lng; showing best matches',
      );
    });
  });

  it('"pav" ranks real name matches above the "Pavilion" prefix match', async () => {
    const result = await searchIds(q('pav'));

    expect(result.indexOf(S.goliNear._id.toHexString())).toBeLessThan(
      result.indexOf(S.summerPavilion._id.toHexString()),
    );
  });

  it('a typo with nothing else recognized: "goli vada pao" finds Goli Vada Pav first', async () => {
    expect((await searchIds(q('goli vada pao'))).slice(0, 2).sort()).toEqual(
      ids([S.goliNear, S.goliFar]).sort(),
    );
  });

  it('leftover words boost and never exclude: Cyber Hub first, the rest still listed', async () => {
    const result = await searchIds(q('south indian near cyber hub'));

    expect(result[0]).toBe(S.dakshin._id.toHexString());
    expect(result.sort()).toEqual(
      ids([S.sagarRatna, S.dakshin, S.idliCorner, S.saravana]).sort(),
    );
  });

  it('features are filters: online delivery in gurgaon', async () => {
    expect((await searchIds(q('online delivery in gurgaon'))).sort()).toEqual(
      ids([S.goliNear, S.dakshin]).sort(),
    );
  });

  it('items show the feature they were filtered on', async () => {
    const page = await search(q('online delivery in gurgaon'));

    expect(page.data.length).toBeGreaterThan(0);
    for (const item of page.data) {
      expect(item.features.onlineDelivery).toBe(true);
    }
  });

  it('a city typo after "in" is corrected and said so', async () => {
    const page = await search(q('south indian in gurgoan'));

    expect(page.data.map((item) => item.id)).toEqual(
      ids([S.idliCorner, S.sagarRatna, S.dakshin]),
    );
    expect(page.interpretation.notes).toContain(
      "showing results for 'gurgaon' (you typed 'gurgoan')",
    );
  });

  it.each([
    ['chineese in gurgaon', 'chinese in gurgaon', 'chinese'],
    ['dosaa in gurgaon', 'dosa in gurgaon', 'dosa'],
  ])(
    'a misspelled cuisine or dish filters like the right spelling: %s',
    async (typo, correct, corrected) => {
      const page = await search(q(typo));

      expect(page.data.map((item) => item.id).sort()).toEqual(
        (await searchIds(q(correct))).sort(),
      );
      expect(page.data.length).toBeGreaterThan(0);
      expect(page.interpretation.notes).toContain(
        `showing results for '${corrected}' (you typed '${typo.split(' ')[0]}')`,
      );
    },
  );

  it('an unknown city after "in" gives an empty list with a note', async () => {
    const page = await search(q('south indian in atlantis'));

    expect(page.data).toEqual([]);
    expect(page.interpretation.notes).toContain("no city 'atlantis'");
  });

  it('a price without a resolvable currency ranks within-price first, then the rest', async () => {
    const page = await search(`${q('under 500')}&${AT_ANCHOR}`);

    expect(page.data.map((item) => item.id)).toEqual(
      ids([
        // ≤ 500, nearest first
        S.chaatStreet, // 0.2
        S.goliNear, // 0.4
        S.tikkiPoint, // 1
        S.idliCorner, // 1.2
        S.bhelJunction, // 2
        S.sagarRatna, // 2.5
        S.goliFar, // 3
        // the rest, nearest first
        S.summerPavilion, // 0.6
        S.dakshin, // 0.8
        S.yetiMomos, // 1.5
        S.grandGrill, // 4
      ]),
    );
    expect(page.interpretation).toMatchObject({
      pricePreference: { maxCost: 500 },
    });
  });

  it('an explicit parameter overrides the query, with a note', async () => {
    const page = await search(`${q('best in gurgaon')}&city=new delhi`);

    expect(page.data.map((item) => item.id)).toEqual(
      ids([S.saravana, S.delhiDarbar]),
    );
    expect(page.interpretation.notes).toContain(
      "city: 'gurgaon' from the query, overridden by city=new delhi",
    );
  });

  it('pages a search with its cursor; another q cannot reuse it', async () => {
    const all = await searchIds(`${q('in gurgaon')}&limit=100`);
    const walked: string[] = [];
    let cursor: string | null = null;
    do {
      const suffix: string = cursor ? `&cursor=${cursor}` : '';
      const page: SearchPage = await search(
        `${q('in gurgaon')}&limit=4${suffix}`,
      );
      walked.push(...page.data.map((item) => item.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(walked).toEqual(all);

    const first = await search(`${q('in gurgaon')}&limit=4`);
    const reused = await request(app).get(
      `/v1/restaurants/search?${q('in new delhi')}&limit=4&cursor=${first.nextCursor}`,
    );
    expect(reused.status).toBe(400);
    expect(reused.body.error.code).toBe('CURSOR_INVALID');
  });

  it('503 SEARCH_UNAVAILABLE when Atlas Search is unreachable', async () => {
    const { app: failing } = await appFor(SEARCH_FIXTURE_TENANT, {
      aggregate: () =>
        Promise.reject(new MongoNetworkError('mongot unreachable')),
    });

    const response = await request(failing).get(
      `/v1/restaurants/search?${q('cafe')}`,
    );

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('SEARCH_UNAVAILABLE');
  });

  describe('a city first created by POST', () => {
    const TENANT = 'search-post-test';
    afterEach(() => collection.deleteMany({ tenantId: TENANT }));

    it('is understood in q right after the POST (vocabulary refresh) and found once indexed', async () => {
      const { app: own, vocabulary } = await appFor(TENANT);
      const created = await request(own)
        .post('/v1/restaurants')
        .send({
          name: 'Lake View Thali',
          address: 'Fateh Sagar Road',
          city: 'Udaipur',
          countryCode: 'IN',
          cuisines: ['Rajasthani'],
        });
      expect(created.status).toBe(201);

      await waitForSearch(
        async () => vocabulary.snapshot().cities.has('udaipur'),
        {
          what: 'vocabulary refresh',
        },
      );
      await waitForSearch(async () => {
        const page = (
          await request(own).get(
            `/v1/restaurants/search?${q('thali in udaipur')}`,
          )
        ).body as SearchPage;
        return page.data.some((item) => item.id === created.body.id);
      });
      const page = (
        await request(own).get(
          `/v1/restaurants/search?${q('rajasthani in udaipur')}`,
        )
      ).body as SearchPage;
      expect(page.interpretation).toMatchObject({
        city: 'udaipur',
        cuisines: ['rajasthani'],
      });
    });
  });
});
