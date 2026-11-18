<script lang="ts">
  import { doneRouteIds, logHike } from '../journal/store';
  import type { JournalPlan } from '../data/types';
  // Interim control: Task 5 replaces it with the hike log. Done is now derived
  // from hikes, so ticking logs a hike and the tick locks once the route is done.
  let { routeId, plan }: { routeId: string; plan?: JournalPlan } = $props();
  let done = $derived($doneRouteIds.has(routeId));

  function toggle(): void {
    if (!done) void logHike({ routeId, date: null, notes: '', plan });
  }
</script>

<fieldset class="journal">
  <legend>Journal</legend>
  <label>
    <input type="checkbox" checked={done} disabled={done} onchange={toggle} aria-label="Mark done" />
    Done
  </label>
</fieldset>

<style>
  .journal { display: flex; flex-direction: column; gap: 0.6rem; margin-top: 1.5rem; }
</style>
