<script lang="ts">
  /**
   * The shape of the walk: distance along the bottom, height up the side, and a
   * marker that follows the cursor.
   *
   * On an out-and-back route this is not a nicety — the line covers the same
   * ground twice, so the direction arrows cancel out and this marker is the
   * only thing that shows which way round the walk goes.
   *
   * Inline SVG rather than a charting library: one path, two axes and a marker
   * do not justify a dependency, and this way the colours are the map's own
   * (the same terracotta accent as RouteVariants and the route pins, the same
   * ink as the line-icon halo).
   */
  import { profilePoints, totalDistanceM, type Point3 } from '$lib/map/profile';

  let {
    coords,
    onscrub
  }: { coords: Point3[]; onscrub?: (distanceM: number | null) => void } = $props();

  const WIDTH = 640;
  const HEIGHT = 140;
  const PAD = { top: 8, right: 8, bottom: 18, left: 34 };

  let points = $derived(profilePoints(coords));
  let totalM = $derived(totalDistanceM(coords));
  let lowest = $derived(points.length ? Math.min(...points.map((p) => p.elevationM)) : 0);
  let highest = $derived(points.length ? Math.max(...points.map((p) => p.elevationM)) : 0);
  let climb = $derived(Math.round(highest - lowest));
  let marker = $state<number | null>(null);

  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;

  const x = (distanceM: number) => PAD.left + (totalM ? (distanceM / totalM) * plotW : 0);
  const y = (elevationM: number) => {
    const span = highest - lowest || 1;
    return PAD.top + plotH - ((elevationM - lowest) / span) * plotH;
  };

  let line = $derived(
    points
      .map((p, i) => `${i ? 'L' : 'M'}${x(p.distanceM).toFixed(1)} ${y(p.elevationM).toFixed(1)}`)
      .join(' ')
  );

  function report(distanceM: number | null): void {
    marker = distanceM;
    onscrub?.(distanceM);
  }

  function fromPointer(event: PointerEvent): void {
    const svg = event.currentTarget as SVGSVGElement;
    const box = svg.getBoundingClientRect();
    // jsdom reports a zero-width box; guard so the component is testable.
    const usable = box.width || WIDTH;
    const fraction = (((event.clientX - box.left) / usable) * WIDTH - PAD.left) / plotW;
    report(Math.min(Math.max(fraction, 0), 1) * totalM);
  }

  function step(event: KeyboardEvent): void {
    const delta = totalM / 40;
    if (event.key === 'ArrowRight') report(Math.min((marker ?? 0) + delta, totalM));
    else if (event.key === 'ArrowLeft') report(Math.max((marker ?? 0) - delta, 0));
    else return;
    event.preventDefault();
  }

  // Nearest sampled point to the marker distance, for the dot on the line and
  // the elevation read out in the caption — not an interpolation, since the
  // underlying samples are themselves an approximation.
  let markerPoint = $derived.by(() => {
    if (marker === null || !points.length) return null;
    let nearest = points[0];
    for (const p of points) {
      if (Math.abs(p.distanceM - marker) < Math.abs(nearest.distanceM - marker)) nearest = p;
    }
    return nearest;
  });
</script>

{#if points.length}
  <figure class="profile">
    <svg
      viewBox="0 0 {WIDTH} {HEIGHT}"
      role="slider"
      tabindex="0"
      aria-label="Elevation profile: {(totalM / 1000).toFixed(1)} km, about {climb} m of climb. Use the arrow keys to move the marker along the walk."
      aria-valuemin="0"
      aria-valuemax={totalM}
      aria-valuenow={marker ?? 0}
      aria-valuetext={markerPoint
        ? `${(markerPoint.distanceM / 1000).toFixed(2)} km, ${Math.round(markerPoint.elevationM)} m`
        : 'no point selected'}
      onpointermove={fromPointer}
      onpointerleave={() => report(null)}
      onkeydown={step}
    >
      <path class="fill" d="{line} L{x(totalM)} {PAD.top + plotH} L{PAD.left} {PAD.top + plotH} Z" />
      <path class="line" data-testid="profile-line" d={line} />
      <text class="tick" x="2" y={y(highest) + 4}>{Math.round(highest)}</text>
      <text class="tick" x="2" y={y(lowest) + 4}>{Math.round(lowest)}</text>
      {#if markerPoint}
        <line
          class="guide"
          x1={x(markerPoint.distanceM)}
          y1={PAD.top}
          x2={x(markerPoint.distanceM)}
          y2={PAD.top + plotH}
        />
        <circle class="marker" cx={x(markerPoint.distanceM)} cy={y(markerPoint.elevationM)} r="4" />
      {/if}
    </svg>
    <figcaption>
      {(totalM / 1000).toFixed(1)} km · ≈ {climb} m of climb
      {#if markerPoint}
        · at {(markerPoint.distanceM / 1000).toFixed(2)} km: {Math.round(markerPoint.elevationM)} m
      {/if}
    </figcaption>
  </figure>
{/if}

<style>
  .profile {
    margin: 1rem 0;
  }
  svg {
    width: 100%;
    height: auto;
    display: block;
    touch-action: none;
  }
  svg:focus-visible {
    outline: 2px solid #c2410c;
    outline-offset: 2px;
  }
  /* Area wash at ~10% opacity: the series colour, never saturated. */
  .fill {
    fill: color-mix(in srgb, #c2410c 10%, transparent);
    stroke: none;
  }
  .line {
    fill: none;
    stroke: #c2410c;
    stroke-width: 2;
    stroke-linejoin: round;
    stroke-linecap: round;
  }
  /* Recessive guide, hairline, one step off the surface. */
  .guide {
    stroke: #3f2d1d;
    stroke-width: 1;
    opacity: 0.35;
  }
  /* End-marker: >=8px, filled with the series colour, ringed in the surface
     colour so it stays legible where it sits on the line. */
  .marker {
    fill: #c2410c;
    stroke: #f7f3ec;
    stroke-width: 2;
  }
  .tick {
    font-size: 10px;
    fill: currentColor;
    opacity: 0.6;
  }
  figcaption {
    font-size: 0.82em;
    opacity: 0.75;
    padding-top: 0.3rem;
    font-variant-numeric: tabular-nums;
  }
</style>
