import type {
  HealthRepository,
  ReadinessResult,
  ReadinessService,
  ReadinessServiceOptions,
  SearchIndexState,
} from '../models/health.model';

const DEFAULT_TTL_MS = 5000;

interface CachedResult {
  result: ReadinessResult;
  checkedAt: number;
}

// Failures are cached too, so probes during an outage do not pile onto a
// struggling database; recovery is visible within one TTL.
export class CachedReadinessService implements ReadinessService {
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly vocabulary: ReadinessServiceOptions['vocabulary'];
  private cached: CachedResult | undefined;

  constructor(
    private readonly repository: HealthRepository,
    options: ReadinessServiceOptions = {},
  ) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.now = options.now ?? Date.now;
    this.vocabulary = options.vocabulary;
  }

  async check(): Promise<ReadinessResult> {
    if (this.cached && this.now() - this.cached.checkedAt < this.ttlMs) {
      return this.cached.result;
    }
    const result = await this.probe();
    this.cached = { result, checkedAt: this.now() };
    return result;
  }

  private async probe(): Promise<ReadinessResult> {
    try {
      await this.repository.ping();
    } catch {
      return {
        ready: false,
        checks: {
          mongo: 'fail',
          searchIndex: 'skipped',
          ...(this.vocabulary && {
            vocabulary: this.vocabulary.isLoaded() ? 'ok' : 'not_loaded',
          }),
        },
      };
    }

    let searchIndex: SearchIndexState;
    try {
      searchIndex = await this.repository.searchIndexState();
    } catch {
      searchIndex = 'error';
    }
    if (!this.vocabulary) {
      return {
        ready: searchIndex === 'ok',
        checks: { mongo: 'ok', searchIndex },
      };
    }
    const vocabulary = this.vocabulary.isLoaded() ? 'ok' : 'not_loaded';
    return {
      ready: searchIndex === 'ok' && vocabulary === 'ok',
      checks: { mongo: 'ok', searchIndex, vocabulary },
    };
  }
}
