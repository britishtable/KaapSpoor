<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { base } from '$app/paths';
  import { session } from '$lib/account/session';
  import { activeHike } from '$lib/journal/store';
  import type { Point3 } from '$lib/map/profile';
  import ReportForm from './ReportForm.svelte';

  /**
   * The route page's reporting: the entry point, the form, and the hand-off to the locator map's
   * pick mode. The page renders the map; this reports what the map should do through callbacks.
   */
  let { routeId, lineCoords, hasLocation, onmapmode, onspot, onmapview }: {
    routeId: string;
    lineCoords: Point3[];
    hasLocation: boolean;
    /** Called with a tap handler to put the map in pick mode, or null to take it out. */
    onmapmode: (handler: ((p: [number, number]) => void) | null) => void;
    /** The spot the form has chosen (snapped if snapped), to keep marked on the map; null clears it. */
    onspot: (p: [number, number] | null) => void;
    /** Asks the page to bring the map into view. */
    onmapview?: () => void;
  } = $props();

  let reporting = $state(false);
  let root: HTMLElement | undefined;
  // Deliberately not reactive: nothing here should re-run when a pick starts or ends.
  let pending: ((p: [number, number] | null) => void) | null = null;

  /** The hike this report belongs to: only the one in progress on THIS route. */
  let hikeId = $derived($activeHike && $activeHike.routeId === routeId ? $activeHike.id : null);

  function endPick(p: [number, number] | null): void {
    const done = pending;
    pending = null;
    onmapmode(null);
    done?.(p);
  }
  function requestPick(): Promise<[number, number] | null> {
    endPick(null);
    return new Promise((resolve) => {
      pending = resolve;
      onmapmode((p) => endPick(p));
      onmapview?.();
    });
  }

  export async function open(): Promise<void> {
    reporting = true;
    await tick();
    root?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  }
  function close(): void {
    endPick(null);
    onspot(null);
    reporting = false;
  }
  onDestroy(() => { endPick(null); onspot(null); });
</script>

<div class="report" bind:this={root}>
  {#if !$session}
    <a class="btn wide" href="{base}/account">Sign in to report what you see.</a>
  {:else if reporting}
    <ReportForm {routeId} {lineCoords} {hasLocation} activeHikeId={hikeId}
      onpickrequest={requestPick} oncancelpick={() => endPick(null)} {onspot} onclose={close} />
  {:else}
    <button type="button" class="wide" onclick={open}>Report something on this route</button>
  {/if}
</div>

<style>
  .report { margin-top: 1.5rem; }
  .report :global(.btn), .report > button {
    min-height: 48px; padding: 0 1rem; font: inherit; cursor: pointer; box-sizing: border-box; width: 100%;
    border: 1px solid color-mix(in srgb, currentColor 35%, transparent); border-radius: 0.4rem;
    background: transparent; color: inherit; display: inline-flex; align-items: center; justify-content: center;
    text-decoration: none;
  }
</style>
