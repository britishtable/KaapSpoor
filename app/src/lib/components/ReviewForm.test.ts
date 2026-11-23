import { render, screen, fireEvent, within } from '@testing-library/svelte';
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import ReviewForm from './ReviewForm.svelte';
import type { Review } from '../data/types';

function setup(over: { review?: Review; graded?: boolean; gradeLevel?: string | null } = {}) {
  const onsave = vi.fn();
  const oncancel = vi.fn();
  render(ReviewForm, { review: undefined, graded: true, gradeLevel: '3', onsave, oncancel, ...over });
  return { onsave, oncancel };
}
const save = () => screen.getByRole('button', { name: 'Save review' }) as HTMLButtonElement;
const chip = (name: string) => screen.getByRole('radio', { name }) as HTMLButtonElement;

describe('ReviewForm', () => {
  it('graded route asks against the grade level', () => {
    setup();
    expect(screen.getByText('Compared with grade 3:')).toBeTruthy();
    expect(chip('Easier')).toBeTruthy();
    expect(chip('As graded')).toBeTruthy();
    expect(chip('Harder')).toBeTruthy();
  });

  it('ungraded route asks easy/moderate/hard', () => {
    setup({ graded: false, gradeLevel: null });
    expect(screen.getByText('How hard was it?')).toBeTruthy();
    expect(chip('Easy')).toBeTruthy();
    expect(chip('Moderate')).toBeTruthy();
    expect(chip('Hard')).toBeTruthy();
    expect(screen.queryByRole('radio', { name: 'Harder' })).toBeNull();
  });

  it('Save disabled until one answer', async () => {
    setup();
    expect(save().disabled).toBe(true);
    await fireEvent.click(chip('Harder'));
    expect(save().disabled).toBe(false);
  });

  it('Save is enabled by a non-blank note alone, not a blank one', async () => {
    setup();
    await fireEvent.click(screen.getByRole('button', { name: 'Add a note' }));
    const note = screen.getByLabelText('Note');
    await fireEvent.input(note, { target: { value: '   ' } });
    expect(save().disabled).toBe(true);
    await fireEvent.input(note, { target: { value: 'Lovely' } });
    expect(save().disabled).toBe(false);
  });

  it('tapping the chosen chip clears it', async () => {
    setup();
    await fireEvent.click(chip('Harder'));
    expect(chip('Harder').getAttribute('aria-checked')).toBe('true');
    await fireEvent.click(chip('Harder'));
    expect(chip('Harder').getAttribute('aria-checked')).toBe('false');
    expect(save().disabled).toBe(true);
  });

  it('arrow keys move the choice within a group', async () => {
    setup();
    await fireEvent.click(chip('Easier'));
    await fireEvent.keyDown(chip('Easier'), { key: 'ArrowRight' });
    expect(chip('As graded').getAttribute('aria-checked')).toBe('true');
  });

  it('what-happened shows for MOSTLY and NO only; its text survives clearing safety and is dropped on save', async () => {
    const { onsave } = setup();
    expect(screen.queryByLabelText('What happened?')).toBeNull();
    await fireEvent.click(chip('Yes'));
    expect(screen.queryByLabelText('What happened?')).toBeNull();
    await fireEvent.click(chip('Mostly'));
    await fireEvent.input(screen.getByLabelText('What happened?'), { target: { value: 'Loose scree' } });
    await fireEvent.click(chip('Mostly')); // accidental clear
    expect(screen.queryByLabelText('What happened?')).toBeNull();
    await fireEvent.click(chip('Mostly'));
    expect((screen.getByLabelText('What happened?') as HTMLTextAreaElement).value).toBe('Loose scree');
    await fireEvent.click(chip('Mostly')); // clear again, then save
    await fireEvent.click(chip('4'));
    await fireEvent.click(save());
    expect(onsave).toHaveBeenCalledWith({ enjoyment: 4 });
    expect(Object.keys(onsave.mock.calls[0][0])).toEqual(['enjoyment']);
  });

  it('keeps the what-happened text with the safety answer on save', async () => {
    const { onsave } = setup();
    await fireEvent.click(chip('Mostly'));
    await fireEvent.input(screen.getByLabelText('What happened?'), { target: { value: 'Loose scree' } });
    await fireEvent.click(save());
    expect(onsave).toHaveBeenCalledWith({ safety: 'MOSTLY', safetyNote: 'Loose scree' });
  });

  it('saves with absent answers omitted', async () => {
    const { onsave } = setup();
    await fireEvent.click(chip('4'));
    await fireEvent.click(save());
    expect(onsave).toHaveBeenCalledTimes(1);
    expect(onsave.mock.calls[0][0]).toEqual({ enjoyment: 4 });
    expect(Object.keys(onsave.mock.calls[0][0])).toEqual(['enjoyment']);
  });

  it('no Remove review on a new review', () => {
    setup();
    expect(screen.queryByRole('button', { name: 'Remove review' })).toBeNull();
  });

  it('Remove review on an existing review calls onsave(null)', async () => {
    const onsave = vi.fn();
    render(ReviewForm, { review: { enjoyment: 5 }, graded: false, gradeLevel: null, onsave, oncancel: () => {} });
    expect(chip('5').getAttribute('aria-checked')).toBe('true');
    await fireEvent.click(screen.getByRole('button', { name: 'Remove review' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Tap again to remove' }));
    expect(onsave).toHaveBeenCalledWith(null);
  });

  it('Remove review needs a second tap, and other interaction resets it', async () => {
    const onsave = vi.fn();
    render(ReviewForm, { review: { enjoyment: 5 }, graded: false, gradeLevel: null, onsave, oncancel: () => {} });
    await fireEvent.click(screen.getByRole('button', { name: 'Remove review' }));
    expect(onsave).not.toHaveBeenCalled();
    await fireEvent.click(chip('3'));
    expect(screen.getByRole('button', { name: 'Remove review' })).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Remove review' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Tap again to remove' }));
    expect(onsave).toHaveBeenCalledTimes(1);
    expect(onsave).toHaveBeenCalledWith(null);
  });

  it('Cancel calls oncancel', async () => {
    const { oncancel } = setup();
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(oncancel).toHaveBeenCalled();
  });

  it('chips are at least 48px', () => {
    // jsdom has no layout: this reads the min-height the component's own CSS declares for .chip,
    // and that the chips carry that class. It cannot prove the rendered size.
    setup();
    const src = readFileSync('src/lib/components/ReviewForm.svelte', 'utf8');
    const rule = /\.chip\s*\{[^}]*min-height:\s*(\d+)px/.exec(src);
    expect(rule).not.toBeNull();
    expect(Number(rule![1])).toBeGreaterThanOrEqual(48);
    const group = screen.getAllByRole('radiogroup')[0];
    for (const c of within(group).getAllByRole('radio')) expect(c.classList.contains('chip')).toBe(true);
  });
});
