import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cancelSpeech, isTtsAvailable, loadTtsEnabled, saveTtsEnabled, speak } from '../tts';

interface UtteranceLike {
  text: string;
  rate: number;
}

interface SpeechSynthesisLike {
  speak: (utterance: UtteranceLike) => void;
  cancel: () => void;
}

let speakSpy: ReturnType<typeof vi.fn>;
let cancelSpy: ReturnType<typeof vi.fn>;

class FakeUtterance implements UtteranceLike {
  text: string;
  rate = 1;
  constructor(text: string) {
    this.text = text;
  }
}

beforeEach(() => {
  speakSpy = vi.fn();
  cancelSpy = vi.fn();
  const fakeSynth: SpeechSynthesisLike = {
    speak: (utterance) => {
      speakSpy(utterance);
    },
    cancel: () => {
      cancelSpy();
    },
  };
  Object.defineProperty(globalThis, 'speechSynthesis', {
    value: fakeSynth,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', {
    value: FakeUtterance,
    configurable: true,
  });
  // Fresh localStorage shim per test. We expose only the methods the module
  // touches; the cast at the boundary is the price of bypassing DOM types.
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (key: string) => store.get(key),
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => {
        store.clear();
      },
    } as unknown as Storage,
    configurable: true,
  });
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'speechSynthesis');
  Reflect.deleteProperty(globalThis, 'SpeechSynthesisUtterance');
  Reflect.deleteProperty(globalThis, 'localStorage');
});

describe('isTtsAvailable', () => {
  it('returns true when speechSynthesis exists', () => {
    expect(isTtsAvailable()).toBe(true);
  });

  it('returns false when speechSynthesis is missing', () => {
    Reflect.deleteProperty(globalThis, 'speechSynthesis');
    expect(isTtsAvailable()).toBe(false);
  });
});

describe('toggle persistence', () => {
  it('starts false', () => {
    expect(loadTtsEnabled()).toBe(false);
  });

  it('round-trips through localStorage', () => {
    saveTtsEnabled(true);
    expect(loadTtsEnabled()).toBe(true);
    saveTtsEnabled(false);
    expect(loadTtsEnabled()).toBe(false);
  });
});

describe('speak', () => {
  it('cancels in-flight utterance and speaks the new one', () => {
    speak('hello');
    expect(cancelSpy).toHaveBeenCalledTimes(1);
    expect(speakSpy).toHaveBeenCalledTimes(1);
    expect(speakSpy).toHaveBeenCalledWith(expect.objectContaining({ text: 'hello' }));
  });

  it('respects cancelInFlight: false', () => {
    speak('hello', { cancelInFlight: false });
    expect(cancelSpy).not.toHaveBeenCalled();
    expect(speakSpy).toHaveBeenCalledTimes(1);
  });

  it('skips empty text', () => {
    speak('   ');
    expect(speakSpy).not.toHaveBeenCalled();
  });

  it('passes rate through to the utterance', () => {
    speak('hello', { rate: 1.5 });
    expect(speakSpy).toHaveBeenCalledWith(expect.objectContaining({ rate: 1.5 }));
  });
});

describe('cancelSpeech', () => {
  it('calls cancel on the global synth', () => {
    cancelSpeech();
    expect(cancelSpy).toHaveBeenCalledTimes(1);
  });
});
