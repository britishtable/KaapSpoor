<script lang="ts">
  import { base } from '$app/paths';
  import { humanizeArea } from '$lib/data/areas';
  import StatsStrip from '$lib/components/StatsStrip.svelte';
  import JournalControls from '$lib/components/JournalControls.svelte';
  import LocatorMap from '$lib/components/LocatorMap.svelte';
  import RouteVariants from '$lib/components/RouteVariants.svelte';
  import ProvenanceNote from '$lib/components/ProvenanceNote.svelte';
  import RouteProfile from '$lib/components/RouteProfile.svelte';
  import { isPoint3, totalDistanceM, type Point3 } from '$lib/map/profile';
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();
  let r = $derived(data.route);
  let scrubDistanceM = $state<number | null>(null);
  let lineCoords = $state<Point3[]>([]);

  // The route's own drawn line, fetched once per route so the elevation
  // profile can plot it and the locator map can carry the same marker along
  // it as the reader scrubs the chart.
  $effect(() => {
    const id = r.id;
    if (!r.hasLine) {
      lineCoords = [];
      return;
    }
    let abandoned = false;
    void (async () => {
      try {
        const res = await fetch(`${base}/data/route-lines.geojson`);
        if (!res.ok) return;
        const collection = (await res.json()) as {
          features: { geometry: { coordinates: number[][] }; properties: { routeId: string } }[];
        };
        // The longest variant BY GROUND DISTANCE, not by point count: a
        // variant with fewer but wider-spaced points can still cover more
        // ground. transform.ts picks the same route's ascentM/distanceM by
        // this same measure (totalDistanceM), so the profile the reader
        // scrubs and the StatsStrip figures beside it describe one line, not
        // two that happen to share a routeId.
        const mine = collection.features
          .filter((f) => f.properties.routeId === id)
          .map((f) => f.geometry.coordinates.filter(isPoint3));
        const longest = mine.sort((a, b) => totalDistanceM(b) - totalDistanceM(a))[0];
        if (!abandoned) lineCoords = longest ?? [];
      } catch {
        if (!abandoned) lineCoords = [];
      }
    })();
    return () => {
      abandoned = true;
    };
  });
</script>

<div class="page">
  <nav class="crumb">
    <a href="{base}/">Home</a>
    {#each r.area as seg}<span> / {humanizeArea(seg)}</span>{/each}
  </nav>

  <h1>{r.title}</h1>
  <StatsStrip route={r} />

  <!-- Every route states how its position is known, in the same component the
       map's preview panel uses, so the two can never word it differently. -->
  {#if r.coords}
    <LocatorMap
      coords={r.coords}
      title={r.title}
      accuracyM={r.coordsAccuracyM}
      routeId={r.id}
      hasLine={r.hasLine}
      {scrubDistanceM}
    />
  {/if}
  {#if r.hasLine}
    <RouteProfile coords={lineCoords} onscrub={(d) => (scrubDistanceM = d)} />
  {/if}
  <ProvenanceNote route={r} />
  <RouteVariants lines={r.lines} />

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
  .src { margin-top: 2rem; font-size: 0.85em; opacity: 0.7; }
</style>
