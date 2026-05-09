import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { setEmbedderForTest } from '$lib/embed';

import {
  dispatch,
  registerHandler,
  resetHandlers,
  type DispatchVault,
  type SlashContext,
} from '../dispatch';
import { listHandler } from '../handlers/list';
import { parseSlashCommand, type ParsedCommand } from '../parser';

function vaultWith(content: Record<string, string>): DispatchVault {
  return {
    readRaw: (path) => {
      const value = content[path];
      if (value === undefined) {
        const error = new Error(`no file at ${path}`) as Error & { code?: string };
        error.code = 'ENOENT';
        return Promise.reject(error);
      }
      return Promise.resolve(value);
    },
    listNotes: () => Promise.resolve(Object.keys(content)),
  };
}

function makeContext(content: Record<string, string> = {}): SlashContext {
  return {
    vault: vaultWith(content),
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

// Identity-keyed embedder: each unique text gets a distinct one-hot vector.
// Cosine of two identical texts → 1.0, cosine of two different texts → 0.0.
// Lets tests distinguish "exact-match dedup" from "embedding-match dedup".
function installIdentityEmbedder(): () => void {
  const cache = new Map<string, number>();
  setEmbedderForTest({
    embed(texts) {
      return Promise.resolve(
        texts.map((text) => {
          let index = cache.get(text);
          if (index === undefined) {
            index = cache.size;
            cache.set(text, index);
          }
          const vector = new Float32Array(384);
          vector[index % 384] = 1;
          return vector;
        }),
      );
    },
    countTokens(text) {
      return text.split(/\s+/).length;
    },
  });
  return () => {
    setEmbedderForTest(undefined);
  };
}

beforeEach(() => {
  resetHandlers();
  registerHandler('list', listHandler);
});

afterEach(() => {
  setEmbedderForTest(undefined);
});

describe('/list', () => {
  it('proposes creating a new list with one item when none exists', async () => {
    const result = await dispatch(parse('/list grocery eggs'), makeContext());
    if (result.kind !== 'proposal') throw new Error('expected proposal');
    expect(result.proposal.op).toBe('create');
    expect(result.proposal.target).toBe('lists/grocery.md');
    expect(result.proposal.finalContent).toContain('type: list');
    expect(result.proposal.finalContent).toContain('## Items');
    expect(result.proposal.finalContent).toContain('- eggs');
  });

  it('appends a new bullet to an existing list', async () => {
    const existing = [
      '---',
      'type: list',
      '---',
      '',
      '# grocery',
      '',
      '## Items',
      '',
      '- eggs',
      '',
    ].join('\n');
    const restore = installIdentityEmbedder();
    try {
      const result = await dispatch(
        parse('/list grocery milk'),
        makeContext({ 'lists/grocery.md': existing }),
      );
      if (result.kind !== 'proposal') throw new Error('expected proposal');
      expect(result.proposal.op).toBe('append');
      expect(result.proposal.finalContent).toContain('- eggs');
      expect(result.proposal.finalContent).toContain('- milk');
    } finally {
      restore();
    }
  });

  it('rejects exact-duplicate items (case-insensitive)', async () => {
    const existing = '## Items\n\n- Eggs\n';
    const result = await dispatch(
      parse('/list grocery eggs'),
      makeContext({ 'lists/grocery.md': existing }),
    );
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.message).toContain('already on');
    }
  });

  it('finds list by alias from frontmatter', async () => {
    const existing = [
      '---',
      'type: list',
      'aliases: [groceries, food]',
      '---',
      '',
      '## Items',
      '',
      '- eggs',
      '',
    ].join('\n');
    const restore = installIdentityEmbedder();
    try {
      const result = await dispatch(
        parse('/list groceries milk'),
        makeContext({ 'lists/grocery-list.md': existing }),
      );
      if (result.kind !== 'proposal') throw new Error('expected proposal');
      expect(result.proposal.target).toBe('lists/grocery-list.md');
      expect(result.proposal.finalContent).toContain('- milk');
    } finally {
      restore();
    }
  });

  it('falls back to creating a new list when the name does not resolve', async () => {
    const restore = installIdentityEmbedder();
    try {
      const result = await dispatch(
        parse('/list books-to-read sapiens'),
        makeContext({ 'lists/grocery.md': '## Items\n\n- eggs\n' }),
      );
      if (result.kind !== 'proposal') throw new Error('expected proposal');
      expect(result.proposal.target).toBe('lists/books-to-read.md');
      expect(result.proposal.op).toBe('create');
    } finally {
      restore();
    }
  });
});
