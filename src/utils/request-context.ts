import { AsyncLocalStorage } from 'node:async_hooks';
import { performance } from 'node:perf_hooks';

/** What one request contributes to its log line (ADR-004). */
export interface RequestContext {
  requestId: string;
  /** performance.now() at arrival (monotonic). */
  startedAt: number;
  /** Time spent in MongoDB calls, summed by `timed()`. */
  dbMs: number;
  /** List and search add what was asked and found (no raw values). */
  summary?: Record<string, unknown>;
  /** Set by the error handler: the catalog code, and the cause for 5xx. */
  errorCode?: string;
  error?: unknown;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** Runs `fn` (and everything it awaits) with `context` as the current one. */
export function runWithContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function currentContext(): RequestContext | undefined {
  return storage.getStore();
}

/** Adds to the current request's database time; a no-op outside a request. */
export function recordDbTime(ms: number): void {
  const context = storage.getStore();
  if (context) context.dbMs += ms;
}

export function setRequestSummary(summary: Record<string, unknown>): void {
  const context = storage.getStore();
  if (context) context.summary = summary;
}

/** Times one database call into the current request, success or failure. */
export async function timed<T>(operation: () => Promise<T>): Promise<T> {
  const start = performance.now();
  try {
    return await operation();
  } finally {
    recordDbTime(performance.now() - start);
  }
}
