<script lang="ts">
  import { get } from 'svelte/store';
  import { base } from '$app/paths';
  import { journal, replaceAll } from '$lib/journal/store';
  import { serialize, parse, merge } from '$lib/journal/io';

  let mode = $state<'merge' | 'replace'>('merge');
  let pending = $state<string | null>(null);
  let error = $state<string | null>(null);

  function exportJournal() {
    const blob = new Blob([serialize([...get(journal).values()])], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'kaapspoor-journal.json'; a.click();
    URL.revokeObjectURL(url);
  }

  async function onFile(e: Event) {
    error = null;
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    pending = file ? await file.text() : null;
  }

  async function applyImport() {
    if (!pending) return;
    try {
      const incoming = parse(pending);
      await replaceAll(merge(get(journal), incoming, mode));
      pending = null;
    } catch (err) {
      error = (err as Error).message;
    }
  }
</script>

<div class="page">
  <h1>Settings</h1>

  <section>
    <h2>Export</h2>
    <button onclick={exportJournal}>Export journal</button>
  </section>

  <section>
    <h2>Import</h2>
    <input type="file" accept="application/json" aria-label="Import file" onchange={onFile} />
    <label><input type="radio" bind:group={mode} value="merge" /> Merge</label>
    <label><input type="radio" bind:group={mode} value="replace" /> Replace</label>
    <button onclick={applyImport} disabled={!pending}>Apply import</button>
    {#if error}<p class="error">{error}</p>{/if}
  </section>

  <p><a href="{base}/">Back</a></p>
</div>

<style>
  .page { padding: 1rem; max-width: 60rem; margin: 0 auto; }
  section { margin: 1.5rem 0; }
  .error { color: #c0392b; }
</style>
