<script lang="ts">
  /** Where the hiker is, in words: the same facts the map's dot and the profile's marker show. */
  import { formatDistance } from '$lib/map/profile';
  import { STALE_S, type RouteStatus } from '$lib/position/route-status';
  import type { PositionProblem } from '$lib/position/source';

  let { status, on, problem, ontoggle }: {
    status: RouteStatus | null;
    on: boolean;
    problem: PositionProblem | null;
    ontoggle?: () => void;
  } = $props();

  const PROBLEMS: Record<PositionProblem, string> = {
    denied: "Location is off for this site. You can turn it on in your browser's settings.",
    unavailable: "Couldn't get your location just now. It will keep trying.",
    insecure: 'Location needs a secure (https) page.'
  };

  let line = $derived.by(() => {
    if (!status) return problem ? null : 'Finding where you are';
    switch (status.kind) {
      case 'on': return 'On route';
      case 'off': return `Off route by ${formatDistance(status.offM)}`;
      case 'rough': return `Waiting for a better GPS fix (±${Math.round(status.accuracy)} m)`;
      case 'noline': return status.toPinM === null
        ? 'Your position is on the map'
        : `${formatDistance(status.toPinM)} to the route pin, as the crow flies`;
    }
  });
  // A rough fix works nothing out; the last good distances stay, greyed.
  let measured = $derived(status?.kind === 'rough' ? status.prevGood : status);
  let distances = $derived(
    measured && (measured.kind === 'on' || measured.kind === 'off')
      ? `${formatDistance(measured.doneM)} done · ${formatDistance(measured.remainingM)} to go`
      : null
  );
</script>

<section class="live" aria-label="Where you are">
  <button type="button" aria-pressed={on} onclick={() => ontoggle?.()}>
    {on ? 'Stop showing where I am' : 'Show where I am'}
  </button>
  {#if on}
    {#if line}
      <p class="status" class:off={status?.kind === 'off'} class:quiet={!status || status.kind === 'rough'} role="status">{line}</p>
    {/if}
    {#if distances}
      <p class="distances" class:stale={status?.kind === 'rough'} data-testid="live-distances">{distances}</p>
    {/if}
    {#if status && status.ageS > STALE_S}
      <p class="age" data-testid="live-age">Last fix {status.ageS} s ago</p>
    {/if}
    {#if problem}<p class="problem" role="status">{PROBLEMS[problem]}</p>{/if}
  {/if}
</section>

<style>
  .live { display: grid; gap: 0.25rem; margin: 0 0 1rem; }
  button {
    min-height: 48px; width: 100%; padding: 0 1rem; font: inherit; cursor: pointer;
    border: 1px solid color-mix(in srgb, currentColor 35%, transparent); border-radius: 0.4rem;
    background: transparent; color: inherit;
  }
  button[aria-pressed='true'] { border: 2px solid var(--ks-here); }
  button:focus-visible { outline: 3px solid #c2410c; outline-offset: 2px; }
  p { margin: 0; font-variant-numeric: tabular-nums; }
  /* Read at arm's length, walking, in sun: the one large line on the page after its title. */
  .status { margin-top: 0.4rem; font-size: 1.4rem; line-height: 1.25; font-weight: 700; }
  .status.off { color: var(--ks-accent-text); }
  .status.quiet { font-size: 1.1rem; font-weight: 600; }
  .distances { font-size: 1.1rem; }
  .distances.stale { color: color-mix(in srgb, currentColor 72%, transparent); }
  .age { font-size: 0.9em; }
  .problem { margin-top: 0.4rem; }
</style>
