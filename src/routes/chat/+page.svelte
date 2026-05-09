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
  import CommandBar from '$lib/chat/command-bar/CommandBar.svelte';
  import {
    COMMAND_LIST,
    loadCommandStats,
    recordUse,
    saveCommandStats,
    type CommandStats,
  } from '$lib/chat/command-bar';
  import { searchMentions, type MentionMatch } from '$lib/chat/mention';
  import MentionPopover from '$lib/chat/mention/MentionPopover.svelte';
  import { applyProposal, type Proposal } from '$lib/chat/proposal';
  import ProposalCard from '$lib/chat/proposal/ProposalCard.svelte';
  import {
    configureEdit,
    configureFind,
    configureOrganize,
    configureRelated,
    dispatch as dispatchSlash,
    extractSlashFromResponse,
    loadLlmEmitEnabled,
    makeProductionFindRetriever,
    makeProductionRetriever,
    parseSlashCommand,
    registerCoreHandlers,
    saveLlmEmitEnabled,
    SLASH_EMIT_SYSTEM_INSTRUCTION,
    type ParsedCommand,
    type SlashContext,
    type SlashLlmRunner,
  } from '$lib/chat/slash';
  import {
    isReviewDue,
    loadLastReviewAt,
    recordReview,
    yesterdayHasContent,
  } from '$lib/chat/daily-review';
  import { suggestCommand } from '$lib/chat/intent-suggester';
  import {
    cancelSpeech,
    isTtsAvailable,
    loadTtsEnabled,
    saveTtsEnabled,
    speak,
  } from '$lib/chat/tts';
  import { logError } from '$lib/log';
  import { streamChat } from '$lib/llm/runtime';
  import { assembleContext, retrieve } from '$lib/memory';
  import { model } from '$lib/state.svelte';
  import { createWebSpeechTranscriber } from '$lib/transcribe';
  import { vault } from '$lib/vault';

  registerCoreHandlers();
  const sharedLlmRunner: SlashLlmRunner = {
    modelLoaded: () => model.loaded,
    complete: async (systemPrompt, userPrompt) => {
      let buffer = '';
      await streamChat(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        (token) => {
          buffer += token;
        },
      );
      return buffer;
    },
  };
  const sharedRetrievalVault = {
    readRaw: (path: string) => vault.readRaw(path),
    listNotes: () => vault.listNotes(),
  };
  configureOrganize(sharedLlmRunner, {
    readRaw: (path) => vault.readRaw(path),
    writeNote: (path, content) => vault.writeNote(path, content),
  });
  configureEdit(sharedLlmRunner);
  configureRelated(makeProductionRetriever(sharedRetrievalVault));
  configureFind(makeProductionFindRetriever(sharedRetrievalVault));

  // ── Session state ────────────────────────────────────────────────────────

  let session = $state<ChatSession | undefined>(undefined);
  let allSessions = $state<ChatSession[]>([]);
  let input = $state('');
  let isStreaming = $state(false);
  let streamingOutput = $state('');
  let streamingCitations = $state<string[]>([]);
  let phase = $state<'idle' | 'retrieving' | 'thinking'>('idle');
  // Phase 5.5: ephemeral proposals from slash commands. Not persisted to the
  // session — the file (or the absence of one after Discard) is the artifact.
  let pendingProposals = $state<Proposal[]>([]);

  // Phase 5.5: command-bar state. Stats persist to .openbrain/command-stats.json
  // (see saveCommandStats); we debounce writes by 5s so a quick rapid-fire of
  // chips doesn't churn the sync queue.
  let commandStats = $state<CommandStats>({});
  let pendingStatsSave: ReturnType<typeof setTimeout> | undefined;
  // Phase 5.5: mention popover state. Caret-tracked; index rebuilt on vault
  // change events so newly-saved notes show up immediately.
  let textareaElement = $state<HTMLTextAreaElement | undefined>(undefined);
  let mentionPaths = $state<string[]>([]);
  let mentionStart = $state<number | undefined>(undefined);
  let mentionMatches = $state<MentionMatch[]>([]);
  let mentionSelectedIndex = $state(0);

  // Phase 5.5: TTS toggle for the assistant's reply. Voice in (mic) is
  // separate; this is purely "speak the answer aloud after streaming
  // finishes". Per-device preference (different speakers, headphones, etc.).
  const ttsAvailable = isTtsAvailable();
  let ttsEnabled = $state(loadTtsEnabled());

  // Phase 5.5: embedding-based intent suggester. Promotes the most likely
  // chip in the command bar after a typing-pause debounce. Never auto-routes;
  // a wrong promotion costs one tap to ignore.
  let promotedCommand = $state<string | undefined>(undefined);
  let suggesterTimer: ReturnType<typeof setTimeout> | undefined;
  const SUGGESTER_DEBOUNCE_MS = 700;

  // Phase 5.5: LLM slash-emit. When enabled, we inject an extra system
  // instruction asking the model to reply with a single /slash line for
  // write-style requests. Default OFF until the JSON-vs-slash bench lands.
  let llmEmitEnabled = $state(loadLlmEmitEnabled());

  // Phase 5.5: daily review prompt. Set on mount when > 24h since last
  // review AND yesterday's daily journal has substantive content.
  let reviewSuggestionPath = $state<string | undefined>(undefined);

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

  // Load Phase 5.5 metadata once on mount: command stats (frecency) +
  // the mention index (paths only — title/aliases are a v2 enhancement) +
  // the daily-review status.
  $effect(() => {
    void (async () => {
      try {
        commandStats = await loadCommandStats(chatVault);
      } catch (error: unknown) {
        logError('chat/load-command-stats', { error });
      }
      try {
        mentionPaths = await vault.listNotes();
      } catch (error: unknown) {
        logError('chat/load-mention-paths', { error });
      }
      try {
        const lastAt = await loadLastReviewAt(chatVault);
        if (isReviewDue(lastAt, Date.now())) {
          const yesterday = await yesterdayHasContent(chatVault, new Date());
          if (yesterday.hasContent) {
            reviewSuggestionPath = yesterday.path;
          }
        }
      } catch (error: unknown) {
        logError('chat/load-daily-review', { error });
      }
    })();
  });

  // Intent suggester: re-run on a typing-pause debounce so the chip bar
  // gets a hint about what the user is reaching for. Slash inputs already
  // know their command — skip the embed in that case.
  $effect(() => {
    const trimmed = input.trim();
    if (suggesterTimer !== undefined) clearTimeout(suggesterTimer);
    if (trimmed === '' || trimmed.startsWith('/')) {
      promotedCommand = undefined;
      return;
    }
    suggesterTimer = setTimeout(() => {
      const captured = trimmed;
      void (async () => {
        const result = await suggestCommand(captured);
        // Reject the result if the input has moved on while we were embedding.
        if (input.trim() !== captured) return;
        promotedCommand = result?.command;
      })();
    }, SUGGESTER_DEBOUNCE_MS);
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
    if (text === '' || isStreaming || current === undefined) return;
    // Cut off any in-flight TTS the moment a new turn begins.
    cancelSpeech();

    // Phase 5.5: slash commands bypass the LLM entirely. Capture and write
    // operations don't need a model loaded.
    const parsed = parseSlashCommand(text);
    if (parsed !== undefined) {
      input = '';
      await handleSlashCommand(text, parsed, current);
      return;
    }

    // Normal chat path requires the model.
    if (!model.loaded) return;
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

      const systemPrompt = llmEmitEnabled
        ? `${assembled.systemPrompt}\n\n${SLASH_EMIT_SYSTEM_INSTRUCTION}`
        : assembled.systemPrompt;
      const llmMessages: ChatCompletionMessageParam[] = [
        { role: 'system', content: systemPrompt },
        // Replay prior turns. Skip system messages — they are slash-command
        // status / confirmation lines and would confuse the model if echoed
        // back as part of conversation history.
        ...working.messages
          .slice(0, -1)
          .filter((message) => message.role !== 'system')
          .map((message) => ({
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
      if (ttsEnabled && accumulated.trim() !== '') {
        speak(accumulated);
      }
      // LLM slash-emit: if the response is a single slash-command line,
      // route it through the dispatcher and surface a proposal card.
      if (llmEmitEnabled) {
        const slashLine = extractSlashFromResponse(accumulated);
        if (slashLine !== undefined) {
          const parsedFromLlm = parseSlashCommand(slashLine);
          if (parsedFromLlm !== undefined) {
            await dispatchLlmEmittedSlash(parsedFromLlm, assistantMessage.id, working);
          }
        }
      }
    } catch (error: unknown) {
      logError('chat/send', { error });
    } finally {
      isStreaming = false;
      streamingOutput = '';
      streamingCitations = [];
      phase = 'idle';
    }
  }

  function toggleTts(): void {
    ttsEnabled = !ttsEnabled;
    saveTtsEnabled(ttsEnabled);
    if (!ttsEnabled) cancelSpeech();
  }

  function toggleLlmEmit(): void {
    llmEmitEnabled = !llmEmitEnabled;
    saveLlmEmitEnabled(llmEmitEnabled);
  }

  function acceptDailyReview(): void {
    const path = reviewSuggestionPath;
    if (path === undefined) return;
    input = `/organize @${path}`;
    void (async () => {
      await recordReview(chatVault, new Date()).catch((error: unknown) => {
        logError('chat/record-review', { error });
      });
    })();
    reviewSuggestionPath = undefined;
    setTimeout(() => {
      void send();
    }, 0);
  }

  function dismissDailyReview(): void {
    const at = new Date();
    void (async () => {
      await recordReview(chatVault, at).catch((error: unknown) => {
        logError('chat/record-review', { error });
      });
    })();
    reviewSuggestionPath = undefined;
  }

  async function dispatchLlmEmittedSlash(
    parsed: ParsedCommand,
    sourceTurnId: string,
    working: ChatSession,
  ): Promise<void> {
    if (parsed.kind === 'unknown') return;
    const last = lastAssistant(working.messages.slice(0, -1));
    const context: SlashContext = {
      vault: {
        readRaw: (path) => vault.readRaw(path),
        listNotes: () => vault.listNotes(),
      },
      now: () => new Date(),
      sourceTurnId,
      sessionId: working.id,
      sessionMessages: working.messages.map((message) => ({
        role: message.role,
        content: message.content,
        timestamp: message.timestamp,
      })),
      ...(last !== undefined && { lastAssistantMessage: last }),
    };
    try {
      const result = await dispatchSlash(parsed, context);
      if (result.kind === 'proposal') {
        pendingProposals = [...pendingProposals, result.proposal];
      } else if (result.kind === 'proposals') {
        pendingProposals = [...pendingProposals, ...result.proposals];
      }
      // 'message' and 'error' from LLM-emitted slashes are dropped — the
      // assistant message itself already conveys whatever the model said.
    } catch (error: unknown) {
      logError('chat/llm-slash-dispatch', { error });
    }
  }

  // ── Slash commands ──────────────────────────────────────────────────────

  async function handleSlashCommand(
    text: string,
    parsed: ParsedCommand,
    current: ChatSession,
  ): Promise<void> {
    if (parsed.kind !== 'unknown') {
      recordCommandUse(`/${parsed.kind}`);
    }
    const userMessage: ChatMessage = {
      id: cryptoRandomId(),
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };
    let working = await appendMessage(chatVault, current, userMessage);
    session = working;

    const last = lastAssistant(working.messages.slice(0, -1));
    const context: SlashContext = {
      vault: {
        readRaw: (path) => vault.readRaw(path),
        listNotes: () => vault.listNotes(),
      },
      now: () => new Date(),
      sourceTurnId: userMessage.id,
      sessionId: current.id,
      sessionMessages: working.messages.slice(0, -1).map((message) => ({
        role: message.role,
        content: message.content,
        timestamp: message.timestamp,
      })),
      ...(last !== undefined && { lastAssistantMessage: last }),
    };

    let result;
    try {
      result = await dispatchSlash(parsed, context);
    } catch (error: unknown) {
      logError('chat/slash-dispatch', { error });
      result = { kind: 'error' as const, message: 'Dispatch failed unexpectedly.' };
    }

    switch (result.kind) {
      case 'error': {
        const sys: ChatMessage = {
          id: cryptoRandomId(),
          role: 'system',
          content: result.message,
          timestamp: Date.now(),
        };
        working = await appendMessage(chatVault, working, sys);
        session = working;
        break;
      }
      case 'message': {
        const sys: ChatMessage = {
          id: cryptoRandomId(),
          role: 'system',
          content: result.content,
          timestamp: Date.now(),
        };
        working = await appendMessage(chatVault, working, sys);
        session = working;
        break;
      }
      case 'proposals': {
        pendingProposals = [...pendingProposals, ...result.proposals];
        if (result.summary !== undefined) {
          const sys: ChatMessage = {
            id: cryptoRandomId(),
            role: 'system',
            content: result.summary,
            timestamp: Date.now(),
          };
          working = await appendMessage(chatVault, working, sys);
          session = working;
        }
        break;
      }
      case 'proposal': {
        pendingProposals = [...pendingProposals, result.proposal];
        break;
      }
    }
    allSessions = [working, ...allSessions.filter((entry) => entry.id !== working.id)];
  }

  function lastAssistant(
    messages: ChatMessage[],
  ): SlashContext['lastAssistantMessage'] | undefined {
    for (let index = messages.length - 1; index >= 0; index--) {
      const candidate = messages[index];
      if (candidate?.role === 'assistant') {
        return {
          id: candidate.id,
          content: candidate.content,
          timestamp: candidate.timestamp,
        };
      }
    }
    return undefined;
  }

  async function handleProposalApply(proposal: Proposal): Promise<void> {
    const current = session;
    if (current === undefined) return;
    await applyProposal(proposal, vault);
    pendingProposals = pendingProposals.filter((entry) => entry.id !== proposal.id);
    const sys: ChatMessage = {
      id: cryptoRandomId(),
      role: 'system',
      content: `✓ Saved to ${proposal.target}`,
      timestamp: Date.now(),
    };
    const working = await appendMessage(chatVault, current, sys);
    session = working;
    allSessions = [working, ...allSessions.filter((entry) => entry.id !== working.id)];
  }

  function handleProposalDiscard(proposal: Proposal): void {
    pendingProposals = pendingProposals.filter((entry) => entry.id !== proposal.id);
  }

  function handleKeydown(event: KeyboardEvent): void {
    // Mention popover navigation takes precedence over Enter-to-send.
    if (mentionMatches.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        mentionSelectedIndex = (mentionSelectedIndex + 1) % mentionMatches.length;
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        mentionSelectedIndex =
          (mentionSelectedIndex - 1 + mentionMatches.length) % mentionMatches.length;
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        const match = mentionMatches[mentionSelectedIndex];
        if (match !== undefined) pickMention(match.path);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        closeMentionPopover();
        return;
      }
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  }

  // ── Command bar ─────────────────────────────────────────────────────────

  function pickChip(command: string): void {
    input = `${command} `;
    recordCommandUse(command);
    const element = textareaElement;
    setTimeout(() => {
      element?.focus();
      element?.setSelectionRange(input.length, input.length);
    }, 0);
  }

  function recordCommandUse(command: string): void {
    commandStats = recordUse(commandStats, command, Date.now());
    if (pendingStatsSave !== undefined) clearTimeout(pendingStatsSave);
    pendingStatsSave = setTimeout(() => {
      void saveCommandStats(chatVault, commandStats).catch((error: unknown) => {
        logError('chat/save-command-stats', { error });
      });
      pendingStatsSave = undefined;
    }, 5000);
  }

  // ── Mention popover ─────────────────────────────────────────────────────

  function handleInput(): void {
    updateMentionState();
  }

  function updateMentionState(): void {
    if (textareaElement === undefined) {
      closeMentionPopover();
      return;
    }
    const cursor = textareaElement.selectionStart;
    const found = findActiveMention(input, cursor);
    if (found === undefined) {
      closeMentionPopover();
      return;
    }
    mentionStart = found.start;
    mentionMatches = searchMentions(mentionPaths, found.query);
    mentionSelectedIndex = 0;
  }

  function pickMention(path: string): void {
    if (mentionStart === undefined || textareaElement === undefined) return;
    const element = textareaElement;
    const cursor = element.selectionStart;
    const before = input.slice(0, mentionStart);
    const after = input.slice(cursor);
    const insertion = `@${path} `;
    input = `${before}${insertion}${after}`;
    closeMentionPopover();
    setTimeout(() => {
      element.focus();
      const newCursor = before.length + insertion.length;
      element.setSelectionRange(newCursor, newCursor);
    }, 0);
  }

  function closeMentionPopover(): void {
    mentionStart = undefined;
    mentionMatches = [];
    mentionSelectedIndex = 0;
  }

  function findActiveMention(
    text: string,
    cursor: number,
  ): { start: number; query: string } | undefined {
    let index = cursor;
    while (index > 0) {
      const char = text[index - 1];
      if (char === '@') {
        // Anchored to start-of-string or whitespace before the @.
        const previous = index >= 2 ? text[index - 2] : undefined;
        if (previous === undefined || /\s/.test(previous)) {
          return { start: index - 1, query: text.slice(index, cursor) };
        }
        return undefined;
      }
      if (char === undefined || /\s/.test(char)) return undefined;
      index--;
    }
    return undefined;
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

  function roleLabel(role: ChatMessage['role']): string {
    if (role === 'user') return 'you';
    if (role === 'assistant') return 'ai';
    return 'sys';
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
    {#if reviewSuggestionPath !== undefined}
      <div class="daily-review" role="region" aria-label="Daily review suggestion">
        <span class="daily-review-text">
          You captured stuff in <code>{reviewSuggestionPath}</code> yesterday. Want me to organize it
          into separate notes?
        </span>
        <div class="daily-review-actions">
          <button class="apply-review" onclick={acceptDailyReview}>Organize</button>
          <button class="dismiss-review" onclick={dismissDailyReview}>Skip for today</button>
        </div>
      </div>
    {/if}
    <div class="messages" role="log" aria-live="polite" aria-label="Chat messages">
      {#each visibleMessages as message (message.id)}
        <div class="message {message.role}">
          <span class="role">{roleLabel(message.role)}</span>
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

      {#each pendingProposals as proposal (proposal.id)}
        <div class="message system">
          <span class="role">tool</span>
          <div class="bubble">
            <ProposalCard
              {proposal}
              onApply={handleProposalApply}
              onDiscard={handleProposalDiscard}
            />
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

    {#if !model.loaded}
      <p class="hint">
        Model not loaded — slash commands (e.g. <code>/note</code>, <code>/save</code>) still work.
        <a href="/setup">Load a model</a> to ask about your notes.
      </p>
    {/if}
    <div class="composer">
      {#if mentionMatches.length > 0}
        <div class="popover-anchor">
          <MentionPopover
            matches={mentionMatches}
            selectedIndex={mentionSelectedIndex}
            onPick={pickMention}
          />
        </div>
      {/if}
      <CommandBar
        commands={COMMAND_LIST}
        stats={commandStats}
        onPick={pickChip}
        promote={promotedCommand}
      />
      <div class="input-row">
        <textarea
          rows={3}
          placeholder={model.loaded
            ? 'Ask anything about your notes… (Enter to send)'
            : 'Type a slash command, e.g. /note My idea'}
          bind:value={input}
          bind:this={textareaElement}
          onkeydown={handleKeydown}
          oninput={handleInput}
          onclick={updateMentionState}
          onkeyup={updateMentionState}
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
        {#if ttsAvailable}
          <button
            class="tts"
            class:enabled={ttsEnabled}
            onclick={toggleTts}
            aria-label={ttsEnabled ? 'Disable spoken replies' : 'Enable spoken replies'}
            title={ttsEnabled ? 'Disable spoken replies' : 'Enable spoken replies'}
            aria-pressed={ttsEnabled}
          >
            {ttsEnabled ? '🔊' : '🔇'}
          </button>
        {/if}
        <button
          class="llm-emit"
          class:enabled={llmEmitEnabled}
          onclick={toggleLlmEmit}
          aria-label={llmEmitEnabled
            ? 'Disable AI-emitted slash commands'
            : 'Enable AI-emitted slash commands'}
          title={llmEmitEnabled
            ? 'AI may emit slash commands (experimental)'
            : 'Enable AI to emit slash commands (experimental)'}
          aria-pressed={llmEmitEnabled}
        >
          {llmEmitEnabled ? '⚡' : '○'}
        </button>
        <button
          class="send"
          onclick={() => {
            void send();
          }}
          disabled={isStreaming || input.trim() === ''}
        >
          {isStreaming ? '…' : 'Send'}
        </button>
      </div>
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

  .composer {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    position: relative;
  }

  .daily-review {
    border: 1px solid var(--color-accent);
    border-radius: 4px;
    padding: 0.6rem 0.75rem;
    margin-bottom: 0.6rem;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
    font-family: var(--font-mono);
    font-size: 0.8rem;
    background: color-mix(in srgb, var(--color-bg), var(--color-accent) 6%);
  }

  .daily-review-text {
    flex: 1;
    min-width: 12rem;
  }

  .daily-review-actions {
    display: flex;
    gap: 0.4rem;
  }

  .daily-review button {
    font-family: var(--font-mono);
    font-size: 0.75rem;
    padding: 0.25rem 0.6rem;
    background: transparent;
    border: 1px solid var(--color-border);
    color: var(--color-fg);
    border-radius: 3px;
    cursor: pointer;
  }

  .daily-review button.apply-review {
    border-color: var(--color-accent);
    color: var(--color-accent);
  }

  .popover-anchor {
    position: absolute;
    bottom: 100%;
    left: 0;
    right: 0;
    z-index: 5;
    margin-bottom: 0.25rem;
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
  button.mic,
  button.tts,
  button.llm-emit {
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

  button.mic.listening,
  button.tts.enabled,
  button.llm-emit.enabled {
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
