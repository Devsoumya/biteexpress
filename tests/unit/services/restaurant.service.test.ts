import {
  serviceDependencies,
  staticVocabulary,
} from '../../helpers/vocabulary';
import { ObjectId } from 'mongodb';
import type {
  RestaurantDocument,
  RestaurantDraft,
  RestaurantRepository,
} from '../../../src/models/restaurant.model';
import type {
  RestaurantSearchHit,
  SearchCriteria,
  SearchPage,
  SearchResult,
} from '../../../src/models/search.model';
import { encodeCursor } from '../../../src/utils/cursor';
import { DefaultRestaurantService } from '../../../src/services/restaurant.service';
import { ApplicationError } from '../../../src/utils/application-error';
import {
  createRestaurantBodySchema,
  listRestaurantsQuerySchema,
  searchRestaurantsQuerySchema,
} from '../../../src/validators/restaurant.schema';
import { minimalCreateBody } from '../../helpers/restaurant-fixtures';

const NOW = new Date('2026-11-06T10:00:00Z');

// A fake at the injected seam: records inserts and serves one stored document.
class FakeRepository implements RestaurantRepository {
  inserted: { draft: RestaurantDraft; now: Date }[] = [];
  stored: RestaurantDocument | null = null;

  upsertManyBySourceId(): never {
    throw new Error('not used');
  }

  insert(draft: RestaurantDraft, now: Date): Promise<RestaurantDocument> {
    this.inserted.push({ draft, now });
    return Promise.resolve({
      _id: new ObjectId(),
      tenantId: 'biteexpress',
      ...draft,
      createdAt: now,
      updatedAt: now,
    });
  }

  findById(): Promise<RestaurantDocument | null> {
    return Promise.resolve(this.stored);
  }

  searches: { criteria: SearchCriteria; page: SearchPage }[] = [];
  searchResult: SearchResult = { hits: [], hasMore: false };

  vocabulary(): never {
    throw new Error('not used: the service reads the vocabulary provider');
  }

  search(criteria: SearchCriteria, page: SearchPage): Promise<SearchResult> {
    this.searches.push({ criteria, page });
    return Promise.resolve(this.searchResult);
  }
}

function hit(id: string, token: string): RestaurantSearchHit {
  return {
    _id: new ObjectId(id),
    name: `R ${id}`,
    address: { line: 'line', city: 'Gurgaon' },
    country: { code: 'IN', name: 'India' },
    cuisines: [],
    rating: { average: 4 },
    paginationToken: token,
  };
}

describe('DefaultRestaurantService', () => {
  let repository: FakeRepository;
  let service: DefaultRestaurantService;
  let vocabulary: ReturnType<typeof staticVocabulary>;

  beforeEach(() => {
    repository = new FakeRepository();
    vocabulary = staticVocabulary();
    service = new DefaultRestaurantService(
      repository,
      serviceDependencies({ vocabulary, clock: () => NOW }),
    );
  });

  it('inserts the mapped draft, with no tenant, at the clock time', async () => {
    const created = await service.create(
      createRestaurantBodySchema.parse(minimalCreateBody()),
    );

    expect(repository.inserted).toHaveLength(1);
    const [call] = repository.inserted;
    expect(call?.now).toBe(NOW);
    expect(call?.draft).not.toHaveProperty('tenantId');
    expect(call?.draft.country).toEqual({ code: 'PH', name: 'Philippines' });
    expect(created.createdAt).toBe(NOW);
  });

  it('fails loudly if a country code the schema should have rejected reaches it', async () => {
    await expect(
      service.create({ ...minimalCreateBody(), countryCode: 'XX' } as never),
    ).rejects.toThrow('Unsupported country code XX');
    expect(repository.inserted).toHaveLength(0);
  });

  it('returns the stored restaurant', async () => {
    const created = await service.create(
      createRestaurantBodySchema.parse(minimalCreateBody()),
    );
    repository.stored = created;

    await expect(service.getById(created._id.toHexString())).resolves.toBe(
      created,
    );
  });

  it('throws RESTAURANT_NOT_FOUND (404) when the repository finds nothing', async () => {
    const error: unknown = await service
      .getById('5f1d7c3e9b1e8a0012345678')
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApplicationError);
    expect(error).toMatchObject({
      statusCode: 404,
      code: 'RESTAURANT_NOT_FOUND',
    });
  });

  describe('list', () => {
    const query = (raw: Record<string, unknown>) =>
      listRestaurantsQuerySchema.parse(raw);

    it('passes the normalized criteria and the page size to the repository', async () => {
      await service.list(query({ city: 'Gurugram', limit: '5' }));

      expect(repository.searches).toEqual([
        {
          criteria: { city: 'gurgaon', cuisineMatch: 'any' },
          page: { limit: 5 },
        },
      ]);
    });

    it('returns nextCursor null on the last page', async () => {
      repository.searchResult = {
        hits: [hit('5f1d7c3e9b1e8a0012345678', 'tok-1')],
        hasMore: false,
      };

      const result = await service.list(query({}));

      expect(result.nextCursor).toBeNull();
      expect(result.data.map((item) => item.id)).toEqual([
        '5f1d7c3e9b1e8a0012345678',
      ]);
    });

    it("returns the last item's token as a query-bound cursor when more exist", async () => {
      repository.searchResult = {
        hits: [
          hit('5f1d7c3e9b1e8a0012345678', 'tok-1'),
          hit('5f1d7c3e9b1e8a0012345679', 'tok-2'),
        ],
        hasMore: true,
      };

      const result = await service.list(query({ city: 'Gurgaon' }));

      expect(result.nextCursor).toBe(
        encodeCursor('tok-2', { city: 'gurgaon', cuisineMatch: 'any' }),
      );
    });

    it('turns a valid cursor into searchAfter for the next page', async () => {
      const cursor = encodeCursor('tok-2', {
        city: 'gurgaon',
        cuisineMatch: 'any',
      });

      await service.list(query({ city: 'Gurgaon', cursor, limit: '50' }));

      expect(repository.searches[0]?.page).toEqual({
        limit: 50,
        searchAfter: 'tok-2',
      });
    });

    it('rejects a cursor from another query before searching', async () => {
      const cursor = encodeCursor('tok-2', {
        city: 'gurgaon',
        cuisineMatch: 'any',
      });

      await expect(
        service.list(query({ city: 'New Delhi', cursor })),
      ).rejects.toMatchObject({ code: 'CURSOR_INVALID' });
      expect(repository.searches).toHaveLength(0);
    });
  });

  it('refreshes the vocabulary after a successful POST', async () => {
    await service.create(createRestaurantBodySchema.parse(minimalCreateBody()));

    expect(vocabulary.refreshes).toBe(1);
  });

  describe('search', () => {
    const search = (raw: Record<string, unknown>) =>
      service.search(searchRestaurantsQuerySchema.parse(raw));

    it('interprets q, searches the merged criteria and returns the interpretation', async () => {
      const result = await search({
        q: 'best south indian in gurgaon',
        limit: '5',
      });

      expect(repository.searches).toEqual([
        {
          criteria: {
            cuisineMatch: 'any',
            city: 'gurgaon',
            cuisines: ['south indian'],
            sort: 'rating',
            minVotes: 20,
          },
          page: { limit: 5 },
        },
      ]);
      expect(result.interpretation).toEqual({
        query: 'best south indian in gurgaon',
        city: 'gurgaon',
        cuisines: ['south indian'],
        sort: 'rating',
        minVotes: 20,
        notes: [],
      });
      expect(result.nextCursor).toBeNull();
    });

    it("binds the cursor to the merged criteria, so another q can't reuse it", async () => {
      repository.searchResult = {
        hits: [hit('5f1d7c3e9b1e8a0012345678', 'tok-1')],
        hasMore: true,
      };
      const first = await search({ q: 'cafe in gurgaon' });

      await expect(
        search({ q: 'cafe in new delhi', cursor: first.nextCursor ?? '' }),
      ).rejects.toMatchObject({ code: 'CURSOR_INVALID' });
    });
  });
});
