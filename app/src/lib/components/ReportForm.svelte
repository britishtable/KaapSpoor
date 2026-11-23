<script lang="ts">
  import { onMount } from 'svelte';
  import { fileReport, pendingOutbox, SignInRequiredError } from '$lib/reports/outbox';
  import { CATEGORIES, CATEGORY_LABELS, SAFETY_GUIDANCE, NOTE_MAX } from '$lib/reports/labels';
  import type { Category } from '$lib/reports/types';
  import { nearestOnLine, type Point3 } from '$lib/map/profile';

  let { routeId, lineCoords, hasLocation, activeHikeId, onpickrequest, oncancelpick, onspot, onclose }: {
    routeId: string;
    /** The plan the page already resolved; empty when the route has no drawn line. */
    lineCoords: Point3[];
    hasLocation: boolean;
    activeHikeId: string | null;
    /** Puts the page's map in pick mode; resolves with [lon, lat] once tapped, or null if abandoned. */
    onpickrequest: () => Promise<[number, number] | null>;
    /** Called when a pick in progress is abandoned (another Where choice, or closing). */
    oncancelpick?: () => void;
    /** The spot the form currently holds (snapped if snapped), or null; for the page to mark on the map. */
    onspot?: (p: [number, number] | null) => void;
    onclose: () => void;
  } = $props();

  const SNAP_M = 100;
  /** The server accepts positions inside this box only. */
  const inArea = (p: [number, number]) => p[0] >= 17.0 && p[0] <= 24.5 && p[1] >= -35.0 && p[1] <= -30.0;
  /** A little inside the server's 14 days so a slow clock never turns a valid answer into a refusal. */
  const EARLIEST_MS = 14 * 864e5 - 10 * 60e3;

  type Where = 'gps' | 'map' | 'none';
  type Fix = { point: [number, number]; how: 'snapped' | 'gps' | 'map' };

  let category = $state<Category | undefined>(undefined);
  let note = $state('');
  let when = $state<'now' | 'earlier'>('now');
  let earlier = $state('');
  let where = $state<Where | null>('none');
  let fix = $state<Fix | null>(null);
  let busy = $state(false);
  let whereError = $state('');
  let saving = $state(false);
  let error = $state('');
  let savedId = $state<string | null>(null);
  let wantId = 0;

  let heading = $state<HTMLElement>();
  let doneButton = $state<HTMLElement>();
  onMount(() => heading?.focus());
  $effect(() => { onspot?.(fix ? fix.point : null); });
  $effect(() => {
    if (savedId && doneButton) doneButton.focus();
  });

  const pad = (n: number) => String(n).padStart(2, '0');
  const local = (d: Date) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  let bounds = $state({ min: '', max: '' });
  function refreshBounds(): void {
    const t = Date.now();
    bounds = { min: local(new Date(t - EARLIEST_MS)), max: local(new Date(t)) };
  }
  refreshBounds();

  /** The chosen "when" as an ISO time, undefined for Now, or null when the picker holds nothing usable. */
  let observedAt = $derived.by((): string | undefined | null => {
    if (when === 'now') return undefined;
    const t = Date.parse(earlier);
    if (!earlier || Number.isNaN(t)) return null;
    return t >= Date.parse(bounds.min) && t <= Date.parse(bounds.max) + 60e3 ? new Date(t).toISOString() : null;
  });
  let ready = $derived(category !== undefined && observedAt !== null && !busy && !saving);

  function arrow(e: KeyboardEvent, count: number, index: number, choose: ((i: number) => void) | null): void {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1
      : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (step === 0) return;
    e.preventDefault();
    const next = (index + step + count) % count;
    choose?.(next);
    const group = (e.currentTarget as HTMLElement).parentElement;
    queueMicrotask(() => (group?.children[next] as HTMLElement | undefined)?.focus());
  }

  /** Snaps to the drawn line within 100 m; otherwise keeps the point as it came. */
  function place(p: [number, number], from: 'gps' | 'map'): void {
    if (!inArea(p)) {
      fix = null;
      where = null;
      whereError = "That spot is outside the area KaapSpoor covers, so it wasn't marked.";
      return;
    }
    const hit = nearestOnLine(lineCoords, p);
    fix = hit && hit.distanceM <= SNAP_M ? { point: hit.point, how: 'snapped' } : { point: p, how: from };
  }

  function chooseWhere(w: Where): void {
    if (where === w && w === 'none') return;
    if (where === 'map' && w !== 'map') oncancelpick?.();
    const mine = ++wantId;
    where = w;
    fix = null;
    whereError = '';
    busy = false;
    if (w === 'gps') {
      if (!('geolocation' in navigator)) { failedLocation(); return; }
      busy = true;
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (mine !== wantId) return;
          busy = false;
          place([pos.coords.longitude, pos.coords.latitude], 'gps');
        },
        () => { if (mine === wantId) failedLocation(); },
        { enableHighAccuracy: true, timeout: 15000 }
      );
    } else if (w === 'map') {
      busy = true;
      void onpickrequest().then((p) => {
        if (mine !== wantId) return;
        busy = false;
        if (p) place(p, 'map'); else where = null;
      }, () => { if (mine === wantId) { busy = false; where = null; } });
    }
  }
  function failedLocation(): void {
    busy = false;
    where = null;
    whereError = "Couldn't get your location. You can pick the spot on the map instead.";
  }

  async function submit(e: Event): Promise<void> {
    e.preventDefault();
    if (!ready || category === undefined) return;
    saving = true;
    error = '';
    try {
      const at = observedAt;
      savedId = await fileReport({
        routeId,
        category,
        note: note.trim() === '' ? undefined : note,
        hikeId: activeHikeId,
        position: where !== 'none' && fix ? { lon: fix.point[0], lat: fix.point[1] } : null,
        ...(at ? { observedAt: at } : {})
      });
    } catch (err) {
      error = err instanceof SignInRequiredError
        ? 'Sign in to report what you see.'
        : "Couldn't save that on this device. Your report is still here.";
    } finally {
      saving = false;
    }
  }

  let queued = $derived(savedId !== null && $pendingOutbox.some((i) => i.id === savedId));
  const fixText = $derived(
    fix?.how === 'snapped' ? 'Snapped to the route'
      : fix?.how === 'gps' ? 'Marked where you are'
      : fix?.how === 'map' ? 'Marked on the map' : ''
  );
</script>

{#snippet chips<T extends string>(id: string, title: string, options: { value: T; label: string }[], current: T | null | undefined, set: (v: T) => void, activateOnArrow = true)}
  <div class="q">
    <p class="qh" id="rp-{id}">{title}</p>
    <div class="chips" role="radiogroup" aria-labelledby="rp-{id}">
      {#each options as o, i (o.value)}
        <button type="button" role="radio" class="chip" aria-checked={current === o.value}
          tabindex={current === o.value || ((current === undefined || current === null) && i === 0) ? 0 : -1}
          onclick={() => set(o.value)}
          onkeydown={(e) => arrow(e, options.length, i, activateOnArrow ? (n) => set(options[n].value) : null)}>
          {o.label}
        </button>
      {/each}
    </div>
  </div>
{/snippet}

{#if savedId}
  <section class="report saved" aria-label="Report">
    <p class="done" role="status">{activeHikeId ? 'Saved. It will show once you finish your hike.' : 'Saved.'}</p>
    {#if queued}<p class="hint">Will send when you have signal</p>{/if}
    <button type="button" class="wide" bind:this={doneButton} onclick={onclose}>Done</button>
  </section>
{:else}
  <form class="report" onsubmit={submit} aria-labelledby="rp-title">
    <h3 id="rp-title" class="title" tabindex="-1" bind:this={heading}>Report something on this route</h3>
    {@render chips<Category>('category', 'What did you see?',
      CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] })), category, (v) => (category = v))}
    {#if category === 'SAFETY'}<p class="guide">{SAFETY_GUIDANCE}</p>{/if}

    <div class="field">
      <label for="rp-note">Note</label>
      <textarea id="rp-note" rows="3" maxlength={NOTE_MAX} bind:value={note}></textarea>
    </div>

    {@render chips<'now' | 'earlier'>('when', 'When?',
      [{ value: 'now', label: 'Now' }, { value: 'earlier', label: 'Earlier' }], when,
      (v) => { when = v; if (v === 'earlier') refreshBounds(); })}
    {#if when === 'earlier'}
      <div class="field">
        <label for="rp-earlier">When did you see it?</label>
        <input id="rp-earlier" type="datetime-local" min={bounds.min} max={bounds.max} bind:value={earlier} />
        {#if earlier && observedAt === null}<p class="hint">Pick a time within the last 14 days.</p>{/if}
      </div>
    {/if}

    {#if hasLocation}
      {@render chips<Where>('where', 'Where?',
        [{ value: 'gps', label: 'Use my location' }, { value: 'map', label: 'Pick on the map' }, { value: 'none', label: 'No exact spot' }],
        where, chooseWhere, false)}
    {:else}
      {@render chips<Where>('where', 'Where?', [{ value: 'none', label: 'No exact spot' }], where, chooseWhere, false)}
      <p class="hint">This route has no map position, so the report describes the whole route.</p>
    {/if}
    <p class="status" role="status">
      {#if busy && where === 'gps'}Finding your location...
      {:else if busy && where === 'map'}Tap the map above to choose the spot.
      {:else if where !== 'none' && fix}{fixText}{/if}
    </p>
    {#if whereError}<p class="err" role="alert">{whereError}</p>{/if}

    {#if error}<p class="err" role="alert">{error}</p>{/if}
    <div class="row"><button type="button" class="plain" onclick={onclose}>Cancel</button></div>
    <button type="submit" class="primary wide" disabled={!ready}>Send report</button>
  </form>
{/if}

<style>
  .report { display: grid; gap: 1rem; }
  .title { margin: 0; font-size: 1.1rem; }
  .title:focus { outline: none; }
  .q { display: grid; gap: 0.4rem; }
  .qh { margin: 0; font-weight: 600; }
  .chips { display: flex; flex-wrap: wrap; gap: 0.5rem; }
  .chip {
    min-height: 48px; min-width: 48px; padding: 0.4rem 0.9rem; font: inherit; cursor: pointer; box-sizing: border-box;
    border: 1px solid color-mix(in srgb, currentColor 35%, transparent); border-radius: 0.4rem;
    background: transparent; color: inherit; display: inline-flex; align-items: center; justify-content: center;
  }
  .chip[aria-checked='true'] { background: #c2410c; border-color: #c2410c; color: #fff; font-weight: 600; }
  .plain, .wide {
    min-height: 48px; padding: 0 1rem; font: inherit; cursor: pointer; box-sizing: border-box;
    border: 1px solid color-mix(in srgb, currentColor 35%, transparent); border-radius: 0.4rem;
    background: transparent; color: inherit; display: inline-flex; align-items: center; justify-content: center;
  }
  .wide { width: 100%; }
  .primary { background: #c2410c; border-color: #c2410c; color: #fff; font-weight: 600; }
  .primary:disabled { opacity: 0.45; cursor: default; }
  .guide { margin: 0; padding: 0.5rem 0.7rem; border-left: 3px solid #c2410c; }
  .field { display: grid; gap: 0.3rem; }
  .field label { font-weight: 600; }
  textarea, input[type='datetime-local'] {
    font: inherit; min-height: 48px; padding: 0.4rem 0.6rem; box-sizing: border-box; width: 100%;
    border: 1px solid color-mix(in srgb, currentColor 35%, transparent); border-radius: 0.4rem;
    background: transparent; color: inherit;
  }
  textarea { min-height: 5rem; }
  .status { margin: 0; font-weight: 600; min-height: 1.2em; }
  .hint { margin: 0; font-size: 0.9rem; opacity: 0.8; }
  .err { margin: 0; color: var(--ks-error); }
  .done { margin: 0; font-weight: 600; }
  .row { display: flex; gap: 0.5rem; }
  .saved { gap: 0.6rem; }
  .chip:focus-visible, .plain:focus-visible, .wide:focus-visible, textarea:focus-visible, input:focus-visible {
    outline: 3px solid #c2410c; outline-offset: 2px;
  }
</style>
