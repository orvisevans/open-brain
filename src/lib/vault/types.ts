// Public types for the Vault module.
// `NotePath` is repo-relative POSIX (e.g. "notes/foo.md"), per ARCHITECTURE §3.

export type NotePath = string;

export interface Note {
  path: NotePath;
  content: string;
  frontmatter: Record<string, unknown>;
  lastModified: number;
}

export interface WikilinkReference {
  from: NotePath;
  // Free-form target string; resolution to an actual NotePath happens at the
  // call site, since it requires cross-referencing `listNotes()`.
  to: string;
  display?: string;
}

export interface ParsedMarkdown {
  frontmatter: Record<string, unknown>;
  body: string;
}
