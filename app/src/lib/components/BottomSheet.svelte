<script lang="ts">
  import type { Snippet } from 'svelte';
  let { children }: { children: Snippet } = $props();
</script>

<aside class="sheet">{@render children()}</aside>

<style>
  /* Desktop: an ordinary sidebar column. */
  .sheet {
    overflow-y: auto;
    border-left: 1px solid color-mix(in srgb, currentColor 15%, transparent);
    padding: 0.75rem;
  }

  /* Narrow screens: a sheet over the map. CSS only — nothing measures anything. */
  @media (max-width: 48rem) {
    .sheet {
      border-left: none;
      border-top: 1px solid color-mix(in srgb, currentColor 20%, transparent);
      border-radius: 12px 12px 0 0;
      background: Canvas;
      max-height: 55vh;
      box-shadow: 0 -4px 16px rgb(0 0 0 / 0.15);
    }
  }
</style>
