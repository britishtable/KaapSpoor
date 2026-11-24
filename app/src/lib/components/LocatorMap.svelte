<script lang="ts">
  import { onMount, onDestroy, untrack } from 'svelte';
  import { base } from '$app/paths';
  // maplibre-gl v6 has no default export — import the protocol helpers by name.
  import {
    addProtocol,
    removeProtocol,
    setWorkerUrl,
    Map as MapLibreMap,
    Marker,
    AttributionControl
  } from 'maplibre-gl';
  import { Protocol } from 'pmtiles';
  import 'maplibre-gl/dist/maplibre-gl.css';
  import { buildStyle, SHIPPED_BASEMAP } from '$lib/map/style';
  import {
    ROUTE_LINE_SOURCE, routeLineFilter, activeSegmentFilter, lineBounds,
    ARROW_IMAGE, arrowImage
  } from '$lib/map/route-lines';
  import { uncertaintyPaint, uncertaintyBounds, uncertaintyRadiusExpression } from '$lib/map/pins';
  import { pointAtDistance, type Point3 } from '$lib/map/profile';
  import type { Coords } from '$lib/data/types';
  import { selection } from '$lib/map/selection';
  import { CATEGORY_COLOURS } from '$lib/reports/labels';
  import type { PublicReport } from '$lib/reports/types';

  let {
    coords,
    title,
    /** Metres. Set for an `area-approx` position only; see pins.ts. */
    accuracyM = null,
    /** The route this map is for, and whether Phase 4d could draw its line. */
    routeId,
    hasLine = false,
    /** Metres along the drawn line to mark, or null. Driven by the profile. */
    scrubDistanceM = null,
    /**
     * The route's own drawn line — the SAME plan the caller resolved for
     * everything else on the page (profile, stats). Passed in rather than
     * fetched and selected here: a second selection of "which plan" next
     * to the page's would only need to be re-aligned with it, not made
     * impossible to disagree with. Defaults to empty for callers with no line.
     */
    lineCoords = [],
    /**
     * When set, the map is in pick mode: a tap calls this with [lon, lat]. The tap marks nothing
     * itself: the caller may refuse the point, and shows what it kept through `spot`.
     */
    onpick = undefined,
    /** A spot to keep marked (the report's chosen point), or null. The only owner of that marker. */
    spot = null,
    /** Public, active reports to pin. Never pass held or unsent ones: a pin is public. */
    reports = [],
    /** Called with a report's id when its pin is tapped (outside pick mode). */
    onreport = undefined,
    /** Where the hiker is, with the fix's own accuracy in metres, or null. */
    position = null
  }: {
    coords: Coords;
    title: string;
    accuracyM?: number | null;
    routeId: string;
    hasLine?: boolean;
    scrubDistanceM?: number | null;
    lineCoords?: Point3[];
    onpick?: (p: [number, number]) => void;
    spot?: [number, number] | null;
    reports?: PublicReport[];
    onreport?: (id: string) => void;
    position?: { lon: number; lat: number; accuracy: number } | null;
  } = $props();
  let container: HTMLDivElement;
  let map: MapLibreMap | undefined;
  let mapLoaded = $state(false);
  let pickMarker: Marker | undefined;
  let ready = $state(false);
  /** The style has loaded and the report pins' source exists. */
  let pinsReady = $state(false);

  const POSITION = 'position';
  const HERE = '#1d4ed8';
  const REPORTS = 'reports';
  /** How far from a pin's centre, in px, a tap still counts as on it: a fingertip, not a pixel. */
  const PIN_SLOP = 14;

  $effect(() => {
    const list = reports;
    if (!pinsReady || !map) return;
    const source = map.getSource(REPORTS) as import('maplibre-gl').GeoJSONSource | undefined;
    source?.setData({
      type: 'FeatureCollection',
      features: list.flatMap((r) => r.position
        ? [{
            type: 'Feature' as const,
            geometry: { type: 'Point' as const, coordinates: [r.position.lon, r.position.lat] },
            properties: { id: r.id, colour: CATEGORY_COLOURS[r.category] }
          }]
        : [])
    });
  });

  // Outside pick mode, a tap on a pin opens that report in the list. Same reason as pick mode
  // for listening on the container: the map is non-interactive and raises no clicks itself.
  $effect(() => {
    const open = onreport;
    if (!open || onpick || !container) return;
    const el = container;
    const tap = (e: MouseEvent) => {
      if (!map || !pinsReady) return;
      if ((e.target as Element | null)?.closest?.('.maplibregl-ctrl')) return;
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const hit = map.queryRenderedFeatures(
        [[x - PIN_SLOP, y - PIN_SLOP], [x + PIN_SLOP, y + PIN_SLOP]],
        { layers: [REPORTS] }
      );
      const id = hit[0]?.properties?.id;
      if (typeof id === 'string') open(id);
    };
    el.addEventListener('click', tap);
    return () => el.removeEventListener('click', tap);
  });

  function markSpot(p: [number, number] | null): void {
    try { pickMarker?.remove(); } catch { /* never painted */ }
    pickMarker = undefined;
    if (!p || !map) return;
    try {
      pickMarker = new Marker({ color: '#3f2d1d' }).setLngLat(p).addTo(map);
    } catch (err) {
      console.warn('LocatorMap: could not add spot marker', err);
    }
  }
  // The chosen spot stays marked after the pick ends, until the caller clears it.
  $effect(() => {
    const p = spot;
    if (!ready) return;
    markSpot(p);
  });

  // Pick mode. The map is non-interactive (so it cannot hijack page scroll), which also means it
  // raises no click events of its own; a plain DOM click on the container is unprojected instead.
  $effect(() => {
    const pick = onpick;
    if (!pick || !container) return;
    const el = container;
    const tap = (e: MouseEvent) => {
      if (!map) return;
      // Map controls and markers are not the spot being picked.
      if ((e.target as Element | null)?.closest?.('.maplibregl-ctrl, .maplibregl-marker')) return;
      const rect = el.getBoundingClientRect();
      const { lng, lat } = map.unproject([e.clientX - rect.left, e.clientY - rect.top]);
      pick([lng, lat]);
    };
    el.addEventListener('click', tap);
    el.classList.add('picking');
    return () => {
      el.removeEventListener('click', tap);
      el.classList.remove('picking');
    };
  });

  $effect(() => {
    const at = scrubDistanceM;
    if (!map || !lineCoords.length) return;
    const source = map.getSource('scrub') as import('maplibre-gl').GeoJSONSource | undefined;
    if (!source) return;
    source.setData(
      at === null
        ? { type: 'FeatureCollection', features: [] }
        : {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: pointAtDistance(lineCoords, at) },
            properties: {}
          }
    );
  });

  $effect(() => {
    const p = position;
    if (!pinsReady || !map) return;
    const source = map.getSource(POSITION) as import('maplibre-gl').GeoJSONSource | undefined;
    source?.setData({
      type: 'FeatureCollection',
      features: p
        ? [{
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
            // The name the shared metres-to-pixels radius expression reads.
            properties: { coordsAccuracyM: p.accuracy }
          }]
        : []
    });
  });

  // Brings the dot into view when it appears. Not on every fix after that: the map does not
  // follow. But it cannot be panned either, so a dot that appears off-screen must be fetched.
  let placed = $derived(position !== null);
  $effect(() => {
    if (!placed || !pinsReady) return;
    untrack(() => frame(Math.max(13, coords.zoom)));
  });

  /** Frames the route (its line, else its circle, else its pin), and the dot when there is one. */
  function frame(maxZoom: number): void {
    if (!map) return;
    const bounds =
      (hasLine && lineCoords.length ? lineBounds({ type: 'LineString', coordinates: lineCoords }) : null) ??
      (accuracyM
        ? uncertaintyBounds(coords.lon, coords.lat, accuracyM)
        : ([[coords.lon, coords.lat], [coords.lon, coords.lat]] as [[number, number], [number, number]]));
    if (!position) {
      map.fitBounds(bounds, { padding: 24, maxZoom });
      return;
    }
    const [[w, s], [e, n]] = bounds;
    map.fitBounds(
      [
        [Math.min(w, position.lon), Math.min(s, position.lat)],
        [Math.max(e, position.lon), Math.max(n, position.lat)]
      ],
      { padding: 24, maxZoom }
    );
  }

  // Frames the SAME line the profile plots and the scrub marker rides,
  // whenever it arrives -- the page resolves it asynchronously, so this
  // fires once mapLoaded flips true and again if lineCoords itself changes.
  $effect(() => {
    if (!mapLoaded || !map || !hasLine || !lineCoords.length) return;
    untrack(() => frame(15));
  });

  // Lights the plan the reader has chosen on the picker beside this map,
  // dimming the unchosen alternatives -- the same emphasis the home map gives
  // a selection, applied here to the picker's choice instead. The route page
  // publishes `planSegmentIds` itself (see +page.svelte's setPlanSegments
  // effect); this map only reads it, so it always reflects THIS route's plan,
  // never a stale selection left over from the previous page.
  $effect(() => {
    const ids = $selection.planSegmentIds;
    if (!mapLoaded || !map) return;
    map.setFilter('route-line-active', activeSegmentFilter(ids));
  });

  onMount(() => {
    // See MapView.svelte: maplibre-gl's worker script resolves relative to
    // the bundled chunk's own URL, not its package directory, so it 404s
    // after a Vite build unless pointed at the copy in static/ explicitly.
    setWorkerUrl(`${base}/maplibre/maplibre-gl-worker.mjs`);

    const protocol = new Protocol();
    addProtocol('pmtiles', protocol.tile);
    map = new MapLibreMap({
      container,
      style: buildStyle(SHIPPED_BASEMAP, base),
      center: [coords.lon, coords.lat],
      // Clamp to at least z13: the shared style's `paths` layer (the
      // footpath itself) has minzoom 12, and a couple of routes carry
      // coords.zoom as low as 11. Below the paths layer's minzoom, a locator
      // map shows a route pin with no trail under it -- useless for its one
      // job of showing where the hike actually goes.
      zoom: Math.max(13, coords.zoom),
      // Non-interactive: a scrollable map inside an article hijacks page scroll.
      interactive: false,
      attributionControl: false
    });
    map.addControl(new AttributionControl({ compact: true }));
    ready = true;

    // Test-only hook, mirroring MapView's: WebGL pixels are not queryable from
    // Playwright, so an e2e asserting the line renders has no other way in.
    (container as HTMLDivElement & { __maplibreMap?: MapLibreMap }).__maplibreMap = map;

    // The route's own line, on the page where the description that produced it
    // is actually read. Same source, same layers, same style as the main map,
    // so the two cannot disagree about what a route line looks like.
    if (hasLine) {
      map.on('load', async () => {
        if (!map) return;
        try {
          const res = await fetch(`${base}/data/route-lines.geojson`);
          if (!res.ok) throw new Error(`HTTP ${res.status} for route lines`);
          const collection = await res.json();
          const source = map.getSource(ROUTE_LINE_SOURCE) as
            | import('maplibre-gl').GeoJSONSource
            | undefined;
          source?.setData(collection);
          // The style names the image; the map has to be given it.
          if (!map.hasImage(ARROW_IMAGE)) map.addImage(ARROW_IMAGE, arrowImage());
          map.setFilter('route-line-arrows', routeLineFilter(routeId));
          map.setFilter('route-line-casing', routeLineFilter(routeId));
          map.setFilter('route-line', routeLineFilter(routeId));
          // route-line-active's filter is set by the $effect above, driven by
          // $selection.planSegmentIds -- not here, so it stays correct as the
          // reader changes the plan without needing a re-fetch.
          // Framing the line rather than the clamped centre: a locator map's
          // one job is showing where the hike goes, and now it can show all of
          // it. Which plan to frame is the caller's call (the `lineCoords`
          // prop) -- see the $effect above -- not a second lookup here.
          map.addSource('scrub', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] }
          });
          map.addLayer({
            id: 'scrub',
            type: 'circle',
            source: 'scrub',
            paint: {
              'circle-radius': 6,
              'circle-color': '#3f2d1d',
              'circle-stroke-color': '#f4f1ea',
              'circle-stroke-width': 2
            }
          });
          mapLoaded = true;
        } catch (err) {
          console.warn('LocatorMap: could not load route lines', err);
        }
      });
    }

    if (accuracyM) {
      // Frame the whole circle rather than the clamped zoom above. Centring at
      // z13 on a position known to kilometres puts the pin in the middle of a
      // view narrower than its own error, which asserts exactly the precision
      // the coordinate does not have. The same treatment MapView gives a
      // selected approximate route.
      map.fitBounds(uncertaintyBounds(coords.lon, coords.lat, accuracyM), { padding: 24 });
      map.on('load', () => {
        if (!map) return;
        map.addSource('uncertainty', {
          type: 'geojson',
          data: {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [coords.lon, coords.lat] },
            // The paint expression reads the radius off the feature, exactly as
            // it does on the main map, so both maps size the circle identically.
            properties: { coordsAccuracyM: accuracyM }
          }
        });
        map.addLayer({
          id: 'uncertainty',
          type: 'circle',
          source: 'uncertainty',
          paint: uncertaintyPaint()
        });
      });
    }

    // Report pins, on every locator map with a position: reports don't need a drawn line. Added
    // on load after the style's layers and the uncertainty circle (registered above), so the
    // pins sit on top of the route line and the circle.
    map.on('load', () => {
      if (!map) return;
      try {
        map.addSource(REPORTS, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addLayer({
          id: REPORTS,
          type: 'circle',
          source: REPORTS,
          paint: {
            'circle-radius': 7,
            'circle-color': ['get', 'colour'],
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 2
          }
        });
        // The hiker, above everything: a halo of the fix's real size on the ground, and a
        // white-cored bull's-eye, since a plain blue dot is what a water report looks like.
        map.addSource(POSITION, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addLayer({
          id: 'position-halo',
          type: 'circle',
          source: POSITION,
          paint: {
            'circle-radius': uncertaintyRadiusExpression(),
            'circle-color': HERE,
            'circle-opacity': 0.15,
            'circle-stroke-color': HERE,
            'circle-stroke-width': 1,
            'circle-stroke-opacity': 0.6
          }
        });
        map.addLayer({
          id: POSITION,
          type: 'circle',
          source: POSITION,
          paint: { 'circle-radius': 9, 'circle-color': HERE, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2.5 }
        });
        map.addLayer({
          id: 'position-core',
          type: 'circle',
          source: POSITION,
          paint: { 'circle-radius': 3.5, 'circle-color': '#ffffff' }
        });
        pinsReady = true;
      } catch (err) {
        console.warn('LocatorMap: could not add report pins', err);
      }
    });

    try {
      // Marker.addTo() projects the coordinate immediately. If WebGL2 never
      // initialized (e.g. no GPU context, as under jsdom in unit tests), the
      // map has no painter/transform to project onto and this throws — the
      // same root cause map.remove() guards against below.
      new Marker({ color: '#c1663f' }).setLngLat([coords.lon, coords.lat]).addTo(map);
    } catch (err) {
      // jsdom has no WebGL2, so projecting a marker throws there. Log it:
      // in a real browser this would mean a genuine failure worth seeing.
      console.warn('LocatorMap: could not add marker', err);
    }
  });

  onDestroy(() => {
    // If WebGL2 never initialized (e.g. no GPU context, as under jsdom in unit
    // tests), maplibre-gl leaves `painter` unset and `remove()` throws instead
    // of no-op'ing. Swallow that so teardown of a never-painted map is silent.
    try {
      map?.remove();
    } catch {
      /* map never finished initializing; nothing to remove */
    }
    removeProtocol('pmtiles');
  });
</script>

<figure class="locator-figure">
  <div class="locator" bind:this={container} data-testid="locator-map" aria-label="Location of {title}"></div>
  <!-- The coordinates stay visible, not merely an aria-label. A map conveys
       position only to people who can see it and only where WebGL renders, so
       the text carries the same information for screen-reader users, for devices
       without WebGL, and for anyone wanting to copy the position elsewhere.

       The number of decimals is part of the claim: 4 places is ~11 m, which for
       an area centroid good to kilometres is the most precise-looking thing on
       the page. An approximate position gets 2 places (~1 km) and its radius
       stated outright. -->
  <figcaption>
    {#if accuracyM}
      {coords.lat.toFixed(2)}, {coords.lon.toFixed(2)} · ±{(accuracyM / 1000).toFixed(1)} km
    {:else}
      {coords.lat.toFixed(4)}, {coords.lon.toFixed(4)}
    {/if}
  </figcaption>
</figure>

<style>
  .locator-figure { margin: 1rem 0; }
  .locator:global(.picking) { cursor: crosshair; outline: 3px solid #c2410c; outline-offset: 2px; }
  .locator {
    height: 14rem;
    border-radius: 8px;
    overflow: hidden;
  }
  figcaption {
    font-size: 0.8em;
    opacity: 0.7;
    padding-top: 0.35rem;
    font-variant-numeric: tabular-nums;
  }
</style>
