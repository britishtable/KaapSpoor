<script lang="ts">
  /**
   * The paths a route's description names, as the map is highlighting them.
   *
   * The heading is the design. These are paths the text REFERS TO — which
   * includes the ravine it tells you to escape down and the track it merely
   * crosses. We cannot tell an ascent from a bail-out, so nothing here may
   * imply we can. Names are the OSM spelling, because that is what is printed
   * on the map beside this list.
   *
   * This is also the guaranteed tier: the highlighted line cannot collide, but
   * its label can lose placement to a peak, a suburb or a route pin. The text
   * here always says what the map is showing.
   */
  let { names }: { names: string[] } = $props();
</script>

{#if names.length}
  <section class="mentions">
    <h3>Paths this description names</h3>
    <ul>
      {#each names as name (name)}
        <li>{name}</li>
      {/each}
    </ul>
  </section>
{:else}
  <p class="none">No mapped paths are named in this description.</p>
{/if}

<style>
  .mentions { margin: 0.75rem 0; }
  h3 { margin: 0 0 0.35rem; font-size: 0.85rem; opacity: 0.7; font-weight: 600; }
  ul { margin: 0; padding: 0; list-style: none; display: flex; flex-wrap: wrap; gap: 0.3rem; }
  /* Set as the map sets them: the referenced line's own brown, so the panel
     and the terrain read as one statement rather than two. */
  li {
    font-size: 0.85em;
    padding: 0.1rem 0.45rem;
    border: 1px solid color-mix(in srgb, #6b3f24 35%, transparent);
    border-radius: 999px;
    color: color-mix(in srgb, #6b3f24 85%, currentColor);
  }
  .none { margin: 0.75rem 0; font-size: 0.85em; opacity: 0.55; }
</style>
