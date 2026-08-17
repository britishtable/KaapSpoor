import { render, screen, fireEvent } from '@testing-library/svelte';
import { describe, it, expect, vi } from 'vitest';
import RouteProfile from './RouteProfile.svelte';
import { totalDistanceM, type Point3 } from '$lib/map/profile';

const climb: Point3[] = [
  [18.4, -34.0, 100],
  [18.401, -34.0, 200],
  [18.402, -34.0, 400]
];

// Climbs to 400, drops back to 100, climbs to 400 again: cumulative ascent is
// 300 + 300 = 600 m, but max - min is only 300 m. A component that reports
// elevation range instead of ascent would render "≈ 300 m" here too.
const upDownUp: Point3[] = [
  [18.4, -34.0, 100],
  [18.401, -34.0, 400],
  [18.402, -34.0, 100],
  [18.403, -34.0, 400]
];

describe('RouteProfile', () => {
  it('renders nothing when the line carries no heights', () => {
    // Lines drawn before sampling existed must not produce an empty chart
    // frame that looks broken.
    const { container } = render(RouteProfile, { coords: [[18.4, -34.0], [18.401, -34.0]] });
    expect(container.querySelector('svg')).toBeNull();
  });

  it('draws a path across the whole width for a line with heights', () => {
    const { container } = render(RouteProfile, { coords: climb });
    const path = container.querySelector('path[data-testid="profile-line"]');
    expect(path).not.toBeNull();
    expect(path!.getAttribute('d')!.length).toBeGreaterThan(10);
  });

  it('states the climb and the distance as text, not only as a picture', () => {
    // A chart conveys nothing to a screen reader, and nothing where SVG fails.
    render(RouteProfile, { coords: climb });
    expect(screen.getByText(/≈ 300 m/)).toBeTruthy();
  });

  it('reports cumulative ascent, not the elevation range, when the line climbs, drops and climbs again', () => {
    render(RouteProfile, { coords: upDownUp });
    expect(screen.getByText(/≈ 600 m/)).toBeTruthy();
    expect(screen.queryByText(/≈ 300 m/)).toBeNull();
  });

  it('reports the distance under the cursor while scrubbing', () => {
    const onscrub = vi.fn();
    const { container } = render(RouteProfile, { coords: climb, onscrub });
    const svg = container.querySelector('svg')!;
    // jsdom's getBoundingClientRect returns an all-zero box, so the component
    // falls back to usable = WIDTH (640, the viewBox width). With
    // PAD.left = 34, PAD.right = 8, plotW = 640 - 34 - 8 = 598:
    //   fraction = ((clientX - box.left) / usable * WIDTH - PAD.left) / plotW
    //            = ((333 - 0) / 640 * 640 - 34) / 598
    //            = (333 - 34) / 598 = 0.5
    // i.e. clientX 333 lands exactly at the midpoint of the plotted line, so
    // the reported distance should be exactly half the total.
    //
    // fireEvent.pointerMove builds a real PointerEvent, which this jsdom does
    // not implement — it silently falls back to a bare Event that drops
    // clientX. Dispatch a MouseEvent with type 'pointermove' instead: the
    // component's onpointermove listener matches by event type, not
    // constructor, and MouseEvent does carry clientX in jsdom.
    fireEvent(
      svg,
      new MouseEvent('pointermove', { clientX: 333, clientY: 10, bubbles: true, cancelable: true })
    );
    expect(onscrub).toHaveBeenCalledWith(totalDistanceM(climb) / 2);
  });

  it('clears the marker when the pointer leaves', () => {
    const onscrub = vi.fn();
    const { container } = render(RouteProfile, { coords: climb, onscrub });
    fireEvent.pointerLeave(container.querySelector('svg')!);
    expect(onscrub).toHaveBeenLastCalledWith(null);
  });

  it('steps the marker with the keyboard', () => {
    // The profile is the direction indicator for an out-and-back route, so it
    // cannot be mouse-only.
    const onscrub = vi.fn();
    const { container } = render(RouteProfile, { coords: climb, onscrub });
    const svg = container.querySelector('svg')!;
    fireEvent.keyDown(svg, { key: 'ArrowRight' });
    expect(onscrub).toHaveBeenCalled();
  });
});
