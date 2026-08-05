<script lang="ts">
  import { base } from '$app/paths';
  import { humanizeArea } from '../data/areas';
  import type { RouteContent } from '../data/types';
  import StatsStrip from './StatsStrip.svelte';
  import ProvenanceNote from './ProvenanceNote.svelte';

  let { routeId, onclose }: { routeId: string; onclose?: () => void } = $props();

  // Three states, all of them rendered. A failed fetch has to say so: an empty
  // panel is indistinguishable from a route with nothing in it.
  type View =
    | { status: 'loading' }
    | { status: 'loaded'; route: RouteContent }
    | { status: 'failed' };

  let view = $state<View>({ status: 'loading' });

  $effect(() => {
    const id = routeId;
    view = { status: 'loading' };

    // The request in flight is the one for `id`; the cleanup below runs when
    // routeId changes or the panel unmounts, and marks this one abandoned. Two
    // selections in quick succession therefore cannot race -- a slow response
    // for the route the user has already navigated away from is dropped rather
    // than overwriting the one they are looking at now.
    let abandoned = false;

    void (async () => {
      try {
        const res = await fetch(`${base}/data/routes/${id}.json`);
        // A missing route resolves with ok:false rather than rejecting, so this
        // has to be checked explicitly or the 404 body gets parsed as route JSON.
        if (!res.ok) throw new Error(`HTTP ${res.status} for route ${id}`);
        const route = (await res.json()) as RouteContent;
        if (!abandoned) view = { status: 'loaded', route };
      } catch {
        if (!abandoned) view = { status: 'failed' };
      }
    })();

    return () => { abandoned = true; };
  });
</script>

<section class="preview" aria-label="Route preview">
  <header>
    <h2>{view.status === 'loaded' ? view.route.title : 'Route'}</h2>
    <button type="button" aria-label="Close preview" onclick={() => onclose?.()}>×</button>
  </header>

  {#if view.status === 'loading'}
    <p class="muted" data-testid="preview-loading">Loading…</p>
  {:else if view.status === 'failed'}
    <p class="failed" data-testid="preview-error">
      Could not load this route. It may not have been published yet.
    </p>
  {:else}
    {@const r = view.route}
    <div class="body" data-testid="preview-body">
      <p class="crumb">{r.area.map(humanizeArea).join(' / ')}</p>
      <StatsStrip route={r} />
      <ProvenanceNote route={r} />

      {#each Object.entries(r.sections) as [heading, text]}
        {#if heading}<h3>{heading}</h3>{/if}
        <p class="prose">{text}</p>
      {/each}

      <a class="more" href="{base}/route/{r.id}">Open the full route page</a>
    </div>
  {/if}
</section>

<style>
  /* min-height:0 so the body can scroll inside a flex parent (the sidebar on
     desktop, the bottom sheet on mobile) rather than pushing it open. */
  .preview { display: flex; flex-direction: column; min-height: 0; height: 100%; }
  header { display: flex; align-items: flex-start; gap: 0.5rem; padding: 0.5rem; }
  h2 { flex: 1; margin: 0; font-size: 1.15rem; line-height: 1.3; }
  header button {
    background: none; border: none; color: inherit; cursor: pointer;
    font-size: 1.4rem; line-height: 1; padding: 0 0.25rem; opacity: 0.7;
  }
  header button:hover { opacity: 1; }
  .body { flex: 1; min-height: 0; overflow-y: auto; padding: 0 0.5rem 0.75rem; }
  .crumb { margin: 0 0 0.6rem; font-size: 0.85em; opacity: 0.7; }
  h3 { margin: 1rem 0 0.25rem; font-size: 0.95rem; }
  /* Section bodies carry real newlines from the source page; the narrow panel
     needs them kept, where the wide route page can collapse them. */
  .prose { margin: 0.25rem 0; white-space: pre-line; }
  .muted { padding: 0 0.5rem; opacity: 0.6; }
  .failed { padding: 0 0.5rem; color: color-mix(in srgb, crimson 70%, currentColor); }
  .more { display: inline-block; margin-top: 1rem; color: inherit; }
</style>
