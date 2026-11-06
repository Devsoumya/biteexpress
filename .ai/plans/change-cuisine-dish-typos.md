# Change: typo correction for cuisines and dishes in `q`

- **Status:** Done (2026-11-07; the author reported cuisine typos not being corrected and approved this plan)
- **Design:** ADR-002 (Passes 5, 6, 7; city typo rule in Pass 4), RFC-001 §5

## Goal

A misspelled cuisine or dish in `q` is read as that cuisine or dish, with a note that says so, the way a misspelled city after "in" already is. Today:

| Query                        | Today                                                                  |
| ---------------------------- | ---------------------------------------------------------------------- |
| `chineese in gurgaon`        | Boost term only: Chinese names first, then the rest of Gurgaon         |
| `north indain in new delhi`  | Boost term only: "North East Castle" first                             |
| `dosaa in bangalore`         | Boost term that matches nothing useful: Toit, The Fatty Bao, …         |
| `goli vada pao`, `vada paav` | Already work: nothing else recognized → fuzzy text (Pass 8). Unchanged |

## Rule

A new pass, **6b: near-miss cuisines and dishes**, runs after the exact dish (5) and cuisine (6) passes, on the words still unused:

1. **Candidates:** the tenant's cuisines (vocabulary) and the dish lexicon (`DISHES`), compared with phrases of the same number of words, longest first (up to 3 words), word by word.
2. **Typos allowed per word, by the length of the typed word** (the way Elasticsearch `AUTO` fuzziness works):

   | Typed word length | Edits allowed |
   | ----------------- | ------------- |
   | 1-4               | 0             |
   | 5-8               | 1             |
   | 9+                | 2             |

   An edit is an insertion, deletion, substitution or a swap of two neighbouring letters (optimal string alignment, as `withinOneEdit` today). Every word of the phrase must be within its own allowance and at least one word must differ (otherwise the exact pass would have taken it).

3. **Exactly one candidate → corrected.** A cuisine goes into `criteria.cuisines`; a dish into `criteria.dishes` (with its usual dish note). The note: `showing results for 'chinese' (you typed 'chineese')`.
4. **Two or more → not corrected.** The words stay a boost term (today's behaviour), with a note: `'xxxx' is close to chinese or chilean; did you mean one of them?`.
5. **Never corrected:** noise words (fillers, currency words, amounts) and words already used by an earlier pass. Explicit parameters (`cuisine=`) stay exact: they are validated strictly, and a silent rewrite of what a client sent would surprise.

Because a corrected word becomes a real criterion, `chineese` alone is now a cuisine filter (with a note) instead of the Pass 8 text fallback.

## Approach

- `utils/edit-distance.ts`: add `editDistanceWithin(a, b, max): number | undefined` (bounded optimal string alignment; returns the distance, or `undefined` when above `max`) and `typoAllowance(word)`. `withinOneEdit` stays for the city rule (unchanged behaviour; it could later use the same helper).
- `services/query-interpreter.service.ts`: `parseNearMisses(words, criteria, notes, vocabulary)` after `parseCuisines`. It reuses `Words.phraseAt`/`take` and the dish-note helper, merges into existing `criteria.cuisines` / `criteria.dishes` (keeping the `MAX_DISHES` cap and the "several …: matching any of them" notes).
- No change to the search builder, the API contract, the index or the OpenAPI document: the output is the same criteria the exact passes produce. The interpretation's `notes` gain the new messages.
- Docs: ADR-002 (new Pass 6b, allowance table, the ambiguity rule, the `cuisine=` decision; the example list), RFC-001 §5 one line if it names typo handling, README only if it lists example queries.

## Tests

- [x] `editDistanceWithin` table: 0, 1, 2 edits, swaps, above `max` → `undefined`, symmetric; `typoAllowance` at the boundaries 4/5 and 8/9.
- [x] Interpreter table (query → exact criteria and notes):
  - `chineese in gurgaon` → cuisines `chinese` + note
  - `north indain in new delhi` → cuisines `north indian` + note
  - `dosaa in bangalore` → dish `dosa` + dish note + correction note
  - long words get 2 edits: `mediteranaen` → `mediterranean` (12 letters, 2 edits)
  - medium words get 1: `chineese` corrected, but `chineeze` (2 edits, 8 letters) is not
  - ambiguous near miss → boost term + "did you mean" note
  - guards, not corrected: a 4-letter word one edit from a cuisine (`thar`), a filler, an amount, an already-recognized city
  - exact matches still win and add no note (`chinese in gurgaon` unchanged)
- [x] Integration (search fixtures): `chineese in gurgaon` returns only the Chinese fixtures; `dosaa in …` returns the dosa / South Indian fixtures; both with the note.

## Out of scope

Typo correction for explicit parameters (`cuisine=`, `city=`); changing the Atlas Search fuzzy setting (`maxEdits: 1`, `prefixLength: 2`) for names and text; phonetic matching; extending the city rule to the new allowance table.

## Notes after implementation

- **Checked against the real vocabulary (145 cuisines) with about 120 everyday food words.** Most corrections are wanted: plurals and singulars (pizzas, burgers, cafes, salads, noodle → noodles, parathas), swaps (indain), long words (contnental, mediteranaen), dishes (dosaa, biryaani, shawarama, momoss). Region names become their cuisine when they are not cities in the data (bengal → bengali, korea → korean); "hyderabad" and "lucknow" are read as cities first.
- **One wrong correction found and fixed:** "dinner" was corrected to the cuisine "Diner". Meal words (`dinner`, `lunch`, `meal`, `meals`, `dining`) are now fillers.
- **The "several cuisines/dishes" notes moved** to after Pass 6b (`noteSeveral`), so a corrected cuisine added to an exact one is reported too. Note order for existing queries is unchanged.
- **`editDistanceWithin(a, b, max)`** is a bounded optimal string alignment that stops once a row exceeds `max`. `withinOneEdit` stays for the city rule, whose behaviour is unchanged.
- **Integration test:** the search fixtures are all in Gurgaon, so the dish case is `dosaa in gurgaon`, compared with `dosa in gurgaon`.
- **Not done:** "in chineese" (no city) is still read as an unknown city, because the city pass runs first and only knows exact cuisines. This is rare and left as is.
- **Tests:** 656 unit, 98 integration, all passing.
