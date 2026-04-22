<script lang="ts">
  import { runDeviceFlow } from '$lib/auth/device-flow';
  import {
    getCurrentUser,
    listInstallationRepos,
    listInstallations,
    type GitHubRepo,
  } from '$lib/auth/installations';
  import { clearAccessToken, getAccessToken, setAccessToken } from '$lib/auth/storage';
  import { GEMMA_MODEL_ID, loadModel } from '$lib/llm/runtime';
  import { logError } from '$lib/log';
  import { auth, model } from '$lib/state.svelte';
  import { cloneRepository } from '$lib/sync/git';

  // GitHub App client_id — set VITE_GITHUB_CLIENT_ID in your .env (Iv23li… prefix).
  const rawClientId: unknown = import.meta.env['VITE_GITHUB_CLIENT_ID'];
  const clientId = typeof rawClientId === 'string' ? rawClientId : '';

  // Manage-installations URL. User-facing fallback when the app isn't installed
  // on any repo yet; takes them to their personal installations settings page
  // from which they can open / reconfigure this GitHub App.
  const MANAGE_INSTALLATIONS_URL = 'https://github.com/settings/installations';

  // ── Auth state ────────────────────────────────────────────────────────────

  type AuthStep = 'idle' | 'waiting-code' | 'polling' | 'done' | 'error';
  let authStep = $state<AuthStep>('idle');
  let userCode = $state<string | undefined>(undefined);
  let verificationUri = $state<string | undefined>(undefined);

  // ── Repo-resolution state ─────────────────────────────────────────────────
  //
  // After sign-in we auto-resolve which repo(s) the installed GitHub App has
  // access to. Happy path: exactly one repo → no user input needed. Otherwise
  // we either prompt to install (none) or let the user pick (many).

  type RepoStep = 'idle' | 'resolving' | 'picker' | 'needs-install' | 'ready' | 'error';
  let repoStep = $state<RepoStep>('idle');
  let repoError = $state<string | undefined>(undefined);
  let availableRepos = $state<GitHubRepo[]>([]);
  let selectedRepo = $state<GitHubRepo | undefined>(undefined);

  // ── Clone state ───────────────────────────────────────────────────────────

  type CloneStep = 'idle' | 'cloning' | 'done' | 'error';
  let cloneStep = $state<CloneStep>('idle');
  let cloneError = $state<string | undefined>(undefined);

  // On mount, restore any persisted token and re-resolve repos.
  $effect(() => {
    void (async () => {
      try {
        const token = await getAccessToken();
        if (token !== undefined) {
          auth.token = token;
          authStep = 'done';
          resolveRepos(token);
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
        resolveRepos(token);
      } catch (error: unknown) {
        logError('setup/device-flow', { error });
        authStep = 'error';
      }
    })();
  }

  function signOut() {
    void (async () => {
      try {
        await clearAccessToken();
      } catch (error: unknown) {
        logError('setup/sign-out', { error });
      }
      auth.token = undefined;
      auth.user = undefined;
      userCode = undefined;
      verificationUri = undefined;
      authStep = 'idle';
      repoStep = 'idle';
      repoError = undefined;
      availableRepos = [];
      selectedRepo = undefined;
      cloneStep = 'idle';
      cloneError = undefined;
    })();
  }

  function resolveRepos(token: string) {
    repoStep = 'resolving';
    repoError = undefined;

    void (async () => {
      try {
        const [user, installations] = await Promise.all([
          getCurrentUser(token),
          listInstallations(token),
        ]);
        auth.user = user.login;

        if (installations.length === 0) {
          repoStep = 'needs-install';
          return;
        }

        const repoLists = await Promise.all(
          installations.map((installation) => listInstallationRepos(token, installation.id)),
        );
        const repos = repoLists.flat();

        if (repos.length === 0) {
          repoStep = 'needs-install';
          return;
        }

        availableRepos = repos;
        selectedRepo = repos[0];
        repoStep = repos.length === 1 ? 'ready' : 'picker';
      } catch (error: unknown) {
        logError('setup/resolve-repos', { error });
        repoError = error instanceof Error ? error.message : String(error);
        repoStep = 'error';
      }
    })();
  }

  function startClone() {
    if (auth.token === undefined || selectedRepo === undefined) {
      return;
    }

    const token = auth.token;
    const { name } = selectedRepo;
    const owner = selectedRepo.owner.login;

    cloneStep = 'cloning';
    cloneError = undefined;

    void (async () => {
      try {
        await cloneRepository(owner, name, token);
        cloneStep = 'done';
      } catch (error: unknown) {
        logError('setup/clone', { error });
        cloneError = error instanceof Error ? error.message : String(error);
        cloneStep = 'error';
      }
    })();
  }

  function pickRepo(fullName: string) {
    selectedRepo = availableRepos.find((repo) => repo.full_name === fullName);
  }

  function retryResolve() {
    if (auth.token !== undefined) {
      resolveRepos(auth.token);
    }
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
      <button class="secondary" onclick={signOut}>Sign out</button>
    {/if}
  </section>

  <!-- Repo -->
  <section>
    <h2>2. Clone your notes repo</h2>
    {#if auth.token === undefined}
      <p class="hint">Sign in first.</p>
    {:else if repoStep === 'resolving'}
      <p>Finding repositories you've granted access to…</p>
    {:else if repoStep === 'needs-install'}
      <p class="hint">
        This app isn't installed on any repository yet. Install it on the repo you want to use as
        your notes vault, then come back.
      </p>
      <p>
        <a href={MANAGE_INSTALLATIONS_URL} target="_blank" rel="noopener noreferrer">
          Manage app installations on GitHub →
        </a>
      </p>
      <button class="secondary" onclick={retryResolve}>Retry</button>
    {:else if repoStep === 'error'}
      <p class="error">Couldn't load repositories.</p>
      {#if repoError !== undefined}
        <pre class="error-detail">{repoError}</pre>
      {/if}
      <button class="secondary" onclick={retryResolve}>Retry</button>
    {:else if repoStep === 'picker' || repoStep === 'ready'}
      {#if availableRepos.length > 1}
        <label>
          Repository
          <select
            value={selectedRepo?.full_name ?? ''}
            onchange={(event) => {
              pickRepo((event.currentTarget as HTMLSelectElement).value);
            }}
            disabled={cloneStep === 'cloning'}
          >
            {#each availableRepos as repo (repo.full_name)}
              <option value={repo.full_name}>{repo.full_name}</option>
            {/each}
          </select>
        </label>
      {:else if selectedRepo !== undefined}
        <p class="hint">
          Using <code>{selectedRepo.full_name}</code> (the only repository this app is installed on).
        </p>
      {/if}
      <button onclick={startClone} disabled={cloneStep === 'cloning' || selectedRepo === undefined}>
        {#if cloneStep === 'cloning'}
          Cloning…
        {:else if selectedRepo !== undefined}
          Clone {selectedRepo.full_name}
        {:else}
          Clone
        {/if}
      </button>
      {#if cloneStep === 'done'}
        <p class="ok">✓ Cloned. <a href="/browse">Browse files →</a></p>
      {:else if cloneStep === 'error'}
        <p class="error">Clone failed.</p>
        {#if cloneError !== undefined}
          <pre class="error-detail">{cloneError}</pre>
        {/if}
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

  select {
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

  button.secondary {
    border-color: var(--color-border);
    color: var(--color-fg);
    opacity: 0.7;
    margin-top: 0.5rem;
  }

  button.secondary:hover {
    opacity: 1;
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

  .error-detail {
    font-family: var(--font-mono);
    font-size: 0.75rem;
    white-space: pre-wrap;
    word-break: break-word;
    padding: 0.5rem;
    margin-top: 0.25rem;
    border: 1px solid var(--color-border);
    color: var(--color-danger);
    opacity: 0.8;
  }

  .hint {
    font-size: 0.8rem;
    opacity: 0.7;
    margin-top: 0.5rem;
  }
</style>
