import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  extractSlashFromResponse,
  loadLlmEmitEnabled,
  saveLlmEmitEnabled,
  SLASH_EMIT_SYSTEM_INSTRUCTION,
} from '../llm-emit';

beforeEach(() => {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (key: string) => store.get(key),
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => {
        store.clear();
      },
    } as unknown as Storage,
    configurable: true,
  });
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'localStorage');
});

describe('LLM emit toggle persistence', () => {
  it('starts disabled (default off until the bench validates reliability)', () => {
    expect(loadLlmEmitEnabled()).toBe(false);
  });

  it('round-trips through localStorage', () => {
    saveLlmEmitEnabled(true);
    expect(loadLlmEmitEnabled()).toBe(true);
    saveLlmEmitEnabled(false);
    expect(loadLlmEmitEnabled()).toBe(false);
  });
});

describe('extractSlashFromResponse', () => {
  it('returns undefined for non-slash responses', () => {
    expect(extractSlashFromResponse('Hello there!')).toBeUndefined();
    expect(extractSlashFromResponse('')).toBeUndefined();
    expect(extractSlashFromResponse('   ')).toBeUndefined();
  });

  it('returns the trimmed line for a clean single-line slash', () => {
    expect(extractSlashFromResponse('/journal Today was good')).toBe('/journal Today was good');
    expect(extractSlashFromResponse('  /save  ')).toBe('/save');
  });

  it('rejects multi-line responses even if they start with /', () => {
    expect(extractSlashFromResponse('/save\n\nI saved your note')).toBeUndefined();
    expect(extractSlashFromResponse('/journal entry\nLet me explain what I did')).toBeUndefined();
  });
});

describe('SLASH_EMIT_SYSTEM_INSTRUCTION', () => {
  it('mentions every shipped command at least once', () => {
    for (const command of ['/journal', '/save', '/note', '/list', '/append']) {
      expect(SLASH_EMIT_SYSTEM_INSTRUCTION).toContain(command);
    }
  });

  it('tells the model to reply normally otherwise', () => {
    expect(SLASH_EMIT_SYSTEM_INSTRUCTION.toLowerCase()).toContain('reply normally');
  });
});
