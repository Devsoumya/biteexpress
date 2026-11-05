import type { ReadinessService } from './health.model';

/** Everything createApp needs; server.ts wires the real implementations. */
export interface AppDependencies {
  readinessService: ReadinessService;
}
