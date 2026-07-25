<script lang="ts">
  import { journal, setEntry, toggleDone } from '../journal/store';
  import type { JournalEntry } from '../data/types';
  let { routeId }: { routeId: string } = $props();
  let entry = $derived<JournalEntry>(
    $journal.get(routeId) ?? { routeId, done: false, date: null, notes: '' }
  );
</script>

<fieldset class="journal">
  <legend>Journal</legend>
  <label>
    <input type="checkbox" checked={entry.done} onchange={() => toggleDone(routeId)} aria-label="Mark done" />
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
