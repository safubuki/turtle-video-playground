import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mediaStoreState = {
  mediaItems: [] as unknown[],
};

const audioStoreState = {
  bgm: null as unknown,
  narrations: [] as unknown[],
};

const captionStoreState = {
  captions: [] as unknown[],
};

const updateStoreState = {
  isApplyingUpdate: false,
};

vi.mock('../stores/mediaStore', () => ({
  default: (selector: (state: typeof mediaStoreState) => unknown) => selector(mediaStoreState),
}));

vi.mock('../stores/audioStore', () => ({
  default: (selector: (state: typeof audioStoreState) => unknown) => selector(audioStoreState),
}));

vi.mock('../stores/captionStore', () => ({
  useCaptionStore: (selector: (state: typeof captionStoreState) => unknown) => selector(captionStoreState),
}));

vi.mock('../stores/updateStore', () => ({
  useUpdateStore: (selector: (state: typeof updateStoreState) => unknown) => selector(updateStoreState),
}));

import { usePreventUnload } from '../hooks/usePreventUnload';

const PreventUnloadHarness: React.FC = () => {
  usePreventUnload();
  return null;
};

describe('usePreventUnload', () => {
  beforeEach(() => {
    mediaStoreState.mediaItems = [];
    audioStoreState.bgm = null;
    audioStoreState.narrations = [];
    captionStoreState.captions = [];
    updateStoreState.isApplyingUpdate = false;
  });

  afterEach(() => {
    cleanup();
  });

  it('編集中のデータがあれば beforeunload を抑止する', () => {
    mediaStoreState.mediaItems = [{}];
    render(<PreventUnloadHarness />);

    const event = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
    const preventDefault = vi.fn();

    event.preventDefault = preventDefault as unknown as typeof event.preventDefault;
    Object.defineProperty(event, 'returnValue', {
      configurable: true,
      writable: true,
      value: undefined,
    });

    window.dispatchEvent(event);

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(event.returnValue).toBe('編集中のデータがあります。ページを離れてもよろしいですか？');
  });

  it('更新適用中は beforeunload ガードを出さない', () => {
    mediaStoreState.mediaItems = [{}];
    updateStoreState.isApplyingUpdate = true;
    render(<PreventUnloadHarness />);

    const event = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
    const preventDefault = vi.fn();

    event.preventDefault = preventDefault as unknown as typeof event.preventDefault;
    Object.defineProperty(event, 'returnValue', {
      configurable: true,
      writable: true,
      value: undefined,
    });

    window.dispatchEvent(event);

    expect(preventDefault).not.toHaveBeenCalled();
    expect(event.returnValue).toBeUndefined();
  });
});