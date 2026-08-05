<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { base } from '$app/paths';
  import {
    addProtocol,
    removeProtocol,
    setWorkerUrl,
    Map as MapLibreMap,
    Popup,
    GeolocateControl,
    NavigationControl,
    AttributionControl,
    type GeoJSONSource
  } from 'maplibre-gl';
  import { Protocol } from 'pmtiles';
  import 'maplibre-gl/dist/maplibre-gl.css';
  import { buildStyle, SHIPPED_BASEMAP, type Basemap } from '$lib/map/style';
  import { routesToGeoJSON, boundsOf } from '$lib/map/geojson';
  import { pinsPaint, uncertaintyPaint, uncertaintyBounds } from '$lib/map/pins';
  import { selection, setHovered, setSelected } from '$lib/map/selection';
  import { journal } from '$lib/journal/store';
  import { SHIPPED_REGION } from '$lib/map/region';
  import type { RouteIndexEntry } from '$lib/data/types';

  let { entries, basemap = SHIPPED_BASEMAP }: { entries: RouteIndexEntry[]; basemap?: Basemap } = $props();

  let container: HTMLDivElement;
  let map: MapLibreMap | undefined;
  let loaded = $state(false);

  // The map is a standalone region (see region.ts), not a window onto a
  // continuous world -- style.ts's region-mask layer paints everything
  // outside SHIPPED_REGION as letterboxing, and without a camera constraint a
  // visitor could still pan clean off it into that masked space.
  //
  // The margin has to be well past a naive "small buffer": MapLibre's
  // maxBounds also raises the *minimum* zoom, to whatever level makes the
  // bounds box fill the viewport, and this region is portrait (0.24° wide by
  // 0.44° tall) while the map pane is landscape -- so the box's height, not
  // its width, decides that floor. A margin of ~0.05-0.15° measured well
  // above the real opening zoom (10.2-10.9 against an observed 9.92) because
  // it raised that floor past the zoom fitBounds actually wants, and the two
  // constraints fought each other. 0.3° was measured to sit below the floor
  // in the Playwright viewport (opening zoom unchanged at 9.924), leaving
  // fitBounds' own camera as the one that wins.
  const REGION_MAX_BOUNDS: [[number, number], [number, number]] = [
    [SHIPPED_REGION.bbox.west - 0.3, SHIPPED_REGION.bbox.south - 0.3],
    [SHIPPED_REGION.bbox.east + 0.3, SHIPPED_REGION.bbox.north + 0.3]
  ];

  onMount(() => {
    // maplibre-gl resolves its worker script relative to import.meta.url of
    // whichever bundle chunk it ends up in, which after a Vite build is a
    // hashed chunk URL, not the package's own dist/ directory — so the
    // worker (and its "./maplibre-gl-shared.mjs" relative import) 404 unless
    // both are copied into static/ and pointed at explicitly. Without this,
    // the map never fires its 'load' event and data-map-ready never flips.
    setWorkerUrl(`${base}/maplibre/maplibre-gl-worker.mjs`);

    // pmtiles:// URLs need their protocol registered before the style loads.
    const protocol = new Protocol();
    addProtocol('pmtiles', protocol.tile);

    map = new MapLibreMap({
      container,
      style: buildStyle(basemap, base),
      attributionControl: false, // added explicitly below so it is never dropped
      maxBounds: REGION_MAX_BOUNDS
    });

    // Test-only hook: WebGL pixels are not queryable from Playwright, and
    // maplibre-gl attaches the instance nowhere else reachable from the DOM,
    // so e2e specs that need to assert on real MapLibre state (feature-state
    // binding, rendered pin counts) read this property off the map container.
    // It is inert in production — nothing in the app reads it back.
    (container as HTMLDivElement & { __maplibreMap?: MapLibreMap }).__maplibreMap = map;

    map.addControl(new AttributionControl({ compact: true }));
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(
      new GeolocateControl({ trackUserLocation: true, showUserLocation: true }),
      'top-right'
    );

    const bounds = boundsOf(entries);
    if (bounds) map.fitBounds(bounds, { padding: 48, animate: false });

    map.on('load', () => {
      if (!map) return;
      map.addSource('routes', {
        type: 'geojson',
        data: routesToGeoJSON(entries),
        // MapLibre parseInt()s string feature ids on GeoJSON sources, so our slug
        // ids become NaN and setFeatureState never matches. promoteId reads the id
        // from properties instead, which is what makes done/active styling work.
        promoteId: 'id',
        cluster: true,
        clusterRadius: 40,
        clusterMaxZoom: 13
      });

      // Added first so it sits under every pin and cluster: a translucent disc
      // several kilometres across must never obscure the thing it describes.
      // The filter starts matching nothing -- this layer draws the SELECTED
      // route's circle only (see the selection effect below), because the 31
      // approximate routes share just 9 centroids and permanent circles would
      // be an overlapping soup. The reasoning is in pins.ts.
      map.addLayer({
        id: 'uncertainty',
        type: 'circle',
        source: 'routes',
        filter: ['==', ['get', 'id'], ''],
        paint: uncertaintyPaint()
      });

      map.addLayer({
        id: 'pins-cluster',
        type: 'circle',
        source: 'routes',
        filter: ['has', 'point_count'],
        paint: {
          // Deliberately NOT the done-green (#4a6741, see the pins layer below):
          // a cluster says "several routes here", which is a different claim
          // from "you have done this one". Sharing a colour made green ambiguous.
          'circle-color': '#55606b',
          'circle-radius': 16,
          'circle-opacity': 0.85
        }
      });
      map.addLayer({
        id: 'pins-cluster-count',
        type: 'symbol',
        source: 'routes',
        filter: ['has', 'point_count'],
        layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-font': ['Open Sans Regular'], 'text-size': 12 },
        paint: { 'text-color': '#fff' }
      });
      map.addLayer({
        id: 'pins',
        type: 'circle',
        source: 'routes',
        filter: ['!', ['has', 'point_count']],
        paint: pinsPaint()
      });

      loaded = true;

      map.on('click', 'pins-cluster', (e) => {
        // Use e.features rather than re-querying: a layer-scoped handler already
        // carries the hit features, and indexing a possibly-empty query result
        // would throw. tsconfig lacks noUncheckedIndexedAccess, so the type
        // checker cannot catch that — the guard has to be explicit.
        const f = e.features?.[0];
        if (!f) return;
        map!.easeTo({
          center: (f.geometry as GeoJSON.Point).coordinates as [number, number],
          zoom: map!.getZoom() + 2
        });
      });

      map.on('click', 'pins', (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const id = String(f.properties?.id);
        setSelected(id);

        // title/grade come from the Mountain Meanders crawl and are untrusted
        // text (titles already contain raw "&"; nothing currently has "<", but
        // that is a fact about today's data, not a guarantee for the next
        // re-crawl). Build the popup from DOM nodes instead of interpolating
        // into setHTML's innerHTML sink, so a future "<" cannot inject markup.
        const content = document.createElement('div');

        const strong = document.createElement('strong');
        strong.textContent = f.properties?.title ?? '';
        content.appendChild(strong);
        content.appendChild(document.createElement('br'));

        content.appendChild(document.createTextNode(f.properties?.grade ?? ''));
        content.appendChild(document.createElement('br'));

        // A plain anchor, not a JS-driven navigation: SvelteKit's client router
        // intercepts clicks on internal <a> hrefs anywhere in the document, so
        // this still navigates client-side rather than doing a full page load.
        const link = document.createElement('a');
        link.href = `${base}/route/${id}`;
        link.textContent = 'Open route';
        content.appendChild(link);

        new Popup({ closeButton: true })
          .setLngLat((f.geometry as GeoJSON.Point).coordinates as [number, number])
          .setDOMContent(content)
          .addTo(map!);
      });

      map.on('mouseenter', 'pins', (e) => {
        map!.getCanvas().style.cursor = 'pointer';
        const id = e.features?.[0]?.properties?.id;
        if (id) setHovered(String(id));
      });
      map.on('mouseleave', 'pins', () => {
        map!.getCanvas().style.cursor = '';
        setHovered(null);
      });
    });
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

  // Bumped every time the pin source's data is replaced, so the feature-state
  // effects below can declare an explicit dependency on "the data currently in
  // the source" rather than relying on both effects happening to read `entries`
  // and hoping the scheduler runs them in source order.
  let dataVersion = $state(0);
  // Plain, non-reactive counter backing the bump above. `dataVersion++` would
  // read *and* write the reactive `dataVersion`, making the effect below
  // depend on the very state it writes — every write re-triggers the effect,
  // which writes again, forever (Svelte throws effect_update_depth_exceeded).
  // Deriving the new value from this untracked counter instead breaks that
  // self-dependency.
  let dataVersionCounter = 0;

  // Keep the pin source in step with the filtered entries. Without this,
  // MapView wrote the GeoJSON once inside map.on('load') and never again, so
  // narrowing the panel with search/filters left the map showing every pin.
  $effect(() => {
    const data = routesToGeoJSON(entries);
    if (!map || !loaded) return;
    (map.getSource('routes') as GeoJSONSource | undefined)?.setData(data);
    dataVersion = ++dataVersionCounter;
  });

  // Paint done state from the journal.
  $effect(() => {
    const done = new Set([...$journal.values()].filter((e) => e.done).map((e) => e.routeId));
    dataVersion; // re-run after the source data above is swapped
    if (!map || !loaded) return;
    for (const e of entries) {
      if (!e.coords) continue;
      map.setFeatureState({ source: 'routes', id: e.id }, { done: done.has(e.id) });
    }
  });

  // Highlight and fly when the panel selects or hovers a route.
  $effect(() => {
    const { hoveredId, selectedId } = $selection;
    dataVersion; // re-run after the source data above is swapped
    if (!map || !loaded) return;
    const active = selectedId ?? hoveredId;
    for (const e of entries) {
      if (!e.coords) continue;
      map.setFeatureState({ source: 'routes', id: e.id }, { active: e.id === active });
    }
    const target = selectedId ? entries.find((e) => e.id === selectedId) : undefined;
    const approxRadius =
      target?.coordsSource === 'area-approx' && target.coordsAccuracyM
        ? target.coordsAccuracyM
        : null;

    // Show the uncertainty circle for the selected route and no other. An id
    // that matches nothing (the empty string) is how it goes away again.
    map.setFilter('uncertainty', ['==', ['get', 'id'], approxRadius ? selectedId : '']);

    if (target?.coords) {
      if (approxRadius) {
        // Do NOT fly to z14 here. That frames a ~1.5 km-wide view on a position
        // known to within kilometres, which asserts precisely the precision this
        // route does not have -- and it would push the circle far outside the
        // pane, leaving a full-screen tint with no visible edge. Framing on the
        // circle's own bounds instead makes the uncertainty the subject: you see
        // its whole extent, and the pin sitting at the middle of it.
        map.fitBounds(uncertaintyBounds(target.coords.lon, target.coords.lat, approxRadius), {
          padding: 48,
          // A tight radius must not zoom in further than a surveyed route does.
          maxZoom: 14
        });
      } else {
        map.flyTo({ center: [target.coords.lon, target.coords.lat], zoom: 14, speed: 1.4 });
      }
    }
  });
</script>

<!-- data-map-ready flips only after the style loaded AND the pins layer was added,
     which is the one honest signal an outside test can assert on: WebGL pixels
     are not queryable from Playwright. -->
<div class="map" bind:this={container} data-testid="map" data-map-ready={loaded}></div>

<style>
  .map { width: 100%; height: 100%; min-height: 20rem; }
</style>
