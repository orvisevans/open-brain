import { describe, expect, it } from 'vitest';

import type { TranscriptEvent } from '../types';
import { createWebSpeechTranscriber } from '../web-speech';

function noop(): void {
  /* no-op */
}

const noFactory = (): undefined => undefined;

interface ResultEntry {
  transcript: string;
  isFinal: boolean;
}

type Listener = ((event: unknown) => void) | (() => void);

interface FakeRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  listeners: Map<string, Listener[]>;
  addEventListener(type: string, listener: Listener): void;
  start(): void;
  stop(): void;
  abort(): void;
  fireResult(...entries: ResultEntry[]): void;
  fireError(error: string, message?: string): void;
  fireEnd(): void;
  startImpl?: () => void;
}

function makeFakeRecognition(): FakeRecognition {
  const listeners = new Map<string, Listener[]>();
  const fake: FakeRecognition = {
    lang: '',
    continuous: false,
    interimResults: false,
    listeners,
    addEventListener: (type, listener) => {
      const list = listeners.get(type) ?? [];
      list.push(listener);
      listeners.set(type, list);
    },
    start: () => {
      fake.startImpl?.();
    },
    stop: noop,
    abort: noop,
    fireResult: (...entries) => {
      const results = entries.map((entry) => ({
        isFinal: entry.isFinal,
        length: 1,
        0: { transcript: entry.transcript },
      }));
      const event = {
        resultIndex: 0,
        results: Object.assign(results, {
          length: results.length,
          item: (index: number) => results[index],
        }),
      };
      for (const listener of listeners.get('result') ?? []) {
        (listener as (eventArgument: typeof event) => void)(event);
      }
    },
    fireError: (errorCode, message) => {
      const event = { error: errorCode, message };
      for (const listener of listeners.get('error') ?? []) {
        (listener as (eventArgument: typeof event) => void)(event);
      }
    },
    fireEnd: () => {
      for (const listener of listeners.get('end') ?? []) {
        (listener as () => void)();
      }
    },
  };
  return fake;
}

describe('createWebSpeechTranscriber', () => {
  it('returns isAvailable() === false when no recognition constructor exists', () => {
    const transcriber = createWebSpeechTranscriber({ recognitionFactory: noFactory });
    expect(transcriber.isAvailable()).toBe(false);
  });

  it('returns isAvailable() === true when factory provides an instance', () => {
    const transcriber = createWebSpeechTranscriber({
      recognitionFactory: makeFakeRecognition,
    });
    expect(transcriber.isAvailable()).toBe(true);
  });

  it('emits partial then final events from result handler', async () => {
    const recognition = makeFakeRecognition();
    const transcriber = createWebSpeechTranscriber({
      recognitionFactory: () => recognition,
    });
    const iterator = transcriber.start()[Symbol.asyncIterator]();

    queueMicrotask(() => {
      recognition.fireResult({ transcript: 'hello', isFinal: false });
      recognition.fireResult({ transcript: 'hello world', isFinal: true });
      recognition.fireEnd();
    });

    const events: TranscriptEvent[] = [];
    for (let next = await iterator.next(); next.done !== true; next = await iterator.next()) {
      events.push(next.value);
    }
    expect(events).toEqual([
      { kind: 'partial', text: 'hello' },
      { kind: 'final', text: 'hello world' },
    ]);
  });

  it('forwards error events', async () => {
    const recognition = makeFakeRecognition();
    const transcriber = createWebSpeechTranscriber({
      recognitionFactory: () => recognition,
    });
    const iterator = transcriber.start()[Symbol.asyncIterator]();

    queueMicrotask(() => {
      recognition.fireError('no-speech', 'silence detected');
      recognition.fireEnd();
    });

    const events: TranscriptEvent[] = [];
    for (let next = await iterator.next(); next.done !== true; next = await iterator.next()) {
      events.push(next.value);
    }
    expect(events[0]).toEqual({ kind: 'error', message: 'silence detected' });
  });

  it('emits an error event and terminates if start() throws', async () => {
    const recognition = makeFakeRecognition();
    recognition.startImpl = () => {
      throw new Error('boom');
    };
    const transcriber = createWebSpeechTranscriber({
      recognitionFactory: () => recognition,
    });
    const iterator = transcriber.start()[Symbol.asyncIterator]();
    const events: TranscriptEvent[] = [];
    for (let next = await iterator.next(); next.done !== true; next = await iterator.next()) {
      events.push(next.value);
    }
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe('error');
  });

  it('stop() is a no-op when nothing is active', async () => {
    const transcriber = createWebSpeechTranscriber({
      recognitionFactory: noFactory,
    });
    await transcriber.stop();
  });
});
