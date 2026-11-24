<script lang="ts">
  /**
   * Asks a hiker standing near an active report whether it is still there. One question at a
   * time, once per report per visit, and never about their own. Nothing is sent unless an answer
   * is tapped; the position itself never leaves the device.
   */
  import { onDestroy, untrack } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { session } from '$lib/account/session';
  import { answerReport, pendingOutbox } from '$lib/reports/outbox';
  import { ANSWERS, CATEGORY_COLOURS, CATEGORY_LABELS } from '$lib/reports/labels';
  import { formatDistance } from '$lib/map/profile';
  import { haversineM } from '$lib/map/snap';
  import { ROUGH_FIX_M } from '$lib/position/route-status';
  import type { Fix } from '$lib/position/source';
  import type { Answer, PublicReport } from '$lib/reports/types';

  let { fix, active, own }: { fix: Fix | null; active: PublicReport[]; own: Set<string> } = $props();

  const NEAR_REPORT_M = 100;
  /** Once asked, a question stays up to here: GPS jitter at the edge must not blink it on and off. */
  const KEEP_REPORT_M = 150;

  let me = $derived($session?.id ?? null);

  // Settled for this visit, per account: answered here, answered in the list below (seen in the
  // queue), or put off.
  const settled = new SvelteSet<string>();
  const key = (owner: string, id: string) => `${owner}:${id}`;
  onDestroy(pendingOutbox.subscribe((items) => {
    untrack(() => {
      for (const i of items) if (i.kind === 'confirmation') settled.add(key(i.owner, i.reportId));
    });
  }));

  function distanceM(r: PublicReport): number {
    return fix && r.position ? haversineM([fix.lon, fix.lat], [r.position.lon, r.position.lat]) : Infinity;
  }
  function mayAsk(r: PublicReport, withinM: number): boolean {
    return me !== null && fix !== null && fix.accuracy <= ROUGH_FIX_M
      && distanceM(r) <= withinM && !own.has(r.id) && !settled.has(key(me, r.id));
  }

  let askedId = $state<string | null>(null);
  // Chosen when a fix or the list arrives, and never within a second of the last tap: either can
  // land mid double tap, and would put another report's buttons under the same finger.
  const REST_MS = 1000;
  let tappedAt = -Infinity;
  $effect(() => {
    void fix;
    void active;
    untrack(() => {
      const current = active.find((r) => r.id === askedId);
      if (current && mayAsk(current, KEEP_REPORT_M)) return;
      if (performance.now() - tappedAt < REST_MS) return;
      const near = active.filter((r) => mayAsk(r, NEAR_REPORT_M)).sort((a, b) => distanceM(a) - distanceM(b));
      askedId = near[0]?.id ?? null;
      error = '';
    });
  });
  let asked = $derived(active.find((r) => r.id === askedId && mayAsk(r, KEEP_REPORT_M)) ?? null);

  let error = $state('');
  let answeredId = $state<string | null>(null);
  let waiting = $derived($pendingOutbox.some(
    (i) => i.kind === 'confirmation' && i.reportId === answeredId && i.error === undefined
  ));

  async function answer(id: string, value: Answer): Promise<void> {
    if (!me) return;
    const owner = me;
    error = '';
    tappedAt = performance.now();
    try {
      await answerReport(id, value);
      settled.add(key(owner, id));
      answeredId = id;
    } catch {
      error = "Couldn't save that answer on this device.";
    }
  }
  function notNow(id: string): void {
    tappedAt = performance.now();
    if (me) settled.add(key(me, id));
  }

  const clip = (s: string) => (s.length > 140 ? `${s.slice(0, 140)}…` : s);
  // To 10 m: a phone's GPS justifies no more, and this line is read out when it changes.
  const about = (m: number) => formatDistance(Math.round(m / 10) * 10);
</script>

{#if asked}
  {@const id = asked.id}
  <section class="near" role="status" style="--pin: {CATEGORY_COLOURS[asked.category]}">
    <p class="question" data-testid="near-question">{CATEGORY_LABELS[asked.category]}, {about(distanceM(asked))} from you. Still there?</p>
    {#if asked.note}<p class="note">{clip(asked.note)}</p>{/if}
    <div class="answers" role="group" aria-label="Is it still there?">
      {#each ANSWERS as a (a.value)}
        <button type="button" onclick={() => answer(id, a.value)}>{a.label}</button>
      {/each}
    </div>
    {#if error}<p class="err" role="alert">{error}</p>{/if}
    <button type="button" class="later" onclick={() => notNow(id)}>Not now</button>
  </section>
{/if}
{#if waiting}<p class="hint" role="status">Will send when you have signal</p>{/if}

<style>
  .near {
    display: grid; gap: 0.5rem; margin: 0 0 1rem; padding: 0.5rem 0.75rem;
    border-left: 6px solid var(--pin); border-radius: 0 0.3rem 0.3rem 0;
    background: color-mix(in srgb, var(--pin) 12%, transparent);
  }
  p { margin: 0; }
  .question { font-size: 1.1rem; font-weight: 700; }
  .note { overflow-wrap: anywhere; white-space: pre-wrap; }
  .answers { display: flex; gap: 0.4rem; }
  .answers button { flex: 1 1 0; padding: 0 0.5rem; }
  button {
    min-height: 48px; padding: 0 0.75rem; font: inherit; cursor: pointer; box-sizing: border-box;
    border: 1px solid color-mix(in srgb, currentColor 45%, transparent); border-radius: 0.4rem;
    background: transparent; color: inherit;
  }
  button:focus-visible { outline: 3px solid #c2410c; outline-offset: 2px; }
  .later { border-color: transparent; text-decoration: underline; }
  .err { color: var(--ks-error); }
  .hint { margin: 0 0 1rem; font-size: 0.9em; }
</style>
