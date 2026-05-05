<script lang="ts">
  // Bare /browse — empty state. The layout's sidebar handles file listing
  // and search; this route just shows a placeholder until the user picks a
  // note (or creates one via the "+ New" button).
</script>

<div class="empty-state">
  <p>Pick a note from the sidebar, or create a new one.</p>
</div>

<style>
  .empty-state {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 1;
    height: 100%;
    font-family: var(--font-mono);
    font-size: 0.85rem;
    opacity: 0.5;
  }
</style>
