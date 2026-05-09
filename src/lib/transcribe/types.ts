// Public types for the transcription layer.
// Mirrors ARCHITECTURE-2026-04-17 §6.

export type TranscriptEvent =
  | { kind: 'partial'; text: string }
  | { kind: 'final'; text: string }
  | { kind: 'error'; message: string };

export interface Transcriber {
  /** Capability check. Hide the mic button when this returns false. */
  isAvailable(): boolean;
  /**
   * Begin recognition. Resolves the iterable as soon as recognition starts;
   * yields events as the user speaks. The consumer calls `stop()` to end.
   */
  start(): AsyncIterable<TranscriptEvent>;
  /** Stop recognition. Idempotent. */
  stop(): Promise<void>;
}
