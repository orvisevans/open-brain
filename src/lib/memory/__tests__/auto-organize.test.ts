import { describe, expect, it } from 'vitest';

import {
  createAutoOrganize,
  type AutoOrganizeRunEvent,
  type AutoOrganizeRunner,
  type AutoOrganizeVault,
} from '../auto-organize';

import { createFakeClock } from './fakes';

function buildVault(): AutoOrganizeVault & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    readRaw: (path) => {
      const value = files.get(path);
      if (value === undefined) {
        const error = new Error(`no file at ${path}`) as Error & { code: string };
        error.code = 'ENOENT';
        return Promise.reject(error);
      }
      return Promise.resolve(value);
    },
    writeNote: (path, content) => {
      files.set(path, content);
      return Promise.resolve();
    },
  };
}

function buildRunner(responses: string[] = ['NO_EXTRACTIONS']): AutoOrganizeRunner & {
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    modelLoaded: () => true,
    complete: (_system, user) => {
      calls.push(user);
      const next = responses.shift() ?? 'NO_EXTRACTIONS';
      return Promise.resolve(next);
    },
  };
}

const longJournal =
  '# Today\n\n' +
  'I spent the morning working through the embedding-queue. Got the chat chunker ' +
  'producing role-tagged chunks and verified the sidecars round-trip without losing ' +
  'the metadata. The retrieval layer now weights notes higher than chats which feels ' +
  'right for the trust gradient. Tomorrow I want to wire up the auto-organize trigger ' +
  'and see whether the daily review can pick up cumulative suggestions across journal ' +
  'and chat sources.\n';

describe('createAutoOrganize', () => {
  it('ignores curated paths (notes/, lists/)', async () => {
    const vault = buildVault();
    vault.files.set('notes/foo.md', longJournal);
    const runner = buildRunner();
    const clock = createFakeClock();
    const trigger = createAutoOrganize({
      vault,
      llm: runner,
      debounceMs: 10,
      setTimeoutImpl: clock.setTimeout,
      clearTimeoutImpl: clock.clearTimeout,
    });
    trigger.noteChanged('notes/foo.md');
    await clock.advance(100);
    await trigger.whenIdle();
    expect(runner.calls).toEqual([]);
  });

  it('runs after debounce for a journal path with enough content', async () => {
    const vault = buildVault();
    vault.files.set('journal/2026-05-11.md', longJournal);
    const runner = buildRunner([
      [
        'EXTRACT',
        'kind: idea',
        'title: weight notes higher than chats',
        'excerpt: chats weighted lower than notes',
        'content:',
        'Chat retrieval should be down-weighted to keep curated notes preferred.',
        'END',
      ].join('\n'),
    ]);
    const events: AutoOrganizeRunEvent[] = [];
    const clock = createFakeClock();
    const trigger = createAutoOrganize({
      vault,
      llm: runner,
      debounceMs: 10,
      setTimeoutImpl: clock.setTimeout,
      clearTimeoutImpl: clock.clearTimeout,
      onRunComplete: (event) => events.push(event),
    });
    trigger.noteChanged('journal/2026-05-11.md');
    await clock.advance(100);
    await trigger.whenIdle();
    expect(runner.calls).toHaveLength(1);
    expect(events).toEqual([
      { path: 'journal/2026-05-11.md', outcome: 'wrote', suggestionCount: 1 },
    ]);
    const sidecar = vault.files.get('.memory/journal/2026-05-11.md.suggestions.json');
    expect(sidecar).toBeDefined();
  });

  it('skips when source content is shorter than minChars', async () => {
    const vault = buildVault();
    vault.files.set('journal/x.md', 'too short to bother');
    const runner = buildRunner();
    const events: AutoOrganizeRunEvent[] = [];
    const clock = createFakeClock();
    const trigger = createAutoOrganize({
      vault,
      llm: runner,
      debounceMs: 10,
      setTimeoutImpl: clock.setTimeout,
      clearTimeoutImpl: clock.clearTimeout,
      onRunComplete: (event) => events.push(event),
    });
    trigger.noteChanged('journal/x.md');
    await clock.advance(100);
    await trigger.whenIdle();
    expect(runner.calls).toEqual([]);
    expect(events).toEqual([{ path: 'journal/x.md', outcome: 'skipped', reason: 'too-short' }]);
  });

  it('skips re-runs when the source hash matches the cached sidecar', async () => {
    const vault = buildVault();
    vault.files.set('journal/y.md', longJournal);
    const runner = buildRunner(['NO_EXTRACTIONS', 'NO_EXTRACTIONS']);
    const events: AutoOrganizeRunEvent[] = [];
    const clock = createFakeClock();
    const trigger = createAutoOrganize({
      vault,
      llm: runner,
      debounceMs: 10,
      setTimeoutImpl: clock.setTimeout,
      clearTimeoutImpl: clock.clearTimeout,
      onRunComplete: (event) => events.push(event),
    });
    trigger.noteChanged('journal/y.md');
    await clock.advance(100);
    await trigger.whenIdle();
    // Trigger again with no content change.
    trigger.noteChanged('journal/y.md');
    await clock.advance(100);
    await trigger.whenIdle();
    expect(runner.calls).toHaveLength(1); // second pass skipped
    expect(events[1]).toEqual({
      path: 'journal/y.md',
      outcome: 'skipped',
      reason: 'already-fresh',
    });
  });

  it('skips when the LLM model is not loaded', async () => {
    const vault = buildVault();
    vault.files.set('.chats/abc.md', longJournal);
    const runner: AutoOrganizeRunner = {
      modelLoaded: () => false,
      complete: () => Promise.resolve(''),
    };
    const events: AutoOrganizeRunEvent[] = [];
    const clock = createFakeClock();
    const trigger = createAutoOrganize({
      vault,
      llm: runner,
      debounceMs: 10,
      setTimeoutImpl: clock.setTimeout,
      clearTimeoutImpl: clock.clearTimeout,
      onRunComplete: (event) => events.push(event),
    });
    trigger.noteChanged('.chats/abc.md');
    await clock.advance(100);
    await trigger.whenIdle();
    expect(events).toEqual([{ path: '.chats/abc.md', outcome: 'skipped', reason: 'no-llm' }]);
  });

  it('debounces rapid changes into a single run', async () => {
    const vault = buildVault();
    vault.files.set('journal/dbg.md', longJournal);
    const runner = buildRunner(['NO_EXTRACTIONS']);
    const clock = createFakeClock();
    const trigger = createAutoOrganize({
      vault,
      llm: runner,
      debounceMs: 50,
      setTimeoutImpl: clock.setTimeout,
      clearTimeoutImpl: clock.clearTimeout,
    });
    trigger.noteChanged('journal/dbg.md');
    await clock.advance(20);
    trigger.noteChanged('journal/dbg.md');
    await clock.advance(20);
    trigger.noteChanged('journal/dbg.md');
    await clock.advance(200);
    await trigger.whenIdle();
    expect(runner.calls).toHaveLength(1);
  });
});
