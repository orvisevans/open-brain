<script lang="ts">
  import type { MentionMatch } from './matcher';

  interface Properties {
    matches: MentionMatch[];
    selectedIndex: number;
    onPick: (path: string) => void;
  }

  const { matches, selectedIndex, onPick }: Properties = $props();
</script>

{#if matches.length > 0}
  <ul class="mention-popover" role="listbox" aria-label="Note suggestions">
    {#each matches as match, index (match.path)}
      <li
        class:active={index === selectedIndex}
        role="option"
        aria-selected={index === selectedIndex}
      >
        <button
          tabindex="-1"
          onmousedown={(event) => {
            // Use mousedown so the click resolves before the textarea blur
            // (which would otherwise close the popover before the click).
            event.preventDefault();
            onPick(match.path);
          }}
        >
          {match.path}
        </button>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .mention-popover {
    list-style: none;
    margin: 0;
    padding: 0.25rem;
    background: var(--color-bg);
    border: 1px solid var(--color-border);
    border-radius: 4px;
    max-height: 14rem;
    overflow-y: auto;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    font-family: var(--font-mono);
  }

  li {
    margin: 0;
  }

  button {
    width: 100%;
    text-align: left;
    background: transparent;
    border: none;
    color: var(--color-fg);
    padding: 0.3rem 0.5rem;
    font-family: inherit;
    font-size: 0.8rem;
    cursor: pointer;
    border-radius: 3px;
  }

  li.active button,
  button:hover {
    background: color-mix(in srgb, var(--color-bg), var(--color-accent) 12%);
    color: var(--color-accent);
  }
</style>
