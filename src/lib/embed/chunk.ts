// Markdown chunking for embedding.
//
// Strategy (per IMPLEMENTATION-PLAN Phase 4):
//   1. Split the body on `##` headings (h2). Each section becomes a candidate
//      chunk seeded with its heading text.
//   2. Any section that exceeds `maxTokens` is sub-divided into windows of
//      `maxTokens` tokens. The first paragraph(s) of each window keep the
//      heading as a prefix so retrieval can show context-rich snippets.
//   3. Empty sections are dropped.
//
// We rely on the embedder's tokenizer for exact token counts. The `countTokens`
// callback is injected so tests don't need the real ONNX tokenizer.

export interface Chunk {
  index: number;
  // Free text fed to the embedder. Includes the section heading (if any).
  text: string;
  // The heading prefix (without the `## ` markers) or undefined if the chunk
  // came from above the first h2 heading.
  heading?: string;
  // Position in the source body — useful later for "show me where this came
  // from" UI in retrieval. 0-indexed character offsets.
  start: number;
  end: number;
}

export interface ChunkOptions {
  maxTokens?: number;
  countTokens: (text: string) => Promise<number> | number;
}

const DEFAULT_MAX_TOKENS = 400;

// Section-detection regex. Matches a line that starts with exactly two `#`
// followed by a space — `##` is "section" in our convention; `#` (h1) is
// reserved for the note title and we don't split on it because it appears at
// most once at the top.
const H2_LINE = /^##\s+(.+)$/;

interface RawSection {
  heading?: string;
  body: string;
  start: number;
  end: number;
}

/**
 * Chunk a markdown body into embedding inputs.
 *
 * The body should be the post-frontmatter content of a note (i.e. what
 * `Note.content` exposes). Returned chunks are in source order.
 */
export async function chunkMarkdown(body: string, options: ChunkOptions): Promise<Chunk[]> {
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  const sections = splitOnH2(body);

  const out: Chunk[] = [];
  for (const section of sections) {
    const sectionText =
      section.heading === undefined
        ? section.body.trim()
        : `${section.heading}\n\n${section.body.trim()}`;

    if (sectionText === '') continue;

    const tokens = await options.countTokens(sectionText);
    if (tokens <= maxTokens) {
      out.push({
        index: out.length,
        text: sectionText,
        ...(section.heading !== undefined && { heading: section.heading }),
        start: section.start,
        end: section.end,
      });
      continue;
    }

    // Section is too big — split into token-bounded windows. We split on
    // paragraph boundaries first (blank lines), then fall back to sentences,
    // then to hard token limits.
    const windows = await splitTooLargeSection(section, maxTokens, options.countTokens);
    for (const window of windows) {
      if (window.text === '') continue;
      out.push({
        index: out.length,
        text: window.text,
        ...(section.heading !== undefined && { heading: section.heading }),
        start: window.start,
        end: window.end,
      });
    }
  }

  return out;
}

function splitOnH2(body: string): RawSection[] {
  const lines = body.split('\n');
  const sections: RawSection[] = [];
  let currentHeading: string | undefined;
  let currentLines: string[] = [];
  let currentStart = 0;
  let cursor = 0;

  function flush(end: number): void {
    const text = currentLines.join('\n');
    sections.push({
      ...(currentHeading !== undefined && { heading: currentHeading }),
      body: text,
      start: currentStart,
      end,
    });
  }

  for (const line of lines) {
    const lineLength = line.length + 1; // +1 for the \n that split removed
    const match = H2_LINE.exec(line);
    if (match === null) {
      currentLines.push(line);
    } else {
      // Flush the prior section before starting a new one.
      flush(cursor);
      currentHeading = (match[1] ?? '').trim();
      currentLines = [];
      currentStart = cursor + lineLength;
    }
    cursor += lineLength;
  }
  flush(cursor);

  return sections.filter((section) => {
    // Drop empty leading section (no heading + no body) that comes from
    // bodies that start with an h2.
    if (section.heading === undefined && section.body.trim() === '') return false;
    return true;
  });
}

interface Window {
  text: string;
  start: number;
  end: number;
}

async function splitTooLargeSection(
  section: RawSection,
  maxTokens: number,
  countTokens: ChunkOptions['countTokens'],
): Promise<Window[]> {
  const headingPrefix = section.heading === undefined ? '' : `${section.heading}\n\n`;
  // Token budget for the body portion of each window. Reserve a few tokens
  // for the heading prefix; the floor prevents pathologically tiny budgets
  // when the heading itself is enormous.
  const headingTokens = headingPrefix === '' ? 0 : await countTokens(headingPrefix);
  const bodyBudget = Math.max(10, maxTokens - headingTokens);

  const paragraphs = splitParagraphs(section.body, section.start);
  const windows: Window[] = [];
  let pendingText = '';
  let pendingStart = section.start;
  let pendingEnd = section.start;
  let pendingTokens = 0;

  function flushPending(): void {
    if (pendingText === '') return;
    const text = `${headingPrefix}${pendingText.trim()}`;
    windows.push({ text, start: pendingStart, end: pendingEnd });
    pendingText = '';
    pendingTokens = 0;
  }

  for (const paragraph of paragraphs) {
    const paragraphTokens = await countTokens(paragraph.text);
    if (paragraphTokens > bodyBudget) {
      // Single paragraph blew the budget on its own. Flush whatever's pending,
      // then hard-split the paragraph by sentences/characters.
      flushPending();
      const subWindows = await splitOversizedParagraph(
        paragraph,
        bodyBudget,
        countTokens,
        headingPrefix,
      );
      windows.push(...subWindows);
      continue;
    }

    if (pendingTokens + paragraphTokens > bodyBudget && pendingText !== '') {
      flushPending();
    }
    if (pendingText === '') {
      pendingStart = paragraph.start;
    }
    pendingText = pendingText === '' ? paragraph.text : `${pendingText}\n\n${paragraph.text}`;
    pendingEnd = paragraph.end;
    pendingTokens += paragraphTokens;
  }
  flushPending();
  return windows;
}

interface Paragraph {
  text: string;
  start: number;
  end: number;
}

function splitParagraphs(body: string, baseOffset: number): Paragraph[] {
  const out: Paragraph[] = [];
  // Paragraph break = one or more blank lines. We track absolute offsets so
  // each chunk records where it came from in the source body.
  const paragraphRegex = /([\s\S]+?)(?=\n\s*\n|$)/g;
  let match;
  while ((match = paragraphRegex.exec(body)) !== null) {
    const captured = match[1] ?? '';
    const text = captured.trim();
    if (text === '') {
      // Avoid an infinite loop on a zero-width match by advancing.
      if (match.index === paragraphRegex.lastIndex) paragraphRegex.lastIndex += 1;
      continue;
    }
    out.push({
      text,
      start: baseOffset + match.index,
      end: baseOffset + match.index + captured.length,
    });
    if (match.index === paragraphRegex.lastIndex) paragraphRegex.lastIndex += 1;
  }
  return out;
}

async function splitOversizedParagraph(
  paragraph: Paragraph,
  budget: number,
  countTokens: ChunkOptions['countTokens'],
  headingPrefix: string,
): Promise<Window[]> {
  // Try sentence-level splits first.
  const sentences = paragraph.text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence !== '');

  const windows: Window[] = [];
  let buffer = '';
  let bufferTokens = 0;
  let bufferStart = paragraph.start;
  let cursor = paragraph.start;

  for (const sentence of sentences) {
    const sentenceTokens = await countTokens(sentence);
    if (sentenceTokens > budget) {
      // Even a single sentence blew the budget. Flush whatever's pending,
      // then hard-chop the sentence on word boundaries until we're under
      // budget per window.
      if (buffer !== '') {
        windows.push({
          text: `${headingPrefix}${buffer}`,
          start: bufferStart,
          end: cursor,
        });
        buffer = '';
        bufferTokens = 0;
        bufferStart = cursor;
      }
      const subWindows = await hardChop(sentence, budget, countTokens, headingPrefix, cursor);
      windows.push(...subWindows);
      cursor += sentence.length + 1;
      bufferStart = cursor;
      continue;
    }

    if (bufferTokens + sentenceTokens > budget && buffer !== '') {
      windows.push({
        text: `${headingPrefix}${buffer}`,
        start: bufferStart,
        end: cursor,
      });
      buffer = '';
      bufferTokens = 0;
      bufferStart = cursor;
    }
    buffer = buffer === '' ? sentence : `${buffer} ${sentence}`;
    bufferTokens += sentenceTokens;
    cursor += sentence.length + 1;
  }
  if (buffer !== '') {
    windows.push({
      text: `${headingPrefix}${buffer}`,
      start: bufferStart,
      end: paragraph.end,
    });
  }
  return windows;
}

// Word-boundary hard-chop for the rare case where a single sentence exceeds
// the budget. Walks word-by-word and emits a window every time the running
// token count crosses `budget`.
async function hardChop(
  text: string,
  budget: number,
  countTokens: ChunkOptions['countTokens'],
  headingPrefix: string,
  baseOffset: number,
): Promise<Window[]> {
  const words = text.split(/\s+/).filter((word) => word !== '');
  const windows: Window[] = [];
  let buffer = '';
  let bufferTokens = 0;
  let bufferOffset = baseOffset;
  let cursor = baseOffset;
  for (const word of words) {
    const tokens = await countTokens(word);
    if (bufferTokens + tokens > budget && buffer !== '') {
      windows.push({
        text: `${headingPrefix}${buffer}`,
        start: bufferOffset,
        end: cursor,
      });
      buffer = '';
      bufferTokens = 0;
      bufferOffset = cursor;
    }
    buffer = buffer === '' ? word : `${buffer} ${word}`;
    bufferTokens += tokens;
    cursor += word.length + 1;
  }
  if (buffer !== '') {
    windows.push({
      text: `${headingPrefix}${buffer}`,
      start: bufferOffset,
      end: cursor,
    });
  }
  return windows;
}
