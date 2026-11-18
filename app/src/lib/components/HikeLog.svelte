<script lang="ts">
  import { base } from '$app/paths';
  import {
    activeHike, hikesForRoute, routeNotes, setRouteNotes, startHike, finishHike,
    logHike, updateHike, deleteHike, ActiveHikeError
  } from '../journal/store';
  import type { Hike, JournalPlan, Visibility } from '../data/types';

  let { routeId, plan }: { routeId: string; plan?: JournalPlan } = $props();

  let hikes = $derived(hikesForRoute(routeId));
  let active = $derived($activeHike);
  let activeHere = $derived(active !== null && active.routeId === routeId);
  let activeElsewhere = $derived(active !== null && active.routeId !== routeId);

  let finished = $state(false);
  let error = $state('');

  const dateFmt = new Intl.DateTimeFormat('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
  const timeFmt = new Intl.DateTimeFormat('en-ZA', { hour: '2-digit', minute: '2-digit', hour12: false });

  /** "2026-07-21" as a LOCAL date: new Date('2026-07-21') is UTC midnight and can show the day before. */
  function formatDate(iso: string): string {
    const [y, m, d] = iso.split('-').map(Number);
    return dateFmt.format(new Date(y, m - 1, d));
  }
  function formatTime(iso: string): string {
    return timeFmt.format(new Date(iso)).replace(/\s/g, '').replace('.', ':');
  }

  async function start(): Promise<void> {
    error = '';
    finished = false;
    try {
      await startHike(routeId, plan);
    } catch (e) {
      error = e instanceof ActiveHikeError ? "You're already on a hike." : "Couldn't start the hike on this device.";
    }
  }
  async function finish(): Promise<void> {
    if (!active) return;
    error = '';
    try {
      await finishHike(active.id);
      finished = true;
    } catch {
      error = "Couldn't save that on this device.";
    }
  }

  // ---- form (shared by "Log a past hike" and Edit) ----
  let formFor = $state<'new' | string | null>(null);
  let fDate = $state('');
  let fUnknown = $state(false);
  let fNotes = $state('');
  let fVis = $state<Visibility>('PRIVATE');
  let fNotesVis = $state<Visibility>('PRIVATE');

  function openNew(): void {
    fDate = ''; fUnknown = false; fNotes = ''; fVis = 'PRIVATE'; fNotesVis = 'PRIVATE';
    formFor = 'new';
  }
  function openEdit(h: Hike): void {
    fDate = h.date ?? ''; fUnknown = h.date === null; fNotes = h.notes;
    fVis = h.visibility; fNotesVis = h.notesVisibility;
    formFor = h.id;
  }
  async function save(e: Event): Promise<void> {
    e.preventDefault();
    error = '';
    const date = fUnknown || !fDate ? null : fDate;
    try {
      if (formFor === 'new') {
        await logHike({ routeId, date, notes: fNotes, visibility: fVis, notesVisibility: fNotesVis, plan });
      } else if (formFor) {
        await updateHike(formFor, { date, notes: fNotes, visibility: fVis, notesVisibility: fNotesVis });
      }
      formFor = null;
    } catch {
      error = "Couldn't save that on this device. Your entry is still here.";
    }
  }

  let confirming = $state<string | null>(null);
  async function remove(id: string): Promise<void> {
    try {
      await deleteHike(id);
      confirming = null;
    } catch {
      error = "Couldn't delete that on this device.";
    }
  }

  let planningNotes = $derived($routeNotes.get(routeId)?.notes ?? '');
  async function saveNotes(e: Event & { currentTarget: HTMLTextAreaElement }): Promise<void> {
    try {
      await setRouteNotes(routeId, e.currentTarget.value, plan);
    } catch {
      error = "Couldn't save the planning notes on this device.";
    }
  }

  const clip = (s: string) => (s.length > 140 ? `${s.slice(0, 140)}…` : s);
</script>

{#snippet hikeForm()}
  <form class="form" onsubmit={save}>
    <div class="field">
      <label for="hl-date">Date</label>
      <input id="hl-date" type="date" bind:value={fDate} disabled={fUnknown} />
      <label class="check">
        <input type="checkbox" bind:checked={fUnknown} onchange={() => { if (fUnknown) fDate = ''; }} />
        I don't remember the date
      </label>
    </div>
    <div class="field">
      <label for="hl-notes">Notes</label>
      <textarea id="hl-notes" rows="3" bind:value={fNotes}></textarea>
    </div>
    <div class="field">
      <label for="hl-vis">Who can see this hike</label>
      <select id="hl-vis" bind:value={fVis}>
        <option value="PRIVATE">Private</option><option value="FRIENDS">Friends</option><option value="PUBLIC">Public</option>
      </select>
    </div>
    <div class="field">
      <label for="hl-nvis">Who can see the notes</label>
      <select id="hl-nvis" bind:value={fNotesVis}>
        <option value="PRIVATE">Private</option><option value="FRIENDS">Friends</option><option value="PUBLIC">Public</option>
      </select>
    </div>
    <p class="hint">For now only you can see your hikes. This choice applies once sharing arrives.</p>
    <div class="row">
      <button type="submit" class="primary">Save hike</button>
      <button type="button" onclick={() => (formFor = null)}>Cancel</button>
    </div>
  </form>
{/snippet}

<section class="hikelog">
  {#if activeHere && active}
    <p class="since">Hike in progress since {formatTime(active.startedAt ?? active.updatedAt)}</p>
    <button type="button" class="wide primary" onclick={finish}>Finish hike</button>
  {:else if activeElsewhere && active}
    <p class="since">You're on a hike on another route.</p>
    <a class="btn wide" href="{base}/route/{active.routeId}">Go to it</a>
  {:else}
    {#if finished}<p class="since" role="status">Hike finished. Nice one.</p>{/if}
    <button type="button" class="wide primary" onclick={start}>Start hike</button>
  {/if}
  {#if error}<p class="err" role="alert">{error}</p>{/if}

  <button type="button" class="disclosure" aria-expanded={formFor === 'new'}
    onclick={() => (formFor === 'new' ? (formFor = null) : openNew())}>Log a past hike</button>
  {#if formFor === 'new'}{@render hikeForm()}{/if}

  <h2>Your hikes here</h2>
  {#if $hikes.length === 0}
    <p class="empty">No hikes logged here yet.</p>
  {:else}
    <ul class="hikes">
      {#each $hikes as h (h.id)}
        <li>
          {#if formFor === h.id}
            {@render hikeForm()}
          {:else}
            <div class="head">
              <strong>{h.date ? formatDate(h.date) : 'Date not recorded'}</strong>
              {#if active?.id === h.id}<span class="tag">In progress</span>{/if}
            </div>
            {#if h.notes}<p class="notes">{clip(h.notes)}</p>{/if}
            {#if h.syncError}<p class="err">Couldn't sync: {h.syncError}</p>{/if}
            {#if confirming === h.id}
              <div class="row">
                <span class="ask">Delete this hike?</span>
                <button type="button" class="danger" onclick={() => remove(h.id)}>Delete</button>
                <button type="button" onclick={() => (confirming = null)}>Keep</button>
              </div>
            {:else}
              <div class="row">
                <button type="button" onclick={() => openEdit(h)}>Edit</button>
                <button type="button" onclick={() => (confirming = h.id)}>Delete</button>
              </div>
            {/if}
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  <h2>Planning notes</h2>
  <label class="sr" for="hl-plan">Planning notes</label>
  <textarea id="hl-plan" rows="3" value={planningNotes} onchange={saveNotes}></textarea>
  <p class="hint">Only on this device for now.</p>
</section>

<style>
  .hikelog { margin-top: 1.5rem; display: grid; gap: 0.6rem; }
  h2 { margin: 1rem 0 0; }
  button, .btn {
    min-height: 48px; padding: 0 1rem; font: inherit; cursor: pointer; box-sizing: border-box;
    border: 1px solid color-mix(in srgb, currentColor 35%, transparent); border-radius: 0.4rem;
    background: transparent; color: inherit; display: inline-flex; align-items: center; justify-content: center;
    text-decoration: none;
  }
  .wide { width: 100%; }
  .primary { background: #c2410c; border-color: #c2410c; color: #fff; font-weight: 600; }
  .danger { border-color: #b91c1c; color: #b91c1c; }
  .disclosure { justify-content: flex-start; width: 100%; }
  button:focus-visible, .btn:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible {
    outline: 3px solid #c2410c; outline-offset: 2px;
  }
  .since { margin: 0; font-weight: 600; }
  .err { margin: 0; color: #b91c1c; font-size: 0.9em; }
  .hint, .empty { margin: 0; font-size: 0.85em; opacity: 0.75; }
  .form { display: grid; gap: 0.75rem; }
  .field { display: grid; gap: 0.3rem; }
  .field label:not(.check) { font-weight: 600; }
  input[type='date'], select, textarea {
    font: inherit; min-height: 48px; padding: 0.4rem 0.6rem; box-sizing: border-box; width: 100%;
    border: 1px solid color-mix(in srgb, currentColor 35%, transparent); border-radius: 0.4rem;
    background: transparent; color: inherit;
  }
  textarea { min-height: 6rem; }
  .check { display: flex; align-items: center; gap: 0.6rem; min-height: 48px; }
  .check input { width: 1.25rem; height: 1.25rem; }
  .row { display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center; }
  .ask { font-weight: 600; }
  .hikes { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.6rem; }
  .hikes li { padding: 0.25rem 0.6rem; border-left: 3px solid #c2410c; display: grid; gap: 0.3rem; }
  .head { display: flex; gap: 0.6rem; align-items: baseline; }
  .tag { font-size: 0.8em; padding: 0 0.4rem; border: 1px solid #c2410c; border-radius: 0.3rem; color: #c2410c; }
  .notes { margin: 0; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
</style>
