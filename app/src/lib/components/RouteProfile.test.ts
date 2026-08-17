import { render, screen, fireEvent } from '@testing-library/svelte';
import { describe, it, expect, vi } from 'vitest';
import RouteProfile from './RouteProfile.svelte';
import type { Point3 } from '$lib/map/profile';

const climb: Point3[] = [
  [18.4, -34.0, 100],
  [18.401, -34.0, 200],
  [18.402, -34.0, 400]
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

  it('reports the distance under the cursor while scrubbing', () => {
    const onscrub = vi.fn();
    const { container } = render(RouteProfile, { coords: climb, onscrub });
    const svg = container.querySelector('svg')!;
    // jsdom gives every element a zero-size box, so the component must read the
    // pointer position defensively rather than assuming a real layout.
    fireEvent.pointerMove(svg, { clientX: 10, clientY: 10 });
    expect(onscrub).toHaveBeenCalled();
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
