// Per-command exemplar phrases for the embedding-based intent suggester.
//
// These strings get embedded once at first use and cached for the page
// lifetime. The user's input is embedded and cosine-scored against each
// exemplar; the top match (if above threshold) gets promoted in the chip
// bar. We never auto-route — promotion is a one-tap-recoverable hint.
//
// Tuning notes for future revisions:
//   - Keep exemplars short and intent-specific. Long sentences match too
//     much and dilute the signal.
//   - Phrases should mirror how users actually start sentences when they
//     have that intent, not how we'd describe the command formally.
//   - When adding a new command, add ≥4 exemplars covering distinct
//     phrasings.

export const INTENT_EXEMPLARS: Record<string, readonly string[]> = {
  '/journal': [
    'today I felt',
    'this morning I',
    'I had a great day',
    'reflecting on today',
    'feeling tired',
    'note for today',
  ],
  '/save': [
    'save this conversation',
    'save the answer above',
    'keep this chat',
    'record this for later',
    'save what you just said',
  ],
  '/note': [
    'create a new note',
    'jot down an idea',
    'capture this thought',
    'I have an idea about',
    'remember to think about',
  ],
  '/list': [
    'add eggs to my grocery list',
    'put milk on the shopping list',
    'add this to my todo',
    'remind me to buy',
    'on my reading list',
  ],
  '/append': [
    'append to my note about',
    'add this to the existing note',
    'continue writing in',
    'extend the note about',
  ],
  '/edit': [
    'change my note about',
    'fix the typo in',
    'update the note',
    'remove the part about',
    'rewrite that note to say',
  ],
  '/find': [
    'where did I write about',
    'find my notes on',
    'do I have anything about',
    'search for',
  ],
  '/related': ['what notes are similar to', 'find related notes', 'see also for'],
  '/archive': ['archive this note', "I don't need this anymore", 'retire this'],
  '/tag': ['tag this note with', 'add tags', 'mark this as'],
};
