import request from 'supertest';
import { createTestApp } from '../../helpers/app';

describe('API documentation endpoints', () => {
  const app = createTestApp({});

  it('serves the OpenAPI document as JSON', async () => {
    const response = await request(app).get('/openapi.json');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(response.body.openapi).toBe('3.1.0');
  });

  it('serves the Swagger UI page pointing at the document', async () => {
    const response = await request(app).get('/swagger');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/text\/html/);
    expect(response.text).toContain('/swagger/swagger-ui-bundle.js');
    expect(response.text).toContain("url: '/openapi.json'");
  });

  it.each([
    ['/swagger/swagger-ui-bundle.js', /javascript/],
    ['/swagger/swagger-ui.css', /text\/css/],
  ])('serves the asset %s from swagger-ui-dist', async (path, type) => {
    const response = await request(app).get(path);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(type);
  });

  // The package's index.html and initializer load the public petstore demo.
  it.each(['/swagger/index.html', '/swagger/swagger-initializer.js'])(
    'does not serve any other package file: %s',
    async (path) => {
      expect((await request(app).get(path)).status).toBe(404);
    },
  );

  it('redirects / to the Swagger UI', async () => {
    const response = await request(app).get('/');

    expect(response.status).toBe(302);
    expect(response.headers['location']).toBe('/swagger');
  });
});
