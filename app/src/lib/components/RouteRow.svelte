<script lang="ts">
  import { base } from '$app/paths';
  import type { RouteIndexEntry } from '../data/types';
  import { selection, setHovered, setSelected } from '../map/selection';
  let { route, done }: { route: RouteIndexEntry; done: boolean } = $props();
  // Highlight when this row is either hovered or selected.
  let active = $derived($selection.selectedId === route.id || $selection.hoveredId === route.id);
</script>

<a
  class="row"
  class:active
  aria-current={active ? 'true' : undefined}
  href="{base}/route/{route.id}"
  data-testid="route-link"
  onmouseenter={() => setHovered(route.id)}
  onmouseleave={() => setHovered(null)}
  onclick={() => setSelected(route.id)}
>
  <span class="title">{route.title}</span>
  {#if route.grade}<span class="grade">{route.grade.split(' ')[0]}</span>{/if}
  {#if !route.coords}<span class="glyph" aria-label="no location" title="No location recorded">◌</span>{/if}
  {#if done}<span class="glyph" aria-label="done" title="Done">✓</span>{/if}
</a>

<style>
  .row { display: flex; gap: 0.5rem; align-items: center; padding: 0.35rem 0.5rem;
    text-decoration: none; color: inherit; border-radius: 4px; }
  .row:hover { background: color-mix(in srgb, currentColor 8%, transparent); }
  .row.active { background: color-mix(in srgb, currentColor 14%, transparent); }
  .title { flex: 1; }
  .grade { font-variant-numeric: tabular-nums; opacity: 0.7; font-size: 0.85em; }
  .glyph { opacity: 0.75; }
</style>
