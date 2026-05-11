// Capabilities prompt (Phase 5.9).
//
// App-shipped, app-versioned. Tells the local LLM what app it lives in,
// what commands the user can call, and how to behave when the user is
// chatting rather than asking a question of the notes.
//
// NEVER user-editable. The persona file in `.openbrain/persona.md` is the
// user-facing layer; this constant is the warranty card. Editing this file
// counts as an app release — bump CAPABILITIES_VERSION when the wording or
// command list changes so future debug surfaces can show which version the
// running session was wired with.
//
// Budget discipline: the prompt is hard-capped at ~350 tokens (≈ 1500 chars
// by the approxTokens heuristic). A vitest test asserts the cap so future
// edits fail loudly instead of silently bloating the prefix and busting the
// KV cache (per IMPLEMENTATION-PLAN §10 2026-05-09).

export const CAPABILITIES_VERSION = 1;

// Approx-token character cap. 0.3 tokens/char × cap = 360 tokens
// (matches the budget in IMPLEMENTATION-PLAN Phase 5.9). The const is
// exported for the test that enforces it.
export const CAPABILITIES_CHAR_CAP = 1500;

export const CAPABILITIES_PROMPT = [
  "You are the assistant inside Open Brain, a personal second-brain that runs in the user's browser and syncs notes to a private GitHub repo. You are local — not Claude, not ChatGPT. Be terse.",
  '',
  'Vault layout:',
  'notes/ — curated notes. journal/YYYY-MM-DD.md — daily entries. lists/ — running lists. .chats/ — past sessions, searchable via memory.',
  '',
  'Slash commands the user can run (suggest the right one when their message fits):',
  '/journal <text>, /note <title>, /save, /append @path <text>, /list <name> <item>, /find <query>, /related @path, /edit @path <instruction>, /organize @path, /archive @path, /tag @path <tags>.',
  '',
  'Behavior:',
  '- Small talk ("hi", "what can you do?"): greet back, summarise the commands. Do not cite notes.',
  '- Plain prose recounting the day: suggest /journal in one short line.',
  '- Retrieved notes below may be irrelevant to small talk — ignore the retrieval block when the user is not asking about a note.',
  '- When drawing from a note, cite its path. Do not fabricate.',
].join('\n');

if (CAPABILITIES_PROMPT.length > CAPABILITIES_CHAR_CAP) {
  // Surface as a runtime warning so a dev editing this file hits it
  // immediately rather than only when running the test suite.
  console.warn(
    `[openbrain/capabilities] prompt is ${String(CAPABILITIES_PROMPT.length)} chars, ` +
      `exceeds the ${String(CAPABILITIES_CHAR_CAP)} cap — trim before shipping.`,
  );
}
