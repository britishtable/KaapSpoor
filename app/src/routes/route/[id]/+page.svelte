<script lang="ts">
  import { onMount } from 'svelte';
  import { base } from '$app/paths';
  import { humanizeArea } from '$lib/data/areas';
  import StatsStrip from '$lib/components/StatsStrip.svelte';
  import JournalControls from '$lib/components/JournalControls.svelte';
  import LocatorMap from '$lib/components/LocatorMap.svelte';
  import ProvenanceNote from '$lib/components/ProvenanceNote.svelte';
  import RouteProfile from '$lib/components/RouteProfile.svelte';
  import RoutePlan from '$lib/components/RoutePlan.svelte';
  import { isPoint3 } from '$lib/map/profile';
  import { isRole } from '$lib/data/segments';
  import { resolvePlan, assemble, type PlanChoice, type PlanSegment } from '$lib/data/plan';
  import { encodePlan, decodePlan } from '$lib/data/plan-params';
  import { setPlanSegments } from '$lib/map/selection';
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();
  let r = $derived(data.route);
  let scrubDistanceM = $state<number | null>(null);

  let segments = $state<PlanSegment[]>([]);
  let wanted = $state<Partial<PlanChoice>>({});

  // The plan is resolved, never stored: a stale choice from the URL or from
  // the previous route can name a combination that does not join up, and
  // resolvePlan is the one place that decides what a legal plan is.
  let plan = $derived(resolvePlan(segments, wanted));
  let lineCoords = $derived(assemble(plan.chosen, plan.choice.reversed));

  // Publish the plan's segments to the map's shared selection store, so the
  // main map lights exactly the segments this plan is made of.
  $effect(() => setPlanSegments(plan.chosen.map((s) => s.segmentId)));

  // Read straight from the address bar rather than through $app/state, and
  // written back with history.replaceState below. The page needs no router
  // for this: the plan is a view of the current URL, not a navigation, and
  // going through goto() would push the map and profile through a full
  // re-render on every dropdown change. The trade is that Back does not step
  // through previous plans — reload and sharing, which are what the spec asks
  // for, both work.
  onMount(() => {
    wanted = decodePlan(new URLSearchParams(window.location.search));
  });

  // The route's drawn segments, fetched once per route. Only the geometry
  // comes from here; the metadata is already on r.segments from the build.
  $effect(() => {
    const id = r.id;
    const meta = r.segments;
    if (!r.hasLine) {
      segments = [];
      return;
    }
    let abandoned = false;
    void (async () => {
      try {
        const res = await fetch(`${base}/data/route-lines.geojson`);
        if (!res.ok) return;
        const collection = (await res.json()) as {
          features: {
            geometry: { coordinates: number[][] };
            properties: { routeId: string; segmentId: string; role: string };
          }[];
        };
        const byId = new Map(meta.map((m) => [m.segmentId, m]));
        const mine = collection.features
          .filter((f) => f.properties.routeId === id && isRole(f.properties.role))
          .map((f) => {
            const m = byId.get(f.properties.segmentId);
            return {
              segmentId: f.properties.segmentId,
              role: f.properties.role as PlanSegment['role'],
              name: m?.name ?? null,
              note: m?.note ?? null,
              coords: f.geometry.coordinates.filter(isPoint3)
            };
          });
        if (!abandoned) segments = mine;
      } catch {
        if (!abandoned) segments = [];
      }
    })();
    return () => {
      abandoned = true;
    };
  });

  function choose(choice: PlanChoice): void {
    // State AND address bar, together, so the two can never disagree about
    // what is on screen. replaceState rather than pushState: a dropdown is an
    // adjustment, not a place, and stacking one history entry per fiddle would
    // make Back useless for leaving the page.
    wanted = choice;
    const params = encodePlan(choice);
    const query = params.toString();
    window.history.replaceState({}, '', query ? `?${query}` : window.location.pathname);
  }
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
      {lineCoords}
    />
  {/if}
  <RoutePlan {plan} onchange={choose} />
  {#if r.hasLine}
    <RouteProfile coords={lineCoords} onscrub={(d) => (scrubDistanceM = d)} />
  {/if}
  <ProvenanceNote route={r} />

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
