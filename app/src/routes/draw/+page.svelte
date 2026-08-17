<script lang="ts">
  import { onMount } from 'svelte';
  import { base } from '$app/paths';
  import {
    Map as MapLibreMap, addProtocol, setWorkerUrl, type GeoJSONSource
  } from 'maplibre-gl';
  import { Protocol } from 'pmtiles';
  import 'maplibre-gl/dist/maplibre-gl.css';
  import { buildStyle, SHIPPED_BASEMAP } from '$lib/map/style';
  import {
    buildGraph, snapToGraph, routeBetween,
    type Point, type SnapGraph
  } from '$lib/map/snap';
  import {
    newVariant, undoLeg, variantCoords, toFeatures, fromFeatures, type Variant
  } from '$lib/draw/state';
  import type { RouteIndexEntry } from '$lib/data/types';

  /** The click tolerance, in screen pixels — the same reach at every zoom. */
  const SNAP_PX = 15;

  let container: HTMLDivElement;
  let map: MapLibreMap | undefined;
  let graph: SnapGraph | null = null;
  /**
   * Every trail line seen so far this route, not just the ones on screen.
   *
   * querySourceFeatures only returns the tiles currently loaded, so rebuilding
   * from scratch on each settle threw away everything you panned past — and a
   * route is longer than a viewport. Clicking, panning to the next bend and
   * clicking again then reported "no trail connects that to the last point"
   * while the connection was in plain sight, because the trail between them had
   * been forgotten. Cleared when a different route is picked.
   */
  let seenLines = new Map<string, Point[]>();

  let entries = $state<RouteIndexEntry[]>([]);
  let routeId = $state<string>('');
  let variants = $state<Variant[]>([newVariant()]);
  let active = $state(0);
  let message = $state('');
  let saving = $state(false);

  let route = $derived(entries.find((e) => e.id === routeId) ?? null);

  function redraw(): void {
    const source = map?.getSource('draw-preview') as GeoJSONSource | undefined;
    source?.setData({
      type: 'FeatureCollection',
      features: variants
        .map((v, i) => ({
          type: 'Feature' as const,
          geometry: { type: 'LineString' as const, coordinates: variantCoords(v) },
          properties: { active: i === active }
        }))
        .filter((f) => f.geometry.coordinates.length >= 2)
    });
  }

  /** Rebuild the snapping graph from whatever path features are loaded. */
  function rebuildGraph(): void {
    if (!map) return;
    // Paths AND roads. A guide's route regularly starts on tarmac — "From
    // Theresa Avenue, hike the cement road which eventually joins the Pipe
    // Track" — and a trail whose only link to the next one is a street cannot
    // be walked at all without them.
    const features = [
      ...map.querySourceFeatures('trails', { sourceLayer: 'paths' }),
      ...map.querySourceFeatures('trails', { sourceLayer: 'roads' })
    ];
    const lines: Point[][] = [];
    for (const feature of features) {
      const geometry = feature.geometry;
      if (geometry.type === 'LineString') lines.push(geometry.coordinates as Point[]);
      else if (geometry.type === 'MultiLineString') {
        for (const part of geometry.coordinates) lines.push(part as Point[]);
      }
    }
    let added = 0;
    for (const line of lines) {
      // Cheap identity: a tile-clipped line is the same line each time it is
      // returned, and its ends plus length distinguish it from its neighbours.
      const first = line[0];
      const last = line[line.length - 1];
      const key = `${line.length}|${first[0]},${first[1]}|${last[0]},${last[1]}`;
      if (!seenLines.has(key)) {
        seenLines.set(key, line);
        added++;
      }
    }
    if (!added && graph) return;
    graph = buildGraph([...seenLines.values()]);
    // Test-only hook, mirroring MapView's: WebGL is not queryable from
    // Playwright, and the editor's snapping is otherwise unobservable.
    (container as HTMLDivElement & { __drawGraph?: SnapGraph | null }).__drawGraph = graph;
  }

  /** 15 screen pixels, expressed in metres at the current centre and zoom. */
  function snapRadiusM(): number {
    if (!map) return 0;
    const centre = map.getCenter();
    const a = map.project(centre);
    const b = map.unproject([a.x + SNAP_PX, a.y]);
    return Math.abs(b.lng - centre.lng) * 111_320 * Math.cos((centre.lat * Math.PI) / 180);
  }

  function onMapClick(lngLat: { lng: number; lat: number }): void {
    if (!graph) return;
    if (!routeId) {
      message = 'Pick a route first.';
      return;
    }
    const click: Point = [lngLat.lng, lngLat.lat];
    // Snaps onto the LINE, not to its nearest vertex — a straight run of trail
    // has vertices only at its ends, and snapping to those refused clicks that
    // plainly landed on the path.
    const hit = snapToGraph(graph, click, snapRadiusM());
    if (!hit) {
      // Refused rather than dropped free-hand: an off-trail point would be
      // indistinguishable from a snapped one afterwards, and off-path geometry
      // is deliberately out of scope (see the spec).
      message = `No trail within ${SNAP_PX} px of that click.`;
      return;
    }
    const node = hit.key;
    const point = hit.point;
    const variant = variants[active];
    if (variant.legs.length === 0) {
      variant.legs.push({ at: point, coords: [point] });
      message = '';
    } else {
      // Re-snap the previous point into the CURRENT graph rather than trusting
      // the key it had when it was clicked. The graph is rebuilt whenever the
      // map settles — which happens after every click — and a node created by
      // splitting an edge does not survive that, so routing from the old key
      // failed on every second click wherever it landed.
      const previous = variant.legs[variant.legs.length - 1].at;
      const from = snapToGraph(graph, previous, snapRadiusM());
      if (!from) {
        message = 'The previous point is off the loaded map — pan back to it.';
        return;
      }
      const walked = routeBetween(graph, from.key, node);
      if (!walked) {
        message =
          'No trail connects those two points yet — if the trail between them ' +
          'is off screen, pan along it once so the editor can see it.';
        return;
      }
      variant.legs.push({ at: point, coords: walked });
      message = '';
    }
    variants = [...variants];
    redraw();
  }

  onMount(() => {
    // See MapView.svelte: maplibre-gl's worker resolves relative to the bundled
    // chunk's own URL, so it needs pointing at the copy in static/.
    setWorkerUrl(`${base}/maplibre/maplibre-gl-worker.mjs`);
    addProtocol('pmtiles', new Protocol().tile);
    map = new MapLibreMap({
      container,
      style: buildStyle(SHIPPED_BASEMAP, base),
      center: [18.41, -33.96],
      zoom: 14
    });
    map.on('load', () => {
      if (!map) return;
      map.addSource('draw-preview', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });
      map.addLayer({
        id: 'draw-preview-line',
        type: 'line',
        source: 'draw-preview',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['case', ['get', 'active'], '#c2410c', '#9a9a9a'],
          'line-width': 4
        }
      });
      // Label EVERY named trail. The shipped style filters `paths-named` to
      // the routes' own vocabulary and the app fills it at runtime; the editor
      // never does, so every ravine and traverse was anonymous. Routes are
      // named after the trail they use, so the name is how the author finds
      // the right line to click.
      map.setFilter('paths-named', ['has', 'name']);
      // Darker than the public map's quiet tier: here the names are the thing
      // being read, not a background fact.
      map.setPaintProperty('paths-named', 'text-color', '#3f2d1d');
      map.setPaintProperty('paths-named', 'text-halo-width', 1.8);
      // Repeat them more often, so a long trail is identifiable wherever the
      // author happens to be looking along it.
      map.setLayoutProperty('paths-named', 'symbol-spacing', 220);
      map.setLayoutProperty('paths-named', 'text-size', [
        'interpolate', ['linear'], ['zoom'], 13, 11, 16, 14
      ]);
      // 30 refused to place a label on a bending trail at all (Phase 4e's own
      // finding); 45 is MapLibre's default and places on the switchbacks these
      // routes are made of.
      map.setLayoutProperty('paths-named', 'text-max-angle', 45);
      rebuildGraph();
    });
    map.on('idle', rebuildGraph);
    (container as HTMLDivElement & { __maplibreMap?: MapLibreMap }).__maplibreMap = map;
    map.on('click', (e) => onMapClick(e.lngLat));

    fetch(`${base}/data/routes-index.json`)
      .then((r) => r.json())
      .then((loaded: RouteIndexEntry[]) => (entries = loaded));

    return () => map?.remove();
  });

  async function save(): Promise<void> {
    if (!routeId) return;
    saving = true;
    try {
      const today = new Date().toISOString().slice(0, 10);
      const res = await fetch('/__route-lines', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ routeId, features: toFeatures(routeId, variants, today) })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const result = (await res.json()) as { saved: number; total: number };
      message = `Saved ${result.saved} line(s); ${result.total} in the file.`;
    } catch (err) {
      message = `Save failed: ${String(err)}`;
    } finally {
      saving = false;
    }
  }

  async function pickRoute(id: string): Promise<void> {
    routeId = id;
    active = 0;
    // A fresh route starts a fresh network, so a long session does not carry
    // the whole peninsula around in memory.
    seenLines = new Map();
    // Load whatever is already drawn for this route, so a second sitting picks
    // up where the first left off rather than silently replacing it on Save.
    try {
      const res = await fetch(`${base}/data/route-lines.geojson`);
      const collection = res.ok ? await res.json() : { features: [] };
      const saved = fromFeatures(id, collection.features);
      variants = saved.length ? saved : [newVariant()];
    } catch {
      variants = [newVariant()];
    }
    redraw();
    const target = entries.find((e) => e.id === id);
    if (target?.coords) map?.flyTo({ center: [target.coords.lon, target.coords.lat], zoom: 15 });
  }
</script>

<div class="editor">
  <div class="map" bind:this={container} data-testid="draw-map"></div>

  <aside>
    <label>
      Route
      <select value={routeId} onchange={(e) => pickRoute(e.currentTarget.value)}>
        <option value="">Pick a route…</option>
        {#each entries as entry (entry.id)}
          <option value={entry.id}>{entry.hasLine ? '● ' : '○ '}{entry.title}</option>
        {/each}
      </select>
    </label>

    {#if route}
      <p class="hint">Click along the trails. Each click follows the paths from the last one.</p>

      {#each variants as variant, i (i)}
        <fieldset class:active={i === active}>
          <button type="button" onclick={() => (active = i)}>Variant {i + 1}</button>
          <input placeholder="Name (e.g. Right Hand)" bind:value={variant.name} />
          <input placeholder="What is it, and when would you take it?" bind:value={variant.note} />
          <span>{variantCoords(variant).length} points</span>
        </fieldset>
      {/each}

      <button
        type="button"
        onclick={() => {
          variants = [...variants, newVariant()];
          active = variants.length - 1;
        }}
      >
        Add variant
      </button>
      <button
        type="button"
        onclick={() => {
          variants[active] = undoLeg(variants[active]);
          variants = [...variants];
          redraw();
        }}
      >
        Undo point
      </button>
      <button
        type="button"
        onclick={() => {
          variants[active] = { ...variants[active], legs: [] };
          variants = [...variants];
          redraw();
        }}
      >
        Clear
      </button>
      <button type="button" onclick={save} disabled={saving}>
        {saving ? 'Saving…' : 'Save'}
      </button>
    {/if}

    {#if message}<p class="message">{message}</p>{/if}
  </aside>
</div>

<style>
  .editor { display: grid; grid-template-columns: 1fr 22rem; height: 100vh; }
  .map { width: 100%; height: 100%; }
  aside { padding: 1rem; overflow-y: auto; display: flex; flex-direction: column; gap: 0.6rem; }
  fieldset { display: grid; gap: 0.3rem; border: 1px solid #ddd; }
  fieldset.active { border-color: #c2410c; }
  .hint, .message { font-size: 0.85rem; }
  .message { color: #b45309; }
</style>
