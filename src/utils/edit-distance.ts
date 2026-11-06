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
