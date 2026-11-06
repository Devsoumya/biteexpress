import pino, { type DestinationStream, type Logger as PinoLogger } from 'pino';

/** The application's logger type; code outside this file never imports pino. */
export type Logger = PinoLogger;

export interface LoggerOptions {
  level: string;
  /** Defaults to stdout; tests pass an in-memory stream. */
  destination?: DestinationStream;
}

/**
 * Structured JSON logs on stdout (ADR-004): ISO timestamps, the level as a
 * word, and pino's standard error serializer (message, stack, and own
 * properties such as a driver error's `code` and `errInfo`).
 */
export function createLogger({ level, destination }: LoggerOptions): Logger {
  return pino(
    {
      level,
      base: { service: 'biteexpress-api' },
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: { level: (label) => ({ level: label }) },
      serializers: { err: pino.stdSerializers.err },
    },
    destination,
  );
}
