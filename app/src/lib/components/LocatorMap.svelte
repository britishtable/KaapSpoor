<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { base } from '$app/paths';
  // maplibre-gl v6 has no default export — import the protocol helpers by name.
  import { addProtocol, removeProtocol, Map as MapLibreMap, Marker, AttributionControl } from 'maplibre-gl';
  import { Protocol } from 'pmtiles';
  import 'maplibre-gl/dist/maplibre-gl.css';
  import { buildStyle } from '$lib/map/style';
  import type { Coords } from '$lib/data/types';

  let { coords, title }: { coords: Coords; title: string } = $props();
  let container: HTMLDivElement;
  let map: MapLibreMap | undefined;

  onMount(() => {
    const protocol = new Protocol();
    addProtocol('pmtiles', protocol.tile);
    map = new MapLibreMap({
      container,
      style: buildStyle('opentopo', base),
      center: [coords.lon, coords.lat],
      zoom: coords.zoom,
      // Non-interactive: a scrollable map inside an article hijacks page scroll.
      interactive: false,
      attributionControl: false
    });
    map.addControl(new AttributionControl({ compact: true }));
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
       without WebGL, and for anyone wanting to copy the position elsewhere. -->
  <figcaption>{coords.lat.toFixed(4)}, {coords.lon.toFixed(4)}</figcaption>
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
