<script lang="ts">
  // Recursive file/folder tree. Folders are click-to-expand; files navigate
  // to /browse/<path>. Active note is highlighted.

  import { SvelteSet } from 'svelte/reactivity';

  import type { NotePath } from '$lib/vault';

  import type { TreeNode } from './tree';
  import FileTree from './FileTree.svelte';

  interface Properties {
    nodes: readonly TreeNode[];
    activePath?: NotePath | undefined;
    depth?: number;
  }

  const { nodes, activePath, depth = 0 }: Properties = $props();

  // Track expansion locally — only directories at this level get state, but
  // since each FileTree instance only owns one level, this is fine.
  // SvelteSet (vs `$state(new Set())`) is required for `.add`/`.delete`
  // mutations to trigger reactivity — Svelte 5 only auto-proxies plain
  // objects and arrays, not Set/Map.
  const expanded = new SvelteSet<string>();

  function toggle(name: string): void {
    if (expanded.has(name)) {
      expanded.delete(name);
    } else {
      expanded.add(name);
    }
  }

  function isExpanded(name: string, hasActiveDescendant: boolean): boolean {
    return hasActiveDescendant || expanded.has(name);
  }

  function containsActive(node: TreeNode, path: NotePath | undefined): boolean {
    if (path === undefined) return false;
    if (node.kind === 'file') return node.path === path;
    return node.children.some((child) => containsActive(child, path));
  }

  function keyFor(node: TreeNode): string {
    return node.kind === 'file' ? node.path : `dir:${node.name}`;
  }

  function fileHref(node: TreeNode): string {
    return node.kind === 'file' ? `/browse/${node.path}` : '';
  }

  function isActive(node: TreeNode, current: NotePath | undefined): boolean {
    return node.kind === 'file' && node.path === current;
  }
</script>

<ul class="tree" style:--depth={String(depth)}>
  {#each nodes as node (keyFor(node))}
    {#if node.kind === 'directory'}
      {@const open = isExpanded(node.name, containsActive(node, activePath))}
      <li class="dir">
        <button
          type="button"
          class="dir-toggle"
          aria-expanded={open}
          onclick={() => {
            toggle(node.name);
          }}
        >
          <span class="chevron" aria-hidden="true">{open ? '▾' : '▸'}</span>
          <span class="name">{node.name}/</span>
        </button>
        {#if open}
          <FileTree nodes={node.children} {activePath} depth={depth + 1} />
        {/if}
      </li>
    {:else}
      <li class="file" class:active={isActive(node, activePath)}>
        <a href={fileHref(node)}>{node.name}</a>
      </li>
    {/if}
  {/each}
</ul>

<style>
  .tree {
    list-style: none;
    margin: 0;
    padding: 0;
    font-family: var(--font-mono);
    font-size: 0.8rem;
  }

  .tree :global(.tree) {
    padding-left: 0.75rem;
    border-left: 1px dotted var(--color-border);
    margin-left: 0.25rem;
  }

  .dir-toggle {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    width: 100%;
    background: transparent;
    border: 0;
    padding: 0.15rem 0.25rem;
    text-align: left;
    color: var(--color-fg);
    font-family: inherit;
    font-size: inherit;
    cursor: pointer;
    opacity: 0.85;
  }

  .dir-toggle:hover {
    opacity: 1;
  }

  .chevron {
    display: inline-block;
    width: 0.75rem;
    text-align: center;
    opacity: 0.6;
  }

  .file a {
    display: block;
    padding: 0.15rem 0.25rem 0.15rem 1rem;
    color: var(--color-fg);
    opacity: 0.7;
    text-decoration: none;
  }

  .file a:hover {
    opacity: 1;
  }

  .file.active a {
    color: var(--color-accent);
    opacity: 1;
  }
</style>
