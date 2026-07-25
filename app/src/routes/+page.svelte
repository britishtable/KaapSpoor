<script lang="ts">
  import { buildAreaTree } from '$lib/data/areas';
  import { filterEntries, type FilterOptions } from '$lib/data/filter';
  import { journal } from '$lib/journal/store';
  import AreaTree from '$lib/components/AreaTree.svelte';
  import Filters from '$lib/components/Filters.svelte';
  let { data } = $props();
  let opts = $state<FilterOptions>({ query: '', status: 'all', located: 'all' });
  let doneIds = $derived(new Set([...$journal.values()].filter((e) => e.done).map((e) => e.routeId)));
  let tree = $derived(buildAreaTree(filterEntries(data.entries, opts, doneIds)));
</script>

<h1>KaapSpoor</h1>
<Filters bind:value={opts} />
<AreaTree nodes={tree} {doneIds} />
