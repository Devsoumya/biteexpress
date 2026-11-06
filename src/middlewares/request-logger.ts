import { performance } from 'node:perf_hooks';
import type { Request, RequestHandler } from 'express';
import type { Logger } from '../utils/logger';
import { requestContextOf } from './request-id';

export interface RequestLoggerOptions {
  logger: Logger;
  /** Requests slower than this are logged at `warn` (SLOW_REQUEST_MS). */
  slowRequestMs: number;
  now?: () => number;
}

const PROBES = new Set(['/health', '/ready']);

function round(ms: number): number {
  return Math.round(ms * 10) / 10;
}

/** The path without its query string: coordinates live there (ADR-004). */
function pathOf(request: Request): string {
  return request.originalUrl.split('?')[0] ?? request.originalUrl;
}

type Level = 'debug' | 'info' | 'warn' | 'error';

function levelFor(path: string, status: number, slow: boolean): Level {
  if (status >= 500 && !PROBES.has(path)) return 'error';
  // Probes run every 10 s; only a failing one is worth seeing at normal level.
  if (PROBES.has(path)) return status >= 500 ? 'warn' : 'debug';
  return slow ? 'warn' : 'info';
}

/**
 * One line per request, written when the response has been sent: what was
 * asked (method, path, route; list/search add a summary), what happened
 * (status, error code, cause for 5xx) and how long it took (total and
 * MongoDB). Never the query string, the body, `q` or raw coordinates.
 */
export function requestLogger({
  logger,
  slowRequestMs,
  now = () => performance.now(),
}: RequestLoggerOptions): RequestHandler {
  return (request, response, next) => {
    response.on('finish', () => {
      const context = requestContextOf(response);
      if (!context) return;
      const path = pathOf(request);
      const durationMs = now() - context.startedAt;
      const level = levelFor(
        path,
        response.statusCode,
        durationMs > slowRequestMs,
      );
      const route = request.route as { path?: string } | undefined;
      logger[level](
        {
          requestId: context.requestId,
          method: request.method,
          path,
          ...(route?.path !== undefined && { route: route.path }),
          status: response.statusCode,
          durationMs: round(durationMs),
          dbMs: round(context.dbMs),
          ...(durationMs > slowRequestMs && { slow: true }),
          ...(context.errorCode !== undefined && {
            errorCode: context.errorCode,
          }),
          ...(context.error !== undefined && { err: context.error }),
          ...(context.summary && { search: context.summary }),
        },
        'request',
      );
    });
    next();
  };
}
