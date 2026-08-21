<script lang="ts">
  import { journal, setEntry } from '../journal/store';
  import type { JournalEntry, JournalPlan } from '../data/types';
  let { routeId, plan }: { routeId: string; plan?: JournalPlan } = $props();
  let entry = $derived<JournalEntry>(
    $journal.get(routeId) ?? { routeId, done: false, date: null, notes: '' }
  );

  // Ticking Done attaches the plan currently on screen, replacing any plan
  // already stored — a re-tick after changing the plan should record what is
  // now shown, not what was recorded last time. Un-ticking, and ticking a
  // route with nothing drawn (plan is undefined), leave the stored plan
  // untouched: neither is a statement about which way they went.
  function toggle(): void {
    const turningOn = !entry.done;
    const next: JournalEntry = { ...entry, done: turningOn };
    if (turningOn && plan) next.plan = plan;
    void setEntry(next);
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
