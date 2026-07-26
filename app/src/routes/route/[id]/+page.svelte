<script lang="ts">
  import { base } from '$app/paths';
  import { humanizeArea } from '$lib/data/areas';
  import StatsStrip from '$lib/components/StatsStrip.svelte';
  import JournalControls from '$lib/components/JournalControls.svelte';
  import LocatorMap from '$lib/components/LocatorMap.svelte';
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();
  let r = $derived(data.route);
</script>

<div class="page">
  <nav class="crumb">
    <a href="{base}/">Home</a>
    {#each r.area as seg}<span> / {humanizeArea(seg)}</span>{/each}
  </nav>

  <h1>{r.title}</h1>
  <StatsStrip route={r} />

  {#if r.coords}
    <LocatorMap coords={r.coords} title={r.title} />
  {:else}
    <p class="loc muted">Location not recorded.</p>
  {/if}

  {#each Object.entries(r.sections) as [heading, body]}
    {#if heading}<h2>{heading}</h2>{/if}
    <p>{body}</p>
  {/each}

  {#if r.related.length}
    <h2>Related</h2>
    <ul>{#each r.related as rel}<li><a href="{base}/route/{rel.id}">{rel.title}</a></li>{/each}</ul>
  {/if}

  <JournalControls routeId={r.id} />

  <p class="src">
    {#if r.photoCount}{r.photoCount} photos on the source page (not yet imported). {/if}
    Source: <a href={r.sourceUrl}>Mountain Meanders</a>, CC BY-SA 2.5 ZA.
  </p>
</div>

<style>
  .page { padding: 1rem; max-width: 60rem; margin: 0 auto; }
  .crumb { opacity: 0.7; font-size: 0.9em; }
  .crumb a { color: inherit; }
  .loc.muted { opacity: 0.6; }
  .src { margin-top: 2rem; font-size: 0.85em; opacity: 0.7; }
</style>
