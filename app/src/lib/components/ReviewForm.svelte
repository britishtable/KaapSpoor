<script lang="ts">
  import { untrack } from 'svelte';
  import { reviewProblem } from '../journal/store';
  import {
    DIFFICULTY_GRADED, DIFFICULTY_UNGRADED, SAFETY_ANSWERS, NAVIGATION_ANSWERS, WATER_ANSWERS,
    REVIEW_NOTE_MAX, REVIEW_SAFETY_NOTE_MAX
  } from '../data/types';
  import type { Review } from '../data/types';
  import { DIFF_LABELS, SAFETY_LABELS, NAV_LABELS, WATER_LABELS } from '../reviews/reviews';

  let { review, graded, gradeLevel, onsave, oncancel }: {
    review: Review | undefined;
    graded: boolean;
    gradeLevel: string | null;
    onsave: (r: Review | null) => void;
    oncancel: () => void;
  } = $props();

  type Opt<T> = { value: T; label: string };
  type Difficulty = NonNullable<Review['difficulty']>;
  type Safety = NonNullable<Review['safety']>;
  type Navigation = NonNullable<Review['navigation']>;
  type Water = NonNullable<Review['water']>;

  const opts = <T extends string>(values: readonly T[], labels: Record<T, string>): Opt<T>[] =>
    values.map((value) => ({ value, label: labels[value] }));
  const difficultyOpts = $derived<Opt<Difficulty>[]>(
    opts<Difficulty>(graded ? DIFFICULTY_GRADED : DIFFICULTY_UNGRADED, DIFF_LABELS)
  );
  const enjoymentOpts: Opt<number>[] = [1, 2, 3, 4, 5].map((n) => ({ value: n, label: String(n) }));

  // The draft starts from the saved review once; later prop changes must not overwrite what is typed.
  const start = untrack(() => review);
  const startDifficulty = start?.difficulty;
  // An old answer from the other scale is not shown as a choice on this one.
  let difficulty = $state<Difficulty | undefined>(
    startDifficulty && untrack(() => (graded ? DIFFICULTY_GRADED : DIFFICULTY_UNGRADED) as readonly string[]).includes(startDifficulty)
      ? startDifficulty : undefined
  );
  let enjoyment = $state<number | undefined>(start?.enjoyment);
  let safety = $state<Safety | undefined>(start?.safety);
  let safetyNote = $state(start?.safetyNote ?? '');
  let navigation = $state<Navigation | undefined>(start?.navigation);
  let water = $state<Water | undefined>(start?.water);
  let note = $state(start?.note ?? '');
  let noteOpen = $state(Boolean(start?.note));
  const existing = start !== undefined;
  let confirmRemove = $state(false);

  let asksWhatHappened = $derived(safety === 'MOSTLY' || safety === 'NO');

  let draft = $derived.by((): Review => {
    const r: Review = {};
    if (difficulty !== undefined) r.difficulty = difficulty;
    if (enjoyment !== undefined) r.enjoyment = enjoyment;
    if (safety !== undefined) r.safety = safety;
    if (asksWhatHappened && safetyNote.trim() !== '') r.safetyNote = safetyNote;
    if (navigation !== undefined) r.navigation = navigation;
    if (water !== undefined) r.water = water;
    if (note.trim() !== '') r.note = note;
    return r;
  });
  let problem = $derived(reviewProblem(draft));

  /** Tapping the chosen chip again clears it. */
  function pick<T>(current: T | undefined, value: T): T | undefined {
    return current === value ? undefined : value;
  }
  function onSafety(v: Safety): void {
    safety = pick(safety, v);
  }

  function arrow(e: KeyboardEvent, count: number, index: number, choose: (i: number) => void): void {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1
      : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (step === 0) return;
    e.preventDefault();
    const next = (index + step + count) % count;
    choose(next);
    const group = (e.currentTarget as HTMLElement).parentElement;
    queueMicrotask(() => (group?.children[next] as HTMLElement | undefined)?.focus());
  }

  function submit(e: Event): void {
    e.preventDefault();
    if (problem === null) onsave(draft);
  }
</script>

{#snippet question<T extends string | number>(id: string, title: string, options: Opt<T>[], current: T | undefined, set: (v: T) => void, compact = false)}
  <div class="q">
    <p class="qh" id="rv-{id}">{title}</p>
    <div class="chips" class:compact role="radiogroup" aria-labelledby="rv-{id}">
      {#each options as o, i (o.value)}
        <button type="button" role="radio" class="chip" aria-checked={current === o.value}
          tabindex={current === o.value || (current === undefined && i === 0) ? 0 : -1}
          onclick={() => set(o.value)}
          onkeydown={(e) => arrow(e, options.length, i, (n) => { if (current !== options[n].value) set(options[n].value); })}>
          {o.label}
        </button>
      {/each}
    </div>
  </div>
{/snippet}

<form class="review" onsubmit={submit} onclickcapture={(e) => { if (!(e.target as HTMLElement).closest('.remove')) confirmRemove = false; }}
  oninput={() => (confirmRemove = false)}>
  {@render question('difficulty', graded ? `Compared with ${gradeLevel ? `grade ${gradeLevel}` : 'its grade'}:` : 'How hard was it?',
    difficultyOpts, difficulty, (v) => (difficulty = pick(difficulty, v)))}
  {@render question('enjoyment', 'How much did you enjoy it?', enjoymentOpts, enjoyment,
    (v) => (enjoyment = pick(enjoyment, v)), true)}
  {@render question('safety', 'Did you feel safe?', opts<Safety>(SAFETY_ANSWERS, SAFETY_LABELS), safety, onSafety)}
  {#if asksWhatHappened}
    <div class="field">
      <label for="rv-safety-note">What happened?</label>
      <textarea id="rv-safety-note" rows="3" maxlength={REVIEW_SAFETY_NOTE_MAX} bind:value={safetyNote}></textarea>
    </div>
  {/if}
  {@render question('navigation', 'Was the way easy to follow?', opts<Navigation>(NAVIGATION_ANSWERS, NAV_LABELS),
    navigation, (v) => (navigation = pick(navigation, v)))}
  {@render question('water', 'Is there water on the route?', opts<Water>(WATER_ANSWERS, WATER_LABELS),
    water, (v) => (water = pick(water, v)))}

  {#if noteOpen}
    <div class="field">
      <label for="rv-note">Note</label>
      <textarea id="rv-note" rows="4" maxlength={REVIEW_NOTE_MAX} bind:value={note}></textarea>
    </div>
  {:else}
    <button type="button" class="plain" onclick={() => (noteOpen = true)}>Add a note</button>
  {/if}

  <div class="row">
    <button type="button" class="plain" onclick={oncancel}>Cancel</button>
    {#if existing}
      <button type="button" class="plain danger remove"
        onclick={() => { if (confirmRemove) onsave(null); else confirmRemove = true; }}>
        {confirmRemove ? 'Tap again to remove' : 'Remove review'}
      </button>
    {/if}
  </div>
  <p class="public">Reviews are public, under your display name. A private hike's date is never shown.</p>
  <button type="submit" class="primary wide" disabled={problem !== null}>Save review</button>
</form>

<style>
  .review { display: grid; gap: 1rem; }
  .q { display: grid; gap: 0.4rem; }
  .qh { margin: 0; font-weight: 600; }
  .chips { display: flex; flex-wrap: wrap; gap: 0.5rem; }
  .chip {
    min-height: 48px; min-width: 48px; padding: 0 0.9rem; font: inherit; cursor: pointer; box-sizing: border-box;
    border: 1px solid color-mix(in srgb, currentColor 35%, transparent); border-radius: 0.4rem;
    background: transparent; color: inherit; display: inline-flex; align-items: center; justify-content: center;
  }
  .chips.compact .chip { flex: 1 1 0; padding: 0; }
  .chip[aria-checked='true'] { background: #c2410c; border-color: #c2410c; color: #fff; font-weight: 600; }
  .plain, .wide {
    min-height: 48px; padding: 0 1rem; font: inherit; cursor: pointer; box-sizing: border-box;
    border: 1px solid color-mix(in srgb, currentColor 35%, transparent); border-radius: 0.4rem;
    background: transparent; color: inherit; display: inline-flex; align-items: center; justify-content: center;
  }
  .wide { width: 100%; }
  .primary { background: #c2410c; border-color: #c2410c; color: #fff; font-weight: 600; }
  .primary:disabled { opacity: 0.45; cursor: default; }
  .danger { border-color: var(--ks-error); color: var(--ks-error); }
  .public { margin: 0; opacity: 0.8; font-size: 0.9rem; }
  .row { display: flex; gap: 0.5rem; flex-wrap: wrap; }
  .field { display: grid; gap: 0.3rem; }
  .field label { font-weight: 600; }
  textarea {
    font: inherit; min-height: 6rem; padding: 0.4rem 0.6rem; box-sizing: border-box; width: 100%;
    border: 1px solid color-mix(in srgb, currentColor 35%, transparent); border-radius: 0.4rem;
    background: transparent; color: inherit;
  }
  .chip:focus-visible, .plain:focus-visible, .wide:focus-visible, textarea:focus-visible {
    outline: 3px solid #c2410c; outline-offset: 2px;
  }
</style>
