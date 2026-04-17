<script lang="ts">
  import { getAccessToken, setAccessToken } from '$lib/auth/storage';
  import { runDeviceFlow } from '$lib/auth/device-flow';
  import { logError } from '$lib/log';
  import { cloneRepository } from '$lib/sync/git';
  import { GEMMA_MODEL_ID, loadModel } from '$lib/llm/runtime';
  import { auth, model } from '$lib/state.svelte';

  // GitHub OAuth App client_id — set VITE_GITHUB_CLIENT_ID in your .env.
  const rawClientId: unknown = import.meta.env['VITE_GITHUB_CLIENT_ID'];
  const clientId = typeof rawClientId === 'string' ? rawClientId : '';

  // ── Auth state ────────────────────────────────────────────────────────────

  type AuthStep = 'idle' | 'waiting-code' | 'polling' | 'done' | 'error';
  let authStep = $state<AuthStep>('idle');
  let userCode = $state<string | undefined>(undefined);
  let verificationUri = $state<string | undefined>(undefined);

  // On mount, restore any persisted token.
  $effect(() => {
    void (async () => {
      try {
        const token = await getAccessToken();
        if (token !== undefined) {
          auth.token = token;
          authStep = 'done';
        }
      } catch (error: unknown) {
        logError('setup/restore-token', { error });
      }
    })();
  });

  function startSignIn() {
    if (clientId === '') {
      logError('setup/sign-in', { reason: 'VITE_GITHUB_CLIENT_ID is not set' });
      return;
    }

    authStep = 'waiting-code';

    void (async () => {
      try {
        const token = await runDeviceFlow(clientId, (code, uri) => {
          userCode = code;
          verificationUri = uri;
          authStep = 'polling';
          globalThis.open(uri, '_blank', 'noopener,noreferrer');
        });
        await setAccessToken(token);
        auth.token = token;
        authStep = 'done';
      } catch (error: unknown) {
        logError('setup/device-flow', { error });
        authStep = 'error';
      }
    })();
  }

  // ── Clone state ───────────────────────────────────────────────────────────

  type CloneStep = 'idle' | 'cloning' | 'done' | 'error';
  let cloneStep = $state<CloneStep>('idle');
  let repoInput = $state('');

  function startClone() {
    const parts = repoInput.trim().split('/');
    const owner = parts[0];
    const name = parts[1];

    if (owner === undefined || owner === '' || name === undefined || name === '') {
      return;
    }
    if (auth.token === undefined) {
      return;
    }

    const token = auth.token;
    cloneStep = 'cloning';

    void (async () => {
      try {
        await cloneRepository(owner, name, token);
        cloneStep = 'done';
      } catch (error: unknown) {
        logError('setup/clone', { error });
        cloneStep = 'error';
      }
    })();
  }

  // ── Model load state ──────────────────────────────────────────────────────

  function startLoadModel() {
    model.loading = true;
    model.loaded = false;
    model.progress = 0;

    void (async () => {
      try {
        await loadModel(GEMMA_MODEL_ID, (progress) => {
          model.progress = progress;
        });
        model.loaded = true;
        model.loading = false;
        model.id = GEMMA_MODEL_ID;
      } catch (error: unknown) {
        logError('setup/load-model', { error });
        model.loading = false;
      }
    })();
  }
</script>

<div class="setup">
  <h1>Setup</h1>

  <!-- Auth -->
  <section>
    <h2>1. Sign in with GitHub</h2>

    {#if authStep === 'idle' || authStep === 'error'}
      {#if authStep === 'error'}
        <p class="error">Sign-in failed. Try again.</p>
      {/if}
      <button onclick={startSignIn} disabled={clientId === ''}>Sign in with GitHub</button>
      {#if clientId === ''}
        <p class="hint">Set <code>VITE_GITHUB_CLIENT_ID</code> in your <code>.env</code> file.</p>
      {/if}
    {:else if authStep === 'waiting-code'}
      <p>Requesting device code…</p>
    {:else if authStep === 'polling'}
      <p>
        Open <a href={verificationUri} target="_blank" rel="noopener noreferrer"
          >{verificationUri}</a
        >
        and enter the code:
      </p>
      <pre class="code">{userCode}</pre>
      <p>Waiting for authorisation…</p>
    {:else if authStep === 'done'}
      <p class="ok">✓ Signed in{auth.user === undefined ? '' : ` as ${auth.user}`}.</p>
    {/if}
  </section>

  <!-- Clone -->
  <section>
    <h2>2. Clone your notes repo</h2>
    {#if auth.token === undefined}
      <p class="hint">Sign in first.</p>
    {:else}
      <label>
        Repository (owner/name)
        <input
          type="text"
          placeholder="octocat/my-notes"
          bind:value={repoInput}
          disabled={cloneStep === 'cloning'}
        />
      </label>
      <button onclick={startClone} disabled={cloneStep === 'cloning' || repoInput.trim() === ''}>
        {cloneStep === 'cloning' ? 'Cloning…' : 'Clone'}
      </button>
      {#if cloneStep === 'done'}
        <p class="ok">✓ Cloned. <a href="/browse">Browse files →</a></p>
      {:else if cloneStep === 'error'}
        <p class="error">Clone failed. Check the repo name and your token permissions.</p>
      {/if}
    {/if}
  </section>

  <!-- LLM -->
  <section>
    <h2>3. Load local AI model</h2>
    {#if model.loaded}
      <p class="ok">✓ {model.id ?? 'Model'} loaded.</p>
    {:else if model.loading}
      <p>Loading {GEMMA_MODEL_ID}… {String(Math.round(model.progress * 100))}%</p>
      <progress value={model.progress}></progress>
    {:else}
      <p>
        Downloads ~1.5 GB on first use; cached in your browser for subsequent loads. Requires a
        WebGPU-capable browser.
      </p>
      <button onclick={startLoadModel}>Load {GEMMA_MODEL_ID}</button>
    {/if}
  </section>
</div>

<style>
  .setup {
    max-width: 32rem;
  }

  h1 {
    font-family: var(--font-mono);
    font-size: 1.25rem;
    margin-bottom: 1.5rem;
  }

  section {
    margin-bottom: 2rem;
    padding: 1rem;
    border: 1px solid var(--color-border);
    border-radius: 4px;
  }

  h2 {
    font-family: var(--font-mono);
    font-size: 0.9rem;
    margin-bottom: 0.75rem;
  }

  label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.875rem;
    margin-bottom: 0.5rem;
  }

  input {
    font-family: var(--font-mono);
    font-size: 0.875rem;
    padding: 0.375rem 0.5rem;
    background: transparent;
    border: 1px solid var(--color-border);
    color: var(--color-fg);
    border-radius: 3px;
  }

  button {
    font-family: var(--font-mono);
    font-size: 0.875rem;
    padding: 0.375rem 0.75rem;
    cursor: pointer;
    background: transparent;
    border: 1px solid var(--color-accent);
    color: var(--color-accent);
    border-radius: 3px;
  }

  button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .code {
    font-family: var(--font-mono);
    font-size: 1.5rem;
    letter-spacing: 0.2em;
    padding: 0.5rem;
    border: 1px solid var(--color-border);
    display: inline-block;
    margin: 0.5rem 0;
  }

  progress {
    width: 100%;
    margin-top: 0.5rem;
  }

  .ok {
    color: var(--color-ok);
    font-size: 0.875rem;
  }

  .error {
    color: var(--color-danger);
    font-size: 0.875rem;
  }

  .hint {
    font-size: 0.8rem;
    opacity: 0.7;
    margin-top: 0.5rem;
  }
</style>
