import { describe, expect, it, vi } from 'vitest';

import {
  ensurePersonaStub,
  loadPersona,
  PERSONA_CHAR_CAP,
  PERSONA_PATH,
  PERSONA_STUB,
  renderPersonaForPrompt,
  type Persona,
  type PersonaReadVault,
  type PersonaWriteVault,
} from '../index';

const noop = (): void => {
  /* swallow */
};

function buildVault(
  files: Record<string, string> = {},
): PersonaReadVault & PersonaWriteVault & { files: Map<string, string> } {
  const map = new Map(Object.entries(files));
  return {
    files: map,
    readRaw: (path) => {
      const value = map.get(path);
      if (value === undefined) {
        const error = new Error(`no file at ${path}`) as Error & { code: string };
        error.code = 'ENOENT';
        return Promise.reject(error);
      }
      return Promise.resolve(value);
    },
    writeNote: (path, content) => {
      map.set(path, content);
      return Promise.resolve();
    },
  };
}

describe('loadPersona', () => {
  it('returns undefined when the file is missing', async () => {
    expect(await loadPersona(buildVault())).toBeUndefined();
  });

  it('returns undefined for a stub-shaped empty file', async () => {
    // The empty stub has placeholder frontmatter (name:, tone:, focus: [])
    // and a body that is just guidance prose. We treat the stub-body as
    // meaningful here since the user *might* have wanted that guidance —
    // but a TRULY empty body and no frontmatter should be undefined.
    const vault = buildVault({
      [PERSONA_PATH]: '---\nname:\n---\n\n',
    });
    expect(await loadPersona(vault)).toBeUndefined();
  });

  it('parses frontmatter + body', async () => {
    const vault = buildVault({
      [PERSONA_PATH]:
        '---\nname: Orvis\ntone: terse\nfocus: [open-brain, cats]\n---\n\nLikes building things.',
    });
    const persona = await loadPersona(vault);
    expect(persona?.frontmatter.name).toBe('Orvis');
    expect(persona?.frontmatter.tone).toBe('terse');
    expect(persona?.frontmatter.focus).toEqual(['open-brain', 'cats']);
    expect(persona?.body).toBe('Likes building things.');
  });

  it('accepts a persona with only frontmatter (no body)', async () => {
    const vault = buildVault({
      [PERSONA_PATH]: '---\nname: A\n---\n\n',
    });
    const persona = await loadPersona(vault);
    expect(persona?.frontmatter.name).toBe('A');
    expect(persona?.body).toBe('');
  });
});

describe('renderPersonaForPrompt', () => {
  it('returns undefined for an absent persona', () => {
    const empty: Persona | undefined = undefined;
    expect(renderPersonaForPrompt(empty)).toBeUndefined();
  });

  it('renders a header line + body', () => {
    const persona: Persona = {
      frontmatter: { name: 'Orvis', tone: 'terse' },
      body: 'Hates filler.',
    };
    const out = renderPersonaForPrompt(persona);
    expect(out).toContain('name: Orvis');
    expect(out).toContain('tone: terse');
    expect(out).toContain('Hates filler.');
  });

  it('omits the header when no frontmatter fields are set', () => {
    const persona: Persona = { frontmatter: {}, body: 'Just body.' };
    expect(renderPersonaForPrompt(persona)).toBe('Just body.');
  });

  it('omits empty-string frontmatter fields', () => {
    const persona: Persona = {
      frontmatter: { name: '', tone: '' },
      body: 'body',
    };
    expect(renderPersonaForPrompt(persona)).toBe('body');
  });

  it('truncates over-budget personas and warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(noop);
    const long = 'x'.repeat(PERSONA_CHAR_CAP + 500);
    const persona: Persona = { frontmatter: {}, body: long };
    const out = renderPersonaForPrompt(persona);
    expect(out?.length).toBeLessThanOrEqual(PERSONA_CHAR_CAP);
    expect(out?.endsWith('…')).toBe(true);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('renders focus as a joined list', () => {
    const persona: Persona = {
      frontmatter: { focus: ['a', 'b', 'c'] },
      body: '',
    };
    expect(renderPersonaForPrompt(persona)).toContain('focus: a, b, c');
  });
});

describe('ensurePersonaStub', () => {
  it('writes the stub when the file is missing', async () => {
    const vault = buildVault();
    const result = await ensurePersonaStub(vault, vault);
    expect(result.created).toBe(true);
    expect(vault.files.get(PERSONA_PATH)).toBe(PERSONA_STUB);
  });

  it('does not overwrite an existing file', async () => {
    const existing = '---\nname: Orvis\n---\n\nMine.';
    const vault = buildVault({ [PERSONA_PATH]: existing });
    const result = await ensurePersonaStub(vault, vault);
    expect(result.created).toBe(false);
    expect(vault.files.get(PERSONA_PATH)).toBe(existing);
  });
});
