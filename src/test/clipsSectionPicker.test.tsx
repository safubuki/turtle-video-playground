import type { ComponentProps } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ClipsSection from '../components/sections/ClipsSection';

function renderClipsSection(overrides: Partial<ComponentProps<typeof ClipsSection>> = {}) {
  const props: ComponentProps<typeof ClipsSection> = {
    mediaItems: [],
    mediaTimelineRanges: {},
    isClipsLocked: false,
    mediaElements: {},
    onToggleClipsLock: vi.fn(),
    onMediaUpload: vi.fn(),
    onOpenMediaPicker: vi.fn(),
    supportsShowOpenFilePicker: false,
    onMoveMedia: vi.fn(),
    onRemoveMedia: vi.fn(),
    onToggleMediaLock: vi.fn(),
    onToggleTransformPanel: vi.fn(),
    onUpdateVideoTrim: vi.fn(),
    onUpdateImageDuration: vi.fn(),
    onUpdateMediaScale: vi.fn(),
    onUpdateMediaPosition: vi.fn(),
    onResetMediaSetting: vi.fn(),
    onUpdateMediaVolume: vi.fn(),
    onToggleMediaMute: vi.fn(),
    onToggleMediaFadeIn: vi.fn(),
    onToggleMediaFadeOut: vi.fn(),
    onUpdateFadeInDuration: vi.fn(),
    onUpdateFadeOutDuration: vi.fn(),
    onOpenHelp: vi.fn(),
    ...overrides,
  };

  return {
    ...render(<ClipsSection {...props} />),
    props,
  };
}

function getFileInput(container: HTMLElement): HTMLInputElement {
  const fileInput = container.querySelector('input[type="file"]');
  if (!(fileInput instanceof HTMLInputElement)) {
    throw new Error('file input not found');
  }
  return fileInput;
}

describe('ClipsSection media picker routing', () => {
  it('showOpenFilePicker 経路が有効なときは専用 picker を開く', () => {
    const onOpenMediaPicker = vi.fn();
    const { container } = renderClipsSection({
      supportsShowOpenFilePicker: true,
      onOpenMediaPicker,
    });
    const inputClickSpy = vi.spyOn(getFileInput(container), 'click');
    try {
      fireEvent.click(screen.getByRole('button', { name: '追加' }));

      expect(onOpenMediaPicker).toHaveBeenCalledTimes(1);
      expect(inputClickSpy).not.toHaveBeenCalled();
    } finally {
      inputClickSpy.mockRestore();
    }
  });

  it('showOpenFilePicker 経路を無効化したときは hidden input を使う', () => {
    const onOpenMediaPicker = vi.fn();
    const { container } = renderClipsSection({
      supportsShowOpenFilePicker: false,
      onOpenMediaPicker,
    });
    const inputClickSpy = vi.spyOn(getFileInput(container), 'click');
    try {
      fireEvent.click(screen.getByRole('button', { name: '追加' }));

      expect(onOpenMediaPicker).not.toHaveBeenCalled();
      expect(inputClickSpy).toHaveBeenCalledTimes(1);
    } finally {
      inputClickSpy.mockRestore();
    }
  });
});
