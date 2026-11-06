import type {
  SearchVocabulary,
  VocabularyProvider,
} from '../../src/models/search.model';
import { RuleBasedQueryInterpreter } from '../../src/services/query-interpreter.service';
import type { RestaurantServiceDependencies } from '../../src/services/restaurant.service';

/** A fixed vocabulary that never refreshes, for tests without a database. */
export function staticVocabulary(
  vocabulary: SearchVocabulary = {
    cities: new Map([
      ['gurgaon', 'IN'],
      ['new delhi', 'IN'],
      ['orlando', 'US'],
    ]),
    cuisines: new Set(['south indian', 'street food', 'chinese', 'cafe']),
  },
): VocabularyProvider & { refreshes: number } {
  return {
    refreshes: 0,
    snapshot: () => vocabulary,
    isLoaded: () => true,
    refresh() {
      this.refreshes++;
      return Promise.resolve();
    },
  };
}

/** Service dependencies for tests: a fixed vocabulary and the real interpreter. */
export function serviceDependencies(
  overrides: Partial<RestaurantServiceDependencies> = {},
): RestaurantServiceDependencies {
  return {
    vocabulary: staticVocabulary(),
    interpreter: new RuleBasedQueryInterpreter({ bestMinVotes: 20 }),
    ...overrides,
  };
}
