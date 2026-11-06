import type { Document } from 'mongodb';

// The single source of the collection validator (ADR-001 appendix), applied by
// the seed and the test setup. `number` accepts int, long, double and
// decimal, because the driver stores whole JS numbers (a 4.0 rating) as int32.
export const RESTAURANT_JSON_SCHEMA: Document = {
  bsonType: 'object',
  required: [
    '_id',
    'tenantId',
    'name',
    'address',
    'country',
    'cuisines',
    'norm',
    'createdAt',
    'updatedAt',
    'schemaVersion',
  ],
  additionalProperties: false,
  properties: {
    _id: { bsonType: 'objectId' },
    tenantId: { bsonType: 'string', minLength: 1 },
    sourceId: { bsonType: ['int', 'long'], minimum: 1 },
    name: { bsonType: 'string', minLength: 1, maxLength: 200 },
    address: {
      bsonType: 'object',
      required: ['line', 'city'],
      additionalProperties: false,
      properties: {
        line: { bsonType: 'string', minLength: 1 },
        locality: { bsonType: 'string', minLength: 1 },
        city: { bsonType: 'string', minLength: 1 },
      },
    },
    country: {
      bsonType: 'object',
      required: ['code', 'name'],
      additionalProperties: false,
      properties: {
        code: { bsonType: 'string', pattern: '^[A-Z]{2}$' },
        name: { bsonType: 'string', minLength: 1 },
      },
    },
    location: {
      bsonType: 'object',
      required: ['type', 'coordinates'],
      additionalProperties: false,
      properties: {
        type: { enum: ['Point'] },
        coordinates: {
          bsonType: 'array',
          minItems: 2,
          maxItems: 2,
          additionalItems: false,
          items: [
            { bsonType: 'number', minimum: -180, maximum: 180 },
            { bsonType: 'number', minimum: -90, maximum: 90 },
          ],
        },
      },
    },
    cuisines: {
      bsonType: 'array',
      uniqueItems: true,
      items: { bsonType: 'string', minLength: 1 },
    },
    cost: {
      bsonType: 'object',
      required: ['currency'],
      additionalProperties: false,
      properties: {
        averageForTwo: {
          bsonType: 'number',
          minimum: 0,
          exclusiveMinimum: true,
        },
        currency: { bsonType: 'string', pattern: '^[A-Z]{3}$' },
        priceRange: { bsonType: 'int', minimum: 1, maximum: 4 },
      },
    },
    features: {
      bsonType: 'object',
      additionalProperties: false,
      properties: {
        tableBooking: { bsonType: 'bool' },
        onlineDelivery: { bsonType: 'bool' },
        deliveringNow: { bsonType: 'bool' },
      },
    },
    rating: {
      bsonType: 'object',
      required: ['votes'],
      additionalProperties: false,
      properties: {
        average: {
          bsonType: 'number',
          minimum: 0,
          exclusiveMinimum: true,
          maximum: 5,
        },
        votes: { bsonType: ['int', 'long'], minimum: 0 },
      },
    },
    norm: {
      bsonType: 'object',
      required: ['city', 'cuisines'],
      additionalProperties: false,
      properties: {
        city: { bsonType: 'string', minLength: 1 },
        cuisines: {
          bsonType: 'array',
          uniqueItems: true,
          items: { bsonType: 'string', minLength: 1 },
        },
      },
    },
    createdAt: { bsonType: 'date' },
    updatedAt: { bsonType: 'date' },
    schemaVersion: { bsonType: 'int', minimum: 1 },
  },
};
