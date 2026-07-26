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
    } catch {
      /* map never finished initializing; nothing to place a marker on */
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

<div class="locator" bind:this={container} data-testid="locator-map" aria-label="Location of {title}"></div>

<style>
  .locator {
    height: 14rem;
    margin: 1rem 0;
    border-radius: 8px;
    overflow: hidden;
  }
</style>
