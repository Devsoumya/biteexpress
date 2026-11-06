import { serviceDependencies } from '../../helpers/vocabulary';
import type { Collection, MongoClient } from 'mongodb';
import request from 'supertest';
import { RESTAURANTS_COLLECTION } from '../../../src/config/database';
import type { RestaurantDocument } from '../../../src/models/restaurant.model';
import { MongoRestaurantRepository } from '../../../src/repositories/restaurant.repository';
import { DefaultRestaurantService } from '../../../src/services/restaurant.service';
import { createTestApp } from '../../helpers/app';
import { expectDocumentedResponse } from '../../helpers/openapi-contract';
import {
  fullCreateBody,
  minimalCreateBody,
  seedRestaurant,
} from '../../helpers/restaurant-fixtures';
import { TEST_DB_NAME, connectTestClient } from '../../helpers/test-database';

// Writes use their own tenants and clean up, so the shared collection and
// search index stay empty for other tests.
const TENANT = 'api-test';
const OTHER_TENANT = 'api-test-other';
const NOW = new Date('2026-11-06T10:00:00Z');

describe('restaurant endpoints against Atlas Local', () => {
  let client: MongoClient;
  let collection: Collection<RestaurantDocument>;

  beforeAll(async () => {
    client = await connectTestClient();
    collection = client
      .db(TEST_DB_NAME)
      .collection<RestaurantDocument>(RESTAURANTS_COLLECTION);
  });

  afterEach(() =>
    collection.deleteMany({ tenantId: { $in: [TENANT, OTHER_TENANT] } }),
  );
  afterAll(() => client.close());

  function repositoryFor(tenantId: string) {
    return new MongoRestaurantRepository(collection, {
      tenantId,
      maxTimeMS: 2000,
      searchIndexName: 'restaurants_search',
    });
  }

  function appFor(tenantId: string) {
    return createTestApp({
      restaurantService: new DefaultRestaurantService(
        repositoryFor(tenantId),
        serviceDependencies({ clock: () => NOW }),
      ),
    });
  }

  describe('POST /v1/restaurants', () => {
    it('returns 201 with Location and stores a document the validator accepts', async () => {
      const response = await request(appFor(TENANT))
        .post('/v1/restaurants')
        .send(fullCreateBody());

      expect(response.status).toBe(201);
      expectDocumentedResponse(response, 'POST', '/v1/restaurants');
      expect(response.headers['location']).toBe(
        `/v1/restaurants/${response.body.id}`,
      );
      expect(response.body).toEqual({
        id: expect.stringMatching(/^[0-9a-f]{24}$/),
        name: 'Goli Vada Pav No. 1',
        address: 'Shop 12, Sector 29 Market',
        city: 'Gurugram',
        country: { code: 'IN', name: 'India' },
        cuisines: ['Street Food', 'Fast Food'],
        averageRating: null,
        locality: 'Sector 29',
        location: { latitude: 28.4595, longitude: 77.0688 },
        cost: { averageForTwo: 300, currency: 'INR', priceRange: 1 },
        features: {
          tableBooking: false,
          onlineDelivery: true,
          deliveringNow: null,
        },
        votes: 0,
        ratingLabel: 'Not rated',
        sourceId: null,
      });

      // Read straight from the collection: the insert passed $jsonSchema.
      const stored = await collection.findOne({ tenantId: TENANT });
      expect(stored).toMatchObject({
        tenantId: TENANT,
        country: { code: 'IN', name: 'India' },
        cost: { currency: 'INR' },
        rating: { votes: 0 },
        norm: { city: 'gurgaon', cuisines: ['street food', 'fast food'] },
        schemaVersion: 1,
        createdAt: NOW,
        updatedAt: NOW,
      });
      expect(stored?._id.toHexString()).toBe(response.body.id);
      expect(stored).not.toHaveProperty('sourceId');
    });

    it('stores no unknown values for a minimal body', async () => {
      const response = await request(appFor(TENANT))
        .post('/v1/restaurants')
        .send(minimalCreateBody());

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({
        location: null,
        cost: { averageForTwo: null, currency: 'PHP', priceRange: null },
        ratingLabel: 'Not rated',
      });
      const stored = await collection.findOne({ tenantId: TENANT });
      expect(stored).not.toHaveProperty('location');
      expect(stored).not.toHaveProperty('features');
      expect(stored?.cost).toEqual({ currency: 'PHP' });
      expect(stored?.rating).toEqual({ votes: 0 });
    });

    it('omits the location for 0,0', async () => {
      await request(appFor(TENANT))
        .post('/v1/restaurants')
        .send({ ...minimalCreateBody(), latitude: 0, longitude: 0 })
        .expect(201);

      const stored = await collection.findOne({ tenantId: TENANT });
      expect(stored).not.toHaveProperty('location');
    });

    it('writes nothing when the body is invalid', async () => {
      const response = await request(appFor(TENANT))
        .post('/v1/restaurants')
        .send({ ...minimalCreateBody(), latitude: 28.4 });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      await expect(
        collection.countDocuments({ tenantId: TENANT }),
      ).resolves.toBe(0);
    });
  });

  describe('GET /v1/restaurants/:id', () => {
    it('returns what POST created, at once (read-your-writes)', async () => {
      const app = appFor(TENANT);
      const created = await request(app)
        .post('/v1/restaurants')
        .send(fullCreateBody())
        .expect(201);

      const response = await request(app).get(
        created.headers['location'] ?? '',
      );

      expect(response.status).toBe(200);
      expect(response.body).toEqual(created.body);
    });

    it('returns a seeded restaurant with sourceId, votes and rating label', async () => {
      await repositoryFor(TENANT).upsertManyBySourceId(
        [seedRestaurant(3400341)],
        NOW,
      );
      const seeded = await collection.findOne({ tenantId: TENANT });
      const id = seeded?._id.toHexString() ?? '';

      const response = await request(appFor(TENANT)).get(
        `/v1/restaurants/${id}`,
      );

      expect(response.status).toBe(200);
      expectDocumentedResponse(response, 'GET', '/v1/restaurants/{id}');
      expect(response.body).toMatchObject({
        id,
        sourceId: 3400341,
        averageRating: 3.6,
        votes: 112,
        ratingLabel: 'Good',
        location: { latitude: 28.4595, longitude: 77.0688 },
      });
    });

    it("returns 404 for another tenant's restaurant", async () => {
      const created = await request(appFor(OTHER_TENANT))
        .post('/v1/restaurants')
        .send(minimalCreateBody())
        .expect(201);

      const response = await request(appFor(TENANT)).get(
        `/v1/restaurants/${created.body.id}`,
      );

      expect(response.status).toBe(404);
      expect(response.body).toEqual({
        error: {
          code: 'RESTAURANT_NOT_FOUND',
          message: 'Restaurant not found',
        },
      });
    });

    it('returns 404 for a well-formed id that does not exist', async () => {
      const response = await request(appFor(TENANT)).get(
        '/v1/restaurants/000000000000000000000000',
      );

      expect(response.status).toBe(404);
    });

    it('returns 400 INVALID_ID for a malformed id', async () => {
      const response = await request(appFor(TENANT)).get('/v1/restaurants/abc');

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('INVALID_ID');
    });
  });
});
