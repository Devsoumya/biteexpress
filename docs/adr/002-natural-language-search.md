# ADR-002: Natural-language search

## Context

`/v1/restaurants/search` has to understand queries like the three in the brief:

1. "Best restaurants in Gurgaon with South Indian Food"
2. "Restaurants in Gurgaon under Rs. 1000 for two"
3. "Nearest place that serves Vada Pav"

Constraints:

- **It has to run with `docker compose up` alone:** no API key, no external call.
- **It must not add a second query path.** Search should reuse the list's `$search` builder.
- **The data has no dish field.** "Vada Pav" isn't a cuisine. It appears in 13 restaurant names and maps loosely to the `Street Food` cuisine (562 restaurants).
- **Short dish words collide with prefixes:** "pav" is a prefix of "Pavilion".

Atlas Search can't do this on its own. Searching the raw text ranks by word overlap: "in Gurgaon" would favour restaurants with Gurgaon in their _name_, and "under 1000" would match the token "1000". Something has to turn the text into structure first.

## Decision

A **deterministic, rule-based interpreter** turns `q` into the same criteria object the list endpoint uses, and the shared builder (ADR-003) places each part in the right clause of the `$search` compound. It is a pure function: `interpret(q, { hasCoords, vocabulary }) → { criteria, notes }`.

### Passes

The text is normalized and split into words. Passes run in this order, and each one consumes the words it recognizes:

1. **Price:** "under / below / upto N", "over N", "between A and B", "500-1500"; amounts like `1,000`, `1k`, `1.5k`; Rs / ₹ / INR / $ / USD. Then:
   - **The currency resolves** (written in the text, or the city's): the price is a filter.
   - **It doesn't:** the price becomes a ranking preference instead. Within-price restaurants come first, then the rest.
   - **Budget words:** "cheap", "budget" and similar set price tier ≤ 2.
2. **Intent:**
   - "best", "top rated": rating order, with a vote floor of 20 so that a 4.9 from 3 votes doesn't win.
   - "nearest", "near me": distance order.
   - "cheapest": cost order.
3. **Features:** "online delivery", "book a table".
4. **City:** "in <city>" or a known city name, longest phrase first, with aliases (Gurugram, Delhi, Bengaluru, Bombay). A typo after "in" is corrected only when exactly one city is one edit away, so "gurgoan" becomes Gurgaon, with a note. "nangalore" is one edit from both Bangalore and Mangalore, so it isn't corrected.
5. **Dishes:** a small lexicon mapping each dish to the cuisines that serve it (vada pav → street food, dosa → south indian, momos → tibetan, chinese). A dish matches as a **phrase** in the name, OR as one of those cuisines. The data has no dish field, so every matched dish adds a note saying exactly that, for example _"vada pav: restaurants with it in their name, or street food places that probably serve it"_. A client never mistakes a cuisine match for a menu fact.
6. **Cuisine:** the cuisines the data actually has (145, including 32 multi-word ones like "street food").
   - **Misspelled cuisines and dishes (6b):** the words still unused are compared with the cuisines and the dishes, word by word, longest phrase first (up to 3 words). Each typed word may have as many typos as its length allows: none up to 4 letters, 1 for 5-8, 2 for 9 or more (like Elasticsearch's `AUTO` fuzziness). A typo is an insertion, deletion, substitution or swap of adjacent letters. When exactly one cuisine or dish is that close, it is used like an exact match, with a note: "chineese" becomes Chinese, "north indain" North Indian, "dosaa" the dish dosa, "pizzas" Pizza. When several are close, nothing is corrected: the words stay a boost term and a note lists the options. Short words are never corrected, because they sit too close to each other ("thar" vs "thai"). Meal words ("dinner", "lunch") are fillers, so "dinner" never becomes the cuisine "Diner". Explicit parameters (`cuisine=`) stay exact: a client that sends a value gets exactly that value.
7. **Leftovers:** filler words are dropped. Other words become **boost terms**: they raise the rank of matching names, cuisines or localities, but never exclude anything. "south indian near cyber hub" ranks Cyber Hub restaurants first without emptying the list.
8. **Nothing recognized:** the words become a typo-tolerant text match on name, cuisines and locality, so "goli vada pao" still finds "Goli Vada Pav No. 1".

**The vocabulary** (cities with their country, and cuisines) comes from the database, not a hard-coded list. It is loaded at startup, refreshed every 24 hours and right after a POST, and kept as the last good copy if a refresh fails. A city added through POST becomes searchable without a deploy.

### How criteria become `$search`

| Criteria                                                                    | Clause                                                                                      |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| city, cuisines, rating, votes, cost (with a currency), features, price tier | `filter`                                                                                    |
| dish, text                                                                  | `must` for relevance order; `filter` for any other order, so they narrow without reordering |
| boost terms, price preference                                               | `should`: they rank, never exclude                                                          |

### Rules

- **Explicit parameters win.** `city=noida` overrides "in gurgaon", with a note. Explicit parameters are validated strictly (400). Words in `q` are read leniently (notes).
- **"Nearest" without coordinates** answers 200 in relevance order, with a note. The list endpoint, by contrast, rejects `sort=distance` without coordinates.
- **Defaults:** relevance when there's a dish, text or boost term; else distance with coordinates; else rating. Relevance ties are broken by rating.

### Response

The list response plus `interpretation`: the normalized values used, the resolved sort, and `notes` saying what was ignored, boosted, overridden or corrected. A client can show these as chips, and a reviewer can see exactly why each result is there.

## Brief examples

| Query                                                 | Understood as                                                       | Result on the seed                   |
| ----------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------ |
| Best restaurants in Gurgaon with South Indian Food    | city gurgaon, cuisine south indian, rating order, at least 20 votes | Zambar (4.0) first                   |
| Restaurants in Gurgaon under Rs. 1000 for two         | city gurgaon, cost ≤ 1000 INR                                       | Caterspoint (4.9) first              |
| Nearest place that serves Vada Pav (with coordinates) | dish vada pav (name phrase OR street food), distance order          | Goli Vada Pav No. 1 at 0.47 km first |

## Alternatives

| Option                        | Why not                                                                                                                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Atlas Search on the raw query | Word overlap: no price filter, no exact city                                                                                                                             |
| An LLM extracts the criteria  | Handles looser phrasing and other languages, but adds an API key, latency, cost per query, and non-deterministic tests. It could slot in behind the same interface later |
| An NLP library                | The brief needs about eight patterns; a library adds weight without solving more                                                                                         |
| Vector search                 | Ranks by similarity, extracts no filters, and the data has little text to embed                                                                                          |
| Unknown words as filters      | One unrecognized word would empty the list                                                                                                                               |

## Consequences

- **Every rule is a row in a test table**, and the interpreter runs in microseconds.
- **The limits are clear:** English only, no negation, several cuisines always mean "any". Dish matching is approximate: a name match is real, a cuisine match means "probably serves it". A bare city word inside a name ("Delhi Darbar") is read as the city. Typo correction covers cities (after "in", one typo) and cuisines and dishes (by word length), only in `q`. A word one typo from a cuisine is read as that cuisine even when it was meant as part of a name.
- **Vocabulary freshness:** per instance, up to 24 hours stale on instances that didn't handle the POST. Restaurants aren't added daily, so a daily refresh is enough, and the instance that handled a POST refreshes at once.
