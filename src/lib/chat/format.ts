// Chat session serialisation.
//
// On-disk format (`.chats/<session-id>.md`):
//
//   ---
//   schema_version: 1
//   session_id: 2026-05-09T07-15-00
//   started_at: 1700000000000
//   last_updated_at: 1700000005000
//   ---
//
//   ## user · 2026-05-09 07:15
//   message body…
//
//   ## assistant · 2026-05-09 07:15 · based on: notes/foo.md, notes/bar.md
//   reply body…
//
// Markdown for human inspectability + git diff legibility. The body parser
// is deliberately permissive: anything between a `## role · ...` line and the
// next role line is the message content.

import type { NotePath } from '$lib/vault/types';

import type { ChatMessage, ChatSession, Role } from './types';
import { CHAT_FILE_PREFIX, CHAT_SCHEMA_VERSION } from './types';

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const ROLE_LINE_RE =
  /^##\s+(user|assistant|system)\b(?:\s*·\s*([^·\n]+?))?(?:\s*·\s*based on:\s*([^\n]+?))?\s*$/;

export function chatPath(sessionId: string): NotePath {
  return `${CHAT_FILE_PREFIX}${sessionId}.md`;
}

export function isChatPath(path: NotePath): boolean {
  return path.startsWith(CHAT_FILE_PREFIX);
}

export class ChatParseError extends Error {
  override readonly name = 'ChatParseError';
}

export function serializeSession(session: ChatSession): string {
  const front = [
    '---',
    `schema_version: ${String(CHAT_SCHEMA_VERSION)}`,
    `session_id: ${session.id}`,
    `started_at: ${String(session.startedAt)}`,
    `last_updated_at: ${String(session.lastUpdatedAt)}`,
    '---',
    '',
  ];

  const body: string[] = [];
  for (const message of session.messages) {
    const time = formatTimestamp(message.timestamp);
    const cite =
      message.retrievedContext === undefined || message.retrievedContext.length === 0
        ? ''
        : ` · based on: ${message.retrievedContext.join(', ')}`;
    body.push(`## ${message.role} · ${time}${cite}`, '', message.content.trimEnd(), '');
  }

  return `${front.join('\n')}\n${body.join('\n')}`.replaceAll(/\n{3,}/g, '\n\n');
}

export function parseSession(content: string): ChatSession {
  const front = FRONTMATTER_RE.exec(content);
  if (front === null) {
    throw new ChatParseError('missing frontmatter');
  }
  const fields = parseFrontLines(front[1] ?? '');
  const sessionId = stringField(fields, 'session_id');
  const startedAt = numberField(fields, 'started_at');
  const lastUpdatedAt = numberField(fields, 'last_updated_at');

  const body = content.slice(front[0].length);
  const messages = parseMessages(body);

  return {
    id: sessionId,
    startedAt,
    lastUpdatedAt,
    messages,
  };
}

function parseMessages(body: string): ChatMessage[] {
  const lines = body.split('\n');
  const messages: ChatMessage[] = [];

  let current: { role: Role; timestamp: number; cite: NotePath[]; lines: string[] } | undefined;

  function flush(): void {
    if (current === undefined) return;
    const text = current.lines.join('\n').trim();
    messages.push({
      id: `${String(current.timestamp)}-${String(messages.length)}`,
      role: current.role,
      content: text,
      timestamp: current.timestamp,
      ...(current.cite.length > 0 && { retrievedContext: current.cite }),
    });
    current = undefined;
  }

  for (const line of lines) {
    const match = ROLE_LINE_RE.exec(line);
    if (match !== null) {
      flush();
      const role = match[1] as Role;
      const timestampText = match[2]?.trim() ?? '';
      const citeText = match[3]?.trim();
      current = {
        role,
        timestamp: parseTimestamp(timestampText),
        cite:
          citeText === undefined || citeText === ''
            ? []
            : citeText
                .split(',')
                .map((entry) => entry.trim())
                .filter((entry) => entry !== ''),
        lines: [],
      };
      continue;
    }
    if (current !== undefined) {
      current.lines.push(line);
    }
  }
  flush();
  return messages;
}

function formatTimestamp(ms: number): string {
  // ISO without seconds, in UTC for stability across devices. Format:
  // 2026-05-09 07:15. We use UTC so two devices in different time zones
  // produce identical files for the same instant.
  const date = new Date(ms);
  const yyyy = date.getUTCFullYear().toString().padStart(4, '0');
  const mm = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  const dd = date.getUTCDate().toString().padStart(2, '0');
  const hh = date.getUTCHours().toString().padStart(2, '0');
  const min = date.getUTCMinutes().toString().padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

function parseTimestamp(text: string): number {
  // Accept the format above plus a fallback to Date.parse for forgiving
  // input (e.g. ISO with seconds if a future writer adds them).
  if (text === '') return Date.now();
  const match = /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/.exec(text);
  if (match !== null) {
    const [, yyyy, mm, dd, hh, min] = match;
    return Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(min), 0, 0);
  }
  const fallback = Date.parse(text);
  return Number.isFinite(fallback) ? fallback : Date.now();
}

function parseFrontLines(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of block.split('\n')) {
    const line = rawLine.replace(/\r$/, '').trim();
    if (line === '' || line.startsWith('#')) continue;
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    out[key] = value;
  }
  return out;
}

function stringField(fields: Record<string, string>, key: string): string {
  const value = fields[key];
  if (value === undefined || value === '') {
    throw new ChatParseError(`missing field: ${key}`);
  }
  return value;
}

function numberField(fields: Record<string, string>, key: string): number {
  const raw = stringField(fields, key);
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new ChatParseError(`field ${key} is not a number: ${raw}`);
  }
  return parsed;
}

export function newSessionId(now: () => number = () => Date.now()): string {
  // Filename-safe ISO. Colons aren't legal on Windows filesystems; some
  // git tooling chokes on them too. Use dashes throughout.
  const date = new Date(now());
  const iso = date.toISOString();
  return iso.replaceAll(/[:.]/g, '-').replace('T', '_').replace('Z', '');
}
