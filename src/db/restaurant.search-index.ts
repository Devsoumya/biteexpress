import type { Document } from 'mongodb';

// The single source of the Atlas Search index definition (ADR-003), used by
// the seed and the test setup. The index name comes from SEARCH_INDEX_NAME.
// Static mappings: only the fields the queries need are indexed.
export const RESTAURANT_SEARCH_INDEX_DEFINITION: Document = {
  analyzers: [
    {
      name: 'folding',
      tokenizer: { type: 'standard' },
      tokenFilters: [{ type: 'lowercase' }, { type: 'icuFolding' }],
    },
  ],
  mappings: {
    dynamic: false,
    fields: {
      _id: { type: 'objectId' },
      tenantId: { type: 'token' },
      name: [
        { type: 'string', analyzer: 'folding' },
        {
          type: 'autocomplete',
          tokenization: 'edgeGram',
          minGrams: 2,
          maxGrams: 15,
          foldDiacritics: true,
        },
      ],
      cuisines: { type: 'string', analyzer: 'folding' },
      address: {
        type: 'document',
        fields: { locality: { type: 'string', analyzer: 'folding' } },
      },
      norm: {
        type: 'document',
        fields: { city: { type: 'token' }, cuisines: { type: 'token' } },
      },
      country: {
        type: 'document',
        fields: { code: { type: 'token' } },
      },
      location: { type: 'geo' },
      rating: {
        type: 'document',
        fields: {
          average: { type: 'number' },
          votes: { type: 'number' },
        },
      },
      cost: {
        type: 'document',
        fields: {
          averageForTwo: { type: 'number' },
          currency: { type: 'token' },
          priceRange: { type: 'number' },
        },
      },
      features: {
        type: 'document',
        fields: {
          tableBooking: { type: 'boolean' },
          onlineDelivery: { type: 'boolean' },
          deliveringNow: { type: 'boolean' },
        },
      },
    },
  },
  // Every list-item field, so mongot serves a page alone: with
  // returnStoredSource a field left out here never reaches the response.
  storedSource: {
    include: [
      'name',
      'address',
      'country',
      'cuisines',
      'rating',
      'cost',
      'features',
      'location',
    ],
  },
};
