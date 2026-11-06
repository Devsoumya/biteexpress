/**
 * True when `a` and `b` differ by at most one insertion, deletion,
 * substitution or swap of adjacent characters (optimal string alignment), so
 * "gurgoan" is one edit from "gurgaon". Used to correct a city typo.
 */
export function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;

  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const restA = a.slice(i + 1);
  const restB = b.slice(i + 1);

  if (a.length === b.length) {
    // Substitution, or a swap of positions i and i + 1.
    const swapped =
      a[i] === b[i + 1] &&
      a[i + 1] === b[i] &&
      a.slice(i + 2) === b.slice(i + 2);
    return restA === restB || swapped;
  }
  // One extra character in the longer string at position i.
  return a.length > b.length
    ? a.slice(i + 1) === b.slice(i)
    : a.slice(i) === b.slice(i + 1);
}

/**
 * The optimal string alignment distance between `a` and `b` (insertions,
 * deletions, substitutions, swaps of adjacent characters) when it is at most
 * `max`; undefined when it is larger. Stops as soon as a row exceeds `max`.
 */
export function editDistanceWithin(
  a: string,
  b: string,
  max: number,
): number | undefined {
  if (Math.abs(a.length - b.length) > max) return undefined;
  // Three rows of the dynamic-programming table: two back is needed for swaps.
  let twoBack: number[] = [];
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(
        (previous[j] ?? Infinity) + 1,
        (current[j - 1] ?? Infinity) + 1,
        (previous[j - 1] ?? Infinity) + cost,
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, (twoBack[j - 2] ?? Infinity) + 1);
      }
      current[j] = value;
      rowMin = Math.min(rowMin, value);
    }
    if (rowMin > max) return undefined;
    twoBack = previous;
    previous = current;
  }
  const distance = previous[b.length] ?? Infinity;
  return distance <= max ? distance : undefined;
}

/**
 * How many typos a typed word may contain and still be corrected (ADR-002
 * Pass 6b), by its length, like Elasticsearch's AUTO fuzziness: short words
 * are too close to each other ("thai", "chai") to correct safely.
 */
export function typoAllowance(word: string): number {
  if (word.length <= 4) return 0;
  if (word.length <= 8) return 1;
  return 2;
}
