// Build a hierarchical tree from a flat list of `notes/foo/bar.md` paths.
// Pure function — no I/O, no Svelte; testable.

import type { NotePath } from '$lib/vault';

export interface TreeFile {
  kind: 'file';
  name: string;
  path: NotePath;
}

export interface TreeDirectory {
  kind: 'directory';
  name: string;
  children: TreeNode[];
}

export type TreeNode = TreeFile | TreeDirectory;

export function buildTree(paths: readonly NotePath[]): TreeNode[] {
  const root: TreeDirectory = { kind: 'directory', name: '', children: [] };

  for (const path of paths) {
    const segments = path.split('/').filter((segment) => segment !== '');
    if (segments.length === 0) continue;
    insert(root, segments, path);
  }

  sort(root);
  return root.children;
}

function insert(parent: TreeDirectory, segments: string[], fullPath: string): void {
  const [head, ...rest] = segments;
  if (head === undefined) return;

  if (rest.length === 0) {
    parent.children.push({ kind: 'file', name: head, path: fullPath });
    return;
  }

  let directory = parent.children.find(
    (child): child is TreeDirectory => child.kind === 'directory' && child.name === head,
  );
  if (directory === undefined) {
    directory = { kind: 'directory', name: head, children: [] };
    parent.children.push(directory);
  }
  insert(directory, rest, fullPath);
}

// Directories first, then files; alphabetical within each group.
function sort(node: TreeDirectory): void {
  node.children.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const child of node.children) {
    if (child.kind === 'directory') sort(child);
  }
}
