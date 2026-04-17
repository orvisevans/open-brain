<script lang="ts">
  import { goto } from '$app/navigation';

  // Root: immediately redirect to /chat. The setup page redirects here if
  // auth/repo are not configured (Phase 7). For now, /chat handles missing state.
  $effect(() => {
    void goto('/chat', { replaceState: true });
  });
</script>
