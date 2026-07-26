<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import { base } from '$app/paths';
  import { hydrate } from '$lib/journal/store';
  import type { LayoutProps } from './$types';
  let { children }: LayoutProps = $props();
  onMount(() => { hydrate(); });
</script>

<header><a href="{base}/">KaapSpoor</a> · <a href="{base}/settings">Settings</a></header>
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
