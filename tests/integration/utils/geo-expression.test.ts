import type { MongoClient } from 'mongodb';
import type { LatLng } from '../../../src/models/geo.model';
import {
  haversineDistanceKmExpression,
  haversineKm,
} from '../../../src/utils/geo';
import { TEST_DB_NAME, connectTestClient } from '../../helpers/test-database';

// A shape-only unit test cannot catch a wrong formula, so the expression is
// evaluated by MongoDB itself ($documents needs no collection or index).
describe('haversineDistanceKmExpression evaluated by MongoDB', () => {
  let client: MongoClient;

  beforeAll(async () => {
    client = await connectTestClient();
  });

  afterAll(() => client.close());

  async function evaluate(
    origin: LatLng,
    documents: Record<string, unknown>[],
  ): Promise<unknown[]> {
    const results = await client
      .db(TEST_DB_NAME)
      .aggregate([
        { $documents: documents },
        { $project: { _id: 0, d: haversineDistanceKmExpression(origin) } },
      ])
      .toArray();
    return results.map((result) => result['d']);
  }

  const pairs: [string, LatLng, LatLng][] = [
    [
      'Gurgaon → Connaught Place',
      { lat: 28.4595, lng: 77.0266 },
      { lat: 28.6315, lng: 77.2167 },
    ],
    [
      'one degree on the equator',
      { lat: 0.0001, lng: 0.0001 },
      { lat: 0.0001, lng: 1.0001 },
    ],
    [
      'across the antimeridian',
      { lat: -17.7, lng: 179.5 },
      { lat: -17.6, lng: -179.5 },
    ],
    ['near the pole', { lat: 89.9, lng: 10 }, { lat: 89.8, lng: -170 }],
    [
      'Mumbai → London',
      { lat: 19.076, lng: 72.8777 },
      { lat: 51.5072, lng: -0.1276 },
    ],
  ];

  it.each(pairs)('matches haversineKm: %s', async (_name, origin, target) => {
    const [distance] = await evaluate(origin, [
      { location: { type: 'Point', coordinates: [target.lng, target.lat] } },
    ]);

    expect(typeof distance).toBe('number');
    expect(
      Math.abs((distance as number) - haversineKm(origin, target)),
    ).toBeLessThan(1e-9);
  });

  it('is null for a document without a location', async () => {
    await expect(
      evaluate({ lat: 28.46, lng: 77.03 }, [{ name: 'no location' }]),
    ).resolves.toEqual([null]);
  });
});
