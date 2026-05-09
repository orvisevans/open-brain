import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  dispatch,
  registerHandler,
  resetHandlers,
  type DispatchVault,
  type SlashContext,
} from '../dispatch';
import {
  configureEdit,
  editHandler,
  resetEditForTest,
  stripWrappingFences,
} from '../handlers/edit';
import type { SlashLlmRunner } from '../llm-runner';
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

beforeEach(() => {
  resetHandlers();
  resetEditForTest();
  registerHandler('edit', editHandler);
});

afterEach(() => {
  resetEditForTest();
});

describe('/edit', () => {
  it('errors when not configured', async () => {
    const result = await dispatch(
      parse('/edit @notes/foo.md remove the typo'),
      makeContext({ 'notes/foo.md': 'body' }),
    );
    expect(result.kind).toBe('error');
  });

  it('errors when the model is not loaded', async () => {
    const runner: SlashLlmRunner = {
      modelLoaded: () => false,
      complete: () => Promise.resolve(''),
    };
    configureEdit(runner);
    const result = await dispatch(
      parse('/edit @notes/foo.md remove the typo'),
      makeContext({ 'notes/foo.md': 'body' }),
    );
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.message).toContain('Load a model');
    }
  });

  it('errors when the source file is missing', async () => {
    configureEdit({ modelLoaded: () => true, complete: () => Promise.resolve('whatever') });
    const result = await dispatch(parse('/edit @notes/missing.md fix it'), makeContext());
    expect(result.kind).toBe('error');
  });

  it('errors when the LLM returns an empty rewrite', async () => {
    configureEdit({ modelLoaded: () => true, complete: () => Promise.resolve('   ') });
    const result = await dispatch(
      parse('/edit @notes/foo.md drop everything'),
      makeContext({ 'notes/foo.md': '# Title\n\nbody\n' }),
    );
    expect(result.kind).toBe('error');
  });

  it('errors when the LLM returns the same content', async () => {
    const original = '# Title\n\nbody\n';
    configureEdit({ modelLoaded: () => true, complete: () => Promise.resolve(original) });
    const result = await dispatch(
      parse('/edit @notes/foo.md change nothing'),
      makeContext({ 'notes/foo.md': original }),
    );
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.message).toContain('No changes');
    }
  });

  it('produces a replace proposal with the LLM output as finalContent', async () => {
    const original = '# Title\n\noriginal body\n';
    const revised = '# Title\n\nrevised body\n';
    configureEdit({
      modelLoaded: () => true,
      complete: () => Promise.resolve(revised),
    });
    const result = await dispatch(
      parse('/edit @notes/foo.md change body'),
      makeContext({ 'notes/foo.md': original }),
    );
    if (result.kind !== 'proposal') throw new Error('expected proposal');
    expect(result.proposal.op).toBe('replace');
    expect(result.proposal.target).toBe('notes/foo.md');
    expect(result.proposal.existingContent).toBe(original);
    expect(result.proposal.finalContent).toBe(revised);
    expect(result.proposal.summary).toContain('Edit');
    expect(result.proposal.note).toContain('change body');
  });

  it('strips a fenced markdown wrapper from the LLM output', async () => {
    const original = '# Title\n\noriginal\n';
    const wrapped = '```markdown\n# Title\n\nrevised\n```';
    configureEdit({ modelLoaded: () => true, complete: () => Promise.resolve(wrapped) });
    const result = await dispatch(
      parse('/edit @notes/foo.md change body'),
      makeContext({ 'notes/foo.md': original }),
    );
    if (result.kind !== 'proposal') throw new Error('expected proposal');
    expect(result.proposal.finalContent).toBe('# Title\n\nrevised');
  });
});

describe('stripWrappingFences', () => {
  it('removes a generic fence', () => {
    expect(stripWrappingFences('```\nhello\n```')).toBe('hello');
  });

  it('removes a language-tagged fence', () => {
    expect(stripWrappingFences('```markdown\n# x\n```')).toBe('# x');
  });

  it('preserves content without fences', () => {
    expect(stripWrappingFences('plain content')).toBe('plain content');
  });

  it('only strips outer fences, not inner code blocks', () => {
    const inner = '# Title\n\n```js\nconsole.log(1)\n```';
    expect(stripWrappingFences(inner)).toBe(inner);
  });
});
