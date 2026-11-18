<script lang="ts">
  import { base } from '$app/paths';
  import { apiBaseUrl } from '$lib/api/config';
  import { session, signIn, register, signOut, SessionError } from '$lib/account/session';
  import { syncState } from '$lib/sync/sync';
  import { now } from '$lib/journal/store';

  let mode = $state<'signin' | 'create'>('signin');
  let displayName = $state('');
  let email = $state('');
  let password = $state('');
  let error = $state<string | null>(null);
  let busy = $state(false);
  const available = apiBaseUrl() !== null;

  function switchMode() {
    mode = mode === 'signin' ? 'create' : 'signin';
    error = null;
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    error = null;
    if (mode === 'create') {
      if (displayName.trim() === '') { error = 'Add a name so friends know who you are.'; return; }
      if (password.length < 10) { error = 'Use at least 10 characters for your password.'; return; }
    }
    busy = true;
    try {
      if (mode === 'signin') await signIn(email.trim(), password);
      else await register(email.trim(), password, displayName.trim());
      password = '';
    } catch (err) {
      error = err instanceof SessionError ? err.message : 'Something went wrong. Try again.';
    } finally {
      busy = false;
    }
  }

  const relFmt = new Intl.RelativeTimeFormat('en-ZA', { numeric: 'auto' });
  function relative(iso: string): string {
    const secs = Math.round((Date.parse(iso) - Date.parse(now())) / 1000);
    if (Math.abs(secs) < 60) return 'just now';
    const mins = Math.round(secs / 60);
    if (Math.abs(mins) < 60) return relFmt.format(mins, 'minute');
    const hours = Math.round(mins / 60);
    if (Math.abs(hours) < 24) return relFmt.format(hours, 'hour');
    return relFmt.format(Math.round(hours / 24), 'day');
  }
  let waiting = $derived($syncState.pendingCount);

  async function leave() {
    error = null;
    await signOut();
  }
</script>

<div class="page">
  <h1>Account</h1>

  {#if !available}
    <p>Accounts aren't available in this build yet. Your hikes are saved on this device.</p>
  {:else if $session}
    <p class="who">Signed in as {$session.displayName}</p>
    <p class="status" role="status">{waiting === 0 ? 'All hikes synced' : `${waiting} ${waiting === 1 ? 'hike' : 'hikes'} waiting to sync`}</p>
    {#if $syncState.lastSyncedAt}<p class="hint">Last synced {relative($syncState.lastSyncedAt)}</p>{/if}
    <button class="wide" onclick={leave}>Sign out</button>
  {:else}
    <form onsubmit={submit} novalidate>
      <h2>{mode === 'signin' ? 'Sign in' : 'Create account'}</h2>
      {#if mode === 'create'}
        <div class="field">
          <label for="acc-name">Display name</label>
          <input id="acc-name" type="text" autocomplete="name" bind:value={displayName} required />
        </div>
      {/if}
      <div class="field">
        <label for="acc-email">Email</label>
        <input id="acc-email" type="email" autocomplete="email" bind:value={email} required />
      </div>
      <div class="field">
        <label for="acc-password">Password</label>
        <input id="acc-password" type="password" autocomplete={mode === 'signin' ? 'current-password' : 'new-password'}
          bind:value={password} required aria-describedby={mode === 'create' ? 'acc-hint' : undefined} />
        {#if mode === 'create'}<span id="acc-hint" class="hint">At least 10 characters</span>{/if}
      </div>
      {#if error}<p class="err" role="alert">{error}</p>{/if}
      <button class="wide primary" type="submit" disabled={busy}>{mode === 'signin' ? 'Sign in' : 'Create account'}</button>
      <button class="link" type="button" onclick={switchMode}>
        {mode === 'signin' ? 'New here? Create account' : 'Already have an account? Sign in'}
      </button>
      <p class="hint">You don't need an account to browse routes or keep a hike log. An account lets your hikes sync between devices.</p>
    </form>
  {/if}

  <p><a href="{base}/">Back</a></p>
</div>

<style>
  .page { padding: 1rem; max-width: 28rem; margin: 0 auto; display: grid; gap: 0.75rem; }
  h1, h2 { margin: 0; }
  h2 { margin-top: 0.5rem; }
  form { display: grid; gap: 0.75rem; }
  .field { display: grid; gap: 0.3rem; }
  .field label { font-weight: 600; }
  input {
    font: inherit; min-height: 48px; padding: 0.4rem 0.6rem; box-sizing: border-box; width: 100%;
    border: 1px solid color-mix(in srgb, currentColor 35%, transparent); border-radius: 0.4rem;
    background: transparent; color: inherit;
  }
  button {
    min-height: 48px; padding: 0 1rem; font: inherit; cursor: pointer; box-sizing: border-box;
    border: 1px solid color-mix(in srgb, currentColor 35%, transparent); border-radius: 0.4rem;
    background: transparent; color: inherit; display: inline-flex; align-items: center; justify-content: center;
  }
  button:disabled { opacity: 0.6; cursor: default; }
  .wide { width: 100%; }
  .primary { background: #c2410c; border-color: #c2410c; color: #fff; font-weight: 600; }
  .link { border: none; text-decoration: underline; }
  button:focus-visible, input:focus-visible, a:focus-visible { outline: 3px solid #c2410c; outline-offset: 2px; }
  .who { margin: 0; font-weight: 600; font-size: 1.15em; }
  .err { margin: 0; color: #b91c1c; font-size: 0.9em; }
  .hint { margin: 0; font-size: 0.85em; opacity: 0.75; }
  .status { margin: 0; }
</style>
