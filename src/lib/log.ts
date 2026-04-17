// Structured error logger. Keeps log output identifiable and machine-parseable.
// Only console.error and console.warn are permitted by the lint config; use this
// wrapper so call-sites never have to remember the allowed subset.

export function logError(code: string, context: Record<string, unknown>): void {
  console.error(`[open-brain/${code}]`, context);
}
