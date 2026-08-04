<script lang="ts">
  import type { RouteIndexEntry } from '../data/types';
  let { route }: { route: RouteIndexEntry } = $props();

  // area-approx is a caveat about the position itself, not a fact about it like
  // the other four sources — it gets its own text and its own visual treatment
  // below so it can never be mistaken for a precise point.
  let text = $derived.by(() => {
    switch (route.coordsSource) {
      case 'crawl': return 'Location from the Mountain Meanders page.';
      case 'curated': return 'Location checked and corrected by hand.';
      case 'osm-match': return `Location matched to “${route.coordsOsm?.name}” in OpenStreetMap.`;
      case 'area-approx': {
        // coordsAccuracyM is only ever set alongside 'area-approx' (see types.ts).
        const km = (route.coordsAccuracyM ?? 0) / 1000;
        return `Approximate — somewhere within about ${km.toFixed(1)} km of this point, averaged from other routes in this area.`;
      }
      default: return 'Location not recorded.';
    }
  });
  let approx = $derived(route.coordsSource === 'area-approx');
</script>

<p class="note" class:approx>{text}</p>

<style>
  .note { margin: 0; font-size: 0.85em; opacity: 0.7; }
  /* Subdued warning, not the flat grey the other four sources get: this one is
     telling the user not to trust the pin too literally. */
  .note.approx {
    opacity: 1;
    color: color-mix(in srgb, darkorange 70%, currentColor);
  }
</style>
