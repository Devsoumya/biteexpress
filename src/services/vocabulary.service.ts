import type { RestaurantRepository } from '../models/restaurant.model';
import type {
  SearchVocabulary,
  VocabularyProvider,
} from '../models/search.model';

export const EMPTY_VOCABULARY: SearchVocabulary = {
  cities: new Map(),
  cuisines: new Set(),
};

export interface VocabularyServiceOptions {
  /** How often the timer reloads (VOCABULARY_REFRESH_MS, default 24 h). */
  refreshMs: number;
  /** Where refresh failures go (server.ts logs them). */
  onError: (error: unknown) => void;
}

/**
 * The cities and cuisines the interpreter recognizes, read from the database
 * (ADR-002 Pass 4): loaded at startup, refreshed on a timer and after a POST,
 * and kept as the last good snapshot when a refresh fails. Per instance, so
 * instances may differ by up to one interval.
 */
export class CachedVocabularyService implements VocabularyProvider {
  private current: SearchVocabulary = EMPTY_VOCABULARY;
  private loaded = false;
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly repository: Pick<RestaurantRepository, 'vocabulary'>,
    private readonly options: VocabularyServiceOptions,
  ) {}

  snapshot(): SearchVocabulary {
    return this.current;
  }

  isLoaded(): boolean {
    return this.loaded;
  }

  /** First load at startup: a failure is thrown, so the API does not start blind. */
  async load(): Promise<void> {
    this.current = await this.repository.vocabulary();
    this.loaded = true;
  }

  async refresh(): Promise<void> {
    try {
      this.current = await this.repository.vocabulary();
      this.loaded = true;
    } catch (error) {
      this.options.onError(error);
    }
  }

  start(): void {
    this.stop();
    this.timer = setInterval(() => void this.refresh(), this.options.refreshMs);
    // A pending refresh must not keep the process alive at shutdown.
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}
