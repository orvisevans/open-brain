// Text-to-speech for assistant replies.
//
// Wraps the Web Speech Synthesis API with the small subset we need:
// availability check, speak (cancelling any in-flight utterance by default),
// and cancel. Toggle state lives in localStorage — voice preferences are
// inherently per-device, so syncing to the vault would be wrong.
//
// Phase 5.5 ships only the one-shot "speak the reply after streaming
// completes" pattern. Continuous listening, voice-activity detection, and
// interrupt-on-user-speech are deferred to the post-MVP "full conversational
// voice mode" entry in §13 of the implementation plan.

const STORAGE_KEY = 'openbrain.tts-enabled';

export function isTtsAvailable(): boolean {
  // `in` works whether or not the global is declared in TS lib types — and
  // matches the runtime check, including the test environment where we
  // delete the property to simulate unsupported browsers.
  return 'speechSynthesis' in globalThis;
}

export function loadTtsEnabled(): boolean {
  try {
    return globalThis.localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function saveTtsEnabled(enabled: boolean): void {
  try {
    globalThis.localStorage.setItem(STORAGE_KEY, enabled ? 'true' : 'false');
  } catch {
    // localStorage may be unavailable (SSR, private mode); skip silently.
  }
}

export interface SpeakOptions {
  rate?: number;
  cancelInFlight?: boolean;
}

export function speak(text: string, options: SpeakOptions = {}): void {
  if (!isTtsAvailable()) return;
  if (text.trim() === '') return;
  if (options.cancelInFlight !== false) {
    globalThis.speechSynthesis.cancel();
  }
  const utterance = new globalThis.SpeechSynthesisUtterance(text);
  if (options.rate !== undefined) utterance.rate = options.rate;
  globalThis.speechSynthesis.speak(utterance);
}

export function cancelSpeech(): void {
  if (!isTtsAvailable()) return;
  globalThis.speechSynthesis.cancel();
}
