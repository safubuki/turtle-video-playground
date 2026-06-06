import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MutableRefObject } from 'react';

import { usePreviewVisibilityLifecycle } from '../flavors/standard/preview/usePreviewVisibilityLifecycle';
import {
  getStandardPreviewPlatformCapabilities,
  standardPreviewRuntime,
} from '../flavors/standard/standardPreviewRuntime';
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

describe('standard preview visibility lifecycle', () => {
  const originalVisibilityState = document.visibilityState;

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: originalVisibilityState,
    });
  });

  it('active seek 中の可視復帰では paused seek の待機や再描画を壊さない', () => {
    let visibilityState: DocumentVisibilityState = 'visible';
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibilityState,
    });

    vi.spyOn(globalThis.performance, 'now').mockReturnValue(500);
    vi.spyOn(Date, 'now').mockReturnValue(1_000);

    const cancelPendingSeekPlaybackPrepare = vi.fn();
    const cancelPendingPausedSeekWait = vi.fn();
    const renderFrame = vi.fn();
    const renderPausedPreviewFrameAtTime = vi.fn();

    const previewPlatformPolicy = standardPreviewRuntime.getPreviewPlatformPolicy(
      getStandardPreviewPlatformCapabilities(createCapabilities()),
    );

    renderHook(() =>
      usePreviewVisibilityLifecycle({
        mediaElementsRef: createRef({}),
        mediaItemsRef: createRef([]),
        bgmRef: createRef(null),
        narrationsRef: createRef([]),
        activeVideoIdRef: createRef<string | null>(null),
        currentTimeRef: createRef(2.5),
        totalDurationRef: createRef(10),
        hiddenStartedAtRef: createRef(800),
        needsResyncAfterVisibilityRef: createRef(true),
        startTimeRef: createRef(0),
        audioResumeWaitFramesRef: createRef(0),
        lastVisibilityRefreshAtRef: createRef(0),
        isPlayingRef: createRef(false),
        isSeekingRef: createRef(true),
        audioCtxRef: createRef(null),
        isProcessing: false,
        previewPlatformPolicy,
        cancelPendingSeekPlaybackPrepare,
        cancelPendingPausedSeekWait,
        renderFrame,
        renderPausedPreviewFrameAtTimeRef: createRef(renderPausedPreviewFrameAtTime),
        pause: vi.fn(),
        logInfo: vi.fn(),
        logWarn: vi.fn(),
      }),
    );

    act(() => {
      visibilityState = 'visible';
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(cancelPendingSeekPlaybackPrepare).not.toHaveBeenCalled();
    expect(cancelPendingPausedSeekWait).not.toHaveBeenCalled();
    expect(renderPausedPreviewFrameAtTime).not.toHaveBeenCalled();
    expect(renderFrame).not.toHaveBeenCalled();
  });

  it('seek していない paused 状態の可視復帰では paused frame を再描画する', () => {
    let visibilityState: DocumentVisibilityState = 'visible';
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibilityState,
    });

    vi.spyOn(globalThis.performance, 'now').mockReturnValue(500);
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });

    const cancelPendingSeekPlaybackPrepare = vi.fn();
    const cancelPendingPausedSeekWait = vi.fn();
    const renderFrame = vi.fn();
    const renderPausedPreviewFrameAtTime = vi.fn();

    const previewPlatformPolicy = standardPreviewRuntime.getPreviewPlatformPolicy(
      getStandardPreviewPlatformCapabilities(createCapabilities()),
    );

    renderHook(() =>
      usePreviewVisibilityLifecycle({
        mediaElementsRef: createRef({}),
        mediaItemsRef: createRef([]),
        bgmRef: createRef(null),
        narrationsRef: createRef([]),
        activeVideoIdRef: createRef<string | null>(null),
        currentTimeRef: createRef(3),
        totalDurationRef: createRef(10),
        hiddenStartedAtRef: createRef(800),
        needsResyncAfterVisibilityRef: createRef(true),
        startTimeRef: createRef(0),
        audioResumeWaitFramesRef: createRef(0),
        lastVisibilityRefreshAtRef: createRef(0),
        isPlayingRef: createRef(false),
        isSeekingRef: createRef(false),
        audioCtxRef: createRef(null),
        isProcessing: false,
        previewPlatformPolicy,
        cancelPendingSeekPlaybackPrepare,
        cancelPendingPausedSeekWait,
        renderFrame,
        renderPausedPreviewFrameAtTimeRef: createRef(renderPausedPreviewFrameAtTime),
        pause: vi.fn(),
        logInfo: vi.fn(),
        logWarn: vi.fn(),
      }),
    );

    act(() => {
      visibilityState = 'visible';
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(cancelPendingSeekPlaybackPrepare).toHaveBeenCalledTimes(1);
    expect(cancelPendingPausedSeekWait).toHaveBeenCalledTimes(1);
    expect(renderPausedPreviewFrameAtTime).toHaveBeenCalledWith(3);
    expect(renderFrame).not.toHaveBeenCalled();
  });

  it('paused 状態の可視復帰で readyState>=1 の動画に対しては破壊的な load() を呼ばない', () => {
    // バックグラウンドから復帰したとき、readyState=1 (HAVE_METADATA) でも load() を
    // 呼ぶと readyState が 0 へ戻り currentTime もリセットされ、動画が固まる原因に
    // なる。本当にデータを失った readyState=0 のときだけ再ロードする方針を固定する。
    let visibilityState: DocumentVisibilityState = 'visible';
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibilityState,
    });

    vi.spyOn(globalThis.performance, 'now').mockReturnValue(500);
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });

    const loadMetadataReady = vi.fn();
    const loadEmpty = vi.fn();
    const loadAudio = vi.fn();
    const loadErrored = vi.fn();

    const metadataReadyVideo = {
      tagName: 'VIDEO',
      readyState: 1,
      error: null,
      load: loadMetadataReady,
    } as unknown as HTMLVideoElement;
    const emptyVideo = {
      tagName: 'VIDEO',
      readyState: 0,
      error: null,
      load: loadEmpty,
    } as unknown as HTMLVideoElement;
    const audioWithData = {
      tagName: 'AUDIO',
      readyState: 2,
      error: null,
      load: loadAudio,
    } as unknown as HTMLAudioElement;
    const erroredVideo = {
      tagName: 'VIDEO',
      readyState: 0,
      error: { code: 4 } as MediaError,
      load: loadErrored,
    } as unknown as HTMLVideoElement;

    const previewPlatformPolicy = standardPreviewRuntime.getPreviewPlatformPolicy(
      getStandardPreviewPlatformCapabilities(createCapabilities()),
    );

    renderHook(() =>
      usePreviewVisibilityLifecycle({
        mediaElementsRef: createRef({
          'video-metadata': metadataReadyVideo,
          'video-empty': emptyVideo,
          'bgm': audioWithData,
          'video-errored': erroredVideo,
        }),
        mediaItemsRef: createRef([]),
        bgmRef: createRef(null),
        narrationsRef: createRef([]),
        activeVideoIdRef: createRef<string | null>(null),
        currentTimeRef: createRef(3),
        totalDurationRef: createRef(10),
        hiddenStartedAtRef: createRef(800),
        needsResyncAfterVisibilityRef: createRef(true),
        startTimeRef: createRef(0),
        audioResumeWaitFramesRef: createRef(0),
        lastVisibilityRefreshAtRef: createRef(0),
        isPlayingRef: createRef(false),
        isSeekingRef: createRef(false),
        audioCtxRef: createRef(null),
        isProcessing: false,
        previewPlatformPolicy,
        cancelPendingSeekPlaybackPrepare: vi.fn(),
        cancelPendingPausedSeekWait: vi.fn(),
        renderFrame: vi.fn(),
        renderPausedPreviewFrameAtTimeRef: createRef(vi.fn()),
        pause: vi.fn(),
        logInfo: vi.fn(),
        logWarn: vi.fn(),
      }),
    );

    act(() => {
      visibilityState = 'visible';
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(loadMetadataReady).not.toHaveBeenCalled();
    expect(loadAudio).not.toHaveBeenCalled();
    expect(loadErrored).not.toHaveBeenCalled();
    expect(loadEmpty).toHaveBeenCalledTimes(1);
  });
});
