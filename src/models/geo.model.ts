export interface LatLng {
  lat: number;
  lng: number;
}

/** GeoJSON point. MongoDB and GeoJSON order coordinates [longitude, latitude]. */
export interface GeoPoint {
  type: 'Point';
  coordinates: [lng: number, lat: number];
}

/**
 * Outcome of validating a coordinate pair (ADR-001 Rule 3). Callers must
 * handle all three: the seed omits the location on `unknown` and `invalid`;
 * POST omits it on `unknown` and rejects `invalid` with 400.
 */
export type CoordinatesResult =
  | { kind: 'point'; point: GeoPoint }
  | { kind: 'unknown' }
  | { kind: 'invalid'; reason: string };
