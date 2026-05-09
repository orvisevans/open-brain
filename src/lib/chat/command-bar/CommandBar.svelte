<script lang="ts">
  import { orderByFrecency, type CommandStats } from './frecency';

  interface Properties {
    commands: readonly string[];
    stats: CommandStats;
    onPick: (command: string) => void;
    // Hint shown in the suggester slot; if defined, the matching command is
    // promoted to the leading position. (Reserved for the embedding suggester
    // wired in a later chunk.)
    promote?: string;
  }

  const { commands, stats, onPick, promote }: Properties = $props();

  const ordered = $derived.by(() => {
    const baseline = orderByFrecency(commands, stats, Date.now());
    if (promote === undefined) return baseline;
    if (!commands.includes(promote)) return baseline;
    return [promote, ...baseline.filter((command) => command !== promote)];
  });
</script>

<nav class="command-bar" aria-label="Slash commands">
  {#each ordered as command (command)}
    <button
      class="chip"
      class:promoted={promote === command}
      onclick={() => {
        onPick(command);
      }}
    >
      {command}
    </button>
  {/each}
</nav>

<style>
  .command-bar {
    display: flex;
    gap: 0.4rem;
    overflow-x: auto;
    overflow-y: hidden;
    scroll-snap-type: x proximity;
    padding: 0.25rem 0;
    /* Hide native scrollbar on most browsers; the row is short and chip
       widths give the user enough affordance. */
    scrollbar-width: none;
  }

  .command-bar::-webkit-scrollbar {
    display: none;
  }

  .chip {
    flex-shrink: 0;
    scroll-snap-align: start;
    font-family: var(--font-mono);
    font-size: 0.8rem;
    padding: 0.3rem 0.7rem;
    background: transparent;
    color: var(--color-fg);
    border: 1px solid var(--color-border);
    border-radius: 999px;
    cursor: pointer;
    white-space: nowrap;
  }

  .chip:hover {
    border-color: var(--color-accent);
    color: var(--color-accent);
  }

  .chip.promoted {
    border-color: var(--color-accent);
    color: var(--color-accent);
    background: color-mix(in srgb, var(--color-bg), var(--color-accent) 10%);
  }
</style>
