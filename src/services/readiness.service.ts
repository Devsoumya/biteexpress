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
  private cached: CachedResult | undefined;

  constructor(
    private readonly repository: HealthRepository,
    options: ReadinessServiceOptions = {},
  ) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.now = options.now ?? Date.now;
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
        checks: { mongo: 'fail', searchIndex: 'skipped' },
      };
    }

    let searchIndex: SearchIndexState;
    try {
      searchIndex = await this.repository.searchIndexState();
    } catch {
      searchIndex = 'error';
    }
    return {
      ready: searchIndex === 'ok',
      checks: { mongo: 'ok', searchIndex },
    };
  }
}
