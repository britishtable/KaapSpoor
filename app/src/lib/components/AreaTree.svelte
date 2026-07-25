<script lang="ts">
  import type { AreaNode } from '../data/areas';
  import { areaProgress } from '../data/areas';
  import RouteRow from './RouteRow.svelte';
  import AreaTree from './AreaTree.svelte';
  let { nodes, doneIds }: { nodes: AreaNode[]; doneIds: Set<string> } = $props();
</script>

<ul class="tree">
  {#each nodes as node (node.key)}
    {@const p = areaProgress(node, doneIds)}
    <li>
      <details open>
        <summary>
          <span class="label">{node.label}</span>
          <span class="count">{p.done}/{p.total}</span>
        </summary>
        {#if node.children.length}
          <AreaTree nodes={node.children} {doneIds} />
        {/if}
        {#each node.routes as route (route.id)}
          <RouteRow {route} done={doneIds.has(route.id)} />
        {/each}
      </details>
    </li>
  {/each}
</ul>

<style>
  .tree { list-style: none; margin: 0; padding-left: 0.75rem; }
  summary { display: flex; gap: 0.5rem; cursor: pointer; padding: 0.35rem 0.5rem; font-weight: 600; }
  .label { flex: 1; }
  .count { opacity: 0.6; font-variant-numeric: tabular-nums; font-weight: 400; }
</style>
