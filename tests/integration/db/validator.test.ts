import {
  type Collection,
  type Document,
  Double,
  type MongoClient,
  MongoServerError,
  ObjectId,
} from 'mongodb';
import { RESTAURANTS_COLLECTION } from '../../../src/config/database';
import { seedRestaurant } from '../../helpers/restaurant-fixtures';
import { TEST_DB_NAME, connectTestClient } from '../../helpers/test-database';

const TENANT = 'validator-test';

describe('restaurants $jsonSchema validator', () => {
  let client: MongoClient;
  let collection: Collection<Document>;

  beforeAll(async () => {
    client = await connectTestClient();
    collection = client.db(TEST_DB_NAME).collection(RESTAURANTS_COLLECTION);
  });

  afterAll(async () => {
    await collection.deleteMany({ tenantId: TENANT });
    await client.close();
  });

  // Each document gets its own source ID, so uq_tenant_source never trips.
  let nextSourceId = 1;
  function validDocument(): Document {
    const now = new Date();
    return {
      _id: new ObjectId(),
      tenantId: TENANT,
      ...seedRestaurant(nextSourceId++),
      createdAt: now,
      updatedAt: now,
    };
  }

  it('accepts a document mapped from a CSV row', async () => {
    await expect(collection.insertOne(validDocument())).resolves.toMatchObject({
      acknowledged: true,
    });
  });

  it('accepts a document without the optional location, cost and rating average', async () => {
    const { location, cost, ...rest } = validDocument();

    await expect(
      collection.insertOne({ ...rest, rating: { votes: 0 } }),
    ).resolves.toMatchObject({ acknowledged: true });
  });

  it.each<[string, (doc: Document) => Document]>([
    ['norm is missing', ({ norm: _n, ...doc }) => doc],
    [
      'rating.average is 0 (unknown must be absent)',
      (doc) => ({ ...doc, rating: { average: 0, votes: 3 } }),
    ],
    [
      'longitude is out of range',
      (doc) => ({
        ...doc,
        location: { type: 'Point', coordinates: [200, 28.4] },
      }),
    ],
    [
      'an unknown top-level field is present',
      (doc) => ({ ...doc, ratingText: 'Good' }),
    ],
    [
      'country.code is lowercase',
      (doc) => ({ ...doc, country: { code: 'in', name: 'India' } }),
    ],
    [
      'schemaVersion is a double',
      (doc) => ({ ...doc, schemaVersion: new Double(1.5) }),
    ],
    [
      'cost.averageForTwo is 0',
      (doc) => ({ ...doc, cost: { averageForTwo: 0, currency: 'INR' } }),
    ],
    ['cuisines repeat', (doc) => ({ ...doc, cuisines: ['Cafe', 'Cafe'] })],
  ])('rejects a document where %s (code 121)', async (_case, change) => {
    const error = await collection.insertOne(change(validDocument())).then(
      () => undefined,
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(MongoServerError);
    expect((error as MongoServerError).code).toBe(121);
  });
});
