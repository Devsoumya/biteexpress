import {
  type Collection,
  type MongoClient,
  MongoServerError,
  ObjectId,
} from 'mongodb';
import { RESTAURANTS_COLLECTION } from '../../../src/config/database';
import type { RestaurantDocument } from '../../../src/models/restaurant.model';
import { MongoRestaurantRepository } from '../../../src/repositories/restaurant.repository';
import { seedRestaurant } from '../../helpers/restaurant-fixtures';
import { TEST_DB_NAME, connectTestClient } from '../../helpers/test-database';

// Writes use their own tenant and clean up, so other tests sharing the
// collection and search index see no extra documents.
const TENANT = 'seed-test';

describe('MongoRestaurantRepository.upsertManyBySourceId', () => {
  let client: MongoClient;
  let collection: Collection<RestaurantDocument>;
  let repository: MongoRestaurantRepository;

  beforeAll(async () => {
    client = await connectTestClient();
    collection = client
      .db(TEST_DB_NAME)
      .collection<RestaurantDocument>(RESTAURANTS_COLLECTION);
    repository = new MongoRestaurantRepository(collection, {
      tenantId: TENANT,
      maxTimeMS: 2000,
      searchIndexName: 'restaurants_search',
    });
  });

  afterEach(() => collection.deleteMany({ tenantId: TENANT }));
  afterAll(() => client.close());

  const restaurants = [1, 2, 3, 4, 5].map((id) => seedRestaurant(id));
  const snapshot = () =>
    collection.find({ tenantId: TENANT }, { sort: { sourceId: 1 } }).toArray();

  it('inserts on the first run and inserts nothing on the second', async () => {
    await expect(
      repository.upsertManyBySourceId(restaurants, new Date('2026-01-01')),
    ).resolves.toEqual({ inserted: 5, updated: 0 });
    const first = await snapshot();

    await expect(
      repository.upsertManyBySourceId(restaurants, new Date('2026-02-01')),
    ).resolves.toEqual({ inserted: 0, updated: 5 });
    const second = await snapshot();

    expect(second).toHaveLength(5);
    expect(second.map((d) => d._id)).toEqual(first.map((d) => d._id));
    expect(second.map((d) => d.createdAt)).toEqual(
      first.map((d) => d.createdAt),
    );
    expect(
      second.every((d) => d.updatedAt.getTime() === Date.parse('2026-02-01')),
    ).toBe(true);
  });

  it('removes a value that became unknown on a later run', async () => {
    const [first] = restaurants;
    if (!first) throw new Error('fixture missing');
    await repository.upsertManyBySourceId([first], new Date());
    const { location, ...withoutLocation } = first;

    await repository.upsertManyBySourceId([withoutLocation], new Date());

    const [stored] = await snapshot();
    expect(stored).not.toHaveProperty('location');
  });

  it('does nothing for an empty batch', async () => {
    await expect(
      repository.upsertManyBySourceId([], new Date()),
    ).resolves.toEqual({ inserted: 0, updated: 0 });
  });

  it('rejects a second document with the same tenant and source ID (code 11000)', async () => {
    const now = new Date();
    const restaurant = { ...seedRestaurant(42), tenantId: TENANT };
    await collection.insertOne({
      ...restaurant,
      createdAt: now,
      updatedAt: now,
    } as RestaurantDocument);

    const error = await collection
      .insertOne({
        ...restaurant,
        createdAt: now,
        updatedAt: now,
      } as RestaurantDocument)
      .then(
        () => undefined,
        (e: unknown) => e,
      );

    expect(error).toBeInstanceOf(MongoServerError);
    expect((error as MongoServerError).code).toBe(11000);
  });
});

describe('MongoRestaurantRepository insert and findById', () => {
  const OTHER_TENANT = 'repository-test-other';
  const NOW = new Date('2026-11-06T10:00:00Z');
  let client: MongoClient;
  let collection: Collection<RestaurantDocument>;
  let repository: MongoRestaurantRepository;
  let otherTenantRepository: MongoRestaurantRepository;

  beforeAll(async () => {
    client = await connectTestClient();
    collection = client
      .db(TEST_DB_NAME)
      .collection<RestaurantDocument>(RESTAURANTS_COLLECTION);
    repository = new MongoRestaurantRepository(collection, {
      tenantId: TENANT,
      maxTimeMS: 2000,
      searchIndexName: 'restaurants_search',
    });
    otherTenantRepository = new MongoRestaurantRepository(collection, {
      tenantId: OTHER_TENANT,
      maxTimeMS: 2000,
      searchIndexName: 'restaurants_search',
    });
  });

  afterEach(() =>
    collection.deleteMany({ tenantId: { $in: [TENANT, OTHER_TENANT] } }),
  );
  afterAll(() => client.close());

  it('inserts with its own tenant and timestamps, returning exactly what is stored', async () => {
    const { sourceId: _sourceId, ...draft } = seedRestaurant(1);

    const inserted = await repository.insert(draft, NOW);

    expect(inserted).toMatchObject({
      tenantId: TENANT,
      createdAt: NOW,
      updatedAt: NOW,
    });
    await expect(collection.findOne({ _id: inserted._id })).resolves.toEqual(
      inserted,
    );
  });

  it("finds its own tenant's restaurant by id", async () => {
    const { sourceId: _sourceId, ...draft } = seedRestaurant(2);
    const inserted = await repository.insert(draft, NOW);

    await expect(
      repository.findById(inserted._id.toHexString()),
    ).resolves.toEqual(inserted);
  });

  it("returns null for another tenant's restaurant and for an unknown id", async () => {
    const { sourceId: _sourceId, ...draft } = seedRestaurant(3);
    const inserted = await repository.insert(draft, NOW);

    await expect(
      otherTenantRepository.findById(inserted._id.toHexString()),
    ).resolves.toBeNull();
    await expect(
      repository.findById(new ObjectId().toHexString()),
    ).resolves.toBeNull();
  });
});
