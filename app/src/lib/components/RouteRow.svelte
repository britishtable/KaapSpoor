<script lang="ts">
  import { base } from '$app/paths';
  import type { RouteIndexEntry } from '../data/types';
  import { selection, setHovered, setSelected } from '../map/selection';
  let { route, done }: { route: RouteIndexEntry; done: boolean } = $props();
  // Hover and selection mean different things and look different: hover is a
  // transient "you are pointing at this", selection is a persistent "this is the
  // current route". Only the selection is aria-current — that attribute marks a
  // single current item, so hover must not claim it.
  let hovered = $derived($selection.hoveredId === route.id);
  let selected = $derived($selection.selectedId === route.id);

  // A plain click selects the route, which opens the preview panel in place --
  // navigating to the full page instead would replace that preview before it
  // could be read, and the map is the thing the user chose to stay on.
  //
  // The row nonetheless stays an <a href> rather than becoming a <button>, so
  // ctrl/cmd/shift/alt-click, middle-click (which fires auxclick, never this
  // handler) and "copy link address" all keep working, and the destination is
  // visible in the status bar. The preview's own link is the plain-click route
  // to the full page.
  function onclick(e: MouseEvent) {
    setSelected(route.id);
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
  }
</script>

<a
  class="row"
  class:hovered
  class:selected
  aria-current={selected ? 'true' : undefined}
  href="{base}/route/{route.id}"
  data-testid="route-link"
  onmouseenter={() => setHovered(route.id)}
  onmouseleave={() => setHovered(null)}
  onclick={onclick}
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
  /* Transient: follows the pointer. */
  .row.hovered { background: color-mix(in srgb, currentColor 8%, transparent); }
  /* Persistent: this is the current route, and it wins the stronger treatment. */
  .row.selected {
    background: color-mix(in srgb, currentColor 16%, transparent);
    box-shadow: inset 3px 0 0 0 currentColor;
  }
  .title { flex: 1; }
  .grade { font-variant-numeric: tabular-nums; opacity: 0.7; font-size: 0.85em; }
  .glyph { opacity: 0.75; }
</style>
