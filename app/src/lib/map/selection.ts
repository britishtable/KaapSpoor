import { writable, type Readable } from 'svelte/store';

export interface SelectionState {
  hoveredId: string | null;
  selectedId: string | null;
}

const EMPTY: SelectionState = { hoveredId: null, selectedId: null };

// Private writable; only the setters below may mutate it.
const state = writable<SelectionState>({ ...EMPTY });

// Exported read-only so the setters' invariants (notably: selecting clears the
// hover) cannot be bypassed by a consumer calling .set() directly. `$selection`
// auto-subscription still works — it only needs `subscribe`.
export const selection: Readable<SelectionState> = { subscribe: state.subscribe };

export function setHovered(id: string | null): void {
  state.update((s) => ({ ...s, hoveredId: id }));
}

export function setSelected(id: string | null): void {
  // Clearing hover avoids two highlights surviving a click.
  state.set({ hoveredId: null, selectedId: id });
}

export function clearSelection(): void {
  state.set({ ...EMPTY });
}
