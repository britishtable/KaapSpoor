import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import RoutePlan from './RoutePlan.svelte';
import { resolvePlan, type PlanSegment } from '$lib/data/plan';
import type { Point3 } from '$lib/map/profile';

const P = (lon: number, h: number): Point3 => [lon, -33.96, h];
const seg = (id: string, role: 'approach' | 'main' | 'exit', name: string, coords: Point3[]):
  PlanSegment => ({ segmentId: id, role, name, note: null, coords });

const SEGMENTS = [
  seg('k', 'approach', 'via Kasteelspoort', [P(18.40, 50), P(18.41, 300)]),
  seg('d', 'approach', 'via Diagonal', [P(18.39, 60), P(18.41, 300)]),
  seg('m', 'main', 'Pimple Traverse', [P(18.41, 300), P(18.43, 500)]),
  seg('x', 'exit', 'via Kasteelspoort', [P(18.43, 500), P(18.45, 100)])
];

describe('RoutePlan', () => {
  it('shows the three rows in walking order', () => {
    const { container } = render(RoutePlan, { plan: resolvePlan(SEGMENTS), onchange: vi.fn() });
    // Row LABELS, not comboboxes: a role with one option renders as plain
    // text, so asking for comboboxes here would contradict the next test.
    const roles = [...container.querySelectorAll('.role')].map((el) => el.textContent?.trim());
    expect(roles).toEqual(['Approach', 'Main', 'Exit']);
  });

  it('reverses the row ORDER too, not only the labels', () => {
    // Walking order is the whole reason the rows are stacked this way — it is
    // what lines them up with the profile beneath, which always runs
    // start-to-finish. Reversed, the walk begins at the exit.
    const { container } = render(RoutePlan, {
      plan: resolvePlan(SEGMENTS, { reversed: true }), onchange: vi.fn()
    });
    const roles = [...container.querySelectorAll('.role')].map((el) => el.textContent?.trim());
    expect(roles).toEqual(['Start', 'Main', 'Finish']);
  });

  it('offers a select only where there is a choice to make', () => {
    render(RoutePlan, { plan: resolvePlan(SEGMENTS), onchange: vi.fn() });
    // Two approaches, so a select; one main and one exit, so plain labels.
    expect(screen.getAllByRole('combobox')).toHaveLength(1);
    expect(screen.getByText('Pimple Traverse')).toBeTruthy();
  });

  it('reports a new choice upward rather than resolving it itself', async () => {
    const onchange = vi.fn();
    render(RoutePlan, { plan: resolvePlan(SEGMENTS), onchange });
    await fireEvent.change(screen.getByLabelText('Approach'), { target: { value: 'd' } });
    expect(onchange).toHaveBeenCalledWith(expect.objectContaining({ approach: 'd', main: 'm' }));
  });

  it('flips the walk when reverse is pressed', async () => {
    const onchange = vi.fn();
    render(RoutePlan, { plan: resolvePlan(SEGMENTS), onchange });
    await fireEvent.click(screen.getByRole('button', { name: /reverse/i }));
    expect(onchange).toHaveBeenCalledWith(expect.objectContaining({ reversed: true }));
  });

  it('relabels the rows for a reversed walk', () => {
    render(RoutePlan, { plan: resolvePlan(SEGMENTS, { reversed: true }), onchange: vi.fn() });
    expect(screen.getByText('Finish')).toBeTruthy();
    expect(screen.queryByText('Approach')).toBeNull();
  });

  it('shows each row its own distance and climb', () => {
    render(RoutePlan, { plan: resolvePlan(SEGMENTS), onchange: vi.fn() });
    expect(screen.getByText(/↑ 250 m/)).toBeTruthy();
  });

  it('shows a flat row’s 0 m climb rather than omitting it (M6: 0 and "not measured" are different claims)', () => {
    // A flat exit -- same height at both ends, so its ascent/descent are 0,
    // not null. `{#if s.ascentM}` treated 0 as falsy and hid the figure,
    // exactly as if the segment carried no heights at all; `!== null` is
    // what the header two lines above already used.
    const flatExit = seg('e', 'exit', 'Flat Path', [P(18.43, 500), P(18.45, 500)]);
    const segments = [SEGMENTS[2], flatExit];
    const { container } = render(RoutePlan, { plan: resolvePlan(segments), onchange: vi.fn() });
    const rows = [...container.querySelectorAll('li')];
    const exitRow = rows.find((li) => li.textContent?.includes('Flat Path'));
    const figures = exitRow?.querySelector('.figures')?.textContent ?? '';
    expect(figures).toContain('↑ 0 m');
    expect(figures).toContain('↓ 0 m');
  });

  it('renders nothing at all for a route with no main', () => {
    const { container } = render(RoutePlan, {
      plan: resolvePlan([SEGMENTS[0]]), onchange: vi.fn()
    });
    expect(container.querySelector('.plan')).toBeNull();
  });
});
