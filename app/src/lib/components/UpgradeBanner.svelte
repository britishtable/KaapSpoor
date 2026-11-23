<script lang="ts">
  import { upgradeBlocked } from '../journal/db';
</script>

<!-- Shown while this tab's database update waits on another tab still running an older build. -->
{#if $upgradeBlocked}
  <p class="upgrade" role="status">Close other KaapSpoor tabs to finish updating.</p>
{/if}

<style>
  .upgrade {
    margin: 0; padding: 0.75rem 1rem; line-height: 1.4;
    border-bottom: 1px solid color-mix(in srgb, currentColor 15%, transparent);
    background: color-mix(in srgb, currentColor 6%, transparent);
  }
</style>
