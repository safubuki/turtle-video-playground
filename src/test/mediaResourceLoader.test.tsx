import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import MediaResourceLoader from '../components/media/MediaResourceLoader';
import type { MediaItem } from '../types';

const getPlatformCapabilitiesMock = vi.fn();

vi.mock('../utils/platform', () => ({
  getPlatformCapabilities: () => getPlatformCapabilitiesMock(),
}));

function createVideoItem(): MediaItem {
  return {
    id: 'video-1',
    file: new File([''], 'clip.mp4', { type: 'video/mp4' }),
    type: 'video',
    url: 'blob:video-1',
    volume: 1,
    isMuted: false,
    fadeIn: false,
    fadeOut: false,
    fadeInDuration: 1,
    fadeOutDuration: 1,
    duration: 2,
    originalDuration: 2,
    trimStart: 0,
    trimEnd: 2,
    scale: 1,
    positionX: 0,
    positionY: 0,
    isTransformOpen: false,
    isLocked: false,
  };
}

describe('MediaResourceLoader', () => {
  beforeEach(() => {
    getPlatformCapabilitiesMock.mockReturnValue({ isIosSafari: false });
  });

  it('iOS Safari では video を clipped parent に閉じ込めず webkit inline 属性を付ける', () => {
    getPlatformCapabilitiesMock.mockReturnValue({ isIosSafari: true });

    const { container } = render(
      <MediaResourceLoader
        mediaItems={[createVideoItem()]}
        bgm={null}
        narrations={[]}
        onElementLoaded={vi.fn()}
        onRefAssign={vi.fn()}
        onSeeked={vi.fn()}
        onVideoLoadedData={vi.fn()}
      />,
    );

    const wrapper = container.firstElementChild as HTMLDivElement;
    const video = container.querySelector('video');

    expect(wrapper.style.overflow).toBe('visible');
    expect(wrapper.style.width).toBe('1px');
    expect(video?.getAttribute('webkit-playsinline')).toBe('');
    expect(video?.style.opacity).toBe('0.01');
  });
});
