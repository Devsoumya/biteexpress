import type { ObjectId } from 'mongodb';
import type {
  CreateRestaurantBody,
  ListRestaurantsQuery,
  SearchRestaurantsQuery,
} from '../validators/restaurant.schema';
import type { GeoPoint } from './geo.model';
import type {
  ListRestaurantsResponse,
  RestaurantSearchHit,
  SearchPage,
  SearchResult,
  SearchCriteria,
  SearchRestaurantsResponse,
  SearchVocabulary,
} from './search.model';

/** Cuisines as shown to clients and as canonical filter keys (`norm.cuisines`). */
export interface NormalizedCuisines {
  display: string[];
  /** `norm[i] === normalize(display[i])` for every i. */
  norm: string[];
}

/**
 * A restaurant as stored (ADR-001). Optional fields are omitted when unknown,
 * never stored as 0 or null (Rule 2).
 */
export interface RestaurantDocument {
  _id: ObjectId;
  tenantId: string;
  /** Zomato `Restaurant ID`; absent for restaurants created through the API. */
  sourceId?: number;
  name: string;
  address: { line: string; locality?: string; city: string };
  country: { code: string; name: string };
  location?: GeoPoint;
  cuisines: string[];
  cost?: { averageForTwo?: number; currency: string; priceRange?: number };
  features?: {
    tableBooking?: boolean;
    onlineDelivery?: boolean;
    deliveringNow?: boolean;
  };
  rating: { average?: number; votes: number };
  norm: { city: string; cuisines: string[] };
  createdAt: Date;
  updatedAt: Date;
  schemaVersion: number;
}

/**
 * A restaurant as the application builds it. The repository adds `_id`,
 * `tenantId` and the timestamps, so no caller can choose the tenant (ADR-001
 * Rule 9).
 */
export type RestaurantDraft = Omit<
  RestaurantDocument,
  '_id' | 'tenantId' | 'createdAt' | 'updatedAt'
>;

/** A seed-row restaurant: always has the source ID it is upserted on. */
export type SeedRestaurant = RestaurantDraft & { sourceId: number };

export interface UpsertResult {
  inserted: number;
  updated: number;
}

/** The only code that reads or writes restaurants; scoped to one tenant. */
export interface RestaurantRepository {
  /** Idempotent bulk upsert on `{tenantId, sourceId}`. */
  upsertManyBySourceId(
    restaurants: readonly SeedRestaurant[],
    now: Date,
  ): Promise<UpsertResult>;
  /** Inserts with `createdAt = updatedAt = now`; returns the stored document. */
  insert(draft: RestaurantDraft, now: Date): Promise<RestaurantDocument>;
  /** `id` is a 24-hex-character string; null when absent or another tenant's. */
  findById(id: string): Promise<RestaurantDocument | null>;
  /** One page from Atlas Search, scoped to the tenant (ADR-003). */
  search(criteria: SearchCriteria, page: SearchPage): Promise<SearchResult>;
  /** Distinct cities (with country) and cuisines of the tenant (ADR-002). */
  vocabulary(): Promise<SearchVocabulary>;
}

export interface RestaurantRepositoryOptions {
  tenantId: string;
  /** Server-side time limit for every read (QUERY_MAX_TIME_MS). */
  maxTimeMS: number;
  /** Atlas Search index for list queries (SEARCH_INDEX_NAME). */
  searchIndexName: string;
}

/** The fields a list item is built from: a search hit or a full document. */
export type ListItemSource = Pick<
  RestaurantSearchHit,
  | '_id'
  | 'name'
  | 'address'
  | 'country'
  | 'cuisines'
  | 'rating'
  | 'cost'
  | 'features'
  | 'distanceKm'
>;

/** Business operations behind the restaurant endpoints; no HTTP, no driver. */
export interface RestaurantService {
  create(body: CreateRestaurantBody): Promise<RestaurantDocument>;
  /** Throws RESTAURANT_NOT_FOUND (404) when absent or another tenant's. */
  getById(id: string): Promise<RestaurantDocument>;
  /** Atlas Search list; throws CURSOR_INVALID or SEARCH_* errors. */
  list(query: ListRestaurantsQuery): Promise<ListRestaurantsResponse>;
  /** q interpreted, merged with explicit parameters, then listed (ADR-002). */
  search(query: SearchRestaurantsQuery): Promise<SearchRestaurantsResponse>;
}

export type RatingLabel =
  'Not rated' | 'Poor' | 'Average' | 'Good' | 'Very Good' | 'Excellent';

/**
 * A restaurant in list results (RFC-001 §5). Unknown values are null and keys
 * are always present, except `distanceKm`, present only with coordinates.
 */
export interface RestaurantListItem {
  id: string;
  name: string;
  address: string;
  city: string;
  country: { code: string; name: string };
  cuisines: string[];
  averageRating: number | null;
  votes: number;
  ratingLabel: RatingLabel;
  // Cost and features are shown because list filters and sorts use them.
  cost: {
    averageForTwo: number | null;
    currency: string | null;
    priceRange: number | null;
  };
  features: {
    tableBooking: boolean | null;
    onlineDelivery: boolean | null;
    deliveringNow: boolean | null;
  };
  /** Only when the request had coordinates and the restaurant has a location. */
  distanceKm?: number;
}

/** GET by id and POST: the list item plus the fields only a detail view needs. */
export interface RestaurantDetail extends Omit<
  RestaurantListItem,
  'distanceKm'
> {
  locality: string | null;
  location: { latitude: number; longitude: number } | null;
  /** Zomato ID for seeded restaurants; null for restaurants created via the API. */
  sourceId: number | null;
}
