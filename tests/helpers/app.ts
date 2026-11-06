import type { Express } from 'express';
import { createApp } from '../../src/app';
import type { AppDependencies } from '../../src/models/app.model';
import { silentLogger } from './logger';

function notUsed(name: string): never {
  throw new Error(`${name} is not used in this test; pass it to createTestApp`);
}

/**
 * The real app with only the dependencies a test cares about. The others
 * throw if called, so a test cannot depend on them by accident.
 */
export function createTestApp(overrides: Partial<AppDependencies>): Express {
  return createApp({
    readinessService: { check: () => notUsed('readinessService') },
    logger: silentLogger(),
    slowRequestMs: 500,
    restaurantService: {
      create: () => notUsed('restaurantService'),
      getById: () => notUsed('restaurantService'),
      list: () => notUsed('restaurantService'),
      search: () => notUsed('restaurantService'),
    },
    ...overrides,
  });
}
