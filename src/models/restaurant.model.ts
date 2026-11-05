/** Cuisines as shown to clients and as canonical filter keys (`norm.cuisines`). */
export interface NormalizedCuisines {
  display: string[];
  /** `norm[i] === normalize(display[i])` for every i. */
  norm: string[];
}
