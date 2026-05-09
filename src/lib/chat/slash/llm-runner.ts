// Shared interface for slash handlers that need LLM access.
//
// Production wires this with `streamChat` (accumulating tokens into a buffer)
// and a `model.loaded` check. Tests pass a stub that returns canned text.
//
// Hoisted out of `handlers/organize.ts` once `/edit` (Phase 5.6) needed the
// same shape — duplicating a 3-line interface is silly.

export interface SlashLlmRunner {
  modelLoaded(): boolean;
  complete(systemPrompt: string, userPrompt: string): Promise<string>;
}
