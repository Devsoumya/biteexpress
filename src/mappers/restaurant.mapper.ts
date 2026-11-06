import { RESTAURANT_SCHEMA_VERSION } from '../constants/restaurant';
import type { Country } from '../models/country.model';
import type { GeoPoint } from '../models/geo.model';
import type {
  ListItemSource,
  RatingLabel,
  RestaurantDetail,
  RestaurantDocument,
  RestaurantDraft,
  RestaurantListItem,
} from '../models/restaurant.model';
import type { CreateRestaurantBody } from '../validators/restaurant.schema';
import { parseCoordinates } from '../utils/geo';
import { normalizeCity, normalizeCuisines } from '../utils/normalize';

type Features = NonNullable<RestaurantDocument['features']>;

function locationFrom(body: CreateRestaurantBody): GeoPoint | undefined {
  if (body.latitude === undefined || body.longitude === undefined) {
    return undefined;
  }
  const coordinates = parseCoordinates(body.latitude, body.longitude);
  // The request schema checks the same ranges, so this is a bug, not input.
  if (coordinates.kind === 'invalid') throw new Error(coordinates.reason);
  return coordinates.kind === 'point' ? coordinates.point : undefined;
}

// The driver stores an undefined-valued key as null, which the validator
// rejects, so only keys the client actually sent are copied.
function featuresFrom(body: CreateRestaurantBody): Features | undefined {
  const entries = Object.entries(body.features ?? {}).filter(
    ([, value]) => value !== undefined,
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

/**
 * Builds a restaurant from a validated POST body (ADR-001 Rules 2-6). Uses the
 * same helpers as the CSV mapper, so `norm.*` is identical for both writers.
 * Pure: the repository adds `_id`, the tenant and the timestamps.
 */
export function toRestaurantDraft(
  body: CreateRestaurantBody,
  country: Country,
): RestaurantDraft {
  const cuisines = normalizeCuisines(body.cuisines ?? []);
  const location = locationFrom(body);
  const features = featuresFrom(body);

  return {
    name: body.name,
    address: {
      line: body.address,
      ...(body.locality !== undefined && { locality: body.locality }),
      city: body.city,
    },
    country: { code: country.isoCode, name: country.name },
    ...(location && { location }),
    cuisines: cuisines.display,
    cost: {
      ...(body.averageCostForTwo !== undefined && {
        averageForTwo: body.averageCostForTwo,
      }),
      // From the country table, never from the client (Rule 6).
      currency: country.currency,
      ...(body.priceRange !== undefined && { priceRange: body.priceRange }),
    },
    ...(features && { features }),
    // A new restaurant has no ratings; votes counts them from 0.
    rating: { votes: 0 },
    norm: { city: normalizeCity(body.city), cuisines: cuisines.norm },
    schemaVersion: RESTAURANT_SCHEMA_VERSION,
  };
}

/**
 * Bands derived from the source data, where the label was a clean function of
 * the average (ADR-001 Context): Poor 1.8-2.4, Average 2.5-3.4, Good 3.5-3.9,
 * Very Good 4.0-4.4, Excellent 4.5-4.9. Derived, not stored (Rule 8).
 */
export function ratingLabel(average: number | undefined): RatingLabel {
  if (average === undefined) return 'Not rated';
  if (average < 2.5) return 'Poor';
  if (average < 3.5) return 'Average';
  if (average < 4) return 'Good';
  if (average < 4.5) return 'Very Good';
  return 'Excellent';
}

/** 2 decimals is 10 m: finer than any address, coarse enough to read. */
function roundKm(distanceKm: number): number {
  return Math.round(distanceKm * 100) / 100;
}

/**
 * A search hit or a full document → list item. `distanceKm` is added only
 * when the pipeline computed one (the request had coordinates) and the
 * restaurant has a location; otherwise it is omitted (invariant 1).
 */
export function toRestaurantListItem(
  source: ListItemSource,
): RestaurantListItem {
  return {
    id: source._id.toHexString(),
    name: source.name,
    address: source.address.line,
    city: source.address.city,
    country: { code: source.country.code, name: source.country.name },
    cuisines: source.cuisines,
    averageRating: source.rating?.average ?? null,
    ...(typeof source.distanceKm === 'number' && {
      distanceKm: roundKm(source.distanceKm),
    }),
  };
}

export function toRestaurantDetail(
  document: RestaurantDocument,
): RestaurantDetail {
  const { location, cost, features, rating } = document;
  return {
    ...toRestaurantListItem({ ...document, distanceKm: undefined }),
    locality: document.address.locality ?? null,
    location: location
      ? {
          latitude: location.coordinates[1],
          longitude: location.coordinates[0],
        }
      : null,
    cost: {
      averageForTwo: cost?.averageForTwo ?? null,
      currency: cost?.currency ?? null,
      priceRange: cost?.priceRange ?? null,
    },
    features: {
      tableBooking: features?.tableBooking ?? null,
      onlineDelivery: features?.onlineDelivery ?? null,
      deliveringNow: features?.deliveringNow ?? null,
    },
    votes: rating.votes,
    ratingLabel: ratingLabel(rating.average),
    sourceId: document.sourceId ?? null,
  };
}
