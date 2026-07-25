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
  main { padding: 1rem; max-width: 60rem; margin: 0 auto; }
</style>
