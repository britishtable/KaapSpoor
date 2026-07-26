<script lang="ts">
  import { buildAreaTree } from '$lib/data/areas';
  import { filterEntries, type FilterOptions } from '$lib/data/filter';
  import { journal } from '$lib/journal/store';
  import AreaTree from '$lib/components/AreaTree.svelte';
  import Filters from '$lib/components/Filters.svelte';
  import MapView from '$lib/components/MapView.svelte';
  import BottomSheet from '$lib/components/BottomSheet.svelte';
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
    <Filters bind:value={opts} />
    <AreaTree nodes={tree} {doneIds} />
  </BottomSheet>
</div>

<style>
  .split {
    display: grid;
    grid-template-columns: 1fr 22rem;
    height: calc(100vh - 3.25rem);
  }
  .map-pane { min-width: 0; }

  @media (max-width: 48rem) {
    .split { grid-template-columns: 1fr; grid-template-rows: 1fr auto; }
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
