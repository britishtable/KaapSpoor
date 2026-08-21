<!-- app/src/lib/components/RoutePlan.svelte -->
<script lang="ts">
  /**
   * The day the reader is planning: how they get in, what they came for, how
   * they get out — and what that adds up to.
   *
   * This component RESOLVES NOTHING. It reports a wish upward and re-renders
   * from whatever legal plan comes back, so the rule that a main drives its
   * approaches lives in one place (plan.ts) rather than being re-implemented
   * against the DOM.
   */
  import { assemble, planStats, type PlanChoice, type PlanSegment, type ResolvedPlan }
    from '$lib/data/plan';

  let { plan, onchange }: { plan: ResolvedPlan; onchange: (c: PlanChoice) => void } = $props();

  // Reversed, the walk starts where the exit is drawn. The DATA keeps its
  // canonical labels; only these words flip.
  const LABELS = { approach: 'Approach', main: 'Main', exit: 'Exit' };
  const REVERSED_LABELS = { approach: 'Finish', main: 'Main', exit: 'Start' };
  let labels = $derived(plan.choice.reversed ? REVERSED_LABELS : LABELS);

  let rows = $derived.by(() => {
    const built = (
      [
        ['approach', plan.approaches],
        ['main', plan.mains],
        ['exit', plan.exits]
      ] as const
    )
      .map(([role, options]) => ({
        role,
        options,
        chosen: options.find((o) => o.segmentId === plan.choice[role]) ?? null
      }))
      .filter((row) => row.options.length > 0);
    // Reversed, the walk BEGINS at the exit. The rows are stacked in walking
    // order so they line up with the profile beneath — which always runs
    // start to finish — so reversing the labels without reversing the order
    // would break the alignment that put them in this order to begin with.
    return plan.choice.reversed ? [...built].reverse() : built;
  });

  let total = $derived(planStats(assemble(plan.chosen, plan.choice.reversed)));

  const km = (m: number) => `${(m / 1000).toFixed(1)} km`;

  function statsFor(segment: PlanSegment) {
    return planStats(assemble([segment], plan.choice.reversed));
  }

  function pick(role: 'approach' | 'main' | 'exit', segmentId: string) {
    onchange({ ...plan.choice, [role]: segmentId });
  }
</script>

{#if plan.choice.main}
  <section class="plan">
    <header>
      <span class="total">{km(total.distanceM)}</span>
      {#if total.ascentM !== null}<span class="total">↑ {Math.round(total.ascentM)} m</span>{/if}
      {#if total.descentM !== null}<span class="total">↓ {Math.round(total.descentM)} m</span>{/if}
      <button type="button" onclick={() => onchange({ ...plan.choice, reversed: !plan.choice.reversed })}>
        ⇄ reverse
      </button>
    </header>

    <ul>
      {#each rows as row (row.role)}
        <li>
          <span class="role">{labels[row.role]}</span>
          {#if row.options.length > 1}
            <select
              aria-label={labels[row.role]}
              value={plan.choice[row.role]}
              onchange={(e) => pick(row.role, e.currentTarget.value)}
            >
              {#each row.options as option (option.segmentId)}
                <option value={option.segmentId}>{option.name ?? row.role}</option>
              {/each}
            </select>
          {:else}
            <span class="name">{row.chosen?.name ?? labels[row.role]}</span>
          {/if}
          {#if row.chosen}
            {@const s = statsFor(row.chosen)}
            <span class="figures">
              {km(s.distanceM)}
              {#if s.ascentM !== null}↑ {Math.round(s.ascentM)} m{/if}
              {#if s.descentM !== null}↓ {Math.round(s.descentM)} m{/if}
            </span>
          {/if}
          {#if row.chosen?.note}<span class="note">{row.chosen.note}</span>{/if}
        </li>
      {/each}
    </ul>
  </section>
{/if}

<style>
  .plan { margin: 0.75rem 0; }
  header { display: flex; gap: 0.75rem; align-items: baseline; flex-wrap: wrap; }
  .total { font-weight: 600; }
  ul { margin: 0.4rem 0 0; padding: 0; list-style: none; display: grid; gap: 0.35rem; }
  li {
    display: grid; grid-template-columns: 5rem 1fr auto; gap: 0.4rem; align-items: baseline;
    padding: 0.25rem 0.45rem; border-left: 3px solid #c2410c;
  }
  .role { font-size: 0.8em; opacity: 0.7; text-transform: uppercase; letter-spacing: 0.04em; }
  .name { font-weight: 600; }
  .figures { font-size: 0.85em; opacity: 0.8; white-space: nowrap; }
  .note { grid-column: 2 / -1; font-size: 0.82em; opacity: 0.75; }
</style>
