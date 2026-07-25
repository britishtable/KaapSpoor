<script lang="ts">
  import type { RouteContent } from '../data/types';
  let { route }: { route: RouteContent } = $props();
</script>

<dl class="stats">
  {#if route.grade}
    <div><dt>Grade</dt><dd>{route.grade}{#if route.gradeSource === 'prose'}<span class="caveat" title="Inferred from prose, not a labelled field">~</span>{/if}</dd></div>
  {/if}
  {#if route.time}<div><dt>Time</dt><dd>{route.time}</dd></div>{/if}
  {#if route.heightGain}<div><dt>Height gain</dt><dd>{route.heightGain}</dd></div>{/if}
</dl>

<style>
  .stats { display: flex; gap: 1.5rem; flex-wrap: wrap; margin: 0; }
  dt { font-size: 0.75em; text-transform: uppercase; opacity: 0.6; }
  dd { margin: 0; }
  .caveat { opacity: 0.6; cursor: help; }
</style>
