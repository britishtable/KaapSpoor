<script lang="ts">
  import { base } from '$app/paths';
  import { activeHike } from '../journal/store';
</script>

{#if $activeHike}
  <div class="banner" role="status">
    <span>Hike in progress</span>
    <a href="{base}/route/{$activeHike.routeId}">Open</a>
  </div>
{/if}

<style>
  .banner {
    display: flex; align-items: center; justify-content: space-between; gap: 1rem;
    padding: 0 1rem; min-height: 48px; background: #c2410c; color: #fff; font-weight: 600;
  }
  a {
    color: inherit; min-height: 48px; min-width: 48px; display: inline-flex;
    align-items: center; justify-content: center; text-decoration: underline;
  }
  a:focus-visible { outline: 3px solid #fff; outline-offset: -3px; }
</style>
