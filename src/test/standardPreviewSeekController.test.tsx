import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChangeEvent, MutableRefObject } from 'react';

import { usePreviewSeekController } from '../flavors/standard/preview/usePreviewSeekController';
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

describe('standard preview seek controller', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throttled seek change keeps the standard preview clock origin', () => {
    let now = 1_000;
    vi.spyOn(globalThis.performance, 'now').mockImplementation(() => now);
    let scheduledSeekFlush: (() => void) | null = null;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((callback: TimerHandler) => {
      scheduledSeekFlush = callback as () => void;
      return 1 as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout);

    const lastSeekTimeRef = createRef(now - 10);
    const pendingSeekRef = createRef<number | null>(null);
    const pendingSeekTimeoutRef = createRef<ReturnType<typeof setTimeout> | null>(null);
    const renderFrame = vi.fn();
    const setCurrentTime = vi.fn();

    const previewPlatformPolicy = standardPreviewRuntime.getPreviewPlatformPolicy(
      getStandardPreviewPlatformCapabilities(createCapabilities()),
    );

    const { result } = renderHook(() =>
      usePreviewSeekController({
        mediaItemsRef: createRef([]),
        mediaElementsRef: createRef({}),
        sourceNodesRef: createRef({}),
        gainNodesRef: createRef({}),
        audioCtxRef: createRef(null),
        totalDurationRef: createRef(10),
        currentTimeRef: createRef(0),
        activeVideoIdRef: createRef<string | null>(null),
        isPlayingRef: createRef(false),
        isSeekingRef: createRef(true),
        wasPlayingBeforeSeekRef: createRef(false),
        seekingVideosRef: createRef(new Set<string>()),
        startTimeRef: createRef(0),
        reqIdRef: createRef<number | null>(null),
        loopIdRef: createRef(0),
        playbackTimeoutRef: createRef<ReturnType<typeof setTimeout> | null>(null),
        lastSeekTimeRef,
        pendingSeekRef,
        pendingSeekTimeoutRef,
        seekSettleGenerationRef: createRef(0),
        previewPlaybackAttemptRef: createRef(0),
        pendingPausedSeekWaitRef: createRef<{ cleanup: () => void } | null>(null),
        handleSeekEndCallbackRef: createRef<(() => void) | null>(null),
        renderPausedPreviewFrameAtTimeRef: createRef(() => {}),
        cancelSeekPlaybackPrepareRef: createRef<(() => void) | null>(null),
        isSeekPlaybackPreparingRef: createRef(false),
        endFinalizedRef: createRef(false),
        previewPlatformPolicy,
        setCurrentTime,
        attachGlobalSeekEndListeners: vi.fn(),
        detachGlobalSeekEndListeners: vi.fn(),
        cancelPendingSeekPlaybackPrepare: vi.fn(),
        cancelPendingPausedSeekWait: vi.fn(),
        renderFrame,
        loop: vi.fn(),
        resetInactiveVideos: vi.fn(),
        preparePreviewAudioNodesForTime: vi.fn(() => ({
          activeVideoId: null,
          audibleSourceCount: 0,
          requiresWebAudio: false,
        })),
        primePreviewAudioOnlyTracksAtTime: vi.fn(),
      }),
    );

    act(() => {
      result.current.handleSeekChange({
        target: { value: '2.5' },
      } as ChangeEvent<HTMLInputElement>);
    });

    expect(pendingSeekRef.current).toBe(2.5);
    expect(renderFrame).toHaveBeenCalledWith(2.5, false);
    expect(scheduledSeekFlush).not.toBeNull();

    now = 1_040;
    act(() => {
      scheduledSeekFlush?.();
    });

    expect(pendingSeekRef.current).toBeNull();
    expect(pendingSeekTimeoutRef.current).toBeNull();
    expect(lastSeekTimeRef.current).toBe(1_040);
    expect(lastSeekTimeRef.current).toBeLessThan(10_000);
    expect(renderFrame).toHaveBeenNthCalledWith(2, 2.5, false);
    expect(setCurrentTime).toHaveBeenCalledWith(2.5);
  });
});
