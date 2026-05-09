// Minimal frontmatter mutation helpers.
//
// The parser (`frontmatter.ts`) reads YAML into a `Record<string, unknown>`.
// The mutators here write specific updates back as text — they do **not**
// reformat the whole frontmatter block. This preserves authored ordering,
// comments, and incidental whitespace; only the touched fields change.
//
// Scope: setField (replace or insert a flat scalar), addToInlineList (merge
// values into an existing `[a, b]` list, deduplicated). Anything fancier
// (block lists, nested maps) is out of scope until a use case forces it.

const FRONTMATTER_RE = /^(---\r?\n)([\s\S]*?)(\r?\n---\r?\n?)/;

export interface FrontmatterMutationResult {
  content: string;
  changed: boolean;
}

// Set or insert a scalar field. Replaces an existing line for `key`; inserts
// a new line at the end of the block when missing. Creates the frontmatter
// block entirely if the file has none.
export function setField(content: string, key: string, value: string): FrontmatterMutationResult {
  const next = computeSetField(content, key, value);
  return { content: next, changed: next !== content };
}

function computeSetField(content: string, key: string, value: string): string {
  const match = FRONTMATTER_RE.exec(content);
  if (match === null) {
    return `---\n${key}: ${value}\n---\n\n${content}`;
  }
  const [whole, opener = '', block = '', closer = ''] = match;
  const lines = block.split('\n');
  const fieldRe = new RegExp(`^${escapeRegex(key)}\\s*:`);
  const fieldIndex = lines.findIndex((line) => fieldRe.test(line));
  const newLine = `${key}: ${value}`;
  const updated =
    fieldIndex === -1
      ? [...lines, newLine]
      : lines.map((line, index) => (index === fieldIndex ? newLine : line));
  const rest = content.slice(whole.length);
  return `${opener}${updated.join('\n')}${closer}${rest}`;
}

// Merge `values` into the inline list at `key`. Creates `key: [values…]` if
// the field is missing. Skips values already present (case-sensitive).
export function addToInlineList(
  content: string,
  key: string,
  values: readonly string[],
): FrontmatterMutationResult {
  const next = computeAddToInlineList(content, key, values);
  return { content: next, changed: next !== content };
}

function computeAddToInlineList(content: string, key: string, values: readonly string[]): string {
  const cleaned = values.filter((value) => value.trim() !== '');
  if (cleaned.length === 0) return content;

  const match = FRONTMATTER_RE.exec(content);
  if (match === null) {
    return `---\n${key}: [${cleaned.join(', ')}]\n---\n\n${content}`;
  }
  const [whole, opener = '', block = '', closer = ''] = match;
  const lines = block.split('\n');
  const fieldRe = new RegExp(`^${escapeRegex(key)}\\s*:\\s*\\[(.*)\\]\\s*$`);
  const fieldIndex = lines.findIndex((line) => fieldRe.test(line));

  let updated: string[];
  if (fieldIndex === -1) {
    updated = [...lines, `${key}: [${cleaned.join(', ')}]`];
  } else {
    const targetLine = lines[fieldIndex] ?? '';
    const captured = fieldRe.exec(targetLine)?.[1] ?? '';
    const existing = captured
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry !== '');
    const merged = [...existing];
    for (const value of cleaned) {
      if (!merged.includes(value)) merged.push(value);
    }
    const newLine = `${key}: [${merged.join(', ')}]`;
    updated = lines.map((line, index) => (index === fieldIndex ? newLine : line));
  }
  const rest = content.slice(whole.length);
  return `${opener}${updated.join('\n')}${closer}${rest}`;
}

function escapeRegex(input: string): string {
  return input.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}
