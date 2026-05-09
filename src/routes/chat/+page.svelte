<script lang="ts">
  import type { ChatCompletionMessageParam } from '@mlc-ai/web-llm';

  import {
    appendMessage,
    chatVault,
    listSessions,
    newSessionId,
    writeSession,
    type ChatMessage,
    type ChatSession,
  } from '$lib/chat';
  import { logError } from '$lib/log';
  import { streamChat } from '$lib/llm/runtime';
  import { assembleContext, retrieve } from '$lib/memory';
  import { model } from '$lib/state.svelte';
  import { createWebSpeechTranscriber } from '$lib/transcribe';
  import { vault } from '$lib/vault';

  // ── Session state ────────────────────────────────────────────────────────

  let session = $state<ChatSession | undefined>(undefined);
  let allSessions = $state<ChatSession[]>([]);
  let input = $state('');
  let isStreaming = $state(false);
  let streamingOutput = $state('');
  let streamingCitations = $state<string[]>([]);
  let phase = $state<'idle' | 'retrieving' | 'thinking'>('idle');

  // Hydrate the most recent session on mount; create a fresh one if none.
  $effect(() => {
    void (async () => {
      try {
        const sessions = await listSessions(chatVault);
        allSessions = sessions;
        session = sessions[0] ?? (await createSession());
      } catch (error: unknown) {
        logError('chat/hydrate', { error });
        session = await createSession();
      }
    })();
  });

  async function createSession(): Promise<ChatSession> {
    const fresh: ChatSession = {
      id: newSessionId(),
      startedAt: Date.now(),
      lastUpdatedAt: Date.now(),
      messages: [],
    };
    await writeSession(chatVault, fresh);
    return fresh;
  }

  function startNewSession(): void {
    void (async () => {
      const fresh = await createSession();
      session = fresh;
      allSessions = [fresh, ...allSessions];
    })();
  }

  function selectSession(id: string): void {
    const found = allSessions.find((entry) => entry.id === id);
    if (found !== undefined) session = found;
  }

  // ── Send turn ────────────────────────────────────────────────────────────

  async function send(): Promise<void> {
    const text = input.trim();
    const current = session;
    if (text === '' || !model.loaded || isStreaming || current === undefined) return;
    input = '';
    isStreaming = true;
    streamingOutput = '';
    streamingCitations = [];
    phase = 'retrieving';

    const userMessage: ChatMessage = {
      id: cryptoRandomId(),
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };
    let working = await appendMessage(chatVault, current, userMessage);
    session = working;

    try {
      const retrieval = await retrieve(
        {
          readRaw: (path) => vault.readRaw(path),
          listNotes: () => vault.listNotes(),
        },
        text,
      );
      const assembled = assembleContext(retrieval);
      streamingCitations = retrieval.noteRefs;
      phase = 'thinking';

      const llmMessages: ChatCompletionMessageParam[] = [
        { role: 'system', content: assembled.systemPrompt },
        // Replay prior turns from the session for conversational continuity.
        ...working.messages.slice(0, -1).map((message) => ({
          role: message.role,
          content: message.content,
        })),
        { role: 'user', content: assembled.userPrompt },
      ];

      let accumulated = '';
      await streamChat(llmMessages, (token) => {
        accumulated += token;
        streamingOutput = accumulated;
      });

      const assistantMessage: ChatMessage = {
        id: cryptoRandomId(),
        role: 'assistant',
        content: accumulated,
        timestamp: Date.now(),
        ...(retrieval.noteRefs.length > 0 && { retrievedContext: retrieval.noteRefs }),
      };
      working = await appendMessage(chatVault, working, assistantMessage);
      session = working;
      // Update sidebar listing.
      allSessions = [working, ...allSessions.filter((entry) => entry.id !== working.id)];
    } catch (error: unknown) {
      logError('chat/send', { error });
    } finally {
      isStreaming = false;
      streamingOutput = '';
      streamingCitations = [];
      phase = 'idle';
    }
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  }

  function cryptoRandomId(): string {
    const bytes = new Uint8Array(8);
    globalThis.crypto.getRandomValues(bytes);
    return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  // ── Voice input ──────────────────────────────────────────────────────────

  const transcriber = createWebSpeechTranscriber();
  const micAvailable = $derived(transcriber.isAvailable());
  let isListening = $state(false);

  function toggleMic(): void {
    if (isListening) {
      void transcriber.stop();
      isListening = false;
      return;
    }
    isListening = true;
    void (async () => {
      try {
        for await (const event of transcriber.start()) {
          if (event.kind === 'partial') {
            input = event.text;
          } else if (event.kind === 'final') {
            input = event.text;
          } else {
            logError('chat/transcribe', { message: event.message });
          }
        }
      } finally {
        isListening = false;
      }
    })();
  }

  // ── Computed ─────────────────────────────────────────────────────────────

  const visibleMessages = $derived(session?.messages ?? []);

  function formatSessionLabel(entry: ChatSession): string {
    const first = entry.messages.find((message) => message.role === 'user');
    const head = first?.content.split('\n')[0]?.slice(0, 40);
    if (head !== undefined && head !== '') return head;
    return new Date(entry.lastUpdatedAt).toLocaleString();
  }
</script>

<div class="chat">
  <aside class="sessions" aria-label="Chat sessions">
    <div class="sessions-head">
      <span>Sessions</span>
      <button class="ghost" onclick={startNewSession} aria-label="Start new chat session">
        + New
      </button>
    </div>
    <ul class="session-list">
      {#each allSessions as entry (entry.id)}
        <li>
          <button
            class="session-item"
            class:active={session?.id === entry.id}
            onclick={() => {
              selectSession(entry.id);
            }}
          >
            <span class="session-label">{formatSessionLabel(entry)}</span>
            <span class="session-time">
              {new Date(entry.lastUpdatedAt).toLocaleDateString()}
            </span>
          </button>
        </li>
      {/each}
    </ul>
  </aside>

  <section class="conversation">
    <div class="messages" role="log" aria-live="polite" aria-label="Chat messages">
      {#each visibleMessages as message (message.id)}
        <div class="message {message.role}">
          <span class="role">{message.role === 'user' ? 'you' : 'ai'}</span>
          <div class="bubble">
            <pre class="content">{message.content}</pre>
            {#if message.retrievedContext !== undefined && message.retrievedContext.length > 0}
              <p class="cites">
                based on:
                {#each message.retrievedContext as path, index (path)}
                  <a class="cite" href={`/browse/${path}`}>{path}</a
                  >{#if index < message.retrievedContext.length - 1},{/if}
                {/each}
              </p>
            {/if}
          </div>
        </div>
      {/each}

      {#if isStreaming}
        <div class="message assistant streaming">
          <span class="role">ai</span>
          <div class="bubble">
            <pre class="content">{streamingOutput}<span class="cursor" aria-hidden="true">▋</span
              ></pre>
            {#if phase === 'retrieving'}
              <p class="cites status">retrieving relevant notes…</p>
            {:else if streamingCitations.length > 0}
              <p class="cites">
                based on:
                {#each streamingCitations as path, index (path)}
                  <a class="cite" href={`/browse/${path}`}>{path}</a
                  >{#if index < streamingCitations.length - 1},{/if}
                {/each}
              </p>
            {/if}
          </div>
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
        {#if micAvailable}
          <button
            class="mic"
            class:listening={isListening}
            onclick={toggleMic}
            disabled={isStreaming}
            aria-label={isListening ? 'Stop voice input' : 'Start voice input'}
            title={isListening ? 'Stop voice input' : 'Start voice input'}
          >
            {isListening ? '◼' : '🎙'}
          </button>
        {/if}
        <button
          class="send"
          onclick={() => {
            void send();
          }}
          disabled={isStreaming || input.trim() === ''}
        >
          {isStreaming ? '…' : 'Send'}
        </button>
      {/if}
    </div>
  </section>
</div>

<style>
  .chat {
    display: grid;
    grid-template-columns: 14rem 1fr;
    gap: 1rem;
    height: calc(100dvh - 6rem);
  }

  .sessions {
    border-right: 1px solid var(--color-border);
    padding-right: 0.5rem;
    overflow-y: auto;
  }

  .sessions-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-family: var(--font-mono);
    font-size: 0.8rem;
    margin-bottom: 0.5rem;
    opacity: 0.8;
  }

  .session-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }

  .session-item {
    width: 100%;
    text-align: left;
    background: transparent;
    border: 1px solid transparent;
    color: inherit;
    padding: 0.4rem 0.5rem;
    font-family: var(--font-mono);
    font-size: 0.75rem;
    cursor: pointer;
    border-radius: 3px;
    display: flex;
    flex-direction: column;
  }

  .session-item:hover {
    border-color: var(--color-border);
  }

  .session-item.active {
    border-color: var(--color-accent);
    color: var(--color-accent);
  }

  .session-time {
    opacity: 0.5;
    font-size: 0.7rem;
  }

  .ghost {
    font-family: var(--font-mono);
    font-size: 0.75rem;
    background: transparent;
    border: 1px solid var(--color-border);
    color: var(--color-fg);
    padding: 0.15rem 0.4rem;
    border-radius: 3px;
    cursor: pointer;
  }

  .conversation {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    min-width: 0;
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

  .bubble {
    flex: 1;
    min-width: 0;
  }

  .content {
    font-family: var(--font-mono);
    font-size: 0.875rem;
    white-space: pre-wrap;
    margin: 0;
  }

  .cites {
    font-family: var(--font-mono);
    font-size: 0.7rem;
    opacity: 0.7;
    margin: 0.25rem 0 0 0;
  }

  .cites.status {
    font-style: italic;
  }

  .cite {
    color: var(--color-accent);
    text-decoration: underline;
    text-underline-offset: 2px;
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

  button.send,
  button.mic {
    font-family: var(--font-mono);
    font-size: 0.875rem;
    padding: 0.5rem 0.75rem;
    cursor: pointer;
    background: transparent;
    border: 1px solid var(--color-accent);
    color: var(--color-accent);
    border-radius: 3px;
    align-self: flex-end;
  }

  button.mic.listening {
    background: var(--color-accent);
    color: var(--color-bg, var(--color-fg));
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
