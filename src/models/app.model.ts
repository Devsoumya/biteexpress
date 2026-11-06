import type { Logger } from '../utils/logger';
import type { ReadinessService } from './health.model';
import type { RestaurantService } from './restaurant.model';

/** Everything createApp needs; server.ts wires the real implementations. */
export interface AppDependencies {
  readinessService: ReadinessService;
  restaurantService: RestaurantService;
  logger: Logger;
  /** Requests slower than this are logged at `warn` (SLOW_REQUEST_MS). */
  slowRequestMs: number;
}
