<script lang="ts">
  /**
   * A route's alternatives, with the caption that says what each one is.
   *
   * The caption is the point. Two lines on a mountain with no explanation is
   * worse than one line: the reader cannot tell whether they are choices, a
   * route and its escape, or a mistake. Pointing at one lifts it on the map.
   */
  import { setHoveredVariant } from '$lib/map/selection';
  import type { RouteLine } from '$lib/data/types';

  let { lines }: { lines: RouteLine[] } = $props();

  // One unnamed line needs no list — the map is already showing it.
  let named = $derived(lines.filter((l) => l.variant));
</script>

{#if named.length}
  <section class="variants">
    <h3>Ways up this route</h3>
    <ul>
      {#each named as line (line.variant)}
        <li
          onmouseenter={() => setHoveredVariant(line.variant)}
          onmouseleave={() => setHoveredVariant(null)}
        >
          <span class="name">{line.variant}</span>
          {#if line.note}<span class="note">{line.note}</span>{/if}
        </li>
      {/each}
    </ul>
  </section>
{/if}

<style>
  .variants { margin: 0.75rem 0; }
  h3 { margin: 0 0 0.35rem; font-size: 0.85rem; opacity: 0.7; font-weight: 600; }
  ul { margin: 0; padding: 0; list-style: none; display: grid; gap: 0.35rem; }
  li { display: grid; gap: 0.1rem; padding: 0.25rem 0.45rem; border-left: 3px solid #c2410c; }
  .name { font-size: 0.9em; font-weight: 600; }
  .note { font-size: 0.82em; opacity: 0.75; }
</style>
