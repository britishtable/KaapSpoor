# Route Segments — Design

**Goal:** stop treating a route as one line, and start treating it as an **approach**, a **main**,
and an **exit** that the reader chooses between — so the distance, ascent and profile on the page
are the numbers for the day they have actually planned.

Today a route carries one or more `variant` lines, and the entry reports *the longest one, since a
reader walks one*. That is a reasonable claim about alternatives and a wrong one about a day out:
the walk in from the car is a real hour of a real ascent, and it is currently either missing or
silently baked into whichever line happened to be longest.

Timing: **7 of 184 routes are drawn.** The model is still cheap to change. It will not be at 60.

---

## Four axes, kept apart

The single `variant` field conflates things that are not the same. This design separates them:

| Axis | What it answers | Where it lives |
|---|---|---|
| **Role** | Is this the walk in, the route, or the walk out? | `role` on the feature |
| **Alternatives** | Which of three ways up did you take? | several features sharing a role |
| **Multiple mains** | Spring Buttress B or C? | main is a picker like the others |
| **Direction** | Are you doing it in reverse? | a property of the *plan*, not the geometry |

Mountain Meanders already thinks this way. Of 184 entries, 138 carry a `Location` section, 130 a
`Route Description`, 11 a `Descent`, 5 a `Parking & Approach`. Multi-main entries are visible in
the section keys too — *Left to Right traverse* / *Right to left traverse*, *Direct Route* /
*Jeep Track Route*, *Reserve Peak* / *Cleft Peak* / *Junction Peak*.

**Multiple mains are alternatives, not a chain.** Spring Buttress B and C are two ways of doing
Spring Buttress; you do one. This makes all three slots the same mechanism with three labels, and
is the single largest simplification in the design. Combining B and C in one outing is not
expressible, and is deliberately out of scope.

---

## The schema

`data/route-lines.geojson` features gain three properties and lose `variant`:

```json
{ "routeId":   "table-mountain--atlantic-west--pimple-traverse",
  "segmentId": "pimple-traverse/approach/kasteelspoort",
  "role":      "approach",
  "name":      "via Kasteelspoort",
  "note":      "steep, shadeless until 9am",
  "drawn":     "2026-08-21" }
```

- `role` — `approach` | `main` | `exit`. Required on every feature written from now on.
- `segmentId` — stable and unique across the whole file. Generated once from route slug + role +
  a slug of the name, and never rewritten afterwards.
- `name` — the picker label. Omitted when a role holds only one option, exactly as `variant` was.
- `note` — unchanged: the caption under the picker.

**Canonical direction** is enforced at draw time: approach runs car→start, main runs start→end,
exit runs end→car. Geometry is stored one way only. Reversal is computed, never drawn.

### Segments are owned by the route, and are not shared

Kasteelspoort will be drawn once per route that uses it. This is a decision, not a compromise
pending a better one: **routes frequently use only part of a named path.** A shared
"Kasteelspoort" segment would be the whole path, and every route that joins it halfway would have
to describe an offset into it. Two routes' copies are different extents, not duplicates — so
there is no dedupe pass that could later merge them, and this spec does not promise one. The cost
is accepted knowingly: more drawing time, in exchange for a line that says what this route
actually walks.

What `segmentId` does buy is the author's own composite routes: a composite is an ordered list of
segment ids drawn from any entries, which needs stable names and nothing else. That is future
work, and this design's job is only to not foreclose it.

---

## Which combinations are legal

**An invariant, not a heuristic: the end of one segment is the start of the next.** A junction is
an *exactly shared coordinate*, produced by the editor snapping a segment's endpoint onto its
neighbour's. Compatibility is therefore coordinate equality — there is no compatibility table to
maintain and nothing to go stale when a line is redrawn.

Consequences:

- The approach picker offers only approaches whose last coordinate equals the chosen main's first,
  and the exit picker only exits whose first equals the chosen main's last. Where Spring Buttress
  B and C start at the same junction, every approach serves both, and this falls out of the
  geometry rather than being declared.
- A near-miss within 25 m is a **build-time warning** naming both segments and the gap distance.
  It fires on lines drawn before snapping existed (the current 7) and on a segment whose neighbour
  was later redrawn. It never blocks a save.
- The picker refuses to offer an unconnected pairing, so a warned gap degrades the choices
  available rather than producing a plausible-looking wrong total.

---

## Derived numbers

- `profile.ts` gains `totalDescentM`, mirroring `totalAscentM` and its `ASCENT_THRESHOLD_M`. The
  reverse toggle needs it and today only ascent exists. Asserted as a property:
  `totalAscentM(reverse(c)) === totalDescentM(c)`.
- **Plan assembly** concatenates the chosen segments in plan order, dropping exactly one
  coordinate at each junction, and runs the existing `cumulativeDistanceM`. The profile machinery
  needs no other change.
- **Reversal** reverses the assembled coordinates; ascent and descent swap.
- `lineStats` stops meaning *the longest variant* and starts meaning **the default plan**, gaining
  `descentM`. The default is resolved in one order, so it can never name an illegal combination:
  the **first main** in file order, then the first approach *connected to it*, then the first exit
  *connected to it*. Draw order is therefore the author's control over what a reader sees first.
- A route with **no main** has no plan: `lineStats` is null and the page shows no picker, exactly
  as an undrawn route does today. Approach or exit segments without a main are not rendered.

---

## The route page

Three rows, each a select when the role holds more than one connected option, a plain label when
it holds one, and hidden when it holds none:

```
Pimple Traverse                       8.4 km   ↑ 720 m   ⇄ reverse

Approach   [ via Kasteelspoort  ▾ ]   2.1 km   ↑ 480 m
Main         Pimple Traverse          3.9 km   ↑ 140 m
Exit       [ via Diagonal Path   ▾ ]  2.4 km   ↓ 460 m

[============ combined elevation profile ============]
```

- Header totals and the profile recompute on every change.
- The **reverse** toggle relabels the rows Start / Main / Finish, walks the exit line first, and
  swaps ascent for descent. The data keeps its canonical labels; only the presentation flips.
- The chosen plan is encoded in the URL (`?a=…&m=…&x=…&rev=1`) so it survives a reload and can be
  sent to whoever is coming along.
- On the map, `activeVariantFilter`'s routeId + variant pairing is replaced by a filter over a
  list of `segmentId`s: the plan lights up at full weight, unchosen alternatives stay at 0.55 as
  they do today.

---

## The editor

`Variant { name, note, legs[] }` becomes `Segment { id, role, name, note, legs[] }` in
`app/src/lib/draw/state.ts`.

- A role picker per segment, and an *add approach / add main / add exit* action.
- While drawing, sibling segments' endpoints join the snap targets, so building a junction is the
  path of least resistance rather than something the author has to aim at.
- A validation panel lists unmet junctions — *"exit 'via Diagonal Path' starts 340 m from main
  'Spring Buttress B'"*. Non-blocking: the exit is often drawn before the main it attaches to.
- A **flip** action per segment. Drawing something backwards is inevitable, and the fix is
  reversing an array — it should not cost a redraw.
- `toFeatures` / `fromFeatures` carry `role` and `segmentId` through save and reload unchanged.

---

## The journal

`JournalEntry` gains an optional `plan`:

```ts
plan?: { approach?: string; main?: string; exit?: string; reversed: boolean }
```

holding segment ids. `done` stays keyed on `routeId`, so pins, done state, and the existing export
format are untouched. An absent `plan` means a legacy or unrecorded tick and stays valid forever.
IndexedDB gets a version bump with a no-op upgrade; the JSON import path accepts entries with and
without the field.

---

## Migration

The 7 drawn features get a one-pass codemod: `role: "main"`, a generated `segmentId`, and
`variant` → `name`. They remain correct as single-segment routes, and are split into approach /
main / exit whenever the author next opens them. **No re-draw pass gates this feature shipping.**

---

## Testing

Every item below is pure and headless — no DEM, no WebGL:

- `profile.ts`: descent, and the reverse-symmetry property.
- Junction equality, and the 25 m gap-validation tolerance.
- `transform.ts`: default-plan stats replacing longest-variant stats.
- Plan assembly: concatenation drops exactly one coordinate per junction; reversal swaps ascent
  and descent.
- Picker filtering: an approach that does not meet the chosen main is not offered.
- URL round-trip of a plan, including the reversed flag.
- Journal: an entry without `plan` loads; one with `plan` survives export and re-import.
- Editor state: role assignment, flip, and `segmentId` stability across save and reload.

---

## Out of scope

- **Cross-entry composite routes.** Enabled by `segmentId`, specified separately.
- **Chaining several mains** in one outing.
- **A shared segment library.** Ruled out above, for the partial-use reason.
- **Per-segment direction.** The reverse toggle is whole-plan; out-and-back on one trail is
  expressed by drawing the exit.
