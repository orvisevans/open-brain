// App-level shared state — module-level Svelte 5 runes.
// Import directly from this module; do not re-export through $lib/index.ts
// until Phase 5 when the public API stabilises.

export const auth = $state<{
  user: string | undefined;
  token: string | undefined;
}>({ user: undefined, token: undefined });

export const model = $state<{
  loaded: boolean;
  loading: boolean;
  progress: number;
  id: string | undefined;
}>({ loaded: false, loading: false, progress: 0, id: undefined });

// Initialised conservatively; the layout updates it via navigator.onLine + events.
export const network = $state<{ online: boolean }>({ online: true });
