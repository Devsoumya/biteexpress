import {
  EARTH_RADIUS_KM,
  haversineDistanceKmExpression,
  haversineKm,
  parseCoordinates,
} from '../../../src/utils/geo';

describe('parseCoordinates', () => {
  it('builds a GeoJSON point in [lng, lat] order', () => {
    expect(parseCoordinates(28.4595, 77.0266)).toEqual({
      kind: 'point',
      point: { type: 'Point', coordinates: [77.0266, 28.4595] },
    });
  });

  it.each([
    [90, 180],
    [-90, -180],
    [90, -180],
    [-90, 180],
  ])('accepts the boundary %d, %d', (lat, lng) => {
    expect(parseCoordinates(lat, lng).kind).toBe('point');
  });

  it.each([
    [0, 0],
    [28.5, 0],
    [0, 77.1],
    [-0, 77.1],
  ])('treats %d, %d as unknown (0 on either axis)', (lat, lng) => {
    expect(parseCoordinates(lat, lng)).toEqual({ kind: 'unknown' });
  });

  it.each([
    [90.0001, 77, 'latitude must be between -90 and 90'],
    [-90.0001, 77, 'latitude must be between -90 and 90'],
    [28, 180.0001, 'longitude must be between -180 and 180'],
    [28, -180.0001, 'longitude must be between -180 and 180'],
    [Number.NaN, 77, 'coordinates must be finite numbers'],
    [28, Number.POSITIVE_INFINITY, 'coordinates must be finite numbers'],
  ])('rejects %d, %d as invalid', (lat, lng, reason) => {
    expect(parseCoordinates(lat, lng)).toEqual({ kind: 'invalid', reason });
  });

  it('reports out-of-range before treating 0 as unknown', () => {
    expect(parseCoordinates(0, 200).kind).toBe('invalid');
  });
});

describe('haversineKm', () => {
  const degreeOnEquatorKm = (EARTH_RADIUS_KM * Math.PI) / 180; // 111.3195...

  it('is 0 from a point to itself', () => {
    expect(
      haversineKm({ lat: 28.46, lng: 77.03 }, { lat: 28.46, lng: 77.03 }),
    ).toBe(0);
  });

  it('measures one degree of longitude on the equator', () => {
    expect(haversineKm({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })).toBeCloseTo(
      degreeOnEquatorKm,
      9,
    );
  });

  it('measures one degree of latitude on a meridian', () => {
    expect(haversineKm({ lat: 10, lng: 20 }, { lat: 11, lng: 20 })).toBeCloseTo(
      degreeOnEquatorKm,
      9,
    );
  });

  it('measures half the circumference between antipodes', () => {
    expect(haversineKm({ lat: 0, lng: 0 }, { lat: 0, lng: 180 })).toBeCloseTo(
      Math.PI * EARTH_RADIUS_KM,
      6,
    );
  });

  it('is symmetric', () => {
    const gurgaon = { lat: 28.4595, lng: 77.0266 };
    const connaughtPlace = { lat: 28.6315, lng: 77.2167 };

    expect(haversineKm(gurgaon, connaughtPlace)).toBe(
      haversineKm(connaughtPlace, gurgaon),
    );
  });

  it('puts Gurgaon about 25-30 km from Connaught Place', () => {
    const km = haversineKm(
      { lat: 28.4595, lng: 77.0266 },
      { lat: 28.6315, lng: 77.2167 },
    );

    expect(km).toBeGreaterThan(25);
    expect(km).toBeLessThan(30);
  });

  it('takes the short way across the antimeridian', () => {
    expect(
      haversineKm({ lat: 0, lng: 179.5 }, { lat: 0, lng: -179.5 }),
    ).toBeCloseTo(degreeOnEquatorKm, 6);
  });
});

describe('haversineDistanceKmExpression', () => {
  const sinSquaredHalf = (difference: unknown) => ({
    $pow: [{ $sin: { $divide: [difference, 2] } }, 2],
  });

  it('builds the haversine over location.coordinates, null when absent', () => {
    expect(haversineDistanceKmExpression({ lat: 0, lng: 0 })).toEqual({
      $cond: [
        { $isArray: '$location.coordinates' },
        {
          $let: {
            vars: {
              lng: {
                $degreesToRadians: {
                  $arrayElemAt: ['$location.coordinates', 0],
                },
              },
              lat: {
                $degreesToRadians: {
                  $arrayElemAt: ['$location.coordinates', 1],
                },
              },
            },
            in: {
              $multiply: [
                2 * EARTH_RADIUS_KM,
                {
                  $asin: {
                    $sqrt: {
                      $min: [
                        1,
                        {
                          $add: [
                            sinSquaredHalf({ $subtract: ['$$lat', 0] }),
                            {
                              $multiply: [
                                1,
                                { $cos: '$$lat' },
                                sinSquaredHalf({ $subtract: ['$$lng', 0] }),
                              ],
                            },
                          ],
                        },
                      ],
                    },
                  },
                },
              ],
            },
          },
        },
        null,
      ],
    });
  });

  it('reads coordinates from a custom path', () => {
    const expression = haversineDistanceKmExpression(
      { lat: 28.46, lng: 77.03 },
      '$geo.coords',
    );

    expect(JSON.stringify(expression)).toContain('"$geo.coords"');
    expect(JSON.stringify(expression)).not.toContain('location');
  });

  it('precomputes the origin in radians', () => {
    const expression = JSON.stringify(
      haversineDistanceKmExpression({ lat: 90, lng: 180 }),
    );

    expect(expression).toContain(`"$subtract":["$$lat",${Math.PI / 2}]`);
    expect(expression).toContain(`"$subtract":["$$lng",${Math.PI}]`);
  });
});
