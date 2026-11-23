<script lang="ts">
  import { base } from '$app/paths';
  import {
    activeHike, hikesForRoute, routeNotes, setRouteNotes, startHike, finishHike,
    logHike, updateHike, deleteHike, ActiveHikeError, viewer, isLocked,
    setReview, canReview, localDate, ReviewNotAllowedError, InvalidReviewError, LockedHikeError
  } from '../journal/store';
  import { DIFFICULTY_WORDS } from '../reviews/reviews';
  import ReviewForm from './ReviewForm.svelte';
  import { syncState } from '../sync/sync';
  import { session } from '../account/session';
  import { DIFFICULTY_GRADED, DIFFICULTY_UNGRADED } from '../data/types';
  import type { Hike, JournalPlan, Review, Visibility } from '../data/types';
  import { loadRouteReports } from '../reports/reports';
  import { answerReport, pendingOutbox } from '../reports/outbox';
  import { ANSWERS, CATEGORY_COLOURS, CATEGORY_LABELS } from '../reports/labels';
  import { formatAge } from '../reports/age';
  import type { Answer, PublicReport } from '../reports/types';

  let { routeId, plan, graded = false, gradeLevel = null, onreport }: {
    routeId: string; plan?: JournalPlan; graded?: boolean; gradeLevel?: string | null;
    /** Opens the page's report form; the form itself lives on the page, beside the map it can pick from. */
    onreport?: () => void;
  } = $props();

  let hikes = $derived(hikesForRoute(routeId));
  let active = $derived($activeHike);
  let activeHere = $derived(active !== null && active.routeId === routeId);
  let activeElsewhere = $derived(active !== null && active.routeId !== routeId);

  let finished = $state(false);
  let finishedId = $state<string | null>(null);
  let error = $state('');

  const dateFmt = new Intl.DateTimeFormat('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
  const timeFmt = new Intl.DateTimeFormat('en-ZA', { hour: '2-digit', minute: '2-digit', hour12: false });

  /**
   * "2026-07-21" as a LOCAL date: new Date('2026-07-21') is UTC midnight and can show the day before.
   * Anything else is shown as written rather than thrown on.
   */
  function formatDate(iso: string): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    const date = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
    return date && !Number.isNaN(date.getTime()) ? dateFmt.format(date) : iso;
  }
  /** The server accepts dates from 1950 to tomorrow (it allows for time zones ahead of this one). */
  const MIN_DATE = '1950-01-01';
  function tomorrow(): string {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  let maxDate = $state(tomorrow());
  function formatTime(iso: string): string {
    return timeFmt.format(new Date(iso)).replace(/\s/g, '').replace('.', ':');
  }

  async function start(): Promise<void> {
    error = '';
    finished = false;
    finishedId = null;
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
      const id = active.id;
      // Asked only if the hike began today or yesterday, as for a logged hike.
      const began = active.startedAt ? localDate(new Date(active.startedAt)) : null;
      await finishHike(id);
      finishedId = id;
      finished = true;
      if (recent(began)) void askStillThere();
    } catch {
      error = "Couldn't save that on this device.";
    }
  }

  // ---- form (shared by "Log a past hike" and Edit) ----
  // 'new', a hike id (editing it), 'review:<hike id>' (reviewing it), or null.
  let formFor = $state<string | null>(null);
  let reviewError = $state('');
  let fDate = $state('');
  let fUnknown = $state(false);
  let fNotes = $state('');
  let fVis = $state<Visibility>('PRIVATE');
  let fNotesVis = $state<Visibility>('PRIVATE');

  function openNew(): void {
    maxDate = tomorrow();
    fDate = ''; fUnknown = false; fNotes = ''; fVis = 'PRIVATE'; fNotesVis = 'PRIVATE';
    formFor = 'new';
  }
  function openEdit(h: Hike): void {
    maxDate = tomorrow();
    fDate = h.date ?? ''; fUnknown = h.date === null; fNotes = h.notes;
    fVis = h.visibility; fNotesVis = h.notesVisibility;
    formFor = h.id;
  }
  // Closing a form also drops its stale error. Only one form is open at a time:
  // the other entry points (Log a past hike, every Edit) are disabled while one
  // is, so a half-typed draft can never be overwritten by the shared fields.
  function closeForm(): void {
    formFor = null;
    error = '';
    reviewError = '';
  }
  function openReview(h: Hike): void {
    reviewError = '';
    formFor = `review:${h.id}`;
  }
  async function saveReview(id: string, review: Review | null): Promise<void> {
    reviewError = '';
    try {
      await setReview(id, review);
      closeForm();
    } catch (e) {
      reviewError = e instanceof InvalidReviewError ? e.message
        : e instanceof ReviewNotAllowedError ? "This hike can't be reviewed yet. Finish it first, and check its date."
        : e instanceof LockedHikeError ? e.message
        : "Couldn't save that on this device. Your answers are still here.";
    }
  }
  function reviewSummary(r: Review): string {
    const parts: string[] = [];
    const scale: readonly string[] = graded ? DIFFICULTY_GRADED : DIFFICULTY_UNGRADED;
    if (r.difficulty && scale.includes(r.difficulty)) parts.push(DIFFICULTY_WORDS[r.difficulty]);
    if (r.enjoyment !== undefined) parts.push(`${r.enjoyment}/5`);
    return parts.length ? parts.join(' · ') : 'Reviewed';
  }
  let today = $state(localDate());
  let finishedHike = $derived(finishedId ? $hikes.find((h) => h.id === finishedId) : undefined);
  async function save(e: Event): Promise<void> {
    e.preventDefault();
    error = '';
    const date = fUnknown || !fDate ? null : fDate;
    try {
      if (formFor === 'new') {
        await logHike({ routeId, date, notes: fNotes, visibility: fVis, notesVisibility: fNotesVis, plan });
        if (recent(date)) void askStillThere();
      } else if (formFor) {
        await updateHike(formFor, { date, notes: fNotes, visibility: fVis, notesVisibility: fNotesVis });
      }
      closeForm();
    } catch (e) {
      error = e instanceof ReviewNotAllowedError
        ? "This hike has a review, so its date can't be in the future. Pick another date or remove the review."
        : "Couldn't save that on this device. Your entry is still here.";
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

  // Signed out, hikes saved to an account are shown but read-only: anyone may hold the phone.
  let anyLocked = $derived($hikes.some((h) => isLocked(h, $viewer)));

  // ---- "Still there?" ----
  // Asked once, right after a hike here ends or is logged: the reader has just been on the route,
  // so what others reported is worth checking. Nothing is sent unless an answer is tapped.
  // Only for a hike dated (logged) or started (finished) today or yesterday: "Still there" from
  // someone who was here last month would mark a report as freshly confirmed when nobody has seen it lately.
  function recent(date: string | null): boolean {
    if (!date) return false;
    const y = new Date();
    y.setDate(y.getDate() - 1);
    return date === localDate() || date === localDate(y);
  }
  let stillThere = $state<PublicReport[]>([]);
  let stAnswers = $state<Record<string, Answer>>({});
  let stError = $state('');
  let stNow = $state(new Date());
  let askedFor = 0;
  async function askStillThere(): Promise<void> {
    const me = $session?.id;
    if (!me) return; // answering needs an account
    const ask = ++askedFor;
    const r = await loadRouteReports(routeId);
    if (ask !== askedFor || typeof r === 'string') return;
    // Own: every report the server knows as ours, and any of ours still waiting to send.
    const own = new Set([...r.mineIds, ...r.mineHeld.map((h) => h.id),
      ...$pendingOutbox.flatMap((i) => (i.kind === 'report' ? [i.id] : []))]);
    stNow = new Date();
    stAnswers = {};
    stError = '';
    stillThere = r.active.filter((x) => !own.has(x.id));
  }
  async function answerStillThere(id: string, a: Answer): Promise<void> {
    stError = '';
    try {
      await answerReport(id, a);
      stAnswers = { ...stAnswers, [id]: a };
    } catch {
      stError = "Couldn't save that answer on this device.";
    }
  }
  function closeStillThere(): void {
    askedFor++;
    stillThere = [];
  }
  let stQueued = $derived(new Map($pendingOutbox.flatMap((i) => (i.kind === 'confirmation' ? [[i.reportId, i] as const] : []))));

  const clip = (s: string) => (s.length > 140 ? `${s.slice(0, 140)}…` : s);
</script>

{#snippet hikeForm()}
  <form class="form" onsubmit={save}>
    <div class="field">
      <label for="hl-date">Date</label>
      <input id="hl-date" type="date" min={MIN_DATE} max={maxDate} bind:value={fDate} disabled={fUnknown} />
      <label class="check">
        <input type="checkbox" bind:checked={fUnknown} onchange={() => { if (fUnknown) fDate = ''; }} />
        I don't remember the date
      </label>
    </div>
    <div class="field">
      <label for="hl-notes">Notes</label>
      <textarea id="hl-notes" rows="3" maxlength="5000" bind:value={fNotes}></textarea>
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
    <p class="hint">Only you can see your hikes. Reviews are public; a Public hike's month shows on its review.</p>
    <div class="row">
      <button type="submit" class="primary">Save hike</button>
      <button type="button" onclick={closeForm}>Cancel</button>
    </div>
  </form>
{/snippet}

<section class="hikelog">
  {#if activeHere && active}
    <p class="since">Hike in progress since {formatTime(active.startedAt ?? active.updatedAt)}</p>
    <button type="button" class="wide primary" onclick={finish}>Finish hike</button>
    {#if $session}
      <button type="button" class="wide" onclick={() => onreport?.()}>Report something</button>
    {:else}
      <a class="btn wide" href="{base}/account">Sign in to report what you see.</a>
    {/if}
  {:else if activeElsewhere && active}
    <p class="since">You're on a hike on another route.</p>
    <a class="btn wide" href="{base}/route/{active.routeId}">Go to it</a>
  {:else}
    {#if finished}<p class="since" role="status">Hike finished. Nice one.</p>{/if}
    {#if finishedHike && !finishedHike.review && !isLocked(finishedHike, $viewer) && formFor === null && canReview(finishedHike, today)}
      <button type="button" class="wide" onclick={() => openReview(finishedHike)}>Review the route</button>
    {/if}
    <button type="button" class="wide primary" onclick={start}>Start hike</button>
  {/if}
  {#if stillThere.length}
    <section class="still" aria-labelledby="hl-still">
      <h3 id="hl-still">Still there?</h3>
      <p class="hint">You've just been here. Is what others reported still there?</p>
      <ul class="still-list">
        {#each stillThere as r (r.id)}
          <li style="--pin: {CATEGORY_COLOURS[r.category]}">
            <p class="still-cat">{CATEGORY_LABELS[r.category]}</p>
            <p class="hint">Seen {formatAge(r.observedAt, stNow)}</p>
            {#if r.note}<p class="notes">{clip(r.note)}</p>{/if}
            <div class="answers" role="group" aria-label="Is it still there?">
              {#each ANSWERS as a (a.value)}
                <button type="button" aria-pressed={!stQueued.get(r.id)?.error && stAnswers[r.id] === a.value}
                  onclick={() => answerStillThere(r.id, a.value)}>{a.label}</button>
              {/each}
            </div>
            {#if stAnswers[r.id] && stQueued.get(r.id)?.error}
              <p class="err" role="alert">{stQueued.get(r.id)?.error}</p>
            {:else if stAnswers[r.id] && stQueued.has(r.id)}
              <p class="hint" role="status">Will send when you have signal</p>
            {/if}
          </li>
        {/each}
      </ul>
      {#if stError}<p class="err" role="alert">{stError}</p>{/if}
      <button type="button" class="wide" onclick={closeStillThere}>{Object.keys(stAnswers).length ? 'Done' : 'Skip'}</button>
    </section>
  {/if}
  {#if error}<p class="err" role="alert">{error}</p>{/if}

  <button type="button" class="disclosure" aria-expanded={formFor === 'new'}
    disabled={formFor !== null} onclick={openNew}>Log a past hike</button>
  {#if formFor === 'new'}{@render hikeForm()}{/if}

  <h2>Your hikes here</h2>
  {#if $hikes.length === 0}
    <p class="empty">No hikes logged here yet.</p>
  {:else}
    {#if anyLocked}<p class="hint">Sign in to change hikes saved to your account.</p>{/if}
    <ul class="hikes">
      {#each $hikes as h (h.id)}
        <li>
          {#if formFor === h.id}
            {@render hikeForm()}
          {:else if formFor === `review:${h.id}`}
            <div class="head"><strong>{h.date ? formatDate(h.date) : 'Date not recorded'}</strong></div>
            <ReviewForm review={h.review} {graded} {gradeLevel}
              onsave={(r) => saveReview(h.id, r)} oncancel={closeForm} />
            {#if reviewError}<p class="err" role="alert">{reviewError}</p>{/if}
          {:else}
            <div class="head">
              <strong>{h.date ? formatDate(h.date) : 'Date not recorded'}</strong>
              {#if active?.id === h.id}<span class="tag">In progress</span>{/if}
            </div>
            {#if h.notes}<p class="notes">{clip(h.notes)}</p>{/if}
            {#if h.review}<p class="review-line">{reviewSummary(h.review)}</p>{/if}
            {#if h.syncError}<p class="err">Couldn't sync: {h.syncError}</p>
            {:else if h.pending && $syncState.status !== 'off'}
              <p class="hint">{$syncState.status === 'offline' ? 'Will send when you have signal' : 'Not synced yet'}</p>
            {/if}
            {#if isLocked(h, $viewer)}
              <!-- read-only: the hint above the list says why -->
            {:else if confirming === h.id}
              <div class="row">
                <span class="ask">Delete this hike?</span>
                <button type="button" class="danger" onclick={() => remove(h.id)}>Delete</button>
                <button type="button" onclick={() => (confirming = null)}>Keep</button>
              </div>
            {:else}
              <div class="row">
                <button type="button" disabled={formFor !== null} onclick={() => openEdit(h)}>Edit</button>
                {#if canReview(h, today)}
                  <button type="button" disabled={formFor !== null} onclick={() => openReview(h)}
                    aria-label="{h.review ? 'Edit review' : 'Add review'}, hike on {h.date ? formatDate(h.date) : 'Date not recorded'}">
                    {h.review ? 'Edit review' : 'Add review'}
                  </button>
                {/if}
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
  .danger { border-color: var(--ks-error); color: var(--ks-error); }
  .disclosure { justify-content: flex-start; width: 100%; }
  button:focus-visible, .btn:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible {
    outline: 3px solid #c2410c; outline-offset: 2px;
  }
  .since { margin: 0; font-weight: 600; }
  .err { margin: 0; color: var(--ks-error); font-size: 0.9em; }
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
  .tag { font-size: 0.8em; padding: 0 0.4rem; border: 1px solid var(--ks-accent-text); border-radius: 0.3rem; color: var(--ks-accent-text); }
  .notes { margin: 0; }
  .review-line { margin: 0; font-weight: 600; }
  .still { display: grid; gap: 0.6rem; padding: 0.75rem; border-radius: 0.4rem;
    border: 1px solid color-mix(in srgb, currentColor 35%, transparent); }
  .still h3 { margin: 0; }
  .still-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.9rem; }
  .still-list li { padding: 0.25rem 0.6rem; border-left: 4px solid var(--pin); display: grid; gap: 0.25rem; }
  .still-cat { margin: 0; font-weight: 600; }
  .still .notes { overflow-wrap: anywhere; white-space: pre-wrap; }
  .answers { display: flex; gap: 0.4rem; }
  .answers button { flex: 1 1 0; padding: 0 0.5rem; }
  button[aria-pressed='true'] { background: #c2410c; border-color: #c2410c; color: #fff; font-weight: 600; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
</style>
