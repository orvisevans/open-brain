import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  dispatch,
  registerHandler,
  resetHandlers,
  type DispatchVault,
  type SlashContext,
} from '../dispatch';
import {
  configureOrganize,
  organizeHandler,
  resetOrganizeForTest,
  type OrganizeLlmRunner,
  type OrganizeSidecarVault,
} from '../handlers/organize';
import { parseSlashCommand, type ParsedCommand } from '../parser';

function vaultWith(content: Record<string, string>): DispatchVault & OrganizeSidecarVault {
  const store = new Map(Object.entries(content));
  return {
    readRaw: (path) => {
      const value = store.get(path);
      if (value === undefined) {
        const error = new Error(`no file at ${path}`) as Error & { code?: string };
        error.code = 'ENOENT';
        return Promise.reject(error);
      }
      return Promise.resolve(value);
    },
    listNotes: () => Promise.resolve([...store.keys()]),
    writeNote: (path, value) => {
      store.set(path, value);
      return Promise.resolve();
    },
  };
}

function makeContext(vault: DispatchVault): SlashContext {
  return {
    vault,
    now: () => new Date(Date.UTC(2026, 4, 9, 7, 15)),
    sourceTurnId: 'turn-1',
    sessionId: 'session-1',
    sessionMessages: [],
  };
}

function parse(input: string): ParsedCommand {
  const result = parseSlashCommand(input);
  if (result === undefined) throw new Error(`expected slash command for: ${input}`);
  return result;
}

const SAMPLE_OUTPUT = [
  'EXTRACT',
  'kind: idea',
  'title: Cache LLM outputs',
  'excerpt: We could hash inputs',
  'content:',
  'Hash and store the LLM result so re-running on unchanged content is free.',
  'END',
  'EXTRACT',
  'kind: task',
  'title: Send Sarah the article',
  'content:',
  'Email her the cosine-similarity write-up by Friday.',
  'END',
].join('\n');

beforeEach(() => {
  resetHandlers();
  resetOrganizeForTest();
  registerHandler('organize', organizeHandler);
});

afterEach(() => {
  resetOrganizeForTest();
});

describe('/organize', () => {
  it('errors when not configured', async () => {
    const result = await dispatch(
      parse('/organize @journal/2026-05-09.md'),
      makeContext(vaultWith({ 'journal/2026-05-09.md': 'some content' })),
    );
    expect(result.kind).toBe('error');
  });

  it('errors when the model is not loaded', async () => {
    const vault = vaultWith({ 'journal/2026-05-09.md': 'content' });
    const runner: OrganizeLlmRunner = {
      modelLoaded: () => false,
      complete: () => Promise.resolve(''),
    };
    configureOrganize(runner, vault);
    const result = await dispatch(parse('/organize @journal/2026-05-09.md'), makeContext(vault));
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.message).toContain('Load a model');
    }
  });

  it('errors when the source note is empty', async () => {
    const vault = vaultWith({ 'journal/2026-05-09.md': '   ' });
    configureOrganize({ modelLoaded: () => true, complete: () => Promise.resolve('') }, vault);
    const result = await dispatch(parse('/organize @journal/2026-05-09.md'), makeContext(vault));
    expect(result.kind).toBe('error');
  });

  it('produces a proposal per extraction on cache miss', async () => {
    const vault = vaultWith({
      'journal/2026-05-09.md': 'today I had two thoughts and one task',
    });
    configureOrganize(
      {
        modelLoaded: () => true,
        complete: () => Promise.resolve(SAMPLE_OUTPUT),
      },
      vault,
    );
    const result = await dispatch(parse('/organize @journal/2026-05-09.md'), makeContext(vault));
    if (result.kind !== 'proposals') throw new Error(`expected proposals, got ${result.kind}`);
    expect(result.proposals).toHaveLength(2);
    expect(result.proposals[0]?.target).toBe('notes/cache-llm-outputs.md');
    expect(result.proposals[0]?.summary).toContain('Idea');
    expect(result.proposals[1]?.target).toBe('notes/send-sarah-the-article.md');
    expect(result.proposals[1]?.summary).toContain('Task');
    expect(result.proposals[0]?.finalContent).toContain('source: journal/2026-05-09.md');
    expect(result.proposals[0]?.finalContent).toContain('kind: idea');
  });

  it('uses cached sidecar on second invocation if hash matches', async () => {
    const vault = vaultWith({
      'journal/2026-05-09.md': 'today I had two thoughts and one task',
    });
    let llmCalls = 0;
    configureOrganize(
      {
        modelLoaded: () => true,
        complete: () => {
          llmCalls++;
          return Promise.resolve(SAMPLE_OUTPUT);
        },
      },
      vault,
    );

    const first = await dispatch(parse('/organize @journal/2026-05-09.md'), makeContext(vault));
    expect(first.kind).toBe('proposals');
    expect(llmCalls).toBe(1);

    const second = await dispatch(parse('/organize @journal/2026-05-09.md'), makeContext(vault));
    expect(second.kind).toBe('proposals');
    expect(llmCalls).toBe(1); // still 1 — sidecar served the second call
  });

  it('reruns the LLM when the source content has changed', async () => {
    const vault = vaultWith({
      'journal/2026-05-09.md': 'first version',
    });
    let llmCalls = 0;
    configureOrganize(
      {
        modelLoaded: () => true,
        complete: () => {
          llmCalls++;
          return Promise.resolve(SAMPLE_OUTPUT);
        },
      },
      vault,
    );
    await dispatch(parse('/organize @journal/2026-05-09.md'), makeContext(vault));
    await vault.writeNote('journal/2026-05-09.md', 'second version, very different');
    await dispatch(parse('/organize @journal/2026-05-09.md'), makeContext(vault));
    expect(llmCalls).toBe(2);
  });

  it('errors when the LLM returns NO_EXTRACTIONS', async () => {
    const vault = vaultWith({ 'journal/2026-05-09.md': 'just a quick note' });
    configureOrganize(
      { modelLoaded: () => true, complete: () => Promise.resolve('NO_EXTRACTIONS') },
      vault,
    );
    const result = await dispatch(parse('/organize @journal/2026-05-09.md'), makeContext(vault));
    expect(result.kind).toBe('error');
  });

  it('avoids slug collisions across multiple suggestions in one batch', async () => {
    const vault = vaultWith({
      'journal/x.md': 'two ideas with the same title',
      'notes/idea.md': '',
    });
    const collidingOutput = [
      'EXTRACT',
      'kind: idea',
      'title: Idea',
      'content:',
      'first',
      'END',
      'EXTRACT',
      'kind: idea',
      'title: Idea',
      'content:',
      'second',
      'END',
    ].join('\n');
    configureOrganize(
      { modelLoaded: () => true, complete: () => Promise.resolve(collidingOutput) },
      vault,
    );
    const result = await dispatch(parse('/organize @journal/x.md'), makeContext(vault));
    if (result.kind !== 'proposals') throw new Error('expected proposals');
    const targets = result.proposals.map((proposal) => proposal.target);
    expect(new Set(targets).size).toBe(targets.length);
  });
});
