<script lang="ts">
  import { fetchRouteReviews, phrase, formatMonth, answerWords } from '../reviews/reviews';
  import type { RouteReviews as Loaded, Question } from '../reviews/reviews';

  let { routeId }: { routeId: string } = $props();

  const SHOWN = 5;
  const QUESTIONS: { q: Question; title: (graded: boolean) => string }[] = [
    { q: 'difficulty', title: (g) => (g ? 'Compared with its grade' : 'How hard it was') },
    { q: 'enjoyment', title: () => 'Enjoyment' },
    { q: 'safety', title: () => 'Felt safe' },
    { q: 'navigation', title: () => 'Finding the way' },
    { q: 'water', title: () => 'Water' }
  ];

  let result = $state<Loaded | 'offline' | 'unavailable' | null>(null);
  let all = $state(false);

  // Client-side only: route pages are prerendered, and GitHub Pages has no API.
  $effect(() => {
    const id = routeId;
    result = null;
    all = false;
    let abandoned = false;
    void fetchRouteReviews(id).then((r) => { if (!abandoned) result = r; });
    return () => { abandoned = true; };
  });

  let loaded = $derived(typeof result === 'object' && result !== null ? result : null);
  let list = $derived(loaded ? (all ? loaded.reviews : loaded.reviews.slice(0, SHOWN)) : []);
</script>

{#if result === 'offline'}
  <section class="reviews"><h2>Reviews</h2><p class="muted">Reviews need a connection.</p></section>
{:else if loaded}
  <section class="reviews">
    <h2>Reviews</h2>
    {#if loaded.reviews.length === 0}
      <p class="muted">No reviews yet.</p>
    {:else}
      <p class="muted">{loaded.people === 1 ? '1 person has' : `${loaded.people} people have`} reviewed this route.</p>
      <dl class="summary">
        {#each QUESTIONS as { q, title } (q)}
          {@const counts = loaded.summary[q]}
          <div class="q">
            <dt>{title(loaded.graded)}</dt>
            {#if counts}
              {#each phrase(q, counts, loaded.graded) as line (line)}<dd>{line}</dd>{/each}
            {:else}
              <dd class="muted">Not enough reviews yet</dd>
            {/if}
          </div>
        {/each}
      </dl>
      <ul class="list">
        {#each list as r, i (i)}
          {@const when = formatMonth(r.month, r.dateRecorded)}
          {@const words = answerWords(r)}
          <li>
            <p class="who"><strong>{r.displayName}</strong>{#if when}<span class="muted"> {when}</span>{/if}</p>
            {#if words.length}<p class="ans">{words.join(', ')}</p>{/if}
            {#if r.safetyNote}<p class="text"><span class="muted">What happened: </span>{r.safetyNote}</p>{/if}
            {#if r.note}<p class="text">{r.note}</p>{/if}
          </li>
        {/each}
      </ul>
      {#if !all && loaded.reviews.length > SHOWN}
        <button type="button" onclick={() => (all = true)}>Show {loaded.reviews.length - SHOWN} more</button>
      {/if}
    {/if}
  </section>
{/if}

<style>
  .reviews { margin-top: 1.5rem; display: grid; gap: 0.6rem; }
  h2 { margin: 1rem 0 0; }
  p { margin: 0; }
  .muted { opacity: 0.75; }
  .summary { margin: 0; display: grid; gap: 0.6rem; }
  .q { padding: 0.25rem 0.6rem; border-left: 3px solid #c2410c; display: grid; gap: 0.1rem; }
  dt { font-weight: 600; }
  dd { margin: 0; }
  .list { list-style: none; margin: 0.5rem 0 0; padding: 0; display: grid; gap: 0.9rem; }
  .list li { display: grid; gap: 0.2rem; }
  .who { overflow-wrap: anywhere; }
  .ans { font-weight: 600; }
  .text { overflow-wrap: anywhere; white-space: pre-wrap; max-width: 65ch; }
  button {
    min-height: 48px; padding: 0 1rem; font: inherit; cursor: pointer; box-sizing: border-box; width: 100%;
    border: 1px solid color-mix(in srgb, currentColor 35%, transparent); border-radius: 0.4rem;
    background: transparent; color: inherit;
  }
  button:focus-visible { outline: 3px solid #c2410c; outline-offset: 2px; }
</style>
