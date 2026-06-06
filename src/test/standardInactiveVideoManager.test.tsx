import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MutableRefObject } from 'react';

import { useInactiveVideoManager } from '../flavors/standard/preview/useInactiveVideoManager';
import {
  getStandardPreviewPlatformCapabilities,
  standardPreviewRuntime,
} from '../flavors/standard/standardPreviewRuntime';
import type { MediaElementsRef, MediaItem } from '../types';
import type { PlatformCapabilities } from '../utils/platform';

function createCapabilities(
  overrides: Partial<PlatformCapabilities> = {},
): PlatformCapabilities {
  return {
    userAgent: 'test-agent',
    platform: 'test-platform',
    maxTouchPoints: 0,
    isAndroid: true,
    isIOS: false,
    isSafari: false,
    isIosSafari: false,
    supportsShowSaveFilePicker: false,
    supportsShowOpenFilePicker: false,
    supportsTrackProcessor: true,
    supportsMp4MediaRecorder: true,
    audioContextMayInterrupt: false,
    supportedMediaRecorderProfile: { mimeType: 'video/mp4', extension: 'mp4' },
    trackProcessorCtor: undefined,
    ...overrides,
  };
}

function createRef<T>(value: T): MutableRefObject<T> {
  return { current: value };
}

function createVideoItem(overrides: Partial<MediaItem> = {}): MediaItem {
  return {
    id: overrides.id ?? 'video-1',
    file: overrides.file ?? new File([''], 'clip.mp4', { type: 'video/mp4' }),
    type: 'video',
    url: overrides.url ?? 'blob:video-1',
    volume: overrides.volume ?? 1,
    isMuted: overrides.isMuted ?? false,
    fadeIn: overrides.fadeIn ?? false,
    fadeOut: overrides.fadeOut ?? false,
    fadeInDuration: overrides.fadeInDuration ?? 1,
    fadeOutDuration: overrides.fadeOutDuration ?? 1,
    duration: overrides.duration ?? 6,
    originalDuration: overrides.originalDuration ?? 6,
    trimStart: overrides.trimStart ?? 0,
    trimEnd: overrides.trimEnd ?? 6,
    scale: overrides.scale ?? 1,
    positionX: overrides.positionX ?? 0,
    positionY: overrides.positionY ?? 0,
    isTransformOpen: overrides.isTransformOpen ?? false,
    isLocked: overrides.isLocked ?? false,
    ...overrides,
  };
}

function createMockVideoElement(initialCurrentTime: number) {
  const element = {
    paused: false,
    currentTime: initialCurrentTime,
    pause: vi.fn().mockImplementation(() => {
      element.paused = true;
    }),
  };

  return element;
}

describe('standard inactive video manager', () => {
  it('Android preview では protected previous/next video を pause/reset せず保護する', () => {
    const previousVideo = createVideoItem({ id: 'video-0', trimStart: 0.5 });
    const activeVideo = createVideoItem({ id: 'video-1', trimStart: 0 });
    const nextVideo = createVideoItem({ id: 'video-2', trimStart: 1.25 });
    const farVideo = createVideoItem({ id: 'video-3', trimStart: 2.5 });
    const previousVideoElement = createMockVideoElement(0.8);
    const nextVideoElement = createMockVideoElement(0.2);
    const farVideoElement = createMockVideoElement(4.2);
    const previewPlatformPolicy = standardPreviewRuntime.getPreviewPlatformPolicy(
      getStandardPreviewPlatformCapabilities(createCapabilities()),
    );

    const { result } = renderHook(() =>
      useInactiveVideoManager({
        mediaItemsRef: createRef([previousVideo, activeVideo, nextVideo, farVideo]),
        mediaElementsRef: createRef({
          [previousVideo.id]: previousVideoElement as unknown as HTMLVideoElement,
          [nextVideo.id]: nextVideoElement as unknown as HTMLVideoElement,
          [farVideo.id]: farVideoElement as unknown as HTMLVideoElement,
        } as MediaElementsRef),
        sourceNodesRef: createRef({}),
        activeVideoIdRef: createRef(activeVideo.id),
        previewPlatformPolicy,
      }),
    );

    result.current.resetInactiveVideos({
      nextVideoId: nextVideo.id,
      isAndroidPreview: true,
      protectedVideoIds: [previousVideo.id, nextVideo.id],
    });

    expect(previousVideoElement.pause).toHaveBeenCalledTimes(0);
    expect(previousVideoElement.currentTime).toBeCloseTo(0.8);
    expect(nextVideoElement.pause).toHaveBeenCalledTimes(0);
    expect(nextVideoElement.currentTime).toBeCloseTo(0.2);
    expect(farVideoElement.pause).toHaveBeenCalledTimes(1);
    expect(farVideoElement.currentTime).toBeCloseTo(farVideo.trimStart ?? 0);
  });

  it('通常 reset では inactive video 全体を trimStart に戻す', () => {
    const activeVideo = createVideoItem({ id: 'video-1', trimStart: 0 });
    const farVideo = createVideoItem({ id: 'video-3', trimStart: 2.5 });
    const farVideoElement = createMockVideoElement(4.2);
    const previewPlatformPolicy = standardPreviewRuntime.getPreviewPlatformPolicy(
      getStandardPreviewPlatformCapabilities(createCapabilities()),
    );

    const { result } = renderHook(() =>
      useInactiveVideoManager({
        mediaItemsRef: createRef([activeVideo, farVideo]),
        mediaElementsRef: createRef({
          [farVideo.id]: farVideoElement as unknown as HTMLVideoElement,
        } as MediaElementsRef),
        sourceNodesRef: createRef({}),
        activeVideoIdRef: createRef(activeVideo.id),
        previewPlatformPolicy,
      }),
    );

    result.current.resetInactiveVideos();

    expect(farVideoElement.pause).toHaveBeenCalledTimes(1);
    expect(farVideoElement.currentTime).toBeCloseTo(farVideo.trimStart ?? 0);
  });
});
