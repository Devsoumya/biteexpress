import {
  CHEAP_MAX_PRICE_RANGE,
  CHEAP_WORDS,
  CURRENCY_WORDS,
  DISHES,
  FEATURE_PHRASES,
  FILLERS,
  INTENT_PHRASES,
  type Intent,
  MAX_PRICE_WORDS,
  MIN_PRICE_WORDS,
  NOT_PLACES,
  PLACE_PREPOSITIONS,
} from '../constants/lexicon';
import type {
  Dish,
  InterpretContext,
  Interpretation,
  QueryInterpreter,
  SearchVocabulary,
} from '../models/search.model';
import { withinOneEdit } from '../utils/edit-distance';
import { normalize, normalizeCity } from '../utils/normalize';

const MAX_PHRASE_WORDS = 4;
export const MAX_DISHES = 10;
export const MAX_BOOST_TERMS = 10;

type ParsedCriteria = Interpretation['criteria'];

/**
 * The query as words, each marked once a pass has used it. Passes only look
 * at unused words, so a word is never claimed twice ("street food" is a
 * cuisine before "food" can be dropped as a filler).
 */
class Words {
  private readonly used: boolean[];

  constructor(readonly words: readonly string[]) {
    this.used = words.map(() => false);
  }

  get length(): number {
    return this.words.length;
  }

  free(index: number): boolean {
    return index < this.words.length && !this.used[index];
  }

  /** The `count` unused words starting at `index`, joined; undefined if any is used. */
  phraseAt(index: number, count: number): string | undefined {
    if (index + count > this.words.length) return undefined;
    for (let i = index; i < index + count; i++) {
      if (!this.free(i)) return undefined;
    }
    return this.words.slice(index, index + count).join(' ');
  }

  take(index: number, count = 1): void {
    for (let i = index; i < index + count; i++) this.used[i] = true;
  }

  /** Every occurrence of `phrase` in unused words, taken as found. */
  takeAll(phrase: string): number {
    const count = phrase.split(' ').length;
    let found = 0;
    for (let i = 0; i + count <= this.words.length; i++) {
      if (this.phraseAt(i, count) === phrase) {
        this.take(i, count);
        found++;
      }
    }
    return found;
  }

  remaining(): { index: number; word: string }[] {
    return this.words
      .map((word, index) => ({ index, word }))
      .filter(({ index }) => this.free(index));
  }
}

/** normalize(), currency symbols as words, "500-1500" as "500 to 1500". */
export function tokenize(q: string): string[] {
  return normalize(q)
    .replace(/₹/g, ' rs ')
    .replace(/\$/g, ' usd ')
    .replace(/\brs\./g, 'rs ')
    .replace(/(\d)\s*-\s*(\d)/g, '$1 to $2')
    .split(/[^a-z0-9.,]+/)
    .map((word) => word.replace(/^[.,]+|[.,]+$/g, ''))
    .filter((word) => word.length > 0);
}

const AMOUNT = /^\d[\d,]*(\.\d+)?k?$/;

/** "1000", "1,000", "1k", "1.5k" → a number; anything else → undefined. */
export function parseAmount(word: string | undefined): number | undefined {
  if (word === undefined || !AMOUNT.test(word)) return undefined;
  const thousands = word.endsWith('k');
  const value = Number(word.replace(/,/g, '').replace(/k$/, ''));
  return Number.isFinite(value) ? value * (thousands ? 1000 : 1) : undefined;
}

/** Words that carry no meaning of their own once the passes have run. */
function isNoiseWord(word: string): boolean {
  return (
    FILLERS.includes(word) ||
    CURRENCY_WORDS.has(word) ||
    parseAmount(word) !== undefined
  );
}

/** Longest phrase first, so "south indian" is tried before "indian". */
function byLengthDescending(phrases: Iterable<string>): string[] {
  return [...phrases].sort((a, b) => b.split(' ').length - a.split(' ').length);
}

/** "[currency] amount [currency]" at `index`; how many words it used. */
function amountAt(
  words: Words,
  index: number,
): { amount: number; currency?: string; used: number } | undefined {
  let i = index;
  let currency = words.free(i)
    ? CURRENCY_WORDS.get(words.words[i] ?? '')
    : undefined;
  if (currency) i++;
  const amount = words.free(i) ? parseAmount(words.words[i]) : undefined;
  if (amount === undefined) return undefined;
  i++;
  const after = words.free(i)
    ? CURRENCY_WORDS.get(words.words[i] ?? '')
    : undefined;
  if (after) {
    currency ??= after;
    i++;
  }
  return { amount, ...(currency && { currency }), used: i - index };
}

/** Pass 1: price ceilings, floors, ranges and budget words. */
function parsePrice(words: Words, criteria: ParsedCriteria): void {
  const setCurrency = (currency: string | undefined) => {
    if (currency) criteria.currency = currency;
  };
  for (let i = 0; i < words.length; i++) {
    for (const [phrases, bound] of [
      [MAX_PRICE_WORDS, 'maxCost'],
      [MIN_PRICE_WORDS, 'minCost'],
    ] as const) {
      for (const phrase of byLengthDescending(phrases)) {
        const count = phrase.split(' ').length;
        if (words.phraseAt(i, count) !== phrase) continue;
        const found = amountAt(words, i + count);
        if (!found) continue;
        criteria[bound] = found.amount;
        setCurrency(found.currency);
        words.take(i, count + found.used);
      }
    }
    // "between 500 and 1500", "500 to 1500"
    const start = words.phraseAt(i, 1) === 'between' ? i + 1 : i;
    const low = amountAt(words, start);
    if (low) {
      const joiner = start + low.used;
      const word = words.phraseAt(joiner, 1);
      const high =
        word === 'and' || word === 'to'
          ? amountAt(words, joiner + 1)
          : undefined;
      if (high && (start > i || word === 'to')) {
        criteria.minCost = Math.min(low.amount, high.amount);
        criteria.maxCost = Math.max(low.amount, high.amount);
        setCurrency(low.currency ?? high.currency);
        words.take(i, joiner + 1 + high.used - i);
      }
    }
  }
  for (const word of CHEAP_WORDS) {
    if (words.takeAll(word) > 0) criteria.maxPriceRange = CHEAP_MAX_PRICE_RANGE;
  }
}

/** Pass 2: best / nearest / cheapest; applied after the other passes. */
function parseIntents(words: Words): Set<Intent> {
  const intents = new Set<Intent>();
  for (const phrase of byLengthDescending(INTENT_PHRASES.keys())) {
    const intent = INTENT_PHRASES.get(phrase);
    if (intent && words.takeAll(phrase) > 0) intents.add(intent);
  }
  return intents;
}

/** Pass 3: feature flags. */
function parseFeatures(words: Words, criteria: ParsedCriteria): void {
  for (const phrase of byLengthDescending(FEATURE_PHRASES.keys())) {
    const feature = FEATURE_PHRASES.get(phrase);
    if (feature && words.takeAll(phrase) > 0) {
      criteria.features = { ...criteria.features, [feature]: true };
    }
  }
}

/** A known city (after aliases) for `count` words at `index`, if any. */
function knownCityAt(
  words: Words,
  index: number,
  count: number,
  vocabulary: SearchVocabulary,
): string | undefined {
  const phrase = words.phraseAt(index, count);
  if (phrase === undefined) return undefined;
  const city = normalizeCity(phrase);
  return vocabulary.cities.has(city) ? city : undefined;
}

/** True when the words at `index` mean something other than a place. */
function startsNonPlace(
  words: Words,
  index: number,
  vocabulary: SearchVocabulary,
): boolean {
  const word = words.phraseAt(index, 1);
  if (word === undefined || isNoiseWord(word)) return true;
  for (let count = MAX_PHRASE_WORDS; count >= 1; count--) {
    const phrase = words.phraseAt(index, count);
    if (
      phrase !== undefined &&
      (NOT_PLACES.includes(phrase) ||
        vocabulary.cuisines.has(phrase) ||
        DISHES.has(phrase) ||
        FEATURE_PHRASES.has(phrase) ||
        INTENT_PHRASES.has(phrase))
    ) {
      return true;
    }
  }
  return false;
}

/** A city found in the words: which words it used, and a note if corrected. */
interface CityMatch {
  city: string;
  start: number;
  count: number;
  note?: string;
}

/**
 * Pass 4: the city, by three strategies in order of confidence; the first
 * that matches wins:
 * 1. "in <known city>", longest phrase first;
 * 2. a bare known city anywhere, longest phrase first;
 * 3. "in <unknown>": corrected when exactly one city is one edit away;
 *    otherwise the unknown city is kept, so the list is empty and the note
 *    says why.
 */
function parseCity(
  words: Words,
  criteria: ParsedCriteria,
  notes: string[],
  vocabulary: SearchVocabulary,
): void {
  const prepositions = words
    .remaining()
    .filter(({ word }) => PLACE_PREPOSITIONS.includes(word))
    .map(({ index }) => index);

  const match =
    knownCityAfterPreposition(words, prepositions, vocabulary) ??
    knownCityAnywhere(words, vocabulary) ??
    unknownCityAfterPreposition(words, prepositions, vocabulary);
  if (!match) return;

  criteria.city = match.city;
  if (match.note !== undefined) notes.push(match.note);
  words.take(match.start, match.count);
}

/** Strategy 1: "in <known city>"; the preposition is used too. */
function knownCityAfterPreposition(
  words: Words,
  prepositions: readonly number[],
  vocabulary: SearchVocabulary,
): CityMatch | undefined {
  for (const at of prepositions) {
    for (let count = MAX_PHRASE_WORDS; count >= 1; count--) {
      const city = knownCityAt(words, at + 1, count, vocabulary);
      if (city) return { city, start: at, count: count + 1 };
    }
  }
  return undefined;
}

/** Strategy 2: a known city without a preposition. */
function knownCityAnywhere(
  words: Words,
  vocabulary: SearchVocabulary,
): CityMatch | undefined {
  for (let count = MAX_PHRASE_WORDS; count >= 1; count--) {
    for (let i = 0; i < words.length; i++) {
      const city = knownCityAt(words, i, count, vocabulary);
      if (city) return { city, start: i, count };
    }
  }
  return undefined;
}

/**
 * Strategy 3: "in <something>" that is not a known city. Skipped when the
 * words after the preposition mean something else ("in cheap", "in 500").
 */
function unknownCityAfterPreposition(
  words: Words,
  prepositions: readonly number[],
  vocabulary: SearchVocabulary,
): CityMatch | undefined {
  for (const at of prepositions) {
    if (startsNonPlace(words, at + 1, vocabulary)) continue;
    for (let count = Math.min(3, words.length - at - 1); count >= 1; count--) {
      const typed = words.phraseAt(at + 1, count);
      if (typed === undefined) continue;
      const candidates = [...vocabulary.cities.keys()].filter((city) =>
        withinOneEdit(typed, city),
      );
      const [only] = candidates;
      if (candidates.length === 1 && only !== undefined) {
        return {
          city: only,
          start: at,
          count: count + 1,
          note: `showing results for '${only}' (you typed '${typed}')`,
        };
      }
      // Ambiguous: keep what was typed (empty result) and list the options.
      if (candidates.length > 1) {
        return {
          city: typed,
          start: at,
          count: count + 1,
          note: `no city '${typed}'; did you mean ${candidates.sort().join(' or ')}?`,
        };
      }
    }
    const typed = words.phraseAt(at + 1, 1);
    if (typed !== undefined) {
      return {
        city: normalizeCity(typed),
        start: at,
        count: 2,
        note: `no city '${typed}'`,
      };
    }
  }
  return undefined;
}

/** How a dish was matched, for the interpretation's notes. */
export function dishNote({ phrase, cuisines }: Dish): string {
  return cuisines.length > 0
    ? `${phrase}: restaurants with it in their name, or ${cuisines.join(' or ')} places that probably serve it`
    : `${phrase}: restaurants with it in their name`;
}

/** Pass 5: dish phrases (name phrase OR the cuisines that serve them). */
function parseDishes(
  words: Words,
  criteria: ParsedCriteria,
  notes: string[],
  vocabulary: SearchVocabulary,
): void {
  const dishes: Dish[] = [];
  for (const phrase of byLengthDescending(DISHES.keys())) {
    if (words.takeAll(phrase) === 0) continue;
    const cuisines = (DISHES.get(phrase) ?? []).filter((c) =>
      vocabulary.cuisines.has(c),
    );
    dishes.push({ phrase, cuisines });
  }
  if (dishes.length === 0) return;
  if (dishes.length > MAX_DISHES)
    notes.push(`only the first ${MAX_DISHES} dishes are used`);
  // The data has no dish field, so say how each dish was matched: a name
  // match is real, a cuisine match means "probably serves it". The wording
  // says nothing about order, which depends on the sort.
  for (const dish of dishes.slice(0, MAX_DISHES)) notes.push(dishNote(dish));
  criteria.dishes = dishes.slice(0, MAX_DISHES);
  if (dishes.length > 1) notes.push('several dishes: matching any of them');
}

/** Pass 6: the cuisines the tenant's restaurants list. */
function parseCuisines(
  words: Words,
  criteria: ParsedCriteria,
  notes: string[],
  vocabulary: SearchVocabulary,
): void {
  const cuisines: string[] = [];
  for (const cuisine of byLengthDescending(vocabulary.cuisines)) {
    if (words.takeAll(cuisine) > 0) cuisines.push(cuisine);
  }
  if (cuisines.length === 0) return;
  criteria.cuisines = cuisines;
  if (cuisines.length > 1) notes.push('several cuisines: matching any of them');
}

/** Intent precedence: nearest (with coordinates) > best > cheapest. */
function applyIntents(
  intents: Set<Intent>,
  criteria: ParsedCriteria,
  notes: string[],
  { hasCoords, bestMinVotes }: { hasCoords: boolean; bestMinVotes: number },
): void {
  if (intents.has('nearest')) {
    if (hasCoords) criteria.sort = 'distance';
    else notes.push('nearest needs lat/lng; showing best matches');
  }
  if (intents.has('best')) {
    criteria.minVotes = bestMinVotes;
    if (criteria.sort === undefined) criteria.sort = 'rating';
    else
      notes.push(
        `best: nearest first among restaurants with at least ${bestMinVotes} votes`,
      );
  }
  if (intents.has('cheapest')) {
    if (criteria.sort === undefined) {
      criteria.sort = 'cost';
      criteria.order = 'asc';
    } else {
      notes.push(`cheapest ignored: sorted by ${criteria.sort}`);
    }
  }
}

/** Pass 7: unused words become boost phrases; fillers and numbers are dropped. */
function leftovers(words: Words, notes: string[]): string[] {
  const phrases: string[] = [];
  const ignored: string[] = [];
  let run: string[] = [];
  let previous = -2;
  const flush = () => {
    if (run.length > 0) phrases.push(run.join(' '));
    run = [];
  };
  for (const { index, word } of words.remaining()) {
    if (isNoiseWord(word)) {
      ignored.push(word);
      flush();
      continue;
    }
    if (index !== previous + 1) flush();
    run.push(word);
    previous = index;
  }
  flush();
  if (ignored.length > 0)
    notes.push(`ignored: ${[...new Set(ignored)].join(', ')}`);
  return phrases;
}

/**
 * The rule-based interpreter (ADR-002): q → criteria + notes. Pure and
 * deterministic: the vocabulary is passed in, nothing is read or clocked, so
 * every rule is a row in a test table.
 */
export class RuleBasedQueryInterpreter implements QueryInterpreter {
  constructor(private readonly options: { bestMinVotes: number }) {}

  interpret(
    q: string,
    { hasCoords, vocabulary }: InterpretContext,
  ): Interpretation {
    const words = new Words(tokenize(q));
    const criteria: ParsedCriteria = {};
    const notes: string[] = [];

    parsePrice(words, criteria);
    const intents = parseIntents(words);
    parseFeatures(words, criteria);
    parseCity(words, criteria, notes, vocabulary);
    parseDishes(words, criteria, notes, vocabulary);
    parseCuisines(words, criteria, notes, vocabulary);
    applyIntents(intents, criteria, notes, {
      hasCoords,
      bestMinVotes: this.options.bestMinVotes,
    });

    const phrases = leftovers(words, notes);
    const recognized = Object.keys(criteria).length > 0 || intents.size > 0;
    if (!recognized && phrases.length > 0) {
      // Pass 8: nothing structured; search names, cuisines and localities.
      criteria.text = phrases.join(' ');
      notes.push(
        `searching names, cuisines and localities for '${criteria.text}'`,
      );
    } else if (phrases.length > 0) {
      if (phrases.length > MAX_BOOST_TERMS) {
        notes.push(`only the first ${MAX_BOOST_TERMS} boost terms are used`);
      }
      criteria.boostTerms = phrases.slice(0, MAX_BOOST_TERMS);
      notes.push(`boosting: ${criteria.boostTerms.join(', ')}`);
    } else if (!recognized) {
      notes.push('nothing to search for; showing the default list');
    }
    return { criteria, notes };
  }
}
