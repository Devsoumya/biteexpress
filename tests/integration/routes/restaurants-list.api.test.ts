import { type Collection, type MongoClient, MongoNetworkError } from 'mongodb';
import request from 'supertest';
import { RESTAURANTS_COLLECTION } from '../../../src/config/database';
import type { RestaurantDocument } from '../../../src/models/restaurant.model';
import type { SearchExecutor } from '../../../src/models/search.model';
import { MongoRestaurantRepository } from '../../../src/repositories/restaurant.repository';
import { RuleBasedQueryInterpreter } from '../../../src/services/query-interpreter.service';
import { DefaultRestaurantService } from '../../../src/services/restaurant.service';
import { CachedVocabularyService } from '../../../src/services/vocabulary.service';
import { haversineKm } from '../../../src/utils/geo';
import {
  ANCHOR,
  FIXTURE_TENANT,
  GURGAON,
  NEW_DELHI,
  ORLANDO,
  OTHER_TENANT_TWIN,
} from '../../fixtures/restaurants.fixture';
import { createTestApp } from '../../helpers/app';
import { captureLogger, requestLines } from '../../helpers/logger';
import { expectDocumentedResponse } from '../../helpers/openapi-contract';
import { minimalCreateBody } from '../../helpers/restaurant-fixtures';
import {
  TEST_DB_NAME,
  TEST_SEARCH_INDEX_NAME,
  connectTestClient,
} from '../../helpers/test-database';
import { waitForSearch } from '../../helpers/wait-for-search';

const ids = (docs: RestaurantDocument[]) =>
  docs.map((d) => d._id.toHexString());
const G = GURGAON;
const D = NEW_DELHI;
const AT_ANCHOR = `lat=${ANCHOR.lat}&lng=${ANCHOR.lng}`;

interface Page {
  data: {
    id: string;
    name: string;
    distanceKm?: number;
    averageRating: number | null;
  }[];
  nextCursor: string | null;
}

describe('GET /v1/restaurants against Atlas Search (fixtures)', () => {
  let client: MongoClient;
  let collection: Collection<RestaurantDocument>;
  // The real vocabulary of the fixture tenant, loaded from the database.
  let fixtureVocabulary: CachedVocabularyService;

  beforeAll(async () => {
    client = await connectTestClient();
    collection = client
      .db(TEST_DB_NAME)
      .collection<RestaurantDocument>(RESTAURANTS_COLLECTION);
    fixtureVocabulary = new CachedVocabularyService(
      new MongoRestaurantRepository(collection, {
        tenantId: FIXTURE_TENANT,
        maxTimeMS: 2000,
        searchIndexName: TEST_SEARCH_INDEX_NAME,
      }),
      { refreshMs: 60_000, onError: () => undefined },
    );
    await fixtureVocabulary.load();
  });
  afterAll(() => client.close());

  function appFor(tenantId: string, executor?: SearchExecutor) {
    const repository = new MongoRestaurantRepository(
      collection,
      { tenantId, maxTimeMS: 2000, searchIndexName: TEST_SEARCH_INDEX_NAME },
      executor,
    );
    return createTestApp({
      restaurantService: new DefaultRestaurantService(repository, {
        vocabulary: fixtureVocabulary,
        interpreter: new RuleBasedQueryInterpreter({ bestMinVotes: 20 }),
      }),
    });
  }

  async function list(query: string, tenantId = FIXTURE_TENANT): Promise<Page> {
    const response = await request(appFor(tenantId)).get(
      `/v1/restaurants?${query}`,
    );
    expect(response.status).toBe(200);
    expectDocumentedResponse(response, 'GET', '/v1/restaurants');
    return response.body as Page;
  }

  const listIds = async (query: string) =>
    (await list(query)).data.map((item) => item.id);

  describe('items', () => {
    it('show the values filters and sorts use: votes, label, cost and features', async () => {
      const page = await list(`city=gurgaon&limit=100&${AT_ANCHOR}`);
      const item = page.data.find(
        (i) => i.id === G.goliVadaPav._id.toHexString(),
      );

      expect(item).toEqual({
        id: G.goliVadaPav._id.toHexString(),
        name: 'Goli Vada Pav No. 1',
        address: 'Goli Vada Pav No. 1 Road',
        city: 'Gurgaon',
        country: { code: 'IN', name: 'India' },
        cuisines: ['Street Food'],
        averageRating: 3.6,
        votes: 112,
        ratingLabel: 'Good',
        cost: { averageForTwo: 200, currency: 'INR', priceRange: null },
        features: {
          tableBooking: null,
          onlineDelivery: null,
          deliveringNow: null,
        },
        distanceKm: expect.any(Number),
      });
    });

    it('show null for an unknown cost and an unrated restaurant', async () => {
      const page = await list('city=gurgaon&limit=100');
      const byId = new Map(page.data.map((i) => [i.id, i]));

      expect(byId.get(G.noCost._id.toHexString())).toMatchObject({
        cost: { averageForTwo: null, currency: 'INR', priceRange: null },
      });
      expect(byId.get(G.unrated._id.toHexString())).toMatchObject({
        averageRating: null,
        votes: 2,
        ratingLabel: 'Not rated',
      });
    });
  });

  describe('filters', () => {
    it('city, through an alias, case-insensitively', async () => {
      const result = await listIds('city=GURUGRAM&limit=100');

      expect(result.sort()).toEqual(ids(Object.values(G)).sort());
    });

    it('cuisine any vs all', async () => {
      expect(
        (await listIds('cuisine=south indian,chinese&limit=100')).sort(),
      ).toEqual(ids([G.summerPavilion, D.saravana]).sort());
      expect(
        (
          await listIds(
            'cuisine=North Indian,Street Food&cuisineMatch=all&limit=100',
          )
        ).sort(),
      ).toEqual(ids([G.noLocation, D.paratha]).sort());
    });

    it('minRating excludes unrated and lower-rated restaurants', async () => {
      expect(await listIds('city=gurgaon&minRating=4.2&limit=100')).toEqual(
        ids([G.farDhaba, G.noLocation, G.summerPavilion, G.chaatCorner]),
      );
    });

    it('minVotes', async () => {
      expect((await listIds('minVotes=1000&limit=100')).sort()).toEqual(
        ids([D.saravana, D.paratha]).sort(),
      );
    });

    it('a cost range stays in INR and never matches the 900 USD restaurant', async () => {
      const result = await listIds(
        'minCost=700&maxCost=1000&currency=INR&limit=100',
      );

      expect(result.sort()).toEqual(
        ids([G.summerPavilion, G.chaatCorner, G.noLocation, D.darbar]).sort(),
      );
      expect(result).not.toContain(ORLANDO.lakeGrill._id.toHexString());
    });

    it("infers the currency from the city's country (Orlando → USD)", async () => {
      expect(await listIds('city=Orlando&maxCost=1000')).toEqual(
        ids([ORLANDO.lakeGrill, ORLANDO.diner]),
      );
    });

    it('name: type-ahead prefix and one typo, ordered by relevance', async () => {
      expect((await listIds('name=gol'))[0]).toBe(
        G.goliVadaPav._id.toHexString(),
      );
      expect((await listIds('name=goli vada pao'))[0]).toBe(
        G.goliVadaPav._id.toHexString(),
      );
    });

    it('combines city, cuisine and minRating', async () => {
      expect(
        await listIds('city=gurgaon&cuisine=north indian&minRating=4'),
      ).toEqual(ids([G.farDhaba, G.noLocation, G.twinTikkaA, G.twinTikkaB]));
    });

    it('excludes another tenant at identical coordinates (invariant 5)', async () => {
      const result = await listIds(`${AT_ANCHOR}&radiusKm=1&limit=100`);

      expect(result).toContain(G.goliVadaPav._id.toHexString());
      expect(result).not.toContain(OTHER_TENANT_TWIN._id.toHexString());
    });
  });

  describe('sorts', () => {
    it('the default (no coordinates) is rating, votes, _id, with unrated last', async () => {
      expect(await listIds('city=gurgaon&limit=100')).toEqual(
        ids([
          G.farDhaba, // 4.5
          G.noLocation, // 4.4
          G.summerPavilion, // 4.2 / 300, _id 02
          G.chaatCorner, // 4.2 / 300, _id 03
          G.twinTikkaA, // 4.0 / 40, _id 06
          G.twinTikkaB, // 4.0 / 40, _id 07
          G.cyberCafe, // 3.9
          G.goliVadaPav, // 3.6
          G.noCost, // 3.0
          G.unrated, // last
        ]),
      );
    });

    it('explicit sort=rating excludes unrated restaurants', async () => {
      expect(await listIds('city=gurgaon&sort=rating&limit=100')).not.toContain(
        G.unrated._id.toHexString(),
      );
    });

    it('sort=cost asc and desc, ties by _id, unknown cost excluded', async () => {
      const ascending = ids([
        G.goliVadaPav, // 200
        G.unrated, // 300
        G.cyberCafe, // 500
        G.twinTikkaA, // 600, _id 06
        G.twinTikkaB, // 600, _id 07
        G.noLocation, // 700
        G.summerPavilion, // 800, _id 02
        G.chaatCorner, // 800, _id 03
        G.farDhaba, // 1200
      ]);

      expect(await listIds('city=gurgaon&sort=cost&limit=100')).toEqual(
        ascending,
      );
      const descending = await listIds(
        'city=gurgaon&sort=cost&order=desc&limit=100',
      );
      expect(descending[0]).toBe(G.farDhaba._id.toHexString());
      expect(descending).not.toContain(G.noCost._id.toHexString());
      // Ties still break by _id ascending in the descending sort.
      expect(
        descending.indexOf(G.summerPavilion._id.toHexString()),
      ).toBeLessThan(descending.indexOf(G.chaatCorner._id.toHexString()));
    });

    it('a name filter with sort=cost narrows without reordering', async () => {
      expect(
        await listIds('city=gurgaon&name=twin tikka&sort=cost&order=desc'),
      ).toEqual(ids([G.twinTikkaA, G.twinTikkaB]));
    });
  });

  describe('distance', () => {
    it('near me (no city): nearest first within 5 km, with exact distanceKm', async () => {
      const page = await list(`${AT_ANCHOR}&limit=100`);

      expect(page.data.map((item) => item.id)).toEqual(
        ids([
          G.goliVadaPav, // 0.2
          G.summerPavilion, // 0.5
          G.chaatCorner, // 1
          G.unrated, // 1.5
          G.twinTikkaA, // 2, shared point: _id
          G.twinTikkaB,
          G.noCost, // 2.5
          G.cyberCafe, // 3
        ]),
      );
      expect(page.data.map((item) => item.distanceKm)).toEqual([
        0.2, 0.5, 1, 1.5, 2, 2, 2.5, 3,
      ]);
    });

    it('radiusKm widens the circle to include the 6 km restaurant', async () => {
      expect(await listIds(`${AT_ANCHOR}&radiusKm=10&limit=100`)).toContain(
        G.farDhaba._id.toHexString(),
      );
    });

    it.each(['', '&sort=distance'])(
      'city + coordinates%s: the whole city, nearest first, unlocated last',
      async (sort) => {
        const page = await list(`city=gurgaon&${AT_ANCHOR}${sort}&limit=100`);

        expect(page.data).toHaveLength(Object.keys(G).length);
        expect(page.data.at(-1)?.id).toBe(G.noLocation._id.toHexString());
        expect(page.data.at(-1)).not.toHaveProperty('distanceKm');
        expect(page.data.at(-2)?.id).toBe(G.farDhaba._id.toHexString());
      },
    );

    it('a far city with my coordinates: only that city, with real distances', async () => {
      const page = await list(`city=new delhi&${AT_ANCHOR}`);

      expect(page.data.map((item) => item.id)).toEqual(
        ids([D.saravana, D.darbar, D.connaught, D.paratha]),
      );
      const [first] = page.data;
      const [lng, lat] = D.saravana.location?.coordinates ?? [0, 0];
      expect(first?.distanceKm).toBe(
        Math.round(haversineKm(ANCHOR, { lat, lng }) * 100) / 100,
      );
    });

    it('sort=distance without coordinates is a 400', async () => {
      const response = await request(appFor(FIXTURE_TENANT)).get(
        '/v1/restaurants?sort=distance',
      );

      expect(response.status).toBe(400);
      expect(response.body.error.details[0]).toMatchObject({ path: 'sort' });
    });
  });

  describe('paging', () => {
    it.each([
      'city=gurgaon',
      'sort=cost&currency=INR',
      `city=gurgaon&${AT_ANCHOR}`,
    ])(
      'walking pages of 3 equals one big page (%s): no gaps, no repeats',
      async (query) => {
        const everything = await listIds(`${query}&limit=100`);
        const walked: string[] = [];
        let cursor: string | null = null;
        do {
          const suffix: string = cursor ? `&cursor=${cursor}` : '';
          const page: Page = await list(`${query}&limit=3${suffix}`);
          walked.push(...page.data.map((item) => item.id));
          cursor = page.nextCursor;
        } while (cursor);

        expect(walked).toEqual(everything);
      },
    );

    it('a cursor reused with another sort is a 400 CURSOR_INVALID', async () => {
      const first = await list('city=gurgaon&limit=3');
      const response = await request(appFor(FIXTURE_TENANT)).get(
        `/v1/restaurants?city=gurgaon&sort=cost&limit=3&cursor=${first.nextCursor}`,
      );

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('CURSOR_INVALID');
    });
  });

  it('logs one line with the real database time for a list request', async () => {
    const captured = captureLogger();
    const repository = new MongoRestaurantRepository(collection, {
      tenantId: FIXTURE_TENANT,
      maxTimeMS: 2000,
      searchIndexName: TEST_SEARCH_INDEX_NAME,
    });
    const logged = createTestApp({
      logger: captured.logger,
      restaurantService: new DefaultRestaurantService(repository, {
        vocabulary: fixtureVocabulary,
        interpreter: new RuleBasedQueryInterpreter({ bestMinVotes: 20 }),
      }),
    });

    await request(logged).get('/v1/restaurants?city=gurgaon&limit=3');

    const [line] = await requestLines(captured);
    expect(line).toMatchObject({
      status: 200,
      search: { filters: ['city'], resultCount: 3, hasNextPage: true },
    });
    expect(line?.['dbMs']).toBeGreaterThan(0);
    expect(line?.['dbMs']).toBeLessThanOrEqual(line?.['durationMs'] as number);
  });

  describe('search failure', () => {
    it('503 SEARCH_UNAVAILABLE on list while GET by id still works', async () => {
      const app = appFor(FIXTURE_TENANT, {
        aggregate: () =>
          Promise.reject(new MongoNetworkError('mongot unreachable')),
      });

      const listing = await request(app).get('/v1/restaurants');
      const detail = await request(app).get(
        `/v1/restaurants/${G.goliVadaPav._id.toHexString()}`,
      );

      expect(listing.status).toBe(503);
      expect(listing.headers['retry-after']).toBe('5');
      expect(listing.body.error.code).toBe('SEARCH_UNAVAILABLE');
      expect(detail.status).toBe(200);
    });
  });

  describe('POST then list', () => {
    const TENANT = 'list-post-test';
    afterEach(() => collection.deleteMany({ tenantId: TENANT }));

    it('a created restaurant appears in the list once the index catches up', async () => {
      const app = appFor(TENANT);
      const created = await request(app)
        .post('/v1/restaurants')
        .send(minimalCreateBody());
      expect(created.status).toBe(201);

      await waitForSearch(async () => {
        const page = await request(app).get('/v1/restaurants');
        return (page.body as Page).data.some(
          (item) => item.id === created.body.id,
        );
      });
    });
  });
});
