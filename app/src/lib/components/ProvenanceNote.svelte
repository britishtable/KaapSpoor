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
      case 'osm-match': {
        const name = route.coordsOsm?.name;
        return name
          ? `Location matched to “${name}” in OpenStreetMap.`
          : 'Location matched to a feature in OpenStreetMap.';
      }
      case 'area-approx': {
        // coordsAccuracyM is supposed to always be set alongside 'area-approx' (see
        // types.ts), but that value crosses a Python→JSON boundary (tools/geocode)
        // that TypeScript cannot enforce at runtime, so guard it here too.
        const accuracy = route.coordsAccuracyM;
        if (typeof accuracy !== 'number' || !(accuracy > 0)) {
          return 'Approximate — averaged from other routes in this area.';
        }
        const km = accuracy / 1000;
        return `Approximate — somewhere within about ${km.toFixed(1)} km of this point, averaged from other routes in this area.`;
      }
      default: return 'Location not recorded.';
    }
  });
  let approx = $derived(route.coordsSource === 'area-approx');

  // How the LINE is known, which is a separate claim from how the position is.
  // One component owns both sentences so no two surfaces can word the same
  // relationship differently — the reason this component exists at all.
  // One sentence, because there is now one way a line comes to exist. The two
  // Phase 4d sentences named a tier because there were two tiers; naming a
  // single source tells the reader nothing they cannot see.
  let lineText = $derived(
    route.hasLine
      ? 'Line drawn from the Mountain Meanders description and from walking the route.'
      : null
  );
</script>

<p class="note" class:approx>{text}</p>
{#if lineText}
  <p class="note" data-testid="line-provenance">{lineText}</p>
{/if}

<style>
  .note { margin: 0; font-size: 0.85em; opacity: 0.7; }
  /* Subdued warning, not the flat grey the other four sources get: this one is
     telling the user not to trust the pin too literally. */
  .note.approx {
    opacity: 1;
    color: color-mix(in srgb, darkorange 70%, currentColor);
  }
</style>
