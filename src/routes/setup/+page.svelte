<script lang="ts">
  import { runDeviceFlow } from '$lib/auth/device-flow';
  import {
    getCurrentUser,
    listInstallationRepos,
    listInstallations,
    type GitHubRepo,
  } from '$lib/auth/installations';
  import { adoptBundle, getValidAccessToken, initSession } from '$lib/auth/session';
  import { wipeLocalData } from '$lib/auth/wipe';
  import {
    DEFAULT_VARIANT_ID,
    getVariant,
    loadModel,
    MODEL_VARIANTS,
    type ModelVariant,
  } from '$lib/llm/runtime';
  import { logError } from '$lib/log';
  import { auth, model, repo } from '$lib/state.svelte';
  import { cloneRepository } from '$lib/sync/git';
  import { setStoredRepo } from '$lib/sync/repo-storage';

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

  // On mount, restore any persisted session and re-resolve repos. Session
  // init proactively refreshes the access token if it's near expiry, so
  // the resolveRepos call below always runs against a fresh token.
  $effect(() => {
    if (clientId === '') return;
    void (async () => {
      try {
        const bundle = await initSession({ clientId });
        if (bundle !== undefined) {
          authStep = 'done';
          resolveRepos(bundle.accessToken);
        }
      } catch (error: unknown) {
        logError('setup/restore-session', { error });
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
        const bundle = await runDeviceFlow(clientId, (code, uri) => {
          userCode = code;
          verificationUri = uri;
          authStep = 'polling';
          globalThis.open(uri, '_blank', 'noopener,noreferrer');
        });
        await adoptBundle(bundle);
        authStep = 'done';
        resolveRepos(bundle.accessToken);
      } catch (error: unknown) {
        logError('setup/device-flow', { error });
        authStep = 'error';
      }
    })();
  }

  function signOut() {
    void (async () => {
      try {
        // Wipe every IndexedDB database we own (auth token, repo identity,
        // and the lightning-fs working tree). The WebLLM model cache lives
        // in a separate database and is intentionally preserved — it's
        // multi-GB and reusable across logins. Reload right after so any
        // open db handles drop and the runes re-initialise from a clean slate.
        await wipeLocalData();
      } catch (error: unknown) {
        logError('setup/sign-out', { error });
      }
      globalThis.location.assign('/setup');
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
    if (selectedRepo === undefined) return;

    const { name } = selectedRepo;
    const owner = selectedRepo.owner.login;

    cloneStep = 'cloning';
    cloneError = undefined;

    void (async () => {
      try {
        // Use getValidAccessToken so we hit refresh-on-near-expiry before
        // committing to a clone (which can take a while and can't easily
        // be retried mid-stream).
        const token = await getValidAccessToken();
        if (token === undefined) {
          throw new Error('No active session — sign in first.');
        }
        await cloneRepository(owner, name, token);
        await setStoredRepo({ owner, name });
        repo.owner = owner;
        repo.name = name;
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
    void (async () => {
      const token = await getValidAccessToken();
      if (token !== undefined) {
        resolveRepos(token);
      }
    })();
  }

  // ── Model load state ──────────────────────────────────────────────────────

  let selectedVariantId = $state<string>(model.id ?? DEFAULT_VARIANT_ID);
  const selectedVariant = $derived<ModelVariant | undefined>(getVariant(selectedVariantId));

  function pickVariant(id: string) {
    selectedVariantId = id;
  }

  function startLoadModel() {
    model.loading = true;
    model.loaded = false;
    model.progress = 0;

    const variantId = selectedVariantId;
    void (async () => {
      try {
        await loadModel(variantId, (progress) => {
          model.progress = progress;
        });
        model.loaded = true;
        model.loading = false;
        model.id = variantId;
      } catch (error: unknown) {
        logError('setup/load-model', { error });
        model.loading = false;
      }
    })();
  }

  function formatMb(mb: number): string {
    if (mb < 1024) return `${String(mb)} MB`;
    return `${(mb / 1024).toFixed(1)} GB`;
  }

  function loadButtonLabel(): string {
    const label = selectedVariant?.label ?? 'selected variant';
    if (!model.loaded) return `Load ${label}`;
    if (selectedVariant?.id === model.id) return `Reload ${label}`;
    return `Switch to ${label}`;
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
      <p class="hint">Switch variant by selecting another option below and reloading.</p>
    {:else if model.loading}
      <p>Loading {model.id ?? selectedVariantId}… {String(Math.round(model.progress * 100))}%</p>
      <progress value={model.progress}></progress>
    {/if}

    <fieldset class="variants" disabled={model.loading}>
      <legend class="hint">Model variant</legend>
      {#each MODEL_VARIANTS as variant (variant.id)}
        <label class="variant" class:active={selectedVariantId === variant.id}>
          <input
            type="radio"
            name="variant"
            value={variant.id}
            checked={selectedVariantId === variant.id}
            onchange={() => {
              pickVariant(variant.id);
            }}
          />
          <span class="variant-head">
            <span class="variant-label">{variant.label}</span>
            <span class="variant-size">
              {formatMb(variant.downloadMb)} download · ~{formatMb(variant.vramMb)} VRAM
            </span>
          </span>
          <span class="variant-desc">{variant.description}</span>
        </label>
      {/each}
    </fieldset>

    {#if !model.loading}
      <button onclick={startLoadModel} disabled={selectedVariant === undefined}>
        {loadButtonLabel()}
      </button>
      <p class="hint">
        Models cache in your browser; switching reloads weights but doesn't re-download cached ones.
        Requires a WebGPU-capable browser.
      </p>
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

  .variants {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    border: none;
    padding: 0;
    margin: 0.5rem 0 0.75rem;
  }

  .variants legend {
    margin-bottom: 0.25rem;
  }

  .variant {
    display: grid;
    grid-template-columns: 1.25rem 1fr;
    grid-template-areas: 'radio head' 'radio desc';
    gap: 0.1rem 0.5rem;
    padding: 0.4rem 0.6rem;
    border: 1px solid var(--color-border);
    border-radius: 3px;
    cursor: pointer;
    font-size: 0.8rem;
  }

  .variant input {
    grid-area: radio;
    margin-top: 0.25rem;
    accent-color: var(--color-accent);
  }

  .variant.active {
    border-color: var(--color-accent);
  }

  .variant-head {
    grid-area: head;
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
    font-family: var(--font-mono);
  }

  .variant-label {
    color: var(--color-fg);
    font-weight: 600;
  }

  .variant-size {
    opacity: 0.6;
    font-size: 0.7rem;
  }

  .variant-desc {
    grid-area: desc;
    opacity: 0.75;
    font-size: 0.75rem;
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
