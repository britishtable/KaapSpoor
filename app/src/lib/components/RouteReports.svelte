<script lang="ts">
  import { tick } from 'svelte';
  import { base } from '$app/paths';
  import { session } from '$lib/account/session';
  import { loadRouteReports } from '$lib/reports/reports';
  import { answerReport, discardOutboxItem, pendingOutbox, waitsOnHike } from '$lib/reports/outbox';
  import { ANSWERS, ANSWER_WORDS, CATEGORY_COLOURS, CATEGORY_LABELS } from '$lib/reports/labels';
  import { formatAge } from '$lib/reports/age';
  import { hikes } from '$lib/journal/store';
  import { SignInRequiredError } from '$lib/reports/types';
  import type { Answer, Category, OutboxItem, PublicReport, ReportItem, RouteReportsView } from '$lib/reports/types';

  let { routeId, onactive }: {
    routeId: string;
    /** The public, active reports, for the map's pins. Never the reader's held or unsent ones. */
    onactive?: (reports: PublicReport[]) => void;
  } = $props();

  let result = $state<RouteReportsView | 'offline' | 'unavailable' | null>(null);
  /**
   * Answers seen to leave the queue with no error, i.e. accepted by the server. A refused answer
   * keeps its item (with the reason) until discarded, so it never lands here.
   */
  let sent = $state<Record<string, Answer>>({});
  let answerError = $state<Record<string, string>>({});
  let flashed = $state<string | null>(null);
  let now = $state(new Date());
  let root = $state<HTMLElement>();
  let generation = 0;

  function load(id: string, quiet: boolean): void {
    const mine = generation;
    void loadRouteReports(id).then((r) => {
      if (mine !== generation) return;
      // A quiet reload never swaps a good list for "offline".
      if (quiet && typeof r === 'string') return;
      result = r;
      now = new Date();
    });
  }

  // Client-side only: route pages are prerendered, and GitHub Pages has no API.
  // Again whenever the account changes: on a shared phone nothing of the last reader's (which
  // reports are theirs, what they answered) may carry over to the next.
  let me = $derived($session?.id ?? null);
  $effect(() => {
    const id = routeId;
    void me;
    generation++;
    result = null;
    sent = {};
    answerError = {};
    load(id, false);
  });

  // Ages are read against a clock that moves while the page stays open.
  $effect(() => {
    const t = setInterval(() => (now = new Date()), 60_000);
    return () => clearInterval(t);
  });

  let loaded = $derived(typeof result === 'object' && result !== null ? result : null);
  let shown = $derived(result !== null && result !== 'unavailable');

  $effect(() => { onactive?.(loaded?.active ?? []); });

  /** Reports and answers this reader has waiting on this device, live from the queue. */
  let listed = $derived(new Set([
    ...(loaded?.active ?? []), ...(loaded?.history ?? []), ...(loaded?.mineHeld ?? [])
  ].map((r) => r.id)));
  let pending = $derived($pendingOutbox.filter(
    (i): i is ReportItem => i.kind === 'report' && i.body.routeId === routeId && !listed.has(i.id)
  ));
  /** The reader's own: every report the server knows as theirs, plus any still waiting to send. */
  let own = $derived(new Set([
    ...(loaded?.mineIds ?? []), ...(loaded?.mineHeld ?? []).map((r) => r.id),
    ...$pendingOutbox.flatMap((i) => (i.kind === 'report' ? [i.id] : []))
  ]));
  let answersQueued = $derived(new Map(
    $pendingOutbox.flatMap((i) => (i.kind === 'confirmation' ? [[i.reportId, i] as const] : []))
  ));

  // Once something of ours on this route leaves the queue it has been sent: read the lists again,
  // so a sent report shows as held and a sent answer shows its effect.
  // Only an item that is gone from the queue altogether was sent; one that turned refused is
  // still there, with its reason. The watch belongs to one account: a sign-out empties the
  // visible queue without sending anything.
  let sentWatch: { owner: string | null; items: Map<string, OutboxItem> } | null = null;
  $effect(() => {
    const all = new Set($pendingOutbox.map((i) => i.id));
    const items = new Map($pendingOutbox
      .filter((i) => i.error === undefined && (
        (i.kind === 'report' && i.body.routeId === routeId) || (i.kind === 'confirmation' && listed.has(i.reportId))
      ))
      .map((i) => [i.id, i] as const));
    const before = sentWatch;
    sentWatch = { owner: me, items };
    if (!before || before.owner !== me) return;
    const gone = [...before.items.values()].filter((i) => !all.has(i.id));
    if (!gone.length) return;
    const nowSent = { ...sent };
    for (const i of gone) if (i.kind === 'confirmation') nowSent[i.reportId] = i.answer;
    sent = nowSent;
    load(routeId, true);
  });

  async function answer(id: string, value: Answer): Promise<void> {
    answerError = { ...answerError, [id]: '' };
    const { [id]: _was, ...rest } = sent;
    sent = rest; // a new answer is not sent until it leaves the queue
    try {
      await answerReport(id, value);
    } catch (e) {
      answerError = {
        ...answerError,
        [id]: e instanceof SignInRequiredError ? e.message : "Couldn't save that answer on this device."
      };
    }
  }

  /** Brings one report into view, as when its pin on the map is tapped. */
  export async function show(id: string): Promise<void> {
    await tick();
    const el = root?.querySelector<HTMLElement>(`[data-report="${CSS.escape(id)}"]`);
    if (!el) return;
    el.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    el.focus({ preventScroll: true });
    flashed = id;
    setTimeout(() => { if (flashed === id) flashed = null; }, 2000);
  }

  /** The answer to show as chosen: the queued one unless refused, else the one seen sent. */
  function chosen(id: string): Answer | undefined {
    const q = answersQueued.get(id);
    return q ? (q.error ? undefined : q.answer) : sent[id];
  }
  const label = (c: Category) => CATEGORY_LABELS[c];
  function seen(r: { observedAt: string; lastConfirmedAt: string | null }): string {
    const base = `Seen ${formatAge(r.observedAt, now)}`;
    return r.lastConfirmedAt ? `${base} · last confirmed ${formatAge(r.lastConfirmedAt, now)}` : base;
  }
  function ended(r: PublicReport): string {
    return r.clearedAt
      ? `Cleared ${formatAge(r.clearedAt, now)} · seen ${formatAge(r.observedAt, now)}`
      : `Expired ${formatAge(r.expiresAt ?? r.observedAt, now)} · seen ${formatAge(r.observedAt, now)}`;
  }
</script>

{#snippet refused(item: OutboxItem)}
  <div class="refused">
    <p class="err" role="alert">{item.error}</p>
    <button type="button" class="slim" onclick={() => discardOutboxItem(item.id)}>Discard</button>
  </div>
{/snippet}

{#snippet answerStatus(id: string)}
  {@const q = answersQueued.get(id)}
  {#if q?.error}
    {@render refused(q)}
  {:else if q}
    <p class="hint" role="status">Will send when you have signal</p>
  {:else if sent[id]}
    <p class="hint" role="status">Answer sent: {ANSWER_WORDS[sent[id]]}.</p>
  {/if}
  {#if answerError[id]}<p class="err" role="alert">{answerError[id]}</p>{/if}
{/snippet}

{#if shown}
  <section class="reports" bind:this={root} aria-labelledby="rr-title">
    <h2 id="rr-title">Trail reports</h2>

    {#if loaded?.mineHeld.length || pending.length}
      <div class="yours">
        {#if loaded?.mineHeld.length}
          <p class="lead">Only you can see these until you finish your hike.</p>
          <ul class="list">
            {#each loaded.mineHeld as r (r.id)}
              <li style="--pin: {CATEGORY_COLOURS[r.category]}">
                <p class="cat">{label(r.category)}</p>
                <p class="age">{seen(r)}</p>
                {#if r.note}<p class="text">{r.note}</p>{/if}
              </li>
            {/each}
          </ul>
        {/if}
        {#if pending.length}
          <ul class="list">
            {#each pending as item (item.id)}
              <li style="--pin: {CATEGORY_COLOURS[item.body.category]}">
                <p class="cat">{label(item.body.category)}</p>
                <p class="age">Seen {formatAge(item.body.observedAt, now)}</p>
                {#if item.body.note}<p class="text">{item.body.note}</p>{/if}
                {#if item.error}
                  {@render refused(item)}
                {:else if waitsOnHike(item, $hikes)}
                  <div class="refused">
                    <p class="hint">Waiting for your hike to send</p>
                    <button type="button" class="slim" onclick={() => discardOutboxItem(item.id)}>Discard</button>
                  </div>
                {:else}
                  <p class="hint">Will send when you have signal</p>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    {/if}

    {#if result === 'offline'}
      <p class="muted">Reports need a connection.</p>
    {:else if loaded}
      {#if loaded.active.length === 0}
        <p class="muted">Nothing reported recently.</p>
      {:else}
        <ul class="list">
          {#each loaded.active as r (r.id)}
            {@const mine = own.has(r.id)}
            <li data-report={r.id} tabindex="-1" class:flash={flashed === r.id} style="--pin: {CATEGORY_COLOURS[r.category]}">
              <p class="cat">
                {#if r.position}<span class="dot" title="Pinned on the map"></span>{/if}{label(r.category)}
              </p>
              <p class="age">{seen(r)}</p>
              {#if mine}
                <p class="who">You reported this</p>
              {:else}
                <p class="who">Reported by <strong>{r.displayName}</strong></p>
              {/if}
              {#if r.note}<p class="text">{r.note}</p>{/if}
              {#if r.category === 'SAFETY' && r.unverified}
                <p class="calm">Not yet confirmed by anyone else</p>
              {/if}
              {#if $session}
                {#if mine}
                  <button type="button" class="wide" aria-pressed={chosen(r.id) === 'GONE'}
                    onclick={() => answer(r.id, 'GONE')}>It's gone now</button>
                {:else}
                  <div class="answers" role="group" aria-label="Is it still there?">
                    {#each ANSWERS as a (a.value)}
                      <button type="button" aria-pressed={chosen(r.id) === a.value}
                        onclick={() => answer(r.id, a.value)}>{a.label}</button>
                    {/each}
                  </div>
                {/if}
                {@render answerStatus(r.id)}
              {/if}
            </li>
          {/each}
        </ul>
        {#if !$session}
          <a class="btn wide" href="{base}/account">Sign in to report what you see.</a>
        {/if}
      {/if}

      {#if loaded.history.length}
        <details class="history">
          <summary>Earlier reports ({loaded.history.length})</summary>
          <ul class="list">
            {#each loaded.history as r (r.id)}
              <li class="past" style="--pin: {CATEGORY_COLOURS[r.category]}">
                <p class="cat">{label(r.category)}</p>
                <p class="age">{ended(r)}</p>
                {#if r.note}<p class="text">{r.note}</p>{/if}
              </li>
            {/each}
          </ul>
        </details>
      {/if}
    {/if}
  </section>
{/if}

<style>
  .reports { margin-top: 1.5rem; display: grid; gap: 0.6rem; }
  h2 { margin: 1rem 0 0; }
  p { margin: 0; }
  .muted { opacity: 0.75; }
  .lead { font-weight: 600; }
  .yours { display: grid; gap: 0.5rem; padding: 0.6rem 0.75rem; border-radius: 0.4rem;
    border: 1px dashed color-mix(in srgb, currentColor 35%, transparent); }
  .list { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.9rem; }
  /* The stripe is the pin's colour: a report reads the same in the list and on the map. */
  .list li { padding: 0.25rem 0.6rem; border-left: 4px solid var(--pin); display: grid; gap: 0.25rem;
    border-radius: 0 0.3rem 0.3rem 0; }
  .list li:focus { outline: none; }
  .list li:focus-visible { outline: 3px solid #c2410c; outline-offset: 2px; }
  .list li.past { border-left-style: dotted; opacity: 0.85; }
  .flash { background: color-mix(in srgb, var(--pin) 14%, transparent); }
  @media (prefers-reduced-motion: no-preference) {
    .list li { transition: background-color 0.6s ease-out; }
  }
  .cat { font-weight: 600; display: flex; align-items: center; gap: 0.45rem; }
  .dot { flex: none; width: 0.7rem; height: 0.7rem; border-radius: 50%; background: var(--pin);
    box-shadow: 0 0 0 2px #fff, 0 0 0 3px color-mix(in srgb, currentColor 30%, transparent); }
  .age { font-size: 0.9em; opacity: 0.8; font-variant-numeric: tabular-nums; }
  .who { overflow-wrap: anywhere; }
  .text { overflow-wrap: anywhere; white-space: pre-wrap; max-width: 65ch; }
  .calm { font-style: italic; opacity: 0.8; }
  .hint { font-size: 0.85em; opacity: 0.75; }
  .err { color: var(--ks-error); font-size: 0.9em; overflow-wrap: anywhere; }
  .refused { display: flex; gap: 0.6rem; align-items: center; flex-wrap: wrap; }
  .answers { display: flex; gap: 0.4rem; margin-top: 0.2rem; }
  .answers button { flex: 1 1 0; }
  button {
    min-height: 48px; padding: 0 0.75rem; font: inherit; cursor: pointer; box-sizing: border-box;
    border: 1px solid color-mix(in srgb, currentColor 35%, transparent); border-radius: 0.4rem;
    background: transparent; color: inherit;
  }
  button[aria-pressed='true'] { background: #c2410c; border-color: #c2410c; color: #fff; font-weight: 600; }
  .wide { width: 100%; margin-top: 0.2rem; }
  .btn {
    min-height: 48px; padding: 0 1rem; box-sizing: border-box; display: inline-flex; align-items: center;
    justify-content: center; text-decoration: none; color: inherit; border-radius: 0.4rem;
    border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
  }
  .btn:focus-visible { outline: 3px solid #c2410c; outline-offset: 2px; }
  .slim { padding: 0 1rem; }
  button:focus-visible, summary:focus-visible { outline: 3px solid #c2410c; outline-offset: 2px; }
  .history summary { min-height: 48px; display: flex; align-items: center; cursor: pointer; font-weight: 600; }
  .history .list { margin-top: 0.4rem; }
</style>
