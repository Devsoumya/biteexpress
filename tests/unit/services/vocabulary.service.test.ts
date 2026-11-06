import type { SearchVocabulary } from '../../../src/models/search.model';
import {
  CachedVocabularyService,
  EMPTY_VOCABULARY,
} from '../../../src/services/vocabulary.service';

const FIRST: SearchVocabulary = {
  cities: new Map([['gurgaon', 'IN']]),
  cuisines: new Set(['cafe']),
};
const SECOND: SearchVocabulary = {
  cities: new Map([
    ['gurgaon', 'IN'],
    ['udaipur', 'IN'],
  ]),
  cuisines: new Set(['cafe', 'rajasthani']),
};

function repositoryReturning(...results: (SearchVocabulary | Error)[]) {
  const vocabulary = jest.fn(() => {
    const next = results.shift() ?? new Error('no more results');
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  });
  return { vocabulary };
}

describe('CachedVocabularyService', () => {
  afterEach(() => jest.useRealTimers());

  it('is empty and not loaded before the first load', () => {
    const service = new CachedVocabularyService(repositoryReturning(FIRST), {
      refreshMs: 1000,
      onError: jest.fn(),
    });

    expect(service.isLoaded()).toBe(false);
    expect(service.snapshot()).toBe(EMPTY_VOCABULARY);
  });

  it('load() reads the repository and makes the snapshot available', async () => {
    const service = new CachedVocabularyService(repositoryReturning(FIRST), {
      refreshMs: 1000,
      onError: jest.fn(),
    });

    await service.load();

    expect(service.isLoaded()).toBe(true);
    expect(service.snapshot()).toBe(FIRST);
  });

  it('load() throws on failure, so startup fails loudly', async () => {
    const service = new CachedVocabularyService(
      repositoryReturning(new Error('down')),
      { refreshMs: 1000, onError: jest.fn() },
    );

    await expect(service.load()).rejects.toThrow('down');
    expect(service.isLoaded()).toBe(false);
  });

  it('refresh() replaces the snapshot (a POSTed city becomes known)', async () => {
    const service = new CachedVocabularyService(
      repositoryReturning(FIRST, SECOND),
      { refreshMs: 1000, onError: jest.fn() },
    );
    await service.load();

    await service.refresh();

    expect(service.snapshot().cities.has('udaipur')).toBe(true);
  });

  it('a failed refresh keeps the last good snapshot and reports the error', async () => {
    const onError = jest.fn();
    const failure = new Error('timeout');
    const service = new CachedVocabularyService(
      repositoryReturning(FIRST, failure),
      { refreshMs: 1000, onError },
    );
    await service.load();

    await expect(service.refresh()).resolves.toBeUndefined();

    expect(service.snapshot()).toBe(FIRST);
    expect(onError).toHaveBeenCalledWith(failure);
  });

  it('start() refreshes on the interval; stop() ends it', async () => {
    jest.useFakeTimers();
    const repository = repositoryReturning(FIRST, SECOND, FIRST);
    const service = new CachedVocabularyService(repository, {
      refreshMs: 300_000,
      onError: jest.fn(),
    });
    await service.load();
    service.start();

    await jest.advanceTimersByTimeAsync(299_999);
    expect(repository.vocabulary).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(repository.vocabulary).toHaveBeenCalledTimes(2);
    expect(service.snapshot()).toBe(SECOND);

    service.stop();
    await jest.advanceTimersByTimeAsync(600_000);
    expect(repository.vocabulary).toHaveBeenCalledTimes(2);
  });
});
