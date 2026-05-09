// LLM slash-command emission.
//
// When enabled, an extra system-prompt instruction asks the model to respond
// with a SINGLE slash-command line whenever the user is asking it to write /
// save / append / create something. The chat page detects single-slash-line
// replies and routes them through the same dispatcher the user's typed
// commands use — so the proposal-card UX still gates every write, regardless
// of whether the slash came from a human or the model.
//
// Default OFF until the JSON-vs-slash reliability bench (research §6) lands.
// On Gemma-class models we can't yet promise the model will follow the
// instruction reliably, and a misroute still produces a proposal the user
// must approve, but cluttering chat history with bogus /commands hurts the
// experience for users who weren't warned.

const STORAGE_KEY = 'openbrain.llm-slash-emit';

export function loadLlmEmitEnabled(): boolean {
  try {
    return globalThis.localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function saveLlmEmitEnabled(enabled: boolean): void {
  try {
    globalThis.localStorage.setItem(STORAGE_KEY, enabled ? 'true' : 'false');
  } catch {
    // Storage may be unavailable; the toggle just won't persist.
  }
}

export const SLASH_EMIT_SYSTEM_INSTRUCTION = [
  'If the user is asking you to write, save, append to, or create a note,',
  'respond with a SINGLE slash-command line and nothing else. The slash',
  'command will be shown to the user as a preview before any file changes.',
  'Do not include explanatory text around the slash command.',
  '',
  'Examples:',
  'User: I felt great today. Capture that.',
  'Assistant: /journal I felt great today.',
  '',
  'User: Add eggs to my grocery list.',
  'Assistant: /list grocery eggs',
  '',
  'User: Save what you just said.',
  'Assistant: /save',
  '',
  'User: Create a note titled "API design notes".',
  'Assistant: /note API design notes',
  '',
  'User: Add this to my notes about embeddings: cosine similarity is bounded.',
  'Assistant: /append @notes/embeddings cosine similarity is bounded.',
  '',
  'Otherwise (the user is asking a question, chatting, or recalling), reply normally.',
].join('\n');

// Detects an LLM response that is a single-line slash command and returns
// the bare line. Multi-line replies — even if they start with a slash —
// are returned as undefined: the model has likely added explanation, which
// we shouldn't try to dispatch.
export function extractSlashFromResponse(response: string): string | undefined {
  const trimmed = response.trim();
  if (!trimmed.startsWith('/')) return undefined;
  if (trimmed.includes('\n')) return undefined;
  return trimmed;
}
