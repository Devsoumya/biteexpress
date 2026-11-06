import { z } from 'zod';
import {
  COMPONENT_SCHEMAS,
  buildOpenApiDocument,
} from '../../../src/openapi/openapi.document';
import { ERROR_CODES } from '../../../src/constants/error-codes';
import {
  createRestaurantBodySchema,
  listRestaurantsQuerySchema,
} from '../../../src/validators/restaurant.schema';

const document = buildOpenApiDocument() as {
  openapi: string;
  paths: Record<string, Record<string, Record<string, unknown>>>;
  components: { schemas: Record<string, Record<string, unknown>> };
};

describe('buildOpenApiDocument', () => {
  it('is OpenAPI 3.1 with no servers, so Try it out calls the serving host', () => {
    expect(document.openapi).toBe('3.1.0');
    expect(document).not.toHaveProperty('servers');
  });

  it('generates the POST body schema from the request validator', () => {
    const { $schema: _dialect, ...expected } = z.toJSONSchema(
      createRestaurantBodySchema,
      { io: 'input' },
    );

    expect(document.components.schemas['CreateRestaurantRequest']).toEqual(
      expected,
    );
    expect(
      document.components.schemas['CreateRestaurantRequest'],
    ).toMatchObject({
      required: ['name', 'address', 'city', 'countryCode'],
      additionalProperties: false,
    });
  });

  it('gives every operation an operationId, a summary and responses', () => {
    for (const operations of Object.values(document.paths)) {
      for (const operation of Object.values(operations)) {
        expect(operation).toEqual(
          expect.objectContaining({
            operationId: expect.any(String),
            summary: expect.any(String),
            responses: expect.any(Object),
          }),
        );
      }
    }
  });

  it('resolves every $ref to a component', () => {
    const refs = [
      ...JSON.stringify(document).matchAll(/"\$ref":"([^"]+)"/g),
    ].map(([, ref]) => ref);

    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      const name = ref?.replace('#/components/schemas/', '') ?? '';
      expect(Object.keys(COMPONENT_SCHEMAS)).toContain(name);
    }
  });

  // Swagger UI shows type placeholders ("name": "string") only when the
  // document has no example values; the author chose that presentation.
  it('contains no example values, so Swagger renders types from the schemas', () => {
    expect(JSON.stringify(document)).not.toMatch(/"examples?"\s*:/);
  });

  it('names only catalog codes, and every catalog code it can reach', () => {
    const text = JSON.stringify(document);
    const mentioned = new Set(
      [...text.matchAll(/`([A-Z][A-Z_]+)`/g)].map(([, code]) => code),
    );
    for (const code of mentioned) expect(ERROR_CODES).toContain(code);
    for (const code of ERROR_CODES) expect(mentioned).toContain(code);
  });

  it('documents Retry-After on every 503', () => {
    for (const operations of Object.values(document.paths)) {
      for (const operation of Object.values(operations)) {
        const responses = operation['responses'] as Record<
          string,
          { headers?: Record<string, unknown> }
        >;
        if (responses['503'] && operation['operationId'] !== 'getReady') {
          expect(responses['503'].headers).toHaveProperty('Retry-After');
        }
      }
    }
  });

  it('documents one query parameter per field of the list query schema', () => {
    const parameters = document.paths['/v1/restaurants']?.['get']?.[
      'parameters'
    ] as { name: string; in: string; schema: Record<string, unknown> }[];

    expect(parameters.map((p) => p.name)).toEqual(
      Object.keys(listRestaurantsQuerySchema.shape),
    );
    expect(parameters.every((p) => p.in === 'query')).toBe(true);
    expect(parameters.find((p) => p.name === 'limit')?.schema).toMatchObject({
      type: 'integer',
      minimum: 1,
      maximum: 100,
      default: 20,
    });
    expect(parameters.find((p) => p.name === 'sort')?.schema).toMatchObject({
      enum: ['distance', 'rating', 'cost'],
    });
  });

  it('is plain JSON (survives serialization unchanged)', () => {
    expect(JSON.parse(JSON.stringify(document))).toEqual(document);
  });
});
