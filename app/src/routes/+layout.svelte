<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import { base } from '$app/paths';
  import { hydrate } from '$lib/journal/store';
  import { restoreSession } from '$lib/account/session';
  import { startSync } from '$lib/sync/sync';
  import { hydrateOutbox } from '$lib/reports/outbox';
  import ActiveHikeBanner from '$lib/components/ActiveHikeBanner.svelte';
  import type { LayoutProps } from './$types';
  let { children }: LayoutProps = $props();
  onMount(() => {
    restoreSession();
    // Sync only once the local hikes and queued reports are loaded, so the first run sees them.
    let stop: (() => void) | null = null;
    let gone = false;
    Promise.allSettled([hydrate(), hydrateOutbox()]).then(() => { if (!gone) stop = startSync(); });
    return () => { gone = true; stop?.(); };
  });
</script>

<header><a href="{base}/">KaapSpoor</a> · <a href="{base}/settings">Settings</a> · <a href="{base}/account">Account</a></header>
<ActiveHikeBanner />
<main>{@render children()}</main>

<style>
  header { padding: 0.75rem 1rem; border-bottom: 1px solid color-mix(in srgb, currentColor 15%, transparent); }
  header a { color: inherit; }
  /* body now has a definite height (see app.css), so main's flex-basis
     resolves to a real pixel height rather than content size. That makes
     .split's `height: 100%` on the home page resolve against the viewport
     instead of the sidebar's full content height. But a definite height also
     means main no longer grows to fit tall content, so route/settings pages
     (whose content routinely exceeds the viewport) need their own scroll
     container: overflow-y: auto here is what keeps them fully reachable. */
  main { flex: 1; min-height: 0; overflow-y: auto; padding: 0; max-width: none; }
</style>
