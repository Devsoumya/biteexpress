import type {
  HealthRepository,
  ReadinessChecks,
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

  /**
   * Mongo first: without it the index check would only fail again, so it is
   * skipped. The vocabulary is in-process state, so it is always reported.
   */
  private async probe(): Promise<ReadinessResult> {
    const mongo = await this.checkMongo();
    const searchIndex: SearchIndexState =
      mongo === 'ok' ? await this.checkSearchIndex() : 'skipped';
    const vocabulary = this.checkVocabulary();
    return {
      ready:
        mongo === 'ok' && searchIndex === 'ok' && vocabulary !== 'not_loaded',
      checks: {
        mongo,
        searchIndex,
        ...(vocabulary !== undefined && { vocabulary }),
      },
    };
  }

  private async checkMongo(): Promise<ReadinessChecks['mongo']> {
    try {
      await this.repository.ping();
      return 'ok';
    } catch {
      return 'fail';
    }
  }

  // A missing or unbuilt index makes $search return empty results, not an
  // error (invariant 17), so readiness must look at it explicitly.
  private async checkSearchIndex(): Promise<SearchIndexState> {
    try {
      return await this.repository.searchIndexState();
    } catch {
      return 'error';
    }
  }

  /** Undefined when no vocabulary is wired in (it is then not a check). */
  private checkVocabulary(): ReadinessChecks['vocabulary'] {
    if (!this.vocabulary) return undefined;
    return this.vocabulary.isLoaded() ? 'ok' : 'not_loaded';
  }
}
