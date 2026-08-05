<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
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
  import { uncertaintyPaint, uncertaintyBounds } from '$lib/map/pins';
  import type { Coords } from '$lib/data/types';

  let {
    coords,
    title,
    /** Metres. Set for an `area-approx` position only; see pins.ts. */
    accuracyM = null
  }: { coords: Coords; title: string; accuracyM?: number | null } = $props();
  let container: HTMLDivElement;
  let map: MapLibreMap | undefined;

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
