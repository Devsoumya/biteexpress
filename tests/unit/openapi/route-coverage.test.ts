import { buildOpenApiDocument } from '../../../src/openapi/openapi.document';
import { createTestApp } from '../../helpers/app';
import { inventoryRoutes } from '../../helpers/route-inventory';

// The docs endpoints serve the document; they are not part of the API it
// describes.
const UNDOCUMENTED = [
  'GET /',
  'GET /openapi.json',
  'GET /swagger',
  'GET /swagger/swagger-ui-bundle.js',
  'GET /swagger/swagger-ui.css',
];

function documentedOperations(): string[] {
  const { paths } = buildOpenApiDocument() as {
    paths: Record<string, Record<string, unknown>>;
  };
  return Object.entries(paths)
    .flatMap(([path, operations]) =>
      Object.keys(operations).map(
        (method) => `${method.toUpperCase()} ${path}`,
      ),
    )
    .sort();
}

describe('OpenAPI route coverage', () => {
  // Fails when a route is added without documenting it, or documented without
  // existing. Fix it in src/openapi/openapi.document.ts.
  it('documents exactly the routes the app registers', () => {
    const registered = inventoryRoutes(() => createTestApp({})).filter(
      (route) => !UNDOCUMENTED.includes(route),
    );

    expect(registered).toEqual(documentedOperations());
  });

  it('finds the docs endpoints too (the inventory sees every router)', () => {
    expect(inventoryRoutes(() => createTestApp({}))).toEqual(
      expect.arrayContaining(UNDOCUMENTED),
    );
  });
});
