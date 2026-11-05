import type { Document } from 'mongodb';
import type { CoordinatesResult, GeoPoint, LatLng } from '../models/geo.model';

/** The radius MongoDB uses for spherical distances, so ours agree with it. */
export const EARTH_RADIUS_KM = 6378.1;

export function parseCoordinates(lat: number, lng: number): CoordinatesResult {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { kind: 'invalid', reason: 'coordinates must be finite numbers' };
  }
  if (lat < -90 || lat > 90) {
    return { kind: 'invalid', reason: 'latitude must be between -90 and 90' };
  }
  if (lng < -180 || lng > 180) {
    return {
      kind: 'invalid',
      reason: 'longitude must be between -180 and 180',
    };
  }
  // The source data uses 0 as "no location" (497 rows at 0,0); a real
  // restaurant exactly on the equator or prime meridian is not a concern.
  if (lat === 0 || lng === 0) return { kind: 'unknown' };

  const point: GeoPoint = { type: 'Point', coordinates: [lng, lat] };
  return { kind: 'point', point };
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Great-circle distance in km (haversine). */
export function haversineKm(a: LatLng, b: LatLng): number {
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const dLat = lat2 - lat1;
  const dLng = toRadians(b.lng) - toRadians(a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  // Rounding can push h a hair above 1 for antipodal points; asin(>1) is NaN.
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(Math.min(1, h)));
}

/**
 * The same haversine as an aggregation expression, for an `$addFields` stage
 * over the returned page (ADR-003 rule 7). Evaluates to null when the
 * document has no coordinates, so the mapper can omit `distanceKm`.
 */
export function haversineDistanceKmExpression(
  origin: LatLng,
  coordinatesPath = '$location.coordinates',
): Document {
  const originLat = toRadians(origin.lat);
  const originLng = toRadians(origin.lng);
  const sinSquaredHalf = (difference: Document): Document => ({
    $pow: [{ $sin: { $divide: [difference, 2] } }, 2],
  });

  // The $isArray guard is what yields null for a missing location: inside,
  // $min would turn a null into 1 (it ignores nulls) and produce a distance.
  return {
    $cond: [
      { $isArray: coordinatesPath },
      {
        $let: {
          vars: {
            lng: {
              $degreesToRadians: { $arrayElemAt: [coordinatesPath, 0] },
            },
            lat: {
              $degreesToRadians: { $arrayElemAt: [coordinatesPath, 1] },
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
                          sinSquaredHalf({ $subtract: ['$$lat', originLat] }),
                          {
                            $multiply: [
                              Math.cos(originLat),
                              { $cos: '$$lat' },
                              sinSquaredHalf({
                                $subtract: ['$$lng', originLng],
                              }),
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
  };
}
