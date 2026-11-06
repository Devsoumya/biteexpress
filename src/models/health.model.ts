export type ProbedIndexState = 'ok' | 'missing' | 'not_queryable';
export type SearchIndexState = ProbedIndexState | 'error' | 'skipped';

export interface ReadinessChecks {
  mongo: 'ok' | 'fail';
  searchIndex: SearchIndexState;
  /** Present when the search vocabulary is wired in (Step 6). */
  vocabulary?: 'ok' | 'not_loaded';
}

export interface ReadinessResult {
  ready: boolean;
  checks: ReadinessChecks;
}

/** MongoDB checks behind /ready. Implemented by MongoHealthRepository. */
export interface HealthRepository {
  ping(): Promise<void>;
  searchIndexState(): Promise<ProbedIndexState>;
}

/** Decides readiness from the repository's checks. */
export interface ReadinessService {
  check(): Promise<ReadinessResult>;
}

export interface ReadinessServiceOptions {
  /** How long a result (pass or fail) is reused. Default 5000 ms. */
  ttlMs?: number;
  /** Clock, injectable so tests need no timers. Default Date.now. */
  now?: () => number;
  /** The search vocabulary; when given, readiness requires it loaded. */
  vocabulary?: { isLoaded(): boolean };
}

export interface HealthResponseBody {
  status: 'ok';
}

export interface ReadinessResponseBody {
  status: 'ready' | 'not_ready';
  checks: ReadinessChecks;
}
