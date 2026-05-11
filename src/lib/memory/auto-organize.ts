// Auto-organize trigger (Phase 5.8).
//
// Watches vault writes and silently runs the LLM organize pipeline against
// "messy" sources (journal entries, chat sessions) when they grow past a
// density threshold. The result lands as a `.suggestions.json` sidecar —
// the same shape the manual `/organize @path` handler writes — so the
// existing daily-review banner and (future) Browse Organize panel can
// surface them without any extra plumbing.
//
// Design notes:
//   - Debounced per path: rapid edits collapse to one run.
//   - Single-flight per path: an in-flight run blocks re-entry; a later
//     change re-arms the debounce timer.
//   - No new queue. Runs inline on its own debounce. The LLM call is gated
//     by the runner's `modelLoaded()` and the caller's GpuLease (chat
//     always wins via that lease — see `$lib/llm/runtime`).
//   - The trigger emits no UI. Suggestions are silent until the user opens
//     daily-review or browses to the source.

import type { NotePath } from '$lib/vault/types';

import { hashContent } from './hash';
import { buildOrganizePrompt, ORGANIZE_SYSTEM_PROMPT, parseOrganizeOutput } from './organize';
import {
  readSuggestions,
  writeSuggestions,
  type Suggestion,
  type SuggestionSidecar,
  SUGGESTIONS_SCHEMA_VERSION,
} from './suggestions';

export interface AutoOrganizeRunner {
  modelLoaded(): boolean;
  complete(systemPrompt: string, userPrompt: string): Promise<string>;
}

export interface AutoOrganizeVault {
  readRaw(path: NotePath): Promise<string>;
  writeNote(path: NotePath, content: string): Promise<void>;
}

export interface AutoOrganizeOptions {
  vault: AutoOrganizeVault;
  llm: AutoOrganizeRunner;
  // Minimum non-whitespace characters in the source before we'll consider
  // organizing. Journal entries with a single sentence aren't worth the LLM
  // round-trip; we wait for substance.
  minChars?: number;
  // Debounce window after the last write before the organize call fires.
  // Default 60s — long enough to absorb a burst of journal appends in a
  // single capture session.
  debounceMs?: number;
  // Test seam: alternative `setTimeout` / `clearTimeout`.
  setTimeoutImpl?: (handler: () => void, ms: number) => unknown;
  clearTimeoutImpl?: (handle: unknown) => void;
  // Diagnostics — invoked once per completed run (or skipped run with a
  // reason). Wired in production to surface progress in the status bar or
  // dev console.
  onRunComplete?: (event: AutoOrganizeRunEvent) => void;
}

export type AutoOrganizeRunEvent =
  | { path: NotePath; outcome: 'wrote'; suggestionCount: number }
  | { path: NotePath; outcome: 'no-extractions' }
  | { path: NotePath; outcome: 'skipped'; reason: AutoOrganizeSkipReason }
  | { path: NotePath; outcome: 'error'; error: string };

export type AutoOrganizeSkipReason = 'not-mess-shaped' | 'too-short' | 'no-llm' | 'already-fresh';

const DEFAULT_DEBOUNCE_MS = 60_000;
const DEFAULT_MIN_CHARS = 200;
// Trigger only on paths that are "mess-shaped" — captures the user types
// fast without organizing. Curated notes (`notes/foo.md`, `lists/bar.md`)
// are explicitly NOT auto-organized; the user already structured them.
const MESS_PREFIXES = ['journal/', '.chats/'];

export interface AutoOrganizeTrigger {
  /** Hand off a vault path. Non-mess-shaped paths are silently ignored. */
  noteChanged(path: NotePath): void;
  /** Resolves after any in-flight or pending run settles. Test seam. */
  whenIdle(): Promise<void>;
  /** Cancel any pending debounced runs. */
  stop(): void;
}

export function createAutoOrganize(options: AutoOrganizeOptions): AutoOrganizeTrigger {
  const minChars = options.minChars ?? DEFAULT_MIN_CHARS;
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const setTimer = options.setTimeoutImpl ?? ((h, ms) => globalThis.setTimeout(h, ms));
  const clearTimer =
    options.clearTimeoutImpl ??
    ((handle: unknown) => {
      globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>);
    });

  // One pending timer per path; restarted on each change.
  const timers = new Map<NotePath, unknown>();
  // Tracks the active run per path so concurrent triggers don't collide.
  const inFlight = new Map<NotePath, Promise<void>>();
  // Track all in-flight runs together for whenIdle().
  let outstanding: Promise<void>[] = [];

  function isMessShaped(path: NotePath): boolean {
    return MESS_PREFIXES.some((prefix) => path.startsWith(prefix));
  }

  function noteChanged(path: NotePath): void {
    if (!isMessShaped(path)) return;
    const existingTimer = timers.get(path);
    if (existingTimer !== undefined) clearTimer(existingTimer);
    const newTimer = setTimer(() => {
      timers.delete(path);
      const run = drive(path);
      outstanding.push(run);
      void run.finally(() => {
        outstanding = outstanding.filter((p) => p !== run);
      });
    }, debounceMs);
    timers.set(path, newTimer);
  }

  async function drive(path: NotePath): Promise<void> {
    const existing = inFlight.get(path);
    if (existing !== undefined) {
      await existing;
      return;
    }
    const run = runOnce(path);
    inFlight.set(path, run);
    try {
      await run;
    } finally {
      inFlight.delete(path);
    }
  }

  async function runOnce(path: NotePath): Promise<void> {
    let content: string;
    try {
      content = await options.vault.readRaw(path);
    } catch (error: unknown) {
      // Path may have been deleted between trigger and run. Silent.
      options.onRunComplete?.({
        path,
        outcome: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    const nonWhitespace = content.replaceAll(/\s+/g, '');
    if (nonWhitespace.length < minChars) {
      options.onRunComplete?.({ path, outcome: 'skipped', reason: 'too-short' });
      return;
    }

    if (!options.llm.modelLoaded()) {
      options.onRunComplete?.({ path, outcome: 'skipped', reason: 'no-llm' });
      return;
    }

    const sourceHash = await hashContent(content);
    try {
      const cached = await readSuggestions(options.vault, path);
      if (cached?.source_hash === sourceHash) {
        options.onRunComplete?.({ path, outcome: 'skipped', reason: 'already-fresh' });
        return;
      }
    } catch {
      // Read failure on the suggestion sidecar shouldn't block — proceed
      // with a fresh extraction.
    }

    let output: string;
    try {
      output = await options.llm.complete(
        ORGANIZE_SYSTEM_PROMPT,
        buildOrganizePrompt(path, content),
      );
    } catch (error: unknown) {
      options.onRunComplete?.({
        path,
        outcome: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    const suggestions: Suggestion[] = parseOrganizeOutput(output);
    if (suggestions.length === 0) {
      // Still write a sidecar so we don't keep re-running on every change.
      // The sidecar's source_hash gates the next run.
      const empty: SuggestionSidecar = {
        schema_version: SUGGESTIONS_SCHEMA_VERSION,
        source: path,
        source_hash: sourceHash,
        generated_at: new Date().toISOString(),
        suggestions: [],
      };
      try {
        await writeSuggestions(options.vault, empty);
      } catch {
        // Write failures are non-fatal — we'll re-try on the next change.
      }
      options.onRunComplete?.({ path, outcome: 'no-extractions' });
      return;
    }

    const sidecar: SuggestionSidecar = {
      schema_version: SUGGESTIONS_SCHEMA_VERSION,
      source: path,
      source_hash: sourceHash,
      generated_at: new Date().toISOString(),
      suggestions,
    };
    try {
      await writeSuggestions(options.vault, sidecar);
      options.onRunComplete?.({
        path,
        outcome: 'wrote',
        suggestionCount: suggestions.length,
      });
    } catch (error: unknown) {
      options.onRunComplete?.({
        path,
        outcome: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function whenIdle(): Promise<void> {
    while (outstanding.length > 0) {
      await Promise.all(outstanding);
    }
  }

  function stop(): void {
    for (const timer of timers.values()) clearTimer(timer);
    timers.clear();
  }

  return { noteChanged, whenIdle, stop };
}
