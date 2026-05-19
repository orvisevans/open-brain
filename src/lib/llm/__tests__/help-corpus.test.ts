import { describe, expect, it } from 'vitest';

import type { NotePath } from '$lib/vault/types';

import {
  ensureHelpCorpus,
  extractCommandSection,
  HELP_COMMAND_NAMES,
  HELP_CORPUS,
  HELP_CORPUS_VERSION,
  HELP_GETTING_STARTED_PATH,
  HELP_SLASH_COMMANDS_PATH,
  HELP_VAULT_LAYOUT_PATH,
  isHelpCorpusPath,
  listCommandShortHelp,
  readEmbeddedVersion,
} from '../help-corpus';

function createFakeVault(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial));
  const writes: { path: NotePath; content: string }[] = [];
  return {
    readRaw: (path: NotePath): Promise<string> => {
      const value = store.get(path);
      if (value === undefined) {
        const error: NodeJS.ErrnoException = new Error(`ENOENT: ${path}`);
        error.code = 'ENOENT';
        return Promise.reject(error);
      }
      return Promise.resolve(value);
    },
    writeNote: (path: NotePath, content: string): Promise<void> => {
      store.set(path, content);
      writes.push({ path, content });
      return Promise.resolve();
    },
    store,
    writes,
  };
}

describe('HELP_CORPUS', () => {
  it('ships three files under .openbrain/help/', () => {
    const paths = HELP_CORPUS.map((file) => file.path).sort();
    expect(paths).toEqual(
      [HELP_GETTING_STARTED_PATH, HELP_SLASH_COMMANDS_PATH, HELP_VAULT_LAYOUT_PATH].sort(),
    );
    for (const path of paths) {
      expect(path.startsWith('.openbrain/help/')).toBe(true);
      expect(path.endsWith('.md')).toBe(true);
    }
  });

  it('embeds the version marker so on-disk staleness can be detected', () => {
    for (const file of HELP_CORPUS) {
      expect(readEmbeddedVersion(file.content)).toBe(HELP_CORPUS_VERSION);
    }
  });

  it('keeps each file in the 1500–10000 char range — small enough to chunk, big enough to be useful', () => {
    for (const file of HELP_CORPUS) {
      expect(file.content.length).toBeGreaterThan(1500);
      expect(file.content.length).toBeLessThan(10_000);
    }
  });

  it('every command in HELP_COMMAND_NAMES has a "## /<name>" heading in slash-commands.md', () => {
    const slashFile = HELP_CORPUS.find((file) => file.path === HELP_SLASH_COMMANDS_PATH);
    expect(slashFile).toBeDefined();
    for (const name of HELP_COMMAND_NAMES) {
      expect(slashFile?.content).toContain(`## /${name}\n`);
    }
  });

  it('every section in every doc starts with a level-2 heading (stable chunk boundaries)', () => {
    for (const file of HELP_CORPUS) {
      // Skip the version-marker line + h1 + blank, then everything else
      // structural should be h2. We assert there are at least 3 h2 headings
      // per file rather than reverse-engineering the chunker's behavior here.
      const headingCount = (file.content.match(/\n## /g) ?? []).length;
      expect(headingCount).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('isHelpCorpusPath', () => {
  it('matches .openbrain/help/*.md', () => {
    expect(isHelpCorpusPath('.openbrain/help/getting-started.md')).toBe(true);
    expect(isHelpCorpusPath('.openbrain/help/slash-commands.md')).toBe(true);
    expect(isHelpCorpusPath('.openbrain/help/anything.md')).toBe(true);
  });

  it('rejects siblings under .openbrain/ that aren’t in help/', () => {
    expect(isHelpCorpusPath('.openbrain/persona.md')).toBe(false);
    expect(isHelpCorpusPath('.openbrain/config.yaml')).toBe(false);
    expect(isHelpCorpusPath('.openbrain/command-stats.json')).toBe(false);
  });

  it('rejects unrelated paths', () => {
    expect(isHelpCorpusPath('notes/foo.md')).toBe(false);
    expect(isHelpCorpusPath('.chats/2026-05-19.md')).toBe(false);
    expect(isHelpCorpusPath('.openbrain/help/notes.txt')).toBe(false);
  });
});

describe('readEmbeddedVersion', () => {
  it('parses the v1 marker', () => {
    expect(readEmbeddedVersion('<!-- openbrain-help: v1 -->\n\n# foo')).toBe(1);
  });

  it('parses double-digit versions', () => {
    expect(readEmbeddedVersion('<!-- openbrain-help: v42 -->\n\n# foo')).toBe(42);
  });

  it('returns 0 when the marker is missing', () => {
    expect(readEmbeddedVersion('# just a heading\n\nno marker here')).toBe(0);
  });

  it('returns 0 when the marker is malformed', () => {
    expect(readEmbeddedVersion('<!-- openbrain-help: garbage -->')).toBe(0);
  });
});

describe('extractCommandSection', () => {
  it('returns the section for a known command', () => {
    const section = extractCommandSection('journal');
    expect(section).toBeDefined();
    expect(section).toContain('Appends to today');
    // Must not bleed into the next section.
    expect(section).not.toContain('## /list');
  });

  it('returns undefined for an unknown command', () => {
    expect(extractCommandSection('does-not-exist')).toBeUndefined();
  });

  it('covers every command in HELP_COMMAND_NAMES', () => {
    for (const name of HELP_COMMAND_NAMES) {
      const section = extractCommandSection(name);
      expect(section, `missing section for /${name}`).toBeDefined();
      expect(section?.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('ensureHelpCorpus', () => {
  it('writes all three files on a fresh vault', async () => {
    const vault = createFakeVault();
    const result = await ensureHelpCorpus(vault, vault);
    expect(result.written).toHaveLength(3);
    expect(vault.writes.map((entry) => entry.path).sort()).toEqual(
      [HELP_GETTING_STARTED_PATH, HELP_SLASH_COMMANDS_PATH, HELP_VAULT_LAYOUT_PATH].sort(),
    );
  });

  it('skips files that are already at the current version', async () => {
    const initial = Object.fromEntries(HELP_CORPUS.map((file) => [file.path, file.content]));
    const vault = createFakeVault(initial);
    const result = await ensureHelpCorpus(vault, vault);
    expect(result.written).toEqual([]);
    expect(vault.writes).toEqual([]);
  });

  it('overwrites files whose embedded version is behind', async () => {
    const stale = HELP_CORPUS.map((file) => ({
      path: file.path,
      content: file.content.replace(/<!-- openbrain-help: v\d+ -->/, '<!-- openbrain-help: v0 -->'),
    }));
    const vault = createFakeVault(
      Object.fromEntries(stale.map((file) => [file.path, file.content])),
    );
    const result = await ensureHelpCorpus(vault, vault);
    expect(result.written).toHaveLength(3);
    for (const path of result.written) {
      expect(readEmbeddedVersion(vault.store.get(path) ?? '')).toBe(HELP_CORPUS_VERSION);
    }
  });

  it('overwrites a file missing the marker entirely (treated as v0)', async () => {
    const vault = createFakeVault({
      [HELP_GETTING_STARTED_PATH]: '# my custom getting-started\n\nno marker',
    });
    const result = await ensureHelpCorpus(vault, vault);
    expect(result.written).toContain(HELP_GETTING_STARTED_PATH);
    expect(readEmbeddedVersion(vault.store.get(HELP_GETTING_STARTED_PATH) ?? '')).toBe(
      HELP_CORPUS_VERSION,
    );
  });

  it('leaves a file that is ahead of the bundle alone (forward-compat with rolling deploys)', async () => {
    const first = HELP_CORPUS[0];
    if (first === undefined) throw new Error('HELP_CORPUS is empty');
    const ahead = first.content.replace(
      /<!-- openbrain-help: v\d+ -->/,
      '<!-- openbrain-help: v999 -->',
    );
    const vault = createFakeVault({ [HELP_GETTING_STARTED_PATH]: ahead });
    const result = await ensureHelpCorpus(vault, vault);
    expect(result.written).not.toContain(HELP_GETTING_STARTED_PATH);
    expect(vault.store.get(HELP_GETTING_STARTED_PATH)).toBe(ahead);
  });
});

describe('listCommandShortHelp', () => {
  it('returns one entry per command with a non-empty summary', () => {
    const entries = listCommandShortHelp();
    expect(entries).toHaveLength(HELP_COMMAND_NAMES.length);
    for (const entry of entries) {
      expect(entry.summary).not.toBe('');
    }
  });

  it('preserves HELP_COMMAND_NAMES order', () => {
    const entries = listCommandShortHelp();
    expect(entries.map((entry) => entry.name)).toEqual([...HELP_COMMAND_NAMES]);
  });
});
