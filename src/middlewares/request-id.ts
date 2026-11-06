import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { RequestHandler, Response } from 'express';
import { type RequestContext, runWithContext } from '../utils/request-context';

export const REQUEST_ID_HEADER = 'X-Request-Id';

// Short and plain, so a client-supplied id cannot forge log lines.
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

/** The request's context; set by `requestId`, read by the logger and errors. */
export function requestContextOf(
  response: Response,
): RequestContext | undefined {
  return (response.locals as { requestContext?: RequestContext })
    .requestContext;
}

/**
 * First middleware: reuse the client's X-Request-Id when it is safe, else
 * generate one; echo it on the response; start the request's context. The
 * context lives on `res.locals`, which every later middleware can reach.
 */
// performance.now(): monotonic and sub-millisecond, the same clock as the
// repository's database timings, so dbMs never exceeds durationMs.
export function requestId(
  now: () => number = () => performance.now(),
): RequestHandler {
  return (request, response, next) => {
    const supplied = request.get(REQUEST_ID_HEADER);
    const id =
      supplied !== undefined && SAFE_REQUEST_ID.test(supplied)
        ? supplied
        : randomUUID();
    const context: RequestContext = {
      requestId: id,
      startedAt: now(),
      dbMs: 0,
    };
    (response.locals as { requestContext?: RequestContext }).requestContext =
      context;
    response.set(REQUEST_ID_HEADER, id);
    next();
  };
}

/**
 * Binds the context for the rest of the request (AsyncLocalStorage), so the
 * repository can add its database time without the context being passed
 * through every layer. Placed after express.json(): async context does not
 * reliably survive the body parser's stream callbacks.
 */
export const bindRequestContext: RequestHandler = (
  _request,
  response,
  next,
) => {
  const context = requestContextOf(response);
  if (!context) {
    next();
    return;
  }
  runWithContext(context, next);
};
