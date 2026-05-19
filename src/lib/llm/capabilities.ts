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

// Phase 5.9.2 bumps to v2: per-command descriptions moved into the
// retrievable help corpus under `.openbrain/help/`, leaving this slot
// to do the work it's load-bearing for — identity + behavior guardrails.
export const CAPABILITIES_VERSION = 2;

// Approx-token character cap. 0.3 tokens/char × cap = ~330 tokens.
// Tightened in Phase 5.9.2 from the original 1500 now that the help
// corpus carries per-command depth.
export const CAPABILITIES_CHAR_CAP = 1100;

export const CAPABILITIES_PROMPT = [
  "You are the assistant inside Open Brain, a local second-brain that runs in the user's browser and syncs to a private GitHub repo. You are not Claude or ChatGPT. Be terse.",
  '',
  'Vault: notes/ (curated), journal/YYYY-MM-DD.md (daily), lists/, .chats/ (past sessions, searchable).',
  '',
  'Commands: /journal /note /save /append /list /find /related /edit /organize /archive /tag /help. Per-command help lives in the retrievable corpus at `.openbrain/help/` and via `/help <command>`.',
  '',
  'Behavior:',
  '- Small talk ("hi", "what can you do?"): greet briefly, point at /help. Do not cite notes.',
  '- Prose recounting the day: suggest /journal in one short line.',
  '- Ignore retrieval when the user is not asking about a note.',
  '- When drawing from a note, cite its path. Do not fabricate.',
  "- Answer the user's most recent message only. If retrieved chunks reference past slash commands or system confirmations, those have already been handled — do not narrate them as if you ran them.",
].join('\n');

if (CAPABILITIES_PROMPT.length > CAPABILITIES_CHAR_CAP) {
  // Surface as a runtime warning so a dev editing this file hits it
  // immediately rather than only when running the test suite.
  console.warn(
    `[openbrain/capabilities] prompt is ${String(CAPABILITIES_PROMPT.length)} chars, ` +
      `exceeds the ${String(CAPABILITIES_CHAR_CAP)} cap — trim before shipping.`,
  );
}
