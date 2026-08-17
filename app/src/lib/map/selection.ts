import { writable, type Readable } from 'svelte/store';

export interface SelectionState {
  hoveredId: string | null;
  selectedId: string | null;
  /** The variant name the reader is pointing at in the panel, if any. */
  hoveredVariant: string | null;
}

const EMPTY: SelectionState = { hoveredId: null, selectedId: null, hoveredVariant: null };

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
  // Clearing hover avoids two highlights surviving a click; clearing the
  // variant avoids a name from the previous route lighting a line on this one,
  // since variant names repeat across entries.
  state.set({ hoveredId: null, selectedId: id, hoveredVariant: null });
}

export function setHoveredVariant(name: string | null): void {
  state.update((s) => ({ ...s, hoveredVariant: name }));
}

export function clearSelection(): void {
  state.set({ ...EMPTY });
}
