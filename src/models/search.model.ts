import type { Document, ObjectId } from 'mongodb';
import type { GeoPoint, LatLng } from './geo.model';
import type { RestaurantListItem } from './restaurant.model';

/** Sorts a client may ask for (ADR-003 Rule 2). */
export type SortKey = 'distance' | 'rating' | 'cost';
/** `relevance` is implicit only: chosen when there is a name, never sent. */
export type ResolvedSort = SortKey | 'relevance';
export type SortOrder = 'asc' | 'desc';

/**
 * What to find and how to order it, shared by the list endpoint and (Step 6)
 * the search endpoint (ADR-002). Values are already normalized: `city` and
 * `cuisines` are `norm.*` keys, and `currency` is resolved whenever a cost
 * filter or cost sort is present. Absent means "not constrained".
 */
export interface SearchCriteria {
  name?: string;
  /** Step 6: restaurant features the query asked for (filters). */
  features?: { onlineDelivery?: boolean; tableBooking?: boolean };
  /** Step 6: price tier ceiling ("cheap" → 2); needs no currency. */
  maxPriceRange?: number;
  /** Step 6: dish phrases; each matches a name phrase OR its cuisines. */
  dishes?: Dish[];
  /** Step 6: whole-query fallback when nothing else was recognized. */
  text?: string;
  /** Step 6: leftover words; raise the rank, never exclude. */
  boostTerms?: string[];
  /**
   * Step 6: a price from `q` whose currency could not be resolved. Not a
   * filter: restaurants within it rank first (ADR-002 Pass 1).
   */
  pricePreference?: { minCost?: number; maxCost?: number };
  city?: string;
  cuisines?: string[];
  cuisineMatch: 'any' | 'all';
  minRating?: number;
  minVotes?: number;
  minCost?: number;
  maxCost?: number;
  currency?: string;
  origin?: LatLng;
  radiusKm?: number;
  sort?: SortKey;
  order?: SortOrder;
}

export interface Dish {
  phrase: string;
  /** Normalized cuisines that "probably serve" the dish; may be empty. */
  cuisines: string[];
}

/**
 * What the database knows exists, for the interpreter and the currency rule:
 * normalized city → ISO country code, and normalized cuisines (ADR-002 Pass 4).
 */
export interface SearchVocabulary {
  cities: ReadonlyMap<string, string>;
  cuisines: ReadonlySet<string>;
}

/** The cached vocabulary (CachedVocabularyService). */
export interface VocabularyProvider {
  /** The current snapshot; empty until the first load succeeds. */
  snapshot(): SearchVocabulary;
  isLoaded(): boolean;
  /** Reload now; never rejects (a failure keeps the last snapshot). */
  refresh(): Promise<void>;
}

export interface Interpretation {
  criteria: Omit<SearchCriteria, 'cuisineMatch'>;
  notes: string[];
}

export interface InterpretContext {
  hasCoords: boolean;
  vocabulary: SearchVocabulary;
}

/** q → criteria. Pure and deterministic (ADR-002). */
export interface QueryInterpreter {
  interpret(q: string, context: InterpretContext): Interpretation;
}

export interface SearchPage {
  limit: number;
  /** searchSequenceToken of the last item already returned. */
  searchAfter?: string;
}

/** A restaurant as `$search` returns it: stored-source fields only. */
export interface RestaurantSearchHit {
  _id: ObjectId;
  name: string;
  address: { line: string; locality?: string; city: string };
  country: { code: string; name: string };
  cuisines: string[];
  rating: { average?: number; votes: number };
  cost?: { averageForTwo?: number; currency: string; priceRange?: number };
  features?: {
    tableBooking?: boolean;
    onlineDelivery?: boolean;
    deliveringNow?: boolean;
  };
  location?: GeoPoint;
  /** Present only when the criteria had an origin; null without a location. */
  distanceKm?: number | null;
  paginationToken: string;
}

export interface SearchResult {
  hits: RestaurantSearchHit[];
  /** True when more results exist after the last hit. */
  hasMore: boolean;
}

/** The seam a test replaces to simulate a search outage (ADR-005). */
export interface SearchExecutor {
  aggregate(
    pipeline: Document[],
    options: { maxTimeMS: number },
  ): Promise<Document[]>;
}

export interface ListRestaurantsResponse {
  data: RestaurantListItem[];
  nextCursor: string | null;
}

/** What the search understood, as returned to the client. */
export interface InterpretationBody {
  query: string;
  sort: ResolvedSort;
  city?: string;
  cuisines?: string[];
  dishes?: Dish[];
  minRating?: number;
  minVotes?: number;
  minCost?: number;
  maxCost?: number;
  currency?: string;
  pricePreference?: { minCost?: number; maxCost?: number };
  maxPriceRange?: number;
  features?: { onlineDelivery?: boolean; tableBooking?: boolean };
  boostTerms?: string[];
  text?: string;
  notes: string[];
}

export interface SearchRestaurantsResponse extends ListRestaurantsResponse {
  interpretation: InterpretationBody;
}
