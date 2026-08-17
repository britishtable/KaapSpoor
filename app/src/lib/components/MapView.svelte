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
  import {
    buildStyle, SHIPPED_BASEMAP, pathNameFilter, NAMED_PATH_LAYER, type Basemap
  } from '$lib/map/style';
  import {
    ROUTE_LINE_SOURCE, routeLineFilter, activeVariantFilter, lineBounds,
    ARROW_IMAGE, arrowImage
  } from '$lib/map/route-lines';
  import type { FeatureCollection, LineString, MultiLineString } from 'geojson';
  import { routesToGeoJSON, boundsOf } from '$lib/map/geojson';
  import { pinsPaint, uncertaintyPaint, uncertaintyBounds } from '$lib/map/pins';
  import { summariseGrade } from '$lib/data/grade';
  import { selection, setHovered, setSelected } from '$lib/map/selection';
  import { journal } from '$lib/journal/store';
  import { SHIPPED_REGION } from '$lib/map/region';
  import type { RouteIndexEntry } from '$lib/data/types';

  let {
    entries,
    pathVocabulary = [],
    basemap = SHIPPED_BASEMAP
  }: { entries: RouteIndexEntry[]; pathVocabulary?: string[]; basemap?: Basemap } = $props();

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

      // The circle gets its OWN source, deliberately not the clustered `routes`
      // one. Framing a selection on its uncertainty bounds lands the camera at
      // z11-12.2 (measured across viewports), below clusterMaxZoom 13, so the
      // selected point is inside a cluster and a filter against `routes` draws
      // nothing at all -- the feature the filter looks for does not exist at
      // that zoom. This was live and invisible until a browser check caught it.
      // An unclustered source of exactly one point cannot have that problem.
      map.addSource('selected-uncertainty', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });

      // Added first so it sits under every pin and cluster: a translucent disc
      // several kilometres across must never obscure the thing it describes.
      // It holds the SELECTED route alone (see the selection effect below),
      // because the 31 approximate routes share just 9 centroids and permanent
      // circles would be an overlapping soup. The reasoning is in pins.ts.
      map.addLayer({
        id: 'uncertainty',
        type: 'circle',
        source: 'selected-uncertainty',
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
        const el = (tag: string, className?: string, text?: string) => {
          const node = document.createElement(tag);
          if (className) node.className = className;
          if (text !== undefined) node.textContent = text;
          return node;
        };

        const content = el('div', 'rp');

        // The head is set like a printed guide's route list: the grade in its
        // own column, then the name. The grade field trails long prose on most
        // routes (up to 145 characters), so only the level and stars come here.
        const head = el('div', 'rp-head');
        const { level, stars } = summariseGrade(f.properties?.grade ?? null);
        if (level) {
          const gradeCol = el('div', 'rp-grade');
          gradeCol.appendChild(el('span', 'rp-level', level));
          if (stars) {
            // The guide writes quality as asterisks. Set at the size this column
            // needs them, asterisks render as a row of faint dots -- they sit at
            // cap height and carry almost no ink. Drawn as the mark they mean
            // instead, which is legible at 10px and unmistakable.
            gradeCol.appendChild(el('span', 'rp-stars', '★'.repeat(stars.length)));
          }
          // Announced as one fact, or a screen reader reads "black star" per
          // glyph. role=img makes the label replace the contents entirely.
          gradeCol.setAttribute('role', 'img');
          gradeCol.setAttribute(
            'aria-label',
            stars
              ? `Grade ${level}, ${stars.length} ${stars.length === 1 ? 'star' : 'stars'}`
              : `Grade ${level}`
          );
          head.appendChild(gradeCol);
        }
        // Not a heading element: the popup is a transient annotation on the map,
        // not a section of the document, and an h3 here both pollutes the page
        // outline and collides with the preview panel's own heading for the
        // same route.
        head.appendChild(el('div', 'rp-title', f.properties?.title ?? ''));
        content.appendChild(head);

        // A plain anchor, not a JS-driven navigation: SvelteKit's client router
        // intercepts clicks on internal <a> hrefs anywhere in the document, so
        // this still navigates client-side rather than doing a full page load.
        const link = el('a', 'rp-open') as HTMLAnchorElement;
        link.href = `${base}/route/${id}`;
        link.appendChild(el('span', undefined, 'Open route'));
        // Decorative: the label already says what happens, so the arrow must not
        // be announced a second time.
        const arrow = el('span', 'rp-arrow', '→');
        arrow.setAttribute('aria-hidden', 'true');
        link.appendChild(arrow);
        content.appendChild(link);

        // A done route's pin is green; the popup follows it rather than
        // contradicting the thing the user just clicked.
        if (map!.getFeatureState({ source: 'routes', id })?.done) content.classList.add('is-done');

        new Popup({ closeButton: true, className: 'route-popup', maxWidth: '17rem' })
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

  // The quiet label tier. Driven from the FULL in-region vocabulary the page
  // passes in, deliberately not from `entries` — `entries` is already narrowed
  // by the panel's search and filters, and narrowing the list must not
  // un-label the mountain underneath it.
  $effect(() => {
    const names = pathVocabulary;
    if (!map || !loaded) return;
    map.setFilter(NAMED_PATH_LAYER, pathNameFilter(names));
  });

  // Paint done state from the journal.
  $effect(() => {
    const done = new Set([...$journal.values()].filter((e) => e.done).map((e) => e.routeId));
    dataVersion; // re-run after the source data above is swapped
    if (!map || !loaded) return;
    for (const e of entries) {
      if (!e.coords) continue;
      map.setFeatureState({ source: 'routes', id: e.id }, { done: done.has(e.id) });
      // The line reads done/to-do exactly as the pin does. promoteId on the
      // route-lines source (style.ts) is what makes a slug id match here.
      // Cleared as well as set, for the same reason the pin state is: a route
      // un-ticked in the journal must go back to to-do without a reload.
      if (e.hasLine) {
        map.setFeatureState({ source: ROUTE_LINE_SOURCE, id: e.id }, { done: done.has(e.id) });
      }
    }
  });

  // The selection the camera has already responded to.
  //
  // Plain and non-reactive on purpose: writing it must not re-trigger the effect
  // that reads it. The effect below has to re-run on every hover (it paints the
  // active pin), and the pins layer's own mouseenter/mouseleave fire constantly
  // as the pointer crosses pins -- which is exactly what panning does. Moving
  // the camera on every run therefore yanked the map back to the selected route
  // mid-pan, repeatedly. Measured: two flyTo calls from pointer movement alone,
  // returning the centre to the selection exactly. The camera belongs to the
  // user once it has arrived; it is the *change* of selection that owns it.
  let cameraFollowedId: string | null = null;

  // The lines for every route, fetched ONCE the first time a selection needs
  // them. Deliberately not part of routes-index.json: 184 entries would each
  // carry a few hundred coordinates for a shape only the selected route draws.
  let routeLines: FeatureCollection<LineString | MultiLineString, { routeId: string }> | null = null;
  let routeLinesRequested = false;

  async function ensureRouteLines(): Promise<void> {
    if (routeLinesRequested) return;
    routeLinesRequested = true;
    try {
      const res = await fetch(`${base}/data/route-lines.geojson`);
      if (!res.ok) throw new Error(`HTTP ${res.status} for route lines`);
      routeLines = await res.json();
      const source = map?.getSource(ROUTE_LINE_SOURCE) as GeoJSONSource | undefined;
      if (source && routeLines) source.setData(routeLines);
      // The style names the image; the map has to be given it.
      if (map && !map.hasImage(ARROW_IMAGE)) map.addImage(ARROW_IMAGE, arrowImage());
    } catch (err) {
      // A failed fetch means no line draws, which is the same as a route that
      // has none — the map stays usable and the pin still carries the route.
      console.warn('MapView: could not load route lines', err);
    }
  }

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
    // The route's own line. Selection only — hovering fires constantly while
    // panning, and this both re-filters layers and moves the camera.
    // FILTER ONLY. This effect re-runs on every hover, and hover fires
    // constantly as the pointer crosses pins while panning — so anything that
    // moves the camera must live in the camera branch below, which runs once
    // per CHANGE of selection. Framing here yanked a panned view back on every
    // pointer sweep, the exact defect cameraFollowedId exists to prevent.
    if (target?.hasLine) {
      void ensureRouteLines().then(() => {
        // The selection may have moved on while the fetch was in flight; a
        // late arrival must not draw a route the user has left.
        if (!map || $selection.selectedId !== selectedId) return;
        map.setFilter('route-line-casing', routeLineFilter(selectedId));
        map.setFilter('route-line', routeLineFilter(selectedId));
        map.setFilter('route-line-arrows', routeLineFilter(selectedId));
        map.setFilter('route-line-active', activeVariantFilter(selectedId, $selection.hoveredVariant));
      });
    } else {
      map.setFilter('route-line-casing', routeLineFilter(null));
      map.setFilter('route-line', routeLineFilter(null));
      map.setFilter('route-line-arrows', routeLineFilter(null));
      map.setFilter('route-line-active', activeVariantFilter(null, null));
    }
    const approxRadius =
      target?.coordsSource === 'area-approx' && target.coordsAccuracyM
        ? target.coordsAccuracyM
        : null;

    // Show the uncertainty circle for the selected route and no other; an empty
    // collection is how it goes away again.
    (map.getSource('selected-uncertainty') as GeoJSONSource | undefined)?.setData(
      approxRadius && target?.coords
        ? {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [target.coords.lon, target.coords.lat] },
            properties: { coordsAccuracyM: approxRadius }
          }
        : { type: 'FeatureCollection', features: [] }
    );

    // Only a change of selection moves the camera. Recorded even when there is
    // nothing to fly to, so that selecting an unlocated route and then coming
    // back to a located one still counts as a change and still flies.
    if (selectedId !== cameraFollowedId) {
      cameraFollowedId = selectedId;
      if (target?.coords) {
        if (approxRadius) {
          // Do NOT fly to z14 here. That frames a ~1.5 km-wide view on a
          // position known to within kilometres, which asserts precisely the
          // precision this route does not have -- and it would push the circle
          // far outside the pane, leaving a full-screen tint with no visible
          // edge. Framing on the circle's own bounds instead makes the
          // uncertainty the subject: you see its whole extent, and the pin
          // sitting at the middle of it.
          map.fitBounds(uncertaintyBounds(target.coords.lon, target.coords.lat, approxRadius), {
            padding: 48,
            // A tight radius must not zoom in further than a surveyed route does.
            maxZoom: 14
          });
        } else if (target.hasLine) {
          // Framing the line rather than flying to the pin is the point of
          // having a line: you see the whole walk, not its trailhead.
          const coords = target.coords;
          const frame = () => {
            if (!map) return;
            const feature = routeLines?.features.find((f) => f.properties.routeId === target.id);
            const bounds = feature ? lineBounds(feature.geometry) : null;
            if (bounds) map.fitBounds(bounds, { padding: 64, maxZoom: 15 });
            else map.flyTo({ center: [coords.lon, coords.lat], zoom: 14, speed: 1.4 });
          };
          if (routeLines) frame();
          else {
            // First selection of the session: the file is still in flight, so
            // frame once it lands — and only if this selection is still the
            // one the camera is following, so a fast click-through does not
            // end on the wrong route's extent.
            void ensureRouteLines().then(() => {
              if (cameraFollowedId === selectedId && $selection.selectedId === selectedId) frame();
            });
          }
        } else {
          map.flyTo({ center: [target.coords.lon, target.coords.lat], zoom: 14, speed: 1.4 });
        }
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

  /* The pin popup.
   *
   * :global because MapLibre builds this DOM itself, outside the component's
   * markup, so Svelte's scoping never reaches it. Everything is under
   * .route-popup (the className passed to the Popup constructor) so none of it
   * escapes onto MapLibre's other UI.
   *
   * Deliberately light in both themes. The popup is an annotation ON the map,
   * and buildStyle's cartography is pale whatever the chrome is doing; a dark
   * card here would sit heavier than the pins it describes. Its colours are the
   * pins' own — terracotta for to-do, moss for done — so nothing new is
   * introduced to the map's vocabulary.
   */
  .map :global(.route-popup) {
    --rp-paper: #f7f3ec;
    --rp-ink: #241f1a;
    --rp-accent: #c1663f;
    --rp-rule: rgb(36 31 26 / 0.16);
  }
  .map :global(.route-popup .rp.is-done) { --rp-accent: #4a6741; }

  .map :global(.route-popup .maplibregl-popup-content) {
    background: var(--rp-paper);
    color: var(--rp-ink);
    border-radius: 3px;
    padding: 0;
    overflow: hidden;
    box-shadow: 0 2px 10px rgb(36 31 26 / 0.18);
  }
  /* One border side per anchor carries the tip's colour; the rest are already
     transparent. Recolour all of them and only the visible one changes. */
  .map :global(.route-popup .maplibregl-popup-tip) {
    border-top-color: var(--rp-paper);
    border-bottom-color: var(--rp-paper);
    border-left-color: var(--rp-paper);
    border-right-color: var(--rp-paper);
  }
  .map :global(.route-popup .maplibregl-popup-close-button) {
    color: var(--rp-ink);
    opacity: 0.45;
    font-size: 1.1rem;
    line-height: 1;
    padding: 0.3rem 0.45rem;
  }
  .map :global(.route-popup .maplibregl-popup-close-button:hover) {
    background: transparent;
    opacity: 1;
  }

  /* The signature: a grade column ruled off from the name, as a printed
     climbing guide sets its route list. */
  .map :global(.route-popup .rp-head) {
    display: flex;
    align-items: stretch;
    gap: 0.7rem;
    padding: 0.7rem 1.6rem 0.7rem 0.85rem;
  }
  .map :global(.route-popup .rp-grade) {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding-right: 0.7rem;
    border-right: 1px solid var(--rp-rule);
    min-width: 2.1rem;
  }
  .map :global(.route-popup .rp-level) {
    font-size: 1.45rem;
    font-weight: 500;
    line-height: 1;
    letter-spacing: -0.02em;
    font-variant-numeric: tabular-nums;
  }
  .map :global(.route-popup .rp-stars) {
    color: var(--rp-accent);
    font-size: 0.5rem;
    line-height: 1;
    letter-spacing: 0.06em;
    /* Centred as a block: the tracking would otherwise push the run right of
       the numeral by its own trailing space. */
    margin: 0.25rem 0 0 0.06em;
  }
  .map :global(.route-popup .rp-title) {
    margin: 0;
    align-self: center;
    font-size: 0.9rem;
    font-weight: 600;
    line-height: 1.3;
  }

  .map :global(.route-popup .rp-open) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.55rem 0.85rem;
    border-top: 1px solid var(--rp-rule);
    color: var(--rp-accent);
    text-decoration: none;
    font-size: 0.68rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.12em;
  }
  .map :global(.route-popup .rp-open:hover) {
    background: color-mix(in srgb, var(--rp-accent) 9%, transparent);
  }
  .map :global(.route-popup .rp-open:focus-visible) {
    outline: 2px solid var(--rp-accent);
    outline-offset: -2px;
  }
  .map :global(.route-popup .rp-arrow) {
    transition: transform 120ms ease-out;
  }
  .map :global(.route-popup .rp-open:hover .rp-arrow) {
    transform: translateX(2px);
  }
  @media (prefers-reduced-motion: reduce) {
    .map :global(.route-popup .rp-arrow) { transition: none; }
    .map :global(.route-popup .rp-open:hover .rp-arrow) { transform: none; }
  }
</style>
