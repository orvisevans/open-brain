// System-prompt builder (Phase 5.9).
//
// Composes the final `role: 'system'` content the chat-page hands to
// WebLLM. Replaces the inline concatenation that used to live in
// src/routes/chat/+page.svelte. Order is deliberate (stable-prefix
// to variable-suffix) so KV cache reuse stays effective:
//
//   1. CAPABILITIES_PROMPT       (byte-stable per app version)
//   2. PERSONA section           (user-edited but rarely; loaded once
//                                 per chat mount)
//   3. retrieval system prompt   (the existing SYSTEM_PROMPT constant)
//   4. SLASH_EMIT_INSTRUCTION    (toggle-driven; tail so flipping it
//                                 doesn't bust the longer prefix)
//   5. retrieval block           (composed into the user message, not
//                                 the system message — caller passes it
//                                 in via `retrievalBlock`)
//
// The retrieval block is technically embedded in the user prompt by
// `assembleContext`, not in the system prompt. We still expose it via
// `buildSystemPrompt` so the helper owns the whole stable prefix from
// the model's perspective (system + retrieval together).

export interface BuildSystemPromptInput {
  // The capabilities constant (Phase 5.9). Caller passes
  // CAPABILITIES_PROMPT; we accept it as input so tests can stub.
  capabilities: string;
  // Pre-rendered persona block, or undefined when no persona is set.
  // See $lib/persona renderPersonaForPrompt.
  persona?: string;
  // The retrieval-layer system instructions (the existing
  // SYSTEM_PROMPT from $lib/memory/retrieve). Kept as a parameter so
  // we don't introduce a memory → llm import cycle.
  retrievalGuardrails: string;
  // The SLASH_EMIT_SYSTEM_INSTRUCTION constant from
  // $lib/chat/slash/llm-emit, only when the toggle is on.
  slashEmit?: string;
}

export interface BuildSystemPromptOutput {
  prompt: string;
  // Diagnostic: approximate token count via the standard 0.3 tok/char
  // heuristic. Surfaced for the optional debug panel; not load-bearing
  // for any runtime decision.
  approxTokens: number;
}

export function buildSystemPrompt(input: BuildSystemPromptInput): BuildSystemPromptOutput {
  const sections: string[] = [input.capabilities.trim()];
  if (input.persona !== undefined && input.persona.trim() !== '') {
    sections.push(input.persona.trim());
  }
  sections.push(input.retrievalGuardrails.trim());
  if (input.slashEmit !== undefined && input.slashEmit.trim() !== '') {
    sections.push(input.slashEmit.trim());
  }
  const prompt = sections.join('\n\n');
  return {
    prompt,
    approxTokens: Math.ceil(prompt.length * 0.3),
  };
}
