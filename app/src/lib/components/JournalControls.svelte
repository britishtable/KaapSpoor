<script lang="ts">
  import { journal, setEntry } from '../journal/store';
  import type { JournalEntry, JournalPlan } from '../data/types';
  let { routeId, plan }: { routeId: string; plan?: JournalPlan } = $props();
  let entry = $derived<JournalEntry>(
    $journal.get(routeId) ?? { routeId, done: false, date: null, notes: '', ...(plan ? { plan } : {}) }
  );

  // Toggling here rather than through the store's toggleDone keeps the plan
  // this route was resolved to attached to the entry it writes — toggleDone
  // only knows a routeId, not which plan the reader is currently looking at.
  function toggle(): void {
    void setEntry({ ...entry, done: !entry.done });
  }
</script>

<fieldset class="journal">
  <legend>Journal</legend>
  <label>
    <input type="checkbox" checked={entry.done} onchange={toggle} aria-label="Mark done" />
    Done
  </label>
  <label>Date
    <input type="date" value={entry.date ?? ''}
      onchange={(e) => setEntry({ ...entry, date: (e.currentTarget as HTMLInputElement).value || null })} />
  </label>
  <label>Notes
    <textarea value={entry.notes}
      onchange={(e) => setEntry({ ...entry, notes: (e.currentTarget as HTMLTextAreaElement).value })}></textarea>
  </label>
</fieldset>

<style>
  .journal { display: flex; flex-direction: column; gap: 0.6rem; margin-top: 1.5rem; }
  textarea { width: 100%; min-height: 4rem; }
</style>
