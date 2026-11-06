import { type Logger, createLogger } from '../../src/utils/logger';

export interface CapturedLogger {
  logger: Logger;
  /** Every line written so far, parsed. */
  lines(): Record<string, unknown>[];
  /** The raw text, to assert that a value never appears anywhere. */
  text(): string;
}

/** A real pino logger writing to memory (synchronously), for assertions. */
export function captureLogger(level = 'debug'): CapturedLogger {
  const chunks: string[] = [];
  const logger = createLogger({
    level,
    destination: { write: (chunk: string) => void chunks.push(chunk) },
  });
  const text = () => chunks.join('');
  return {
    logger,
    text,
    lines: () =>
      text()
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

export const silentLogger = (): Logger => createLogger({ level: 'silent' });

/**
 * The request lines written so far. The line is written on the response's
 * 'finish' event, which can land just after Supertest resolves, so this
 * waits a turn of the event loop first.
 */
export async function requestLines(
  captured: CapturedLogger,
): Promise<Record<string, unknown>[]> {
  await new Promise((resolve) => setImmediate(resolve));
  return captured.lines().filter((line) => line['msg'] === 'request');
}
