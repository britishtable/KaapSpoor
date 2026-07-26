import { writable } from 'svelte/store';

export interface SelectionState {
  hoveredId: string | null;
  selectedId: string | null;
}

const EMPTY: SelectionState = { hoveredId: null, selectedId: null };

export const selection = writable<SelectionState>({ ...EMPTY });

export function setHovered(id: string | null): void {
  selection.update((s) => ({ ...s, hoveredId: id }));
}

export function setSelected(id: string | null): void {
  // Clearing hover avoids two highlights surviving a click.
  selection.set({ hoveredId: null, selectedId: id });
}

export function clearSelection(): void {
  selection.set({ ...EMPTY });
}
