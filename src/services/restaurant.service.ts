import {
  toRestaurantDraft,
  toRestaurantListItem,
} from '../mappers/restaurant.mapper';
import {
  toInterpretationBody,
  toSearchCriteria,
  toSearchRequestCriteria,
} from '../mappers/search-criteria.mapper';
import type {
  RestaurantDocument,
  RestaurantRepository,
  RestaurantService,
} from '../models/restaurant.model';
import type {
  ListRestaurantsResponse,
  QueryInterpreter,
  SearchCriteria,
  SearchRestaurantsResponse,
  VocabularyProvider,
} from '../models/search.model';
import { ApplicationError } from '../utils/application-error';
import { countryByIsoCode } from '../utils/country';
import { decodeCursor, encodeCursor } from '../utils/cursor';
import {
  summarizeCriteria,
  summarizeInterpretation,
} from '../utils/log-safety';
import { setRequestSummary } from '../utils/request-context';
import type {
  CreateRestaurantBody,
  ListRestaurantsQuery,
  SearchRestaurantsQuery,
} from '../validators/restaurant.schema';

export interface RestaurantServiceDependencies {
  /** Cities (with country) and cuisines; drives the currency rule and q. */
  vocabulary: VocabularyProvider;
  interpreter: QueryInterpreter;
  /** Injectable so tests can assert exact timestamps. */
  clock?: () => Date;
}

/**
 * The business rules behind the restaurant endpoints: derived fields on
 * create, tenant-safe 404s, criteria from query parameters or `q`, and
 * cursor paging. Knows neither HTTP nor the driver (AGENTS.md §5).
 */
export class DefaultRestaurantService implements RestaurantService {
  private readonly vocabulary: VocabularyProvider;
  private readonly interpreter: QueryInterpreter;
  private readonly clock: () => Date;

  constructor(
    private readonly repository: RestaurantRepository,
    dependencies: RestaurantServiceDependencies,
  ) {
    this.vocabulary = dependencies.vocabulary;
    this.interpreter = dependencies.interpreter;
    this.clock = dependencies.clock ?? (() => new Date());
  }

  async create(body: CreateRestaurantBody): Promise<RestaurantDocument> {
    const country = countryByIsoCode(body.countryCode);
    // The request schema accepts only supported codes; reaching this is a bug.
    if (!country) {
      throw new Error(`Unsupported country code ${body.countryCode}`);
    }
    const created = await this.repository.insert(
      toRestaurantDraft(body, country),
      this.clock(),
    );
    // A new city or cuisine becomes searchable on this instance at once
    // (others within one refresh interval). refresh() never rejects.
    void this.vocabulary.refresh();
    return created;
  }

  // Missing and another tenant's are the same 404, so probing ids reveals
  // nothing about other tenants.
  async getById(id: string): Promise<RestaurantDocument> {
    const restaurant = await this.repository.findById(id);
    if (!restaurant) {
      throw new ApplicationError(
        'RESTAURANT_NOT_FOUND',
        'Restaurant not found',
      );
    }
    return restaurant;
  }

  async list(query: ListRestaurantsQuery): Promise<ListRestaurantsResponse> {
    const criteria = toSearchCriteria(query, this.vocabulary.snapshot());
    const page = await this.page(criteria, query);
    setRequestSummary({
      ...summarizeCriteria(criteria, query.limit),
      ...pageSummary(page),
    });
    return page;
  }

  /**
   * q → criteria (interpreter) → explicit parameters win → the same page as
   * the list, plus what was understood (ADR-002).
   */
  async search(
    query: SearchRestaurantsQuery,
  ): Promise<SearchRestaurantsResponse> {
    const vocabulary = this.vocabulary.snapshot();
    const interpretation = this.interpreter.interpret(query.q, {
      hasCoords: query.lat !== undefined && query.lng !== undefined,
      vocabulary,
    });
    const { criteria, notes } = toSearchRequestCriteria(
      interpretation,
      query,
      vocabulary,
    );
    const page = await this.page(criteria, query);
    const body = toInterpretationBody(query.q, criteria, [
      ...interpretation.notes,
      ...notes,
    ]);
    setRequestSummary({
      ...summarizeCriteria(criteria, query.limit),
      ...summarizeInterpretation(body),
      ...pageSummary(page),
    });
    return { ...page, interpretation: body };
  }

  /** One page for final criteria; the cursor is bound to those criteria. */
  private async page(
    criteria: SearchCriteria,
    { cursor, limit }: { cursor?: string | undefined; limit: number },
  ): Promise<ListRestaurantsResponse> {
    // Validated against these criteria before any search runs.
    const searchAfter =
      cursor === undefined ? undefined : decodeCursor(cursor, criteria);
    const { hits, hasMore } = await this.repository.search(criteria, {
      limit,
      ...(searchAfter !== undefined && { searchAfter }),
    });
    const last = hits.at(-1);
    return {
      data: hits.map(toRestaurantListItem),
      nextCursor:
        hasMore && last ? encodeCursor(last.paginationToken, criteria) : null,
    };
  }
}

/**
 * The page's part of the request's log line: counts only, never values
 * (ADR-004). Each endpoint writes its summary once, after the page exists.
 */
function pageSummary(page: ListRestaurantsResponse): Record<string, unknown> {
  return {
    resultCount: page.data.length,
    hasNextPage: page.nextCursor !== null,
  };
}
