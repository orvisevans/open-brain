// WebSpeechTranscriber — uses the browser's `webkitSpeechRecognition` /
// `SpeechRecognition` API.
//
// Capability matrix at time of writing:
//   - Chrome / Edge / Brave: full support via webkitSpeechRecognition
//     (network-backed; requires online).
//   - Safari (macOS 14.1+): support via SpeechRecognition.
//   - Firefox: not supported (returns isAvailable() === false).
//
// Phase 9 will surface the network requirement on the compat page; for now,
// the chat UI just hides the mic button when isAvailable() is false.

import { logError } from '$lib/log';

import type { Transcriber, TranscriptEvent } from './types';

// Minimal structural type for SpeechRecognition. The DOM lib types are
// patchy across TS versions; we capture only what we use.
interface SpeechRecognitionEvent {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}
interface SpeechRecognitionResultList {
  length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}
interface SpeechRecognitionResult {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternative;
}
interface SpeechRecognitionAlternative {
  transcript: string;
}
interface SpeechRecognitionErrorEvent {
  error: string;
  message?: string;
}
interface SpeechRecognitionInstance {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  addEventListener(type: 'result', listener: (event: SpeechRecognitionEvent) => void): void;
  addEventListener(type: 'error', listener: (event: SpeechRecognitionErrorEvent) => void): void;
  addEventListener(type: 'end' | 'start', listener: () => void): void;
  start(): void;
  stop(): void;
  abort(): void;
}
type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

interface WindowWithSpeech {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
}

function getRecognitionConstructor(): SpeechRecognitionConstructor | undefined {
  if ((globalThis as { window?: unknown }).window === undefined) return undefined;
  const w = globalThis.window as unknown as WindowWithSpeech;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export interface WebSpeechOptions {
  language?: string;
  // For tests — replaces the browser API resolver.
  recognitionFactory?: () => SpeechRecognitionInstance | undefined;
}

export function createWebSpeechTranscriber(options: WebSpeechOptions = {}): Transcriber {
  const language = options.language ?? 'en-US';
  const factory =
    options.recognitionFactory ??
    (() => {
      const Ctor = getRecognitionConstructor();
      return Ctor === undefined ? undefined : new Ctor();
    });

  let active: SpeechRecognitionInstance | undefined;

  function isAvailable(): boolean {
    return factory() !== undefined;
  }

  function start(): AsyncIterable<TranscriptEvent> {
    return {
      [Symbol.asyncIterator]: () => {
        const queue: TranscriptEvent[] = [];
        const waiters: ((value: IteratorResult<TranscriptEvent>) => void)[] = [];
        let done = false;

        function push(event: TranscriptEvent): void {
          const next = waiters.shift();
          if (next === undefined) {
            queue.push(event);
            return;
          }
          next({ value: event, done: false });
        }

        function close(): void {
          if (done) return;
          done = true;
          while (waiters.length > 0) {
            const next = waiters.shift();
            next?.({ value: undefined, done: true });
          }
        }

        const recognition = factory();
        if (recognition === undefined) {
          push({ kind: 'error', message: 'speech recognition not available' });
          close();
        } else {
          active = recognition;
          recognition.lang = language;
          recognition.continuous = true;
          recognition.interimResults = true;

          recognition.addEventListener('result', (event) => {
            for (let index = event.resultIndex; index < event.results.length; index += 1) {
              const result = event.results[index];
              if (result === undefined) continue;
              const alternative = result[0];
              if (alternative === undefined) continue;
              push({
                kind: result.isFinal ? 'final' : 'partial',
                text: alternative.transcript,
              });
            }
          });

          recognition.addEventListener('error', (event) => {
            push({
              kind: 'error',
              message: event.message ?? event.error,
            });
          });

          recognition.addEventListener('end', () => {
            close();
          });

          try {
            recognition.start();
          } catch (error: unknown) {
            logError('transcribe/web-speech-start', { error });
            push({
              kind: 'error',
              message: error instanceof Error ? error.message : String(error),
            });
            close();
          }
        }

        return {
          next: (): Promise<IteratorResult<TranscriptEvent>> => {
            const queued = queue.shift();
            if (queued !== undefined) {
              return Promise.resolve({ value: queued, done: false });
            }
            if (done) {
              return Promise.resolve({ value: undefined, done: true });
            }
            return new Promise((resolve) => {
              waiters.push(resolve);
            });
          },
          return: (): Promise<IteratorResult<TranscriptEvent>> => {
            close();
            return Promise.resolve({ value: undefined, done: true });
          },
        };
      },
    };
  }

  function stop(): Promise<void> {
    if (active !== undefined) {
      try {
        active.stop();
      } catch (error: unknown) {
        logError('transcribe/web-speech-stop', { error });
      }
      active = undefined;
    }
    return Promise.resolve();
  }

  return { isAvailable, start, stop };
}
