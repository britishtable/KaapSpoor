<script lang="ts">
  import type { FilterOptions } from '../data/filter';
  let { value = $bindable() }: { value: FilterOptions } = $props();
</script>

<div class="filters">
  <input placeholder="Search routes…" bind:value={value.query} aria-label="Search routes" />
  <select bind:value={value.status} aria-label="Done status">
    <option value="all">All</option>
    <option value="todo">To do</option>
    <option value="done">Done</option>
  </select>
  <select bind:value={value.located} aria-label="Location">
    <option value="all">All</option>
    <option value="mapped">Mapped</option>
    <option value="unmapped">Unmapped</option>
  </select>
</div>

<style>
  .filters { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 0.75rem; }
  input { flex: 1; min-width: 12rem; padding: 0.4rem 0.6rem; }
</style>
