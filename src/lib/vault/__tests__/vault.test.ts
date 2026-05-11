import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createVault, type Vault } from '../vault';

import { MemFs } from './mem-fs';

describe('Vault', () => {
  let fs: MemFs;
  let vault: Vault;

  beforeEach(() => {
    // Suppress logError noise from the explicit error-path tests.
    vi.spyOn(console, 'error').mockImplementation(() => {
      // intentionally empty: silence vault's logError noise during error-path tests
    });
    fs = new MemFs();
    vault = createVault(fs);
  });

  describe('writeNote', () => {
    it('creates parent directories when missing', async () => {
      await vault.writeNote('notes/foo.md', '# hello\n');
      expect(await fs.readFile('/repo/notes/foo.md', 'utf8')).toBe('# hello\n');
    });

    it('creates deeply nested parent directories', async () => {
      await vault.writeNote('notes/projects/2026/q2.md', 'body');
      expect(await fs.readFile('/repo/notes/projects/2026/q2.md', 'utf8')).toBe('body');
    });

    it('overwrites an existing note', async () => {
      await vault.writeNote('notes/x.md', 'first');
      await vault.writeNote('notes/x.md', 'second');
      expect(await fs.readFile('/repo/notes/x.md', 'utf8')).toBe('second');
    });
  });

  describe('readNote', () => {
    it('returns body without frontmatter and parses frontmatter', async () => {
      await vault.writeNote('notes/a.md', '---\ntitle: T\n---\nBody here\n');
      const note = await vault.readNote('notes/a.md');
      expect(note.path).toBe('notes/a.md');
      expect(note.frontmatter).toEqual({ title: 'T' });
      expect(note.content).toBe('Body here\n');
      expect(note.lastModified).toBeGreaterThan(0);
    });

    it('returns full content when no frontmatter', async () => {
      await vault.writeNote('notes/b.md', '# Heading\n');
      const note = await vault.readNote('notes/b.md');
      expect(note.frontmatter).toEqual({});
      expect(note.content).toBe('# Heading\n');
    });

    it('throws on missing file', async () => {
      await expect(vault.readNote('notes/nope.md')).rejects.toMatchObject({ code: 'ENOENT' });
    });
  });

  describe('listNotes', () => {
    it('returns empty array when notes dir missing', async () => {
      expect(await vault.listNotes()).toEqual([]);
    });

    it('returns markdown files only, sorted, repo-relative', async () => {
      await vault.writeNote('notes/zeta.md', 'z');
      await vault.writeNote('notes/alpha.md', 'a');
      await vault.writeNote('notes/sub/beta.md', 'b');
      // Non-md files should be excluded.
      fs.seedFile('/repo/notes/image.png', 'binaryish');
      const list = await vault.listNotes();
      expect(list).toEqual(['notes/alpha.md', 'notes/sub/beta.md', 'notes/zeta.md']);
    });

    it('includes notes that have not yet been committed (fs-walk, not git ls)', async () => {
      // Newly created notes appear immediately — this is the whole point of
      // walking the fs rather than asking isomorphic-git for tracked files.
      await vault.writeNote('notes/just-created.md', '');
      expect(await vault.listNotes()).toEqual(['notes/just-created.md']);
    });

    it('does not include chats in listNotes (sibling listing only)', async () => {
      await vault.writeNote('notes/x.md', '');
      await vault.writeNote('.chats/abc.md', '');
      expect(await vault.listNotes()).toEqual(['notes/x.md']);
    });
  });

  describe('listChats', () => {
    it('returns empty array when chats dir missing', async () => {
      expect(await vault.listChats()).toEqual([]);
    });

    it('returns markdown files under .chats/ only', async () => {
      await vault.writeNote('.chats/2026-05-11.md', '');
      await vault.writeNote('.chats/2026-05-10.md', '');
      fs.seedFile('/repo/.chats/index.json', '{}');
      await vault.writeNote('notes/regular.md', '');
      const list = await vault.listChats();
      expect(list).toEqual(['.chats/2026-05-10.md', '.chats/2026-05-11.md']);
    });
  });

  describe('with custom repoDirectory', () => {
    it('honours the repoDirectory option', async () => {
      const custom = createVault(fs, { repoDirectory: '/elsewhere' });
      await custom.writeNote('notes/x.md', 'data');
      expect(await fs.readFile('/elsewhere/notes/x.md', 'utf8')).toBe('data');
      expect(await custom.listNotes()).toEqual(['notes/x.md']);
    });
  });
});
