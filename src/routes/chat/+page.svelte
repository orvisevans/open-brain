<script lang="ts">
  import type { ChatCompletionMessageParam } from '@mlc-ai/web-llm';

  import { logError } from '$lib/log';
  import { streamChat } from '$lib/llm/runtime';
  import { model } from '$lib/state.svelte';

  let messages = $state<ChatCompletionMessageParam[]>([]);
  let input = $state('');
  let isStreaming = $state(false);
  let streamingOutput = $state('');

  function handleSend() {
    const text = input.trim();
    if (text === '' || !model.loaded || isStreaming) {
      return;
    }

    input = '';
    const userMessage: ChatCompletionMessageParam = { role: 'user', content: text };
    const history: ChatCompletionMessageParam[] = [...messages, userMessage];
    messages = history;
    isStreaming = true;
    streamingOutput = '';

    let accumulated = '';

    void (async () => {
      try {
        await streamChat(history, (token) => {
          accumulated += token;
          streamingOutput = accumulated;
        });
        const assistantMessage: ChatCompletionMessageParam = {
          role: 'assistant',
          content: accumulated,
        };
        messages = [...history, assistantMessage];
        streamingOutput = '';
        isStreaming = false;
      } catch (error: unknown) {
        logError('chat/stream', { error });
        isStreaming = false;
      }
    })();
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  }
</script>

<div class="chat">
  <div class="messages" role="log" aria-live="polite" aria-label="Chat messages">
    {#each messages as message, index (index)}
      <div class="message {message.role}">
        <span class="role">{message.role === 'user' ? 'you' : 'ai'}</span>
        <pre class="content">{typeof message.content === 'string' ? message.content : ''}</pre>
      </div>
    {/each}

    {#if isStreaming}
      <div class="message assistant streaming">
        <span class="role">ai</span>
        <pre class="content">{streamingOutput}<span class="cursor" aria-hidden="true">▋</span></pre>
      </div>
    {/if}
  </div>

  <div class="input-row">
    {#if !model.loaded}
      <p class="hint">Load a model in <a href="/setup">Setup</a> to start chatting.</p>
    {:else}
      <textarea
        rows={3}
        placeholder="Ask anything about your notes… (Enter to send)"
        bind:value={input}
        onkeydown={handleKeydown}
        disabled={isStreaming}
        aria-label="Chat input"
      ></textarea>
      <button onclick={handleSend} disabled={isStreaming || input.trim() === ''}>
        {isStreaming ? '…' : 'Send'}
      </button>
    {/if}
  </div>
</div>

<style>
  .chat {
    display: flex;
    flex-direction: column;
    height: calc(100dvh - 6rem);
    gap: 0.75rem;
  }

  .messages {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .message {
    display: flex;
    gap: 0.5rem;
  }

  .role {
    font-family: var(--font-mono);
    font-size: 0.75rem;
    opacity: 0.5;
    min-width: 2rem;
    padding-top: 0.1rem;
  }

  .content {
    font-family: var(--font-mono);
    font-size: 0.875rem;
    white-space: pre-wrap;
    margin: 0;
    flex: 1;
  }

  .message.user .content {
    opacity: 0.85;
  }

  .cursor {
    animation: blink 1s step-end infinite;
  }

  @media (prefers-reduced-motion: reduce) {
    .cursor {
      animation: none;
    }
  }

  @keyframes blink {
    50% {
      opacity: 0;
    }
  }

  .input-row {
    display: flex;
    gap: 0.5rem;
    align-items: flex-end;
  }

  textarea {
    flex: 1;
    font-family: var(--font-mono);
    font-size: 0.875rem;
    padding: 0.5rem;
    background: transparent;
    border: 1px solid var(--color-border);
    color: var(--color-fg);
    border-radius: 3px;
    resize: none;
  }

  button {
    font-family: var(--font-mono);
    font-size: 0.875rem;
    padding: 0.5rem 1rem;
    cursor: pointer;
    background: transparent;
    border: 1px solid var(--color-accent);
    color: var(--color-accent);
    border-radius: 3px;
    align-self: flex-end;
  }

  button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .hint {
    font-size: 0.875rem;
    opacity: 0.6;
  }
</style>
