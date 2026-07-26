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
    AttributionControl
  } from 'maplibre-gl';
  import { Protocol } from 'pmtiles';
  import 'maplibre-gl/dist/maplibre-gl.css';
  import { buildStyle, type Basemap } from '$lib/map/style';
  import { routesToGeoJSON, boundsOf } from '$lib/map/geojson';
  import { selection, setHovered, setSelected } from '$lib/map/selection';
  import { journal } from '$lib/journal/store';
  import type { RouteIndexEntry } from '$lib/data/types';

  let { entries, basemap = 'opentopo' as Basemap }: { entries: RouteIndexEntry[]; basemap?: Basemap } = $props();

  let container: HTMLDivElement;
  let map: MapLibreMap | undefined;
  let loaded = $state(false);

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
      attributionControl: false // added explicitly below so it is never dropped
    });
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
        cluster: true,
        clusterRadius: 40,
        clusterMaxZoom: 13
      });

      map.addLayer({
        id: 'pins-cluster',
        type: 'circle',
        source: 'routes',
        filter: ['has', 'point_count'],
        paint: { 'circle-color': '#4a6741', 'circle-radius': 16, 'circle-opacity': 0.85 }
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
        paint: {
          // Done routes read differently from to-do ones; hover/selection grows the pin.
          'circle-color': ['case', ['boolean', ['feature-state', 'done'], false], '#4a6741', '#c1663f'],
          'circle-radius': ['case', ['boolean', ['feature-state', 'active'], false], 9, 6],
          'circle-stroke-color': '#fff',
          'circle-stroke-width': 1.5
        }
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
        new Popup({ closeButton: true })
          .setLngLat((f.geometry as GeoJSON.Point).coordinates as [number, number])
          .setHTML(
            `<strong>${f.properties?.title ?? ''}</strong><br>` +
              `${f.properties?.grade ?? ''}<br>` +
              `<a href="${base}/route/${id}">Open route</a>`
          )
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

  // Paint done state from the journal.
  $effect(() => {
    const done = new Set([...$journal.values()].filter((e) => e.done).map((e) => e.routeId));
    if (!map || !loaded) return;
    for (const e of entries) {
      if (!e.coords) continue;
      map.setFeatureState({ source: 'routes', id: e.id }, { done: done.has(e.id) });
    }
  });

  // Highlight and fly when the panel selects or hovers a route.
  $effect(() => {
    const { hoveredId, selectedId } = $selection;
    if (!map || !loaded) return;
    const active = selectedId ?? hoveredId;
    for (const e of entries) {
      if (!e.coords) continue;
      map.setFeatureState({ source: 'routes', id: e.id }, { active: e.id === active });
    }
    if (selectedId) {
      const target = entries.find((e) => e.id === selectedId);
      if (target?.coords) {
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
