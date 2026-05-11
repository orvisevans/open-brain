// Toast store (Phase 9).
//
// Single global store that any caller can push human-readable error
// messages into. The root layout renders them. Three rules from the
// design doc §9:
//   - identical messages within 30s collapse to one entry with a count
//   - auto-dismiss after 6s unless the entry carries an `action`
//   - position is layout's concern; the store just owns the list
//
// Pure state — no Svelte runes, no DOM. Tests subscribe directly and
// verify the snapshot.

export interface Toast {
  id: string;
  message: string;
  // Optional secondary action button. When present, the toast does NOT
  // auto-dismiss; the user must tap it (or the toast itself) to clear.
  action?: { label: string; onClick: () => void };
  // Severity is mostly cosmetic — the rendering component picks a color.
  severity: 'info' | 'warn' | 'error';
  // How many duplicate pushes have collapsed into this entry. >= 1.
  count: number;
  // ms epoch — used by the duplicate-collapse window check.
  createdAt: number;
}

export interface ToastStore {
  readonly value: Toast[];
  show(input: ToastInput): string;
  dismiss(id: string): void;
  subscribe(listener: (toasts: Toast[]) => void): () => void;
  // Test seam.
  _resetForTest(): void;
}

export interface ToastInput {
  message: string;
  severity?: Toast['severity'];
  action?: Toast['action'];
}

export interface ToastStoreOptions {
  // Window during which identical messages collapse onto the most recent
  // entry. Default 30s per design §9.
  collapseWindowMs?: number;
  // Auto-dismiss timer for actionless toasts. Default 6s.
  autoDismissMs?: number;
  now?: () => number;
  setTimeoutImpl?: (handler: () => void, ms: number) => unknown;
  clearTimeoutImpl?: (handle: unknown) => void;
}

const DEFAULT_COLLAPSE_WINDOW_MS = 30_000;
const DEFAULT_AUTO_DISMISS_MS = 6000;

export function createToastStore(options: ToastStoreOptions = {}): ToastStore {
  const collapseWindowMs = options.collapseWindowMs ?? DEFAULT_COLLAPSE_WINDOW_MS;
  const autoDismissMs = options.autoDismissMs ?? DEFAULT_AUTO_DISMISS_MS;
  const now = options.now ?? (() => Date.now());
  const setTimer = options.setTimeoutImpl ?? ((h, ms) => globalThis.setTimeout(h, ms));
  const clearTimer =
    options.clearTimeoutImpl ??
    ((handle: unknown) => {
      globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>);
    });

  const state: { items: Toast[] } = { items: [] };
  const timers = new Map<string, unknown>();
  const listeners = new Set<(toasts: Toast[]) => void>();
  let counter = 0;

  function emit(): void {
    const snapshot = [...state.items];
    for (const listener of listeners) listener(snapshot);
  }

  function scheduleDismiss(id: string): void {
    const handle = setTimer(() => {
      timers.delete(id);
      doDismiss(id);
    }, autoDismissMs);
    timers.set(id, handle);
  }

  function doDismiss(id: string): void {
    const before = state.items.length;
    state.items = state.items.filter((toast) => toast.id !== id);
    if (state.items.length !== before) emit();
    const handle = timers.get(id);
    if (handle !== undefined) {
      clearTimer(handle);
      timers.delete(id);
    }
  }

  function show(input: ToastInput): string {
    const severity = input.severity ?? 'error';
    const t = now();
    // Look for a recent duplicate to collapse onto. Match on
    // (message, severity); ignore actions — if there's an action, the
    // toast is interactive and shouldn't collapse silently.
    if (input.action === undefined) {
      for (const existing of state.items) {
        if (
          existing.message === input.message &&
          existing.severity === severity &&
          existing.action === undefined &&
          t - existing.createdAt <= collapseWindowMs
        ) {
          existing.count += 1;
          existing.createdAt = t; // refresh the window
          // Refresh the auto-dismiss timer.
          const handle = timers.get(existing.id);
          if (handle !== undefined) clearTimer(handle);
          scheduleDismiss(existing.id);
          emit();
          return existing.id;
        }
      }
    }

    counter += 1;
    const id = `toast-${String(t)}-${String(counter)}`;
    const toast: Toast = {
      id,
      message: input.message,
      ...(input.action !== undefined && { action: input.action }),
      severity,
      count: 1,
      createdAt: t,
    };
    state.items = [...state.items, toast];
    if (toast.action === undefined) scheduleDismiss(id);
    emit();
    return id;
  }

  function dismiss(id: string): void {
    doDismiss(id);
  }

  function subscribe(listener: (toasts: Toast[]) => void): () => void {
    listeners.add(listener);
    listener([...state.items]);
    return () => listeners.delete(listener);
  }

  function _resetForTest(): void {
    for (const handle of timers.values()) clearTimer(handle);
    timers.clear();
    state.items = [];
    counter = 0;
    emit();
  }

  return {
    get value() {
      return [...state.items];
    },
    show,
    dismiss,
    subscribe,
    _resetForTest,
  };
}

// Production singleton — callers import `toasts` and call `toasts.show(...)`.
// Tests instantiate their own via `createToastStore` for isolation.
export const toasts: ToastStore = createToastStore();
