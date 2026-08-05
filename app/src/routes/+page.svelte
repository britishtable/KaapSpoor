<script lang="ts">
  import { buildAreaTree } from '$lib/data/areas';
  import { filterEntries, type FilterOptions } from '$lib/data/filter';
  import { journal } from '$lib/journal/store';
  import AreaTree from '$lib/components/AreaTree.svelte';
  import Filters from '$lib/components/Filters.svelte';
  import MapView from '$lib/components/MapView.svelte';
  import BottomSheet from '$lib/components/BottomSheet.svelte';
  import RoutePreview from '$lib/components/RoutePreview.svelte';
  import { selection, clearSelection } from '$lib/map/selection';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  let opts = $state<FilterOptions>({ query: '', status: 'all', located: 'all' });
  let doneIds = $derived(new Set([...$journal.values()].filter((e) => e.done).map((e) => e.routeId)));
  let shown = $derived(filterEntries(data.entries, opts, doneIds));
  let tree = $derived(buildAreaTree(shown));
</script>

<h1 class="visually-hidden">KaapSpoor</h1>

<div class="split">
  <div class="map-pane">
    <!-- Pins follow the filters, so filtering the list filters the map too. -->
    <MapView entries={shown} />
  </div>
  <BottomSheet>
    <!-- Selecting a route turns the panel into that route, filters and all:
         leaving the search box up would let a filter drop the very route being
         read out of the list underneath it. The filter state itself survives in
         `opts`, so closing the preview restores the list exactly as it was. -->
    {#if $selection.selectedId}
      <RoutePreview routeId={$selection.selectedId} onclose={clearSelection} />
    {:else}
      <Filters bind:value={opts} />
      <AreaTree nodes={tree} {doneIds} />
    {/if}
  </BottomSheet>
</div>

<style>
  /* Fill whatever height the layout's <main> gives us. Never hard-code the
     header's height: a magic number silently desyncs the moment the header
     changes, leaving either a gap or an overflowing page. */
  .split {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 22rem;
    height: 100%;
  }
  /* Both axes need the explicit zero minimum. Without min-height, MapView's
     own min-height becomes this pane's min-content floor, which a 1fr track
     cannot shrink below — so a short landscape screen overflows the split
     and the page starts scrolling. */
  .map-pane { min-width: 0; min-height: 0; }

  @media (max-width: 48rem) {
    .split { grid-template-columns: 1fr; grid-template-rows: minmax(0, 1fr) auto; }
  }

  /* The h1 stays for document structure and the existing test, but the map is
     the page's real content so it should not take vertical space. */
  .visually-hidden {
    position: absolute;
    width: 1px; height: 1px;
    margin: -1px; padding: 0; border: 0;
    clip-path: inset(50%);
    overflow: hidden;
    white-space: nowrap;
  }
</style>
