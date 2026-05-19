import { describe, expect, it } from 'vitest';

import { parseSlashCommand } from '../parser';

describe('parseSlashCommand', () => {
  it('returns undefined for non-slash input', () => {
    expect(parseSlashCommand('hello world')).toBeUndefined();
    expect(parseSlashCommand('')).toBeUndefined();
    expect(parseSlashCommand('  ')).toBeUndefined();
  });

  it('treats unknown commands as { unknown }', () => {
    expect(parseSlashCommand('/blarg')).toEqual({ kind: 'unknown', raw: '/blarg' });
  });

  it('tolerates leading whitespace', () => {
    expect(parseSlashCommand('   /save')).toEqual({ kind: 'save', all: false });
  });

  describe('/save', () => {
    it('bare /save', () => {
      expect(parseSlashCommand('/save')).toEqual({ kind: 'save', all: false });
    });
    it('/save --all', () => {
      expect(parseSlashCommand('/save --all')).toEqual({ kind: 'save', all: true });
    });
    it('/save with @target', () => {
      expect(parseSlashCommand('/save @notes/foo')).toEqual({
        kind: 'save',
        all: false,
        target: 'notes/foo.md',
      });
    });
    it('/save with @target including .md', () => {
      expect(parseSlashCommand('/save @notes/foo.md')).toEqual({
        kind: 'save',
        all: false,
        target: 'notes/foo.md',
      });
    });
    it('/save with title', () => {
      expect(parseSlashCommand('/save my new note')).toEqual({
        kind: 'save',
        all: false,
        title: 'my new note',
      });
    });
    it('/save --all @target title', () => {
      expect(parseSlashCommand('/save --all @notes/foo.md custom title')).toEqual({
        kind: 'save',
        all: true,
        target: 'notes/foo.md',
        title: 'custom title',
      });
    });
  });

  describe('/journal', () => {
    it('rejects empty body with a friendly reason', () => {
      const result = parseSlashCommand('/journal');
      expect(result?.kind).toBe('unknown');
      if (result?.kind === 'unknown') {
        expect(result.raw).toBe('/journal');
        expect(result.reason).toContain('Provide an entry');
      }
    });
    it('captures the body verbatim', () => {
      expect(parseSlashCommand('/journal today I felt great')).toEqual({
        kind: 'journal',
        body: 'today I felt great',
      });
    });
    it('preserves multi-line body', () => {
      expect(parseSlashCommand('/journal line one\nline two')).toEqual({
        kind: 'journal',
        body: 'line one\nline two',
      });
    });
  });

  describe('/note', () => {
    it('rejects empty title with a friendly reason', () => {
      const result = parseSlashCommand('/note');
      expect(result?.kind).toBe('unknown');
      if (result?.kind === 'unknown') {
        expect(result.reason).toContain('Provide a title');
      }
    });
    it('title only', () => {
      expect(parseSlashCommand('/note My ideas')).toEqual({
        kind: 'note',
        title: 'My ideas',
      });
    });
    it('title + body separated by newline', () => {
      expect(parseSlashCommand('/note My ideas\nthe body goes here')).toEqual({
        kind: 'note',
        title: 'My ideas',
        body: 'the body goes here',
      });
    });
    it('extracts inline #hashtags into tags', () => {
      expect(parseSlashCommand('/note Cool thought #productivity #ideas')).toEqual({
        kind: 'note',
        title: 'Cool thought',
        tags: ['productivity', 'ideas'],
      });
    });
    it('rejects /note with only hashtags (no real title)', () => {
      const result = parseSlashCommand('/note #empty');
      expect(result?.kind).toBe('unknown');
      if (result?.kind === 'unknown') {
        expect(result.raw).toBe('/note');
        expect(result.reason).toContain('Provide a title');
      }
    });
  });

  describe('/list', () => {
    it('rejects empty name with a friendly reason', () => {
      const result = parseSlashCommand('/list');
      expect(result?.kind).toBe('unknown');
      if (result?.kind === 'unknown') {
        expect(result.reason).toContain('Provide a list name');
      }
    });
    it('name only — no item', () => {
      expect(parseSlashCommand('/list grocery')).toEqual({
        kind: 'list',
        name: 'grocery',
      });
    });
    it('name + item on one line', () => {
      expect(parseSlashCommand('/list grocery eggs and milk')).toEqual({
        kind: 'list',
        name: 'grocery',
        item: 'eggs and milk',
      });
    });
    it('newline form: name on first line, multi-line item below', () => {
      expect(parseSlashCommand('/list grocery\neggs\nmilk')).toEqual({
        kind: 'list',
        name: 'grocery',
        item: 'eggs\nmilk',
      });
    });
  });

  describe('/append', () => {
    it('requires @target with a friendly reason', () => {
      const result = parseSlashCommand('/append body without target');
      expect(result?.kind).toBe('unknown');
      if (result?.kind === 'unknown') {
        expect(result.raw).toBe('/append body without target');
        expect(result.reason).toContain('Provide a target');
      }
    });
    it('parses @target + body', () => {
      expect(parseSlashCommand('/append @notes/foo some new content')).toEqual({
        kind: 'append',
        target: 'notes/foo.md',
        body: 'some new content',
        bullet: false,
      });
    });
    it('honours --bullet', () => {
      expect(parseSlashCommand('/append @notes/foo --bullet item one')).toEqual({
        kind: 'append',
        target: 'notes/foo.md',
        body: 'item one',
        bullet: true,
      });
    });
    it('--bullet anywhere in args still picked up', () => {
      expect(parseSlashCommand('/append @notes/foo item one --bullet')).toEqual({
        kind: 'append',
        target: 'notes/foo.md',
        body: 'item one',
        bullet: true,
      });
    });
    it('preserves multi-line body', () => {
      expect(parseSlashCommand('/append @notes/foo line one\nline two')).toEqual({
        kind: 'append',
        target: 'notes/foo.md',
        body: 'line one\nline two',
        bullet: false,
      });
    });
  });

  describe('@-mention path resolution', () => {
    it('bare @word → notes/word.md', () => {
      expect(parseSlashCommand('/save @grocery')).toEqual({
        kind: 'save',
        all: false,
        target: 'notes/grocery.md',
      });
    });
    it('@dir/file → preserves directory', () => {
      expect(parseSlashCommand('/save @lists/grocery')).toEqual({
        kind: 'save',
        all: false,
        target: 'lists/grocery.md',
      });
    });
  });

  describe('/help', () => {
    it('bare /help', () => {
      expect(parseSlashCommand('/help')).toEqual({ kind: 'help' });
    });
    it('/help <command>', () => {
      expect(parseSlashCommand('/help save')).toEqual({ kind: 'help', command: 'save' });
    });
    it('/help /command (leading slash tolerated)', () => {
      expect(parseSlashCommand('/help /save')).toEqual({ kind: 'help', command: 'save' });
    });
    it('lowercases the command name for lookup', () => {
      expect(parseSlashCommand('/help SAVE')).toEqual({ kind: 'help', command: 'save' });
    });
    it('takes the first token only', () => {
      expect(parseSlashCommand('/help save more args')).toEqual({
        kind: 'help',
        command: 'save',
      });
    });
    it('trailing whitespace stays a bare /help', () => {
      expect(parseSlashCommand('/help   ')).toEqual({ kind: 'help' });
    });
  });
});
