import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MutableRefObject } from 'react';

import * as playbackClock from '../flavors/standard/preview/playbackClock';
import { usePreviewEngine } from '../flavors/standard/preview/usePreviewEngine';
import {
  getStandardPreviewPlatformCapabilities,
  standardPreviewRuntime,
} from '../flavors/standard/standardPreviewRuntime';
import type {
  AudioTrack,
  Caption,
  CaptionSettings,
  MediaElementsRef,
  MediaItem,
  NarrationClip,
} from '../types';
import type { PlatformCapabilities } from '../utils/platform';

const TEST_PREVIEW_START_SETTLE_MS = 60;

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
    trimStart: overrides.trimStart ?? 1,
    trimEnd: overrides.trimEnd ?? 7,
    scale: overrides.scale ?? 1,
    positionX: overrides.positionX ?? 0,
    positionY: overrides.positionY ?? 0,
    isTransformOpen: overrides.isTransformOpen ?? false,
    isLocked: overrides.isLocked ?? false,
    ...overrides,
  };
}

function createImageItem(overrides: Partial<MediaItem> = {}): MediaItem {
  return {
    id: overrides.id ?? 'image-1',
    file: overrides.file ?? new File([''], 'frame.png', { type: 'image/png' }),
    type: 'image',
    url: overrides.url ?? 'blob:image-1',
    volume: overrides.volume ?? 1,
    isMuted: overrides.isMuted ?? false,
    fadeIn: overrides.fadeIn ?? false,
    fadeOut: overrides.fadeOut ?? false,
    fadeInDuration: overrides.fadeInDuration ?? 1,
    fadeOutDuration: overrides.fadeOutDuration ?? 1,
    duration: overrides.duration ?? 1,
    originalDuration: overrides.originalDuration ?? (overrides.duration ?? 1),
    trimStart: overrides.trimStart ?? 0,
    trimEnd: overrides.trimEnd ?? (overrides.duration ?? 1),
    scale: overrides.scale ?? 1,
    positionX: overrides.positionX ?? 0,
    positionY: overrides.positionY ?? 0,
    isTransformOpen: overrides.isTransformOpen ?? false,
    isLocked: overrides.isLocked ?? false,
    ...overrides,
  };
}

function createMockMediaElement(tagName: 'VIDEO' | 'AUDIO') {
  const listeners = new Map<string, Set<EventListener>>();

  const element = {
    tagName,
    readyState: tagName === 'VIDEO' ? 1 : 4,
    seeking: tagName === 'VIDEO',
    paused: true,
    currentTime: 0,
    duration: 12,
    ended: false,
    error: null,
    videoWidth: tagName === 'VIDEO' ? 1280 : 0,
    videoHeight: tagName === 'VIDEO' ? 720 : 0,
    defaultMuted: false,
    muted: false,
    preload: 'metadata',
    playsInline: false,
    volume: 1,
    play: vi.fn().mockImplementation(() => {
      element.paused = false;
      return Promise.resolve();
    }),
    pause: vi.fn().mockImplementation(() => {
      element.paused = true;
    }),
    load: vi.fn(),
    addEventListener: vi.fn((type: string, listener: EventListener) => {
      if (!listeners.has(type)) {
        listeners.set(type, new Set());
      }
      listeners.get(type)?.add(listener);
    }),
    removeEventListener: vi.fn((type: string, listener: EventListener) => {
      listeners.get(type)?.delete(listener);
    }),
    dispatch(type: string) {
      const event = new Event(type);
      for (const listener of listeners.get(type) ?? []) {
        listener(event);
      }
    },
  };

  return element;
}

function createMockVideoElement() {
  return createMockMediaElement('VIDEO');
}

function createMockAudioElement() {
  return createMockMediaElement('AUDIO');
}

function createMockCanvasContext(canvasSize: { width: number; height: number } = { width: 1920, height: 1080 }) {
  return {
    canvas: { width: canvasSize.width, height: canvasSize.height },
    fillRect: vi.fn(),
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    globalAlpha: 1,
    fillStyle: '#000000',
  } as unknown as CanvasRenderingContext2D;
}

describe('standard preview engine', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    try {
      globalThis.localStorage?.removeItem('preview.log.mode');
    } catch {
      // ignore
    }
  });

  afterEach(() => {
    try {
      globalThis.localStorage?.removeItem('preview.log.mode');
    } catch {
      // ignore
    }
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function setupPreviewEngineHarness(options?: {
    bgm?: AudioTrack | null;
    narrations?: NarrationClip[];
    mediaItems?: MediaItem[];
    mediaElements?: MediaElementsRef;
    gainNodes?: Record<string, GainNode>;
    audioContext?: AudioContext | null;
    primePreviewAudioOnlyTracksAtTime?: ReturnType<typeof vi.fn<(playbackTime: number) => void>>;
    canvas?: HTMLCanvasElement | null;
    currentTime?: number;
    totalDuration?: number;
    startTime?: number;
    reqId?: number | null;
    loopId?: number;
    isPlaying?: boolean;
  }) {
    const mediaItems = options?.mediaItems ?? [createVideoItem()];
    const mediaItem = mediaItems[0];
    const videoElement = createMockVideoElement();
    const mediaElements = options?.mediaElements ?? ({
      [mediaItem.id]: videoElement as unknown as HTMLVideoElement,
    } as MediaElementsRef);
    const requestAnimationFrameSpy = vi
      .spyOn(globalThis, 'requestAnimationFrame')
      .mockImplementation(() => 1);

    const previewPlatformPolicy = standardPreviewRuntime.getPreviewPlatformPolicy(
      getStandardPreviewPlatformCapabilities(createCapabilities()),
    );

    const setCurrentTime = vi.fn();
    const play = vi.fn();
    const pause = vi.fn();
    const resetInactiveVideos = vi.fn();
    const clearExport = vi.fn();
    const primePreviewAudioOnlyTracksAtTimeSpy =
      options?.primePreviewAudioOnlyTracksAtTime ?? vi.fn<(playbackTime: number) => void>();
    const totalDurationRef = createRef(
      options?.totalDuration ?? mediaItems.reduce((sum, item) => sum + item.duration, 0),
    );
    const currentTimeRef = createRef(options?.currentTime ?? 0);
    const reqIdRef = createRef<number | null>(options?.reqId ?? null);
    const startTimeRef = createRef(options?.startTime ?? 0);
    const loopIdRef = createRef(options?.loopId ?? 0);
    const isPlayingRef = createRef(options?.isPlaying ?? false);

    const hook = renderHook(() =>
      usePreviewEngine({
        captions: [] as Caption[],
        captionSettings: {} as CaptionSettings,
        mediaItemsRef: createRef(mediaItems),
        bgmRef: createRef<AudioTrack | null>(options?.bgm ?? null),
        narrationsRef: createRef<NarrationClip[]>(options?.narrations ?? []),
        captionsRef: createRef<Caption[]>([]),
        captionSettingsRef: createRef({} as CaptionSettings),
        totalDurationRef,
        currentTimeRef,
        canvasRef: createRef<HTMLCanvasElement | null>(options?.canvas ?? null),
        mediaElementsRef: createRef(mediaElements),
        audioCtxRef: createRef(options?.audioContext ?? ({
          state: 'running',
          currentTime: 0,
          destination: {},
          onstatechange: null,
          resume: vi.fn().mockResolvedValue(undefined),
          suspend: vi.fn().mockResolvedValue(undefined),
        } as unknown as AudioContext)),
        sourceNodesRef: createRef({}),
        gainNodesRef: createRef(options?.gainNodes ?? {}),
        masterDestRef: createRef(null),
        audioRoutingModeRef: createRef<'preview' | 'export'>('preview'),
        reqIdRef,
        startTimeRef,
        audioResumeWaitFramesRef: createRef(0),
        recorderRef: createRef<MediaRecorder | null>(null),
        loopIdRef,
        isPlayingRef,
        isSeekingRef: createRef(false),
        isSeekPlaybackPreparingRef: createRef(false),
        activeVideoIdRef: createRef<string | null>(null),
        videoRecoveryAttemptsRef: createRef({}),
        exportPlayFailedRef: createRef({}),
        exportFallbackSeekAtRef: createRef({}),
        seekingVideosRef: createRef(new Set<string>()),
        pendingSeekRef: createRef<number | null>(null),
        wasPlayingBeforeSeekRef: createRef(false),
        pendingSeekTimeoutRef: createRef<ReturnType<typeof setTimeout> | null>(null),
        previewPlaybackAttemptRef: createRef(0),
        requestPreviewAudioRouteRefreshRef: createRef(() => {}),
        primePreviewAudioOnlyTracksAtTimeRef: createRef(() => {}),
        endFinalizedRef: createRef(false),
        previewPlatformPolicy,
        platformCapabilities: { isAndroid: true, isIosSafari: false },
        setVideoDuration: vi.fn(),
        setCurrentTime,
        setProcessing: vi.fn(),
        setPreviewPlaying: vi.fn(),
        setLoading: vi.fn(),
        setExportPreparationStep: vi.fn(),
        setExportUrl: vi.fn(),
        setExportExt: vi.fn(),
        clearExport,
        setError: vi.fn(),
        play,
        pause,
        getAudioContext: () =>
          ({
            state: 'running',
            currentTime: 0,
            destination: {},
            onstatechange: null,
            resume: vi.fn().mockResolvedValue(undefined),
            suspend: vi.fn().mockResolvedValue(undefined),
          }) as unknown as AudioContext,
        cancelPendingPausedSeekWait: vi.fn(),
        cancelPendingSeekPlaybackPrepare: vi.fn(),
        detachGlobalSeekEndListeners: vi.fn(),
        ensureAudioNodeForElement: vi.fn(() => false),
        detachAudioNode: vi.fn(),
        preparePreviewAudioNodesForTime: vi.fn(() => ({
          activeVideoId: mediaItem.id,
          audibleSourceCount: 1,
          requiresWebAudio: false,
        })),
        preparePreviewAudioNodesForUpcomingVideos: vi.fn(),
        primePreviewAudioOnlyTracksAtTime: primePreviewAudioOnlyTracksAtTimeSpy,
        resetInactiveVideos,
        startWebCodecsExport: vi.fn(),
        stopWebCodecsExport: vi.fn(),
        completeWebCodecsExport: vi.fn(),
        logInfo: vi.fn(),
        logWarn: vi.fn(),
        logDebug: vi.fn(),
      }),
    );

    return {
      mediaItem,
      videoElement,
      requestAnimationFrameSpy,
      setCurrentTime,
      play,
      pause,
      clearExport,
      currentTimeRef,
      reqIdRef,
      loopIdRef,
      totalDurationRef,
      resetInactiveVideos,
      primePreviewAudioOnlyTracksAtTime: primePreviewAudioOnlyTracksAtTimeSpy,
      hook,
    };
  }

  function setupRenderFrameHarness(options?: {
    bgm?: AudioTrack | null;
    narrations?: NarrationClip[];
    mediaItems?: MediaItem[];
    mediaElements?: MediaElementsRef;
    gainNodes?: Record<string, GainNode>;
    audioContext?: AudioContext | null;
    currentTime?: number;
    totalDuration?: number;
    platformCapabilities?: Partial<PlatformCapabilities>;
  }) {
    const mediaItems = options?.mediaItems ?? [createVideoItem()];
    const mediaElements = options?.mediaElements ?? {};
    const canvasContext = createMockCanvasContext();
    const logInfo = vi.fn();
    const logWarn = vi.fn();
    const platformCapabilities = getStandardPreviewPlatformCapabilities(
      createCapabilities(options?.platformCapabilities),
    );
    const previewPlatformPolicy = standardPreviewRuntime.getPreviewPlatformPolicy(
      platformCapabilities,
    );

    const hook = renderHook(() =>
      usePreviewEngine({
        captions: [] as Caption[],
        captionSettings: {} as CaptionSettings,
        mediaItemsRef: createRef(mediaItems),
        bgmRef: createRef<AudioTrack | null>(options?.bgm ?? null),
        narrationsRef: createRef<NarrationClip[]>(options?.narrations ?? []),
        captionsRef: createRef<Caption[]>([]),
        captionSettingsRef: createRef({} as CaptionSettings),
        totalDurationRef: createRef(
          options?.totalDuration ?? mediaItems.reduce((sum, item) => sum + item.duration, 0),
        ),
        currentTimeRef: createRef(options?.currentTime ?? 0),
        canvasRef: createRef({
          getContext: vi.fn(() => canvasContext),
        } as unknown as HTMLCanvasElement),
        mediaElementsRef: createRef(mediaElements),
        audioCtxRef: createRef(options?.audioContext ?? null),
        sourceNodesRef: createRef({}),
        gainNodesRef: createRef(options?.gainNodes ?? {}),
        masterDestRef: createRef(null),
        audioRoutingModeRef: createRef<'preview' | 'export'>('preview'),
        reqIdRef: createRef<number | null>(null),
        startTimeRef: createRef(0),
        audioResumeWaitFramesRef: createRef(0),
        recorderRef: createRef<MediaRecorder | null>(null),
        loopIdRef: createRef(1),
        isPlayingRef: createRef(true),
        isSeekingRef: createRef(false),
        isSeekPlaybackPreparingRef: createRef(false),
        activeVideoIdRef: createRef<string | null>(null),
        videoRecoveryAttemptsRef: createRef({}),
        exportPlayFailedRef: createRef({}),
        exportFallbackSeekAtRef: createRef({}),
        seekingVideosRef: createRef(new Set<string>()),
        pendingSeekRef: createRef<number | null>(null),
        wasPlayingBeforeSeekRef: createRef(false),
        pendingSeekTimeoutRef: createRef<ReturnType<typeof setTimeout> | null>(null),
        previewPlaybackAttemptRef: createRef(0),
        requestPreviewAudioRouteRefreshRef: createRef(() => {}),
        primePreviewAudioOnlyTracksAtTimeRef: createRef(() => {}),
        endFinalizedRef: createRef(false),
        previewPlatformPolicy,
        platformCapabilities,
        setVideoDuration: vi.fn(),
        setCurrentTime: vi.fn(),
        setProcessing: vi.fn(),
        setPreviewPlaying: vi.fn(),
        setLoading: vi.fn(),
        setExportPreparationStep: vi.fn(),
        setExportUrl: vi.fn(),
        setExportExt: vi.fn(),
        clearExport: vi.fn(),
        setError: vi.fn(),
        play: vi.fn(),
        pause: vi.fn(),
        getAudioContext: vi.fn(),
        cancelPendingPausedSeekWait: vi.fn(),
        cancelPendingSeekPlaybackPrepare: vi.fn(),
        detachGlobalSeekEndListeners: vi.fn(),
        ensureAudioNodeForElement: vi.fn(() => false),
        detachAudioNode: vi.fn(),
        preparePreviewAudioNodesForTime: vi.fn(() => ({
          activeVideoId: null,
          audibleSourceCount: 0,
          requiresWebAudio: false,
        })),
        preparePreviewAudioNodesForUpcomingVideos: vi.fn(),
        primePreviewAudioOnlyTracksAtTime: vi.fn(),
        resetInactiveVideos: vi.fn(),
        startWebCodecsExport: vi.fn(),
        stopWebCodecsExport: vi.fn(),
        completeWebCodecsExport: vi.fn(),
        logInfo,
        logWarn,
        logDebug: vi.fn(),
      }),
    );

    return { canvasContext, hook, logInfo, logWarn };
  }

  it('paused seek 後は active video 準備完了を待ってから再生を始める', async () => {
    const { videoElement, requestAnimationFrameSpy, setCurrentTime, play, hook } =
      setupPreviewEngineHarness();

    const startPromise = hook.result.current.startEngine(2, false);
    await Promise.resolve();

    expect(videoElement.play).not.toHaveBeenCalled();
    expect(requestAnimationFrameSpy).not.toHaveBeenCalled();

    videoElement.seeking = false;
    videoElement.readyState = 2;
    videoElement.dispatch('seeked');

    await vi.advanceTimersByTimeAsync(TEST_PREVIEW_START_SETTLE_MS);
    await startPromise;

    expect(videoElement.play).toHaveBeenCalledTimes(1);
    expect(requestAnimationFrameSpy).toHaveBeenCalledTimes(1);
    expect(setCurrentTime).toHaveBeenCalledWith(2);
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('preview 再生開始では exportUrl を clear しない', async () => {
    const { clearExport, hook } = setupPreviewEngineHarness();

    void hook.result.current.startEngine(1, false);
    await Promise.resolve();

    expect(clearExport).not.toHaveBeenCalled();
  });

  it('stop 後の先頭再生でも active video 準備完了を待ってから再生を始める', async () => {
    const { mediaItem, videoElement, requestAnimationFrameSpy, setCurrentTime, play, hook } =
      setupPreviewEngineHarness();

    const startPromise = hook.result.current.startEngine(0, false);
    await Promise.resolve();

    expect(videoElement.currentTime).toBe(mediaItem.trimStart);
    expect(videoElement.play).not.toHaveBeenCalled();
    expect(requestAnimationFrameSpy).not.toHaveBeenCalled();

    videoElement.seeking = false;
    videoElement.readyState = 2;
    videoElement.dispatch('seeked');

    await vi.advanceTimersByTimeAsync(TEST_PREVIEW_START_SETTLE_MS);
    await startPromise;

    expect(videoElement.play).toHaveBeenCalledTimes(1);
    expect(requestAnimationFrameSpy).toHaveBeenCalledTimes(1);
    expect(setCurrentTime).toHaveBeenCalledWith(0);
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('standard preview 開始直後の同期描画は active video を再 pause しない', async () => {
    const canvasContext = createMockCanvasContext();
    const canvas = {
      getContext: vi.fn(() => canvasContext),
    } as unknown as HTMLCanvasElement;
    const { videoElement, hook } = setupPreviewEngineHarness({ canvas });

    videoElement.seeking = false;
    videoElement.readyState = 2;

    const startPromise = hook.result.current.startEngine(0, false);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(TEST_PREVIEW_START_SETTLE_MS);
    await startPromise;

    expect(videoElement.play).toHaveBeenCalledTimes(1);
    const playOrder = videoElement.play.mock.invocationCallOrder[0];
    const pauseCallsAfterPlay = videoElement.pause.mock.invocationCallOrder.filter(
      (callOrder) => callOrder > playOrder,
    );
    expect(pauseCallsAfterPlay).toHaveLength(0);
  });

  it('Android preview startEngine は BGM があっても active video 開始後に audio-only prime を試す', async () => {
    const bgm: AudioTrack = {
      file: new File([''], 'bgm.mp3', { type: 'audio/mpeg' }),
      url: 'blob:bgm',
      volume: 1,
      delay: 0,
      startPoint: 0,
      duration: 10,
      fadeIn: false,
      fadeOut: false,
      fadeInDuration: 1,
      fadeOutDuration: 1,
      isAi: false,
    };
    const { videoElement, requestAnimationFrameSpy, primePreviewAudioOnlyTracksAtTime, hook } =
      setupPreviewEngineHarness({ bgm });

    const startPromise = hook.result.current.startEngine(0, false);
    await Promise.resolve();

    videoElement.seeking = false;
    videoElement.readyState = 2;
    videoElement.dispatch('seeked');

    await vi.advanceTimersByTimeAsync(TEST_PREVIEW_START_SETTLE_MS);
    await startPromise;

    expect(videoElement.play).toHaveBeenCalledTimes(1);
    expect(primePreviewAudioOnlyTracksAtTime).toHaveBeenCalledWith(0);
    expect(requestAnimationFrameSpy).toHaveBeenCalledTimes(1);
  });

  it('preview loop は totalDuration 手前で終端停止し BGM と narration も同時停止する', () => {
    const mediaItem = createVideoItem({ id: 'video-1', duration: 6, trimStart: 0, trimEnd: 6 });
    const canvasContext = createMockCanvasContext();
    const bgmElement = createMockAudioElement();
    bgmElement.paused = false;
    const narrationElement = createMockAudioElement();
    narrationElement.paused = false;
    const videoElement = createMockVideoElement();
    videoElement.readyState = 2;
    videoElement.seeking = false;
    videoElement.paused = false;
    videoElement.currentTime = 5.95;
    const canvas = {
      getContext: vi.fn(() => canvasContext),
    } as unknown as HTMLCanvasElement;

    const cancelAnimationFrameSpy = vi
      .spyOn(globalThis, 'cancelAnimationFrame')
      .mockImplementation(() => {});
    vi.spyOn(playbackClock, 'getStandardPreviewNow').mockReturnValue(5980);

    const bgmGain = {
      gain: {
        value: 1,
        setTargetAtTime: vi.fn(),
        setValueAtTime: vi.fn(),
        cancelScheduledValues: vi.fn(),
      },
    } as unknown as GainNode;

    const { hook, pause, currentTimeRef, reqIdRef, loopIdRef, setCurrentTime, requestAnimationFrameSpy } =
      setupPreviewEngineHarness({
        mediaItems: [mediaItem],
        bgm: {
          file: new File([''], 'bgm.mp3', { type: 'audio/mpeg' }),
          url: 'blob:bgm',
          volume: 1,
          delay: 0,
          startPoint: 0,
          duration: 6,
          fadeIn: false,
          fadeOut: true,
          fadeInDuration: 1,
          fadeOutDuration: 1,
          isAi: false,
        },
        mediaElements: {
          [mediaItem.id]: videoElement as unknown as HTMLVideoElement,
          bgm: bgmElement as unknown as HTMLAudioElement,
          'narration:test': narrationElement as unknown as HTMLAudioElement,
        } as MediaElementsRef,
        gainNodes: { bgm: bgmGain },
        audioContext: {
          state: 'running',
          currentTime: 12,
          destination: {},
          onstatechange: null,
          resume: vi.fn().mockResolvedValue(undefined),
          suspend: vi.fn().mockResolvedValue(undefined),
        } as unknown as AudioContext,
        canvas,
        currentTime: 5.95,
        totalDuration: 6,
        startTime: 0,
        reqId: 91,
        loopId: 1,
        isPlaying: true,
      });

    hook.result.current.loop(false, 1);

    expect(setCurrentTime).toHaveBeenCalledWith(6);
    expect(currentTimeRef.current).toBe(6);
    expect(canvas.getContext).toHaveBeenCalledWith('2d');
    expect(videoElement.currentTime).toBeCloseTo(5.95, 3);
    expect(videoElement.pause).toHaveBeenCalled();
    expect(bgmElement.pause).toHaveBeenCalled();
    expect(narrationElement.pause).toHaveBeenCalled();
    expect(videoElement.volume).toBe(1);
    expect(bgmElement.volume).toBe(0);
    expect(narrationElement.volume).toBe(1);
    expect(bgmGain.gain.setValueAtTime).toHaveBeenCalledWith(0, 12);
    expect(pause).toHaveBeenCalledTimes(1);
    expect(cancelAnimationFrameSpy).toHaveBeenCalledWith(91);
    expect(reqIdRef.current).toBeNull();
    expect(loopIdRef.current).toBe(2);
    expect(requestAnimationFrameSpy).not.toHaveBeenCalled();
  });

  it('preview loop は終端閾値より手前では次の requestAnimationFrame を継続する', () => {
    const mediaItem = createVideoItem({ id: 'video-1', duration: 6, trimStart: 0, trimEnd: 6 });
    const bgmElement = createMockAudioElement();
    bgmElement.paused = false;
    const narrationElement = createMockAudioElement();
    narrationElement.paused = false;
    const videoElement = createMockVideoElement();
    videoElement.readyState = 2;
    videoElement.seeking = false;
    videoElement.paused = false;

    const cancelAnimationFrameSpy = vi
      .spyOn(globalThis, 'cancelAnimationFrame')
      .mockImplementation(() => {});
    vi.spyOn(playbackClock, 'getStandardPreviewNow').mockReturnValue(5960);

    const { hook, pause, currentTimeRef, reqIdRef, loopIdRef, setCurrentTime, requestAnimationFrameSpy } =
      setupPreviewEngineHarness({
        mediaItems: [mediaItem],
        mediaElements: {
          [mediaItem.id]: videoElement as unknown as HTMLVideoElement,
          bgm: bgmElement as unknown as HTMLAudioElement,
          'narration:test': narrationElement as unknown as HTMLAudioElement,
        } as MediaElementsRef,
        currentTime: 5.95,
        totalDuration: 6,
        startTime: 0,
        reqId: 91,
        loopId: 1,
        isPlaying: true,
      });

    hook.result.current.loop(false, 1);

    expect(setCurrentTime).toHaveBeenCalledWith(5.96);
    expect(currentTimeRef.current).toBe(5.96);
    expect(videoElement.pause).not.toHaveBeenCalled();
    expect(bgmElement.pause).not.toHaveBeenCalled();
    expect(narrationElement.pause).not.toHaveBeenCalled();
    expect(pause).not.toHaveBeenCalled();
    expect(cancelAnimationFrameSpy).not.toHaveBeenCalled();
    expect(reqIdRef.current).toBe(1);
    expect(loopIdRef.current).toBe(1);
    expect(requestAnimationFrameSpy).toHaveBeenCalledTimes(1);
  });

  it('renderFrame は standard preview 中の BGM fadeIn / fadeOut volume を毎フレーム反映する', () => {
    const mediaItem = createVideoItem({ id: 'video-1', duration: 10, trimStart: 0, trimEnd: 10 });
    const videoElement = createMockVideoElement();
    videoElement.readyState = 2;
    videoElement.seeking = false;
    const bgmElement = createMockAudioElement();
    const bgmGain = {
      gain: {
        value: 1,
        setTargetAtTime: vi.fn(),
        setValueAtTime: vi.fn(),
        cancelScheduledValues: vi.fn(),
      },
    } as unknown as GainNode;
    const audioContext = {
      state: 'running',
      currentTime: 7,
      destination: {},
      onstatechange: null,
      resume: vi.fn().mockResolvedValue(undefined),
      suspend: vi.fn().mockResolvedValue(undefined),
    } as unknown as AudioContext;
    const bgm: AudioTrack = {
      file: new File([''], 'bgm.mp3', { type: 'audio/mpeg' }),
      url: 'blob:bgm',
      volume: 0.8,
      delay: 1,
      startPoint: 0,
      duration: 10,
      fadeIn: true,
      fadeOut: true,
      fadeInDuration: 2,
      fadeOutDuration: 2,
      isAi: false,
    };

    const { hook } = setupRenderFrameHarness({
      bgm,
      mediaItems: [mediaItem],
      mediaElements: {
        [mediaItem.id]: videoElement as unknown as HTMLVideoElement,
        bgm: bgmElement as unknown as HTMLAudioElement,
      } as MediaElementsRef,
      gainNodes: { bgm: bgmGain },
      audioContext,
      totalDuration: 10,
    });

    hook.result.current.renderFrame(2, true, false);
    expect(bgmElement.volume).toBeLessThanOrEqual(1);
    expect(bgmGain.gain.setValueAtTime).toHaveBeenLastCalledWith(0.4, 7);

    hook.result.current.renderFrame(9, true, false);
    expect(bgmElement.volume).toBeLessThanOrEqual(1);
    expect(bgmGain.gain.setValueAtTime).toHaveBeenLastCalledWith(0.4, 7);

    hook.result.current.renderFrame(10, true, false);
    expect(bgmElement.volume).toBeLessThanOrEqual(1);
    expect(bgmGain.gain.setValueAtTime).toHaveBeenLastCalledWith(0.4, 7);
  });

  it('renderFrame は BGM 100%超を WebAudio gain で維持しつつ native volume は 1 に抑える', () => {
    const mediaItem = createVideoItem({ id: 'video-1', duration: 10, trimStart: 0, trimEnd: 10 });
    const videoElement = createMockVideoElement();
    videoElement.readyState = 2;
    videoElement.seeking = false;
    const bgmElement = createMockAudioElement();
    const bgmGain = {
      gain: {
        value: 1,
        setTargetAtTime: vi.fn(),
        setValueAtTime: vi.fn(),
        cancelScheduledValues: vi.fn(),
      },
    } as unknown as GainNode;
    const audioContext = {
      state: 'running',
      currentTime: 7,
      destination: {},
      onstatechange: null,
      resume: vi.fn().mockResolvedValue(undefined),
      suspend: vi.fn().mockResolvedValue(undefined),
    } as unknown as AudioContext;
    const bgm: AudioTrack = {
      file: new File([''], 'bgm.mp3', { type: 'audio/mpeg' }),
      url: 'blob:bgm',
      volume: 2.5,
      delay: 0,
      startPoint: 0,
      duration: 10,
      fadeIn: false,
      fadeOut: false,
      fadeInDuration: 0,
      fadeOutDuration: 0,
      isAi: false,
    };

    const { hook } = setupRenderFrameHarness({
      bgm,
      mediaItems: [mediaItem],
      mediaElements: {
        [mediaItem.id]: videoElement as unknown as HTMLVideoElement,
        bgm: bgmElement as unknown as HTMLAudioElement,
      } as MediaElementsRef,
      gainNodes: { bgm: bgmGain },
      audioContext,
      totalDuration: 10,
    });

    hook.result.current.renderFrame(5, true, false);

    expect(bgmElement.volume).toBeLessThanOrEqual(1);
    expect(bgmGain.gain.setValueAtTime).toHaveBeenLastCalledWith(2.5, 7);
  });

  it('renderFrame は narration 100%超を WebAudio gain で維持しつつ native volume は 1 に抑える', () => {
    const mediaItem = createVideoItem({ id: 'video-1', duration: 10, trimStart: 0, trimEnd: 10 });
    const videoElement = createMockVideoElement();
    videoElement.readyState = 2;
    videoElement.seeking = false;
    const narrationElement = createMockAudioElement();
    const narrationGain = {
      gain: {
        value: 1,
        setTargetAtTime: vi.fn(),
        setValueAtTime: vi.fn(),
        cancelScheduledValues: vi.fn(),
      },
    } as unknown as GainNode;
    const audioContext = {
      state: 'running',
      currentTime: 7,
      destination: {},
      onstatechange: null,
      resume: vi.fn().mockResolvedValue(undefined),
      suspend: vi.fn().mockResolvedValue(undefined),
    } as unknown as AudioContext;
    const narration: NarrationClip = {
      id: 'nar-1',
      sourceType: 'file',
      file: new File([''], 'narration.mp3', { type: 'audio/mpeg' }),
      url: 'blob:narration',
      startTime: 0,
      volume: 2.5,
      isMuted: false,
      trimStart: 0,
      trimEnd: 10,
      duration: 10,
      isAiEditable: false,
    };

    const { hook } = setupRenderFrameHarness({
      narrations: [narration],
      mediaItems: [mediaItem],
      mediaElements: {
        [mediaItem.id]: videoElement as unknown as HTMLVideoElement,
        'narration:nar-1': narrationElement as unknown as HTMLAudioElement,
      } as MediaElementsRef,
      gainNodes: { 'narration:nar-1': narrationGain },
      audioContext,
      totalDuration: 10,
    });

    hook.result.current.renderFrame(5, true, false);

    expect(narrationElement.volume).toBe(1);
    expect(narrationGain.gain.setTargetAtTime).toHaveBeenLastCalledWith(2.5, 7, 0.1);
  });

  it('Android preview は trimStart あり video の先頭で readyState < 2 の video を描画しない', () => {
    const imageItem = createImageItem({ id: 'image-gap', duration: 1 });
    const videoItem = createVideoItem({
      id: 'video-2',
      duration: 2,
      trimStart: 1.2,
      trimEnd: 3.2,
    });
    const videoElement = createMockVideoElement();
    videoElement.readyState = 1;
    videoElement.seeking = false;
    videoElement.paused = false;
    videoElement.currentTime = 1.36;

    const { canvasContext, hook } = setupRenderFrameHarness({
      mediaItems: [imageItem, videoItem],
      mediaElements: {
        [videoItem.id]: videoElement as unknown as HTMLVideoElement,
      } as MediaElementsRef,
    });

    const timelineTime = 1.1;
    const didUpdateCanvas = hook.result.current.renderFrame(timelineTime, true, false);

    expect(videoElement.currentTime).toBeCloseTo(1.36);
    expect(canvasContext.fillRect).not.toHaveBeenCalled();
    expect(canvasContext.drawImage).not.toHaveBeenCalled();
    expect(didUpdateCanvas).toBe(false);
  });

  it('Android preview は video -> trimmed video の境界で active video を hard seek しない', () => {
    const leadVideo = createVideoItem({
      id: 'video-1',
      duration: 1,
      trimStart: 0,
      trimEnd: 1,
    });
    const trimmedVideo = createVideoItem({
      id: 'video-2',
      duration: 2,
      trimStart: 1.2,
      trimEnd: 3.2,
    });
    const leadVideoElement = createMockVideoElement();
    leadVideoElement.readyState = 2;
    leadVideoElement.seeking = false;
    leadVideoElement.paused = false;
    const trimmedVideoElement = createMockVideoElement();
    trimmedVideoElement.readyState = 1;
    trimmedVideoElement.seeking = false;
    trimmedVideoElement.paused = false;
    trimmedVideoElement.currentTime = 1.55;

    const { canvasContext, hook } = setupRenderFrameHarness({
      mediaItems: [leadVideo, trimmedVideo],
      mediaElements: {
        [leadVideo.id]: leadVideoElement as unknown as HTMLVideoElement,
        [trimmedVideo.id]: trimmedVideoElement as unknown as HTMLVideoElement,
      } as MediaElementsRef,
    });

    const timelineTime = 1.2;
    const didUpdateCanvas = hook.result.current.renderFrame(timelineTime, true, false);

    // passive 方式では境界直後でも targetTime へ書き戻さず、media clock の currentTime をそのまま尊重する。
    expect(trimmedVideoElement.currentTime).toBeCloseTo(1.55);
    expect(canvasContext.fillRect).not.toHaveBeenCalled();
    expect(canvasContext.drawImage).not.toHaveBeenCalled();
    expect(didUpdateCanvas).toBe(false);
  });

  it('Android preview は video 境界で passive switch のまま描画可能な active video を表示する', () => {
    const leadVideo = createVideoItem({
      id: 'video-1',
      duration: 1,
      trimStart: 0,
      trimEnd: 1,
    });
    const nextVideo = createVideoItem({
      id: 'video-2',
      duration: 2,
      trimStart: 1.2,
      trimEnd: 3.2,
    });
    const leadVideoElement = createMockVideoElement();
    leadVideoElement.readyState = 2;
    leadVideoElement.seeking = false;
    leadVideoElement.paused = false;
    const nextVideoElement = createMockVideoElement();
    nextVideoElement.readyState = 2;
    nextVideoElement.seeking = false;
    nextVideoElement.paused = false;
    nextVideoElement.currentTime = 1.25;

    const { canvasContext, hook } = setupRenderFrameHarness({
      mediaItems: [leadVideo, nextVideo],
      mediaElements: {
        [leadVideo.id]: leadVideoElement as unknown as HTMLVideoElement,
        [nextVideo.id]: nextVideoElement as unknown as HTMLVideoElement,
      } as MediaElementsRef,
    });

    const didUpdateCanvas = hook.result.current.renderFrame(1.05, true, false);

    expect(canvasContext.drawImage).toHaveBeenCalled();
    expect(nextVideoElement.currentTime).toBeCloseTo(1.25);
    expect(didUpdateCanvas).toBe(true);
  });

  it('preview 終端では最終フレームへ強制 seek せず現在の drawable frame を固定する', () => {
    const videoItem = createVideoItem({
      id: 'video-end',
      duration: 1,
      originalDuration: 1,
      trimStart: 0,
      trimEnd: 1,
    });
    const videoElement = createMockVideoElement();
    videoElement.readyState = 2;
    videoElement.seeking = false;
    videoElement.paused = false;
    videoElement.currentTime = 0.92;
    videoElement.duration = 1;

    const { canvasContext, hook } = setupRenderFrameHarness({
      mediaItems: [videoItem],
      mediaElements: {
        [videoItem.id]: videoElement as unknown as HTMLVideoElement,
      } as MediaElementsRef,
      totalDuration: 1,
      platformCapabilities: { isAndroid: false },
    });

    const didUpdateCanvas = hook.result.current.renderFrame(0.99, true, false);

    expect(videoElement.currentTime).toBeCloseTo(0.92);
    expect(videoElement.pause).toHaveBeenCalledTimes(1);
    expect(canvasContext.drawImage).toHaveBeenCalledWith(
      videoElement,
      0,
      0,
      expect.any(Number),
      expect.any(Number),
    );
    expect(didUpdateCanvas).toBe(true);
  });

  it('Android preview は drawable な paused 境界 active video で黒フラッシュせず draw 後に play を要求する', () => {
    const leadVideo = createVideoItem({
      id: 'video-1',
      duration: 1,
      trimStart: 0,
      trimEnd: 1,
    });
    const nextVideo = createVideoItem({
      id: 'video-2',
      duration: 2,
      trimStart: 1.2,
      trimEnd: 3.2,
    });
    const leadVideoElement = createMockVideoElement();
    leadVideoElement.readyState = 2;
    leadVideoElement.seeking = false;
    leadVideoElement.paused = false;
    const nextVideoElement = createMockVideoElement();
    nextVideoElement.readyState = 4;
    nextVideoElement.seeking = false;
    nextVideoElement.paused = true;
    nextVideoElement.currentTime = 1.25;

    const { canvasContext, hook, logInfo, logWarn } = setupRenderFrameHarness({
      mediaItems: [leadVideo, nextVideo],
      mediaElements: {
        [leadVideo.id]: leadVideoElement as unknown as HTMLVideoElement,
        [nextVideo.id]: nextVideoElement as unknown as HTMLVideoElement,
      } as MediaElementsRef,
    });
    const drawImageMock = canvasContext.drawImage as unknown as {
      mock: { invocationCallOrder: number[] };
    };

    const didUpdateCanvas = hook.result.current.renderFrame(1.05, true, false);

    expect(canvasContext.drawImage).toHaveBeenCalledWith(
      nextVideoElement,
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
    );
    expect(drawImageMock.mock.invocationCallOrder[0]).toBeLessThan(
      nextVideoElement.play.mock.invocationCallOrder[0],
    );
    expect(nextVideoElement.play).toHaveBeenCalledTimes(1);
    expect(
      logInfo.mock.calls.some(([, message]) => message === 'preview.boundary.smoothPlan'),
    ).toBe(false);
    expect(
      logInfo.mock.calls.some(([, message]) => message === 'canCommit false → drawLastStableFrame'),
    ).toBe(false);
    expect(
      logWarn.mock.calls.some(([, message]) => message === 'preview.android.seek-assignment'),
    ).toBe(false);
    expect(didUpdateCanvas).toBe(true);
  });

  it('Android preview は metadata ready の paused 境界 active video に即 play を要求する', () => {
    const leadVideo = createVideoItem({
      id: 'video-1',
      duration: 1,
      trimStart: 0,
      trimEnd: 1,
    });
    const nextVideo = createVideoItem({
      id: 'video-2',
      duration: 2,
      trimStart: 1.2,
      trimEnd: 3.2,
    });
    const leadVideoElement = createMockVideoElement();
    leadVideoElement.readyState = 2;
    leadVideoElement.seeking = false;
    leadVideoElement.paused = false;
    const nextVideoElement = createMockVideoElement();
    nextVideoElement.readyState = 1;
    nextVideoElement.seeking = false;
    nextVideoElement.paused = true;
    nextVideoElement.currentTime = 1.22;

    const { canvasContext, hook } = setupRenderFrameHarness({
      mediaItems: [leadVideo, nextVideo],
      mediaElements: {
        [leadVideo.id]: leadVideoElement as unknown as HTMLVideoElement,
        [nextVideo.id]: nextVideoElement as unknown as HTMLVideoElement,
      } as MediaElementsRef,
    });

    const didUpdateCanvas = hook.result.current.renderFrame(1.05, true, false);

    expect(nextVideoElement.play).toHaveBeenCalledTimes(1);
    expect(canvasContext.drawImage).not.toHaveBeenCalledWith(
      nextVideoElement,
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
    );
    expect(didUpdateCanvas).toBe(false);
  });

  it('Android preview は clip 境界前でも次の video を preseek しない', () => {
    const imageItem = createImageItem({ id: 'image-gap', duration: 1 });
    const videoItem = createVideoItem({
      id: 'video-2',
      duration: 2,
      trimStart: 1.2,
      trimEnd: 3.2,
    });
    const videoElement = createMockVideoElement();
    videoElement.readyState = 1;
    videoElement.seeking = false;
    videoElement.paused = true;
    videoElement.currentTime = 0.2;

    const { hook } = setupRenderFrameHarness({
      mediaItems: [imageItem, videoItem],
      mediaElements: {
        [videoItem.id]: videoElement as unknown as HTMLVideoElement,
      } as MediaElementsRef,
    });

    hook.result.current.renderFrame(0.75, true, false);

    expect(videoElement.currentTime).toBeCloseTo(0.2);
  });

  it('standard preview は video -> video 境界前に次 video を trimStart へ prebuffer する', () => {
    const currentVideo = createVideoItem({
      id: 'video-1',
      duration: 1,
      trimStart: 0,
      trimEnd: 1,
    });
    const videoItem = createVideoItem({
      id: 'video-2',
      duration: 2,
      trimStart: 0,
      trimEnd: 2,
    });
    const currentVideoElement = createMockVideoElement();
    currentVideoElement.readyState = 2;
    currentVideoElement.seeking = false;
    currentVideoElement.paused = false;
    const videoElement = createMockVideoElement();
    videoElement.readyState = 2;
    videoElement.seeking = false;
    videoElement.paused = true;
    videoElement.currentTime = 0.4;

    const { hook } = setupRenderFrameHarness({
      mediaItems: [currentVideo, videoItem],
      mediaElements: {
        [currentVideo.id]: currentVideoElement as unknown as HTMLVideoElement,
        [videoItem.id]: videoElement as unknown as HTMLVideoElement,
      } as MediaElementsRef,
    });

    hook.result.current.renderFrame(0.6, true, false);

    expect(videoElement.currentTime).toBeCloseTo(0);
    expect(videoElement.muted).toBe(false);
    expect(videoElement.defaultMuted).toBe(false);
    expect(videoElement.preload).toBe('auto');
    expect(videoElement.play).not.toHaveBeenCalled();
  });

  it('standard preview は非 Android でも video -> video 境界前に次 video を prebuffer する', () => {
    const currentVideo = createVideoItem({
      id: 'video-1',
      duration: 1,
      trimStart: 0,
      trimEnd: 1,
    });
    const videoItem = createVideoItem({
      id: 'video-2',
      duration: 2,
      trimStart: 1.2,
      trimEnd: 3.2,
    });
    const currentVideoElement = createMockVideoElement();
    currentVideoElement.readyState = 2;
    currentVideoElement.seeking = false;
    currentVideoElement.paused = false;
    const videoElement = createMockVideoElement();
    videoElement.readyState = 2;
    videoElement.seeking = false;
    videoElement.paused = true;
    videoElement.currentTime = 0.4;

    const { hook } = setupRenderFrameHarness({
      mediaItems: [currentVideo, videoItem],
      mediaElements: {
        [currentVideo.id]: currentVideoElement as unknown as HTMLVideoElement,
        [videoItem.id]: videoElement as unknown as HTMLVideoElement,
      } as MediaElementsRef,
      platformCapabilities: { isAndroid: false },
    });

    hook.result.current.renderFrame(0.6, true, false);

    expect(videoElement.currentTime).toBeCloseTo(1.2);
    expect(videoElement.preload).toBe('auto');
    expect(videoElement.play).not.toHaveBeenCalled();
  });

  it('standard preview は metadata ready の next video に対し破壊的な load() を呼ばない', () => {
    // readyState=1 (HAVE_METADATA) のときに load() を呼ぶと readyState が 0 へ戻ってしまい
    // 境界到達直前のスタッタを誘発するため、preload="auto" 維持と trimStart 合わせだけに留める。
    const currentVideo = createVideoItem({
      id: 'video-1',
      duration: 1,
      trimStart: 0,
      trimEnd: 1,
    });
    const videoItem = createVideoItem({
      id: 'video-2',
      duration: 2,
      trimStart: 1.2,
      trimEnd: 3.2,
    });
    const currentVideoElement = createMockVideoElement();
    currentVideoElement.readyState = 2;
    currentVideoElement.seeking = false;
    currentVideoElement.paused = false;
    const videoElement = createMockVideoElement();
    videoElement.readyState = 1;
    videoElement.seeking = false;
    videoElement.paused = true;
    videoElement.currentTime = 1.2;

    const { hook } = setupRenderFrameHarness({
      mediaItems: [currentVideo, videoItem],
      mediaElements: {
        [currentVideo.id]: currentVideoElement as unknown as HTMLVideoElement,
        [videoItem.id]: videoElement as unknown as HTMLVideoElement,
      } as MediaElementsRef,
    });

    hook.result.current.renderFrame(0.6, true, false);
    hook.result.current.renderFrame(0.7, true, false);

    expect(videoElement.load).not.toHaveBeenCalled();
    expect(videoElement.currentTime).toBeCloseTo(1.2);
    expect(videoElement.preload).toBe('auto');
    expect(videoElement.play).not.toHaveBeenCalled();
  });

  it('Android preview は境界直後 500ms 以内の大きな drift でも recovery seek しない', () => {
    const currentVideo = createVideoItem({
      id: 'video-1',
      duration: 1,
      trimStart: 0,
      trimEnd: 1,
    });
    const nextVideo = createVideoItem({
      id: 'video-2',
      duration: 2,
      trimStart: 1.2,
      trimEnd: 3.2,
    });
    const currentVideoElement = createMockVideoElement();
    currentVideoElement.readyState = 2;
    currentVideoElement.seeking = false;
    currentVideoElement.paused = false;
    const nextVideoElement = createMockVideoElement();
    nextVideoElement.readyState = 2;
    nextVideoElement.seeking = false;
    nextVideoElement.paused = false;
    let assignedCurrentTime = 0.1;
    let seekAssignCount = 0;
    Object.defineProperty(nextVideoElement, 'currentTime', {
      configurable: true,
      get: () => assignedCurrentTime,
      set: (value: number) => {
        assignedCurrentTime = value;
        seekAssignCount += 1;
      },
    });

    const { hook } = setupRenderFrameHarness({
      mediaItems: [currentVideo, nextVideo],
      mediaElements: {
        [currentVideo.id]: currentVideoElement as unknown as HTMLVideoElement,
        [nextVideo.id]: nextVideoElement as unknown as HTMLVideoElement,
      } as MediaElementsRef,
    });

    hook.result.current.renderFrame(1.3, true, false);

    expect(assignedCurrentTime).toBeCloseTo(0.1);
    expect(seekAssignCount).toBe(0);
  });

  it('Android preview の next video preseek は image gap を挟むケースでも無効のままにする', () => {
    const currentVideo = createVideoItem({
      id: 'video-1',
      duration: 1,
      trimStart: 0,
      trimEnd: 1,
    });
    const imageGap = createImageItem({
      id: 'image-gap',
      duration: 1,
    });
    const nextVideo = createVideoItem({
      id: 'video-2',
      duration: 2,
      trimStart: 1.4,
      trimEnd: 3.4,
    });
    const farVideo = createVideoItem({
      id: 'video-3',
      duration: 2,
      trimStart: 0.8,
      trimEnd: 2.8,
    });
    const currentVideoElement = createMockVideoElement();
    currentVideoElement.readyState = 2;
    currentVideoElement.seeking = false;
    currentVideoElement.paused = false;
    const nextVideoElement = createMockVideoElement();
    nextVideoElement.readyState = 2;
    nextVideoElement.seeking = false;
    nextVideoElement.paused = true;
    nextVideoElement.currentTime = 0.1;
    const farVideoElement = createMockVideoElement();
    farVideoElement.readyState = 2;
    farVideoElement.seeking = false;
    farVideoElement.paused = true;
    farVideoElement.currentTime = 0.2;

    const { hook } = setupRenderFrameHarness({
      mediaItems: [currentVideo, imageGap, nextVideo, farVideo],
      mediaElements: {
        [currentVideo.id]: currentVideoElement as unknown as HTMLVideoElement,
        [nextVideo.id]: nextVideoElement as unknown as HTMLVideoElement,
        [farVideo.id]: farVideoElement as unknown as HTMLVideoElement,
      } as MediaElementsRef,
    });

    hook.result.current.renderFrame(0.5, true, false);

    expect(nextVideoElement.currentTime).toBeCloseTo(0.1);
    expect(farVideoElement.currentTime).toBeCloseTo(0.2);
  });

  it('Android preview の next trimmed video preseek は clip 開始直後でも発火しない', () => {
    const imageItem = createImageItem({ id: 'image-gap', duration: 1 });
    const videoItem = createVideoItem({
      id: 'video-2',
      duration: 2,
      trimStart: 1.2,
      trimEnd: 3.2,
    });
    const videoElement = createMockVideoElement();
    videoElement.readyState = 2;
    videoElement.seeking = false;
    videoElement.paused = false;
    videoElement.currentTime = 0.2;

    const { hook } = setupRenderFrameHarness({
      mediaItems: [imageItem, videoItem],
      mediaElements: {
        [videoItem.id]: videoElement as unknown as HTMLVideoElement,
      } as MediaElementsRef,
    });

    hook.result.current.renderFrame(0.19, true, false);

    expect(videoElement.currentTime).toBeCloseTo(0.2);
  });

  it('Android preview は境界後の大きな drift だけを 1 セグメント 1 回だけ recovery seek する', () => {
    const currentVideo = createVideoItem({
      id: 'video-1',
      duration: 1,
      trimStart: 0,
      trimEnd: 1,
    });
    const nextVideo = createVideoItem({
      id: 'video-2',
      duration: 2,
      trimStart: 1.2,
      trimEnd: 3.2,
    });
    const videoElement = createMockVideoElement();
    videoElement.readyState = 2;
    videoElement.seeking = false;
    videoElement.paused = false;
    let assignedCurrentTime = 0.2;
    let seekAssignCount = 0;
    Object.defineProperty(videoElement, 'currentTime', {
      configurable: true,
      get: () => assignedCurrentTime,
      set: (value: number) => {
        assignedCurrentTime = value;
        seekAssignCount += 1;
      },
    });
    const nowSpy = vi.spyOn(Date, 'now');
    nowSpy.mockReturnValue(2_000);

    const { hook, logWarn } = setupRenderFrameHarness({
      mediaItems: [currentVideo, nextVideo],
      mediaElements: {
        [currentVideo.id]: createMockVideoElement() as unknown as HTMLVideoElement,
        [nextVideo.id]: videoElement as unknown as HTMLVideoElement,
      } as MediaElementsRef,
    });

    hook.result.current.renderFrame(1.7, true, false);

    expect(assignedCurrentTime).toBeCloseTo(1.9);
    expect(seekAssignCount).toBe(1);
    expect(logWarn).toHaveBeenCalledWith(
      'RENDER',
      'preview.android.seek-assignment',
      expect.objectContaining({
        reason: 'timeline-drift',
        videoId: nextVideo.id,
        segmentIndex: 1,
      }),
    );

    assignedCurrentTime = 0.3;
    nowSpy.mockReturnValue(3_200);
    // 同一 segment 内では 2 回目の大きな drift を検知しても recovery seek を再実行しない。
    hook.result.current.renderFrame(1.8, true, false);

    expect(assignedCurrentTime).toBeCloseTo(0.3);
    expect(seekAssignCount).toBe(1);
    nowSpy.mockRestore();
  });

  it('standard preview は metadata 未取得の next video を load だけ開始し currentTime は動かさない', () => {
    const currentVideo = createVideoItem({
      id: 'video-1',
      duration: 1,
      trimStart: 0,
      trimEnd: 1,
    });
    const nextVideo = createVideoItem({
      id: 'video-2',
      duration: 2,
      trimStart: 1.2,
      trimEnd: 3.2,
    });

    const notReadyVideo = createMockVideoElement();
    notReadyVideo.readyState = 0;
    notReadyVideo.seeking = false;
    notReadyVideo.paused = true;
    notReadyVideo.currentTime = 0.2;

    const notReadyHarness = setupRenderFrameHarness({
      mediaItems: [currentVideo, nextVideo],
      mediaElements: {
        [currentVideo.id]: createMockVideoElement() as unknown as HTMLVideoElement,
        [nextVideo.id]: notReadyVideo as unknown as HTMLVideoElement,
      } as MediaElementsRef,
    });

    notReadyHarness.hook.result.current.renderFrame(0.75, true, false);

    expect(notReadyVideo.load).toHaveBeenCalledTimes(1);
    expect(notReadyVideo.currentTime).toBeCloseTo(0.2);
    expect(notReadyVideo.preload).toBe('auto');

    const seekingVideo = createMockVideoElement();
    seekingVideo.readyState = 1;
    seekingVideo.seeking = true;
    seekingVideo.paused = true;
    seekingVideo.currentTime = 0.4;

    const seekingHarness = setupRenderFrameHarness({
      mediaItems: [currentVideo, nextVideo],
      mediaElements: {
        [currentVideo.id]: createMockVideoElement() as unknown as HTMLVideoElement,
        [nextVideo.id]: seekingVideo as unknown as HTMLVideoElement,
      } as MediaElementsRef,
    });

    seekingHarness.hook.result.current.renderFrame(0.75, true, false);

    expect(seekingVideo.currentTime).toBeCloseTo(0.4);
    expect(seekingVideo.preload).toBe('auto');
  });

  it('Android preview startEngine は inactive reset に直近の次 video だけを渡す', async () => {
    const currentVideo = createVideoItem({
      id: 'video-1',
      duration: 1,
      trimStart: 0,
      trimEnd: 1,
    });
    const imageGap = createImageItem({
      id: 'image-gap',
      duration: 1,
    });
    const nextVideo = createVideoItem({
      id: 'video-2',
      duration: 2,
      trimStart: 1.25,
      trimEnd: 3.25,
    });
    const farVideo = createVideoItem({
      id: 'video-3',
      duration: 2,
      trimStart: 0.5,
      trimEnd: 2.5,
    });
    const activeVideoElement = createMockVideoElement();
    activeVideoElement.readyState = 2;
    activeVideoElement.seeking = false;
    activeVideoElement.currentTime = 0.5;
    const nextVideoElement = createMockVideoElement();
    nextVideoElement.readyState = 2;
    nextVideoElement.seeking = false;
    const farVideoElement = createMockVideoElement();
    farVideoElement.readyState = 2;
    farVideoElement.seeking = false;

    const { hook, resetInactiveVideos } = setupPreviewEngineHarness({
      mediaItems: [currentVideo, imageGap, nextVideo, farVideo],
      mediaElements: {
        [currentVideo.id]: activeVideoElement as unknown as HTMLVideoElement,
        [nextVideo.id]: nextVideoElement as unknown as HTMLVideoElement,
        [farVideo.id]: farVideoElement as unknown as HTMLVideoElement,
      } as MediaElementsRef,
    });

    const startPromise = hook.result.current.startEngine(0.5, false);
    await vi.runAllTimersAsync();
    await startPromise;

    expect(resetInactiveVideos).toHaveBeenCalledWith({
      nextVideoId: nextVideo.id,
      protectedVideoIds: [currentVideo.id, nextVideo.id],
      isAndroidPreview: true,
    });
  });

  it('Android preview は image -> trimStart あり video でも seeking 中は描画しない', () => {
    const imageItem = createImageItem({ id: 'image-gap', duration: 1 });
    const videoItem = createVideoItem({
      id: 'video-2',
      duration: 2,
      trimStart: 1.2,
      trimEnd: 3.2,
    });
    const videoElement = createMockVideoElement();
    videoElement.readyState = 1;
    videoElement.seeking = true;
    videoElement.paused = false;
    videoElement.currentTime = 1.3;

    const { canvasContext, hook } = setupRenderFrameHarness({
      mediaItems: [imageItem, videoItem],
      mediaElements: {
        [videoItem.id]: videoElement as unknown as HTMLVideoElement,
      } as MediaElementsRef,
    });

    const didUpdateCanvas = hook.result.current.renderFrame(1.1, true, false);

    expect(videoElement.currentTime).toBeCloseTo(1.3);
    expect(canvasContext.fillRect).not.toHaveBeenCalled();
    expect(canvasContext.drawImage).not.toHaveBeenCalled();
    expect(didUpdateCanvas).toBe(false);
  });

  it('Android preview の trimmed entry hold は未準備の間 force soft draw しない', () => {
    const leadVideo = createVideoItem({
      id: 'video-1',
      duration: 1,
      trimStart: 0,
      trimEnd: 1,
    });
    const trimmedVideo = createVideoItem({
      id: 'video-2',
      duration: 2,
      trimStart: 1.2,
      trimEnd: 3.2,
    });
    const leadVideoElement = createMockVideoElement();
    leadVideoElement.readyState = 2;
    leadVideoElement.seeking = false;
    leadVideoElement.paused = false;
    const trimmedVideoElement = createMockVideoElement();
    trimmedVideoElement.readyState = 1;
    trimmedVideoElement.seeking = true;
    trimmedVideoElement.paused = false;
    trimmedVideoElement.currentTime = 2.0;

    const { canvasContext, hook } = setupRenderFrameHarness({
      mediaItems: [leadVideo, trimmedVideo],
      mediaElements: {
        [leadVideo.id]: leadVideoElement as unknown as HTMLVideoElement,
        [trimmedVideo.id]: trimmedVideoElement as unknown as HTMLVideoElement,
      } as MediaElementsRef,
    });

    const first = hook.result.current.renderFrame(1.02, true, false);
    expect(canvasContext.drawImage).not.toHaveBeenCalled();
    expect(first).toBe(false);

    const second = hook.result.current.renderFrame(1.02, true, false);
    expect(canvasContext.drawImage).not.toHaveBeenCalled();
    expect(second).toBe(false);

    const third = hook.result.current.renderFrame(1.02, true, false);
    expect(canvasContext.drawImage).not.toHaveBeenCalled();
    expect(third).toBe(false);

    const didUpdateCanvas = hook.result.current.renderFrame(1.02, true, false);

    expect(canvasContext.drawImage).not.toHaveBeenCalled();
    expect(didUpdateCanvas).toBe(false);
  });

  it('Android preview の trimStart あり video 安定化は先頭 0.25 秒だけに限定する', () => {
    const imageItem = createImageItem({ id: 'image-gap', duration: 1 });
    const videoItem = createVideoItem({
      id: 'video-2',
      duration: 2,
      trimStart: 1.2,
      trimEnd: 3.2,
    });

    const insideWindowVideo = createMockVideoElement();
    insideWindowVideo.readyState = 1;
    insideWindowVideo.seeking = false;
    insideWindowVideo.paused = false;
    insideWindowVideo.currentTime = 1.6;

    const insideHarness = setupRenderFrameHarness({
      mediaItems: [imageItem, videoItem],
      mediaElements: {
        [videoItem.id]: insideWindowVideo as unknown as HTMLVideoElement,
      } as MediaElementsRef,
    });

    const insideTimelineTime = 1.25;
    insideHarness.hook.result.current.renderFrame(insideTimelineTime, true, false);

    expect(insideWindowVideo.currentTime).toBeCloseTo(1.6);

    const outsideWindowVideo = createMockVideoElement();
    outsideWindowVideo.readyState = 1;
    outsideWindowVideo.seeking = false;
    outsideWindowVideo.paused = false;
    outsideWindowVideo.currentTime = 1.6;

    const outsideHarness = setupRenderFrameHarness({
      mediaItems: [imageItem, videoItem],
      mediaElements: {
        [videoItem.id]: outsideWindowVideo as unknown as HTMLVideoElement,
      } as MediaElementsRef,
    });

    outsideHarness.hook.result.current.renderFrame(1.26, true, false);

    expect(outsideWindowVideo.currentTime).toBeCloseTo(1.6);
  });

  it('export モードでタイムライン終端に達したとき completeWebCodecsExport を呼び stopWebCodecsExport を呼ばない', () => {
    // タイムライン終端で stopAll() → stopWebCodecsExport({ reason: 'user' }) が誤呼び出しされ
    // blob 生成後の callback が抑止される問題の回帰テスト。
    const mediaItem = createVideoItem({ id: 'video-1', duration: 6, trimStart: 0, trimEnd: 6 });
    const videoElement = createMockVideoElement();
    videoElement.readyState = 2;
    videoElement.seeking = false;

    // now=6000ms, startTime=0ms → clampedElapsed = 6 = totalDuration → 終端判定
    vi.spyOn(playbackClock, 'getStandardPreviewNow').mockReturnValue(6000);

    const completeWebCodecsExport = vi.fn();
    const stopWebCodecsExport = vi.fn();

    renderHook(() =>
      usePreviewEngine({
        captions: [] as Caption[],
        captionSettings: {} as CaptionSettings,
        mediaItemsRef: createRef([mediaItem]),
        bgmRef: createRef<AudioTrack | null>(null),
        narrationsRef: createRef<NarrationClip[]>([]),
        captionsRef: createRef<Caption[]>([]),
        captionSettingsRef: createRef({} as CaptionSettings),
        totalDurationRef: createRef(6),
        currentTimeRef: createRef(0),
        canvasRef: createRef({
          getContext: vi.fn(() => createMockCanvasContext()),
        } as unknown as HTMLCanvasElement),
        mediaElementsRef: createRef({ [mediaItem.id]: videoElement as unknown as HTMLVideoElement } as MediaElementsRef),
        audioCtxRef: createRef(null),
        sourceNodesRef: createRef({}),
        gainNodesRef: createRef({}),
        masterDestRef: createRef(null),
        audioRoutingModeRef: createRef<'preview' | 'export'>('preview'),
        reqIdRef: createRef<number | null>(null),
        startTimeRef: createRef(0),
        audioResumeWaitFramesRef: createRef(0),
        recorderRef: createRef<MediaRecorder | null>(null),
        loopIdRef: createRef(1),
        isPlayingRef: createRef(true),
        isSeekingRef: createRef(false),
        isSeekPlaybackPreparingRef: createRef(false),
        activeVideoIdRef: createRef<string | null>(null),
        videoRecoveryAttemptsRef: createRef({}),
        exportPlayFailedRef: createRef({}),
        exportFallbackSeekAtRef: createRef({}),
        seekingVideosRef: createRef(new Set<string>()),
        pendingSeekRef: createRef<number | null>(null),
        wasPlayingBeforeSeekRef: createRef(false),
        pendingSeekTimeoutRef: createRef<ReturnType<typeof setTimeout> | null>(null),
        previewPlaybackAttemptRef: createRef(0),
        requestPreviewAudioRouteRefreshRef: createRef(() => {}),
        primePreviewAudioOnlyTracksAtTimeRef: createRef(() => {}),
        endFinalizedRef: createRef(false),
        previewPlatformPolicy: standardPreviewRuntime.getPreviewPlatformPolicy(
          getStandardPreviewPlatformCapabilities(createCapabilities()),
        ),
        platformCapabilities: { isAndroid: true, isIosSafari: false },
        setVideoDuration: vi.fn(),
        setCurrentTime: vi.fn(),
        setProcessing: vi.fn(),
        setPreviewPlaying: vi.fn(),
        setLoading: vi.fn(),
        setExportPreparationStep: vi.fn(),
        setExportUrl: vi.fn(),
        setExportExt: vi.fn(),
        clearExport: vi.fn(),
        setError: vi.fn(),
        play: vi.fn(),
        pause: vi.fn(),
        getAudioContext: vi.fn(),
        cancelPendingPausedSeekWait: vi.fn(),
        cancelPendingSeekPlaybackPrepare: vi.fn(),
        detachGlobalSeekEndListeners: vi.fn(),
        ensureAudioNodeForElement: vi.fn(() => false),
        detachAudioNode: vi.fn(),
        preparePreviewAudioNodesForTime: vi.fn(() => ({
          activeVideoId: mediaItem.id,
          audibleSourceCount: 1,
          requiresWebAudio: false,
        })),
        preparePreviewAudioNodesForUpcomingVideos: vi.fn(),
        primePreviewAudioOnlyTracksAtTime: vi.fn(),
        resetInactiveVideos: vi.fn(),
        startWebCodecsExport: vi.fn(),
        stopWebCodecsExport,
        completeWebCodecsExport,
        logInfo: vi.fn(),
        logWarn: vi.fn(),
        logDebug: vi.fn(),
      }),
    ).result.current.loop(true, 1);

    expect(completeWebCodecsExport).toHaveBeenCalledTimes(1);
    expect(stopWebCodecsExport).not.toHaveBeenCalled();
  });

  it('Android video→video 境界で preview.boundary.smoothPlan が1回だけ出る', () => {
    vi.useFakeTimers();
    globalThis.localStorage?.setItem('preview.log.mode', 'boundary');
    const video1 = createVideoItem({ id: 'v1', duration: 5, trimStart: 0, trimEnd: 5 });
    const video2 = createVideoItem({ id: 'v2', duration: 5, trimStart: 1, trimEnd: 6 });
    const el1 = createMockVideoElement();
    el1.readyState = 4;
    el1.seeking = false;
    el1.paused = false;
    const el2 = createMockVideoElement();
    el2.readyState = 4;
    el2.seeking = false;
    el2.paused = false;
    el2.currentTime = 1;

    const nowRef = { current: 1000 };
    vi.spyOn(playbackClock, 'getStandardPreviewNow').mockImplementation(() => nowRef.current);

    const { hook, logInfo } = setupRenderFrameHarness({
      mediaItems: [video1, video2],
      mediaElements: {
        v1: el1 as unknown as HTMLVideoElement,
        v2: el2 as unknown as HTMLVideoElement,
      } as MediaElementsRef,
      currentTime: 2.0,
      totalDuration: 10,
    });

    // 1回目 loop: now=1000ms, startTime=0 → elapsed=1.0s → video1 セグメント (index=0)
    nowRef.current = 1000;
    hook.result.current.loop(false, 1);

    // 2回目 loop: now=6000ms → elapsed=6.0s → video2 セグメント (index=1) → segmentChanged
    nowRef.current = 6000;
    hook.result.current.loop(false, 1);

    // 3回目 loop: now=6400ms → 400ms後 → after-300ms phase を超えてsmoPlanとjudgementが出る
    nowRef.current = 6400;
    hook.result.current.loop(false, 1);

    const smoothPlanCount = logInfo.mock.calls.filter(([, msg]) => msg === 'preview.boundary.smoothPlan').length;
    expect(smoothPlanCount).toBe(1);
  });

  it('Android video→video 境界で preview.boundary.judgement が出る', () => {
    vi.useFakeTimers();
    globalThis.localStorage?.setItem('preview.log.mode', 'boundary');
    const video1 = createVideoItem({ id: 'v1', duration: 5, trimStart: 0, trimEnd: 5 });
    const video2 = createVideoItem({ id: 'v2', duration: 5, trimStart: 1, trimEnd: 6 });
    const el1 = createMockVideoElement();
    el1.readyState = 4;
    el1.seeking = false;
    el1.paused = false;
    const el2 = createMockVideoElement();
    el2.readyState = 4;
    el2.seeking = false;
    el2.paused = false;
    el2.currentTime = 1;

    const nowRef = { current: 1000 };
    vi.spyOn(playbackClock, 'getStandardPreviewNow').mockImplementation(() => nowRef.current);

    const { hook, logInfo } = setupRenderFrameHarness({
      mediaItems: [video1, video2],
      mediaElements: {
        v1: el1 as unknown as HTMLVideoElement,
        v2: el2 as unknown as HTMLVideoElement,
      } as MediaElementsRef,
      currentTime: 2.0,
      totalDuration: 10,
    });

    nowRef.current = 1000;
    hook.result.current.loop(false, 1);

    nowRef.current = 6000;
    hook.result.current.loop(false, 1);

    nowRef.current = 6400;
    hook.result.current.loop(false, 1);

    const judgementCount = logInfo.mock.calls.filter(([, msg]) => msg === 'preview.boundary.judgement').length;
    expect(judgementCount).toBe(1);
  });

  it('Android video→video 境界で preview.nextVideo.startLatency が出る', () => {
    vi.useFakeTimers();
    globalThis.localStorage?.setItem('preview.log.mode', 'boundary');
    const video1 = createVideoItem({ id: 'v1', duration: 5, trimStart: 0, trimEnd: 5 });
    const video2 = createVideoItem({ id: 'v2', duration: 5, trimStart: 1, trimEnd: 6 });
    const el1 = createMockVideoElement();
    el1.readyState = 4;
    el1.seeking = false;
    el1.paused = false;
    const el2 = createMockVideoElement();
    el2.readyState = 4;
    el2.seeking = false;
    el2.paused = true;
    el2.currentTime = 1;

    const nowRef = { current: 1000 };
    vi.spyOn(playbackClock, 'getStandardPreviewNow').mockImplementation(() => nowRef.current);

    const { hook, logInfo } = setupRenderFrameHarness({
      mediaItems: [video1, video2],
      mediaElements: {
        v1: el1 as unknown as HTMLVideoElement,
        v2: el2 as unknown as HTMLVideoElement,
      } as MediaElementsRef,
      currentTime: 2.0,
      totalDuration: 10,
    });

    nowRef.current = 1000;
    hook.result.current.loop(false, 1);

    nowRef.current = 6000;
    hook.result.current.loop(false, 1);

    el2.paused = false;
    el2.currentTime = 1.04;
    nowRef.current = 6100;
    hook.result.current.loop(false, 1);

    el2.currentTime = 1.3;
    nowRef.current = 6400;
    hook.result.current.loop(false, 1);

    const startLatencyCall = logInfo.mock.calls.find(([, msg]) => msg === 'preview.nextVideo.startLatency');
    expect(startLatencyCall).toBeDefined();
    expect(startLatencyCall?.[2]).toMatchObject({
      previousId: 'v1',
      activeId: 'v2',
      currentTimeAdvancedAt100ms: 40,
      activePausedAtBoundary: true,
      pausedAt100ms: false,
      readyStateAt100ms: 4,
    });
  });

  it('preview.log.mode=smooth では Android 境界診断ログを出さない', () => {
    vi.useFakeTimers();
    globalThis.localStorage?.setItem('preview.log.mode', 'smooth');
    const video1 = createVideoItem({ id: 'v1', duration: 5, trimStart: 0, trimEnd: 5 });
    const video2 = createVideoItem({ id: 'v2', duration: 5, trimStart: 1, trimEnd: 6 });
    const el1 = createMockVideoElement();
    el1.readyState = 4;
    el1.seeking = false;
    el1.paused = false;
    const el2 = createMockVideoElement();
    el2.readyState = 4;
    el2.seeking = false;
    el2.paused = false;
    el2.currentTime = 1;

    const nowRef = { current: 1000 };
    vi.spyOn(playbackClock, 'getStandardPreviewNow').mockImplementation(() => nowRef.current);

    const { hook, logInfo } = setupRenderFrameHarness({
      mediaItems: [video1, video2],
      mediaElements: {
        v1: el1 as unknown as HTMLVideoElement,
        v2: el2 as unknown as HTMLVideoElement,
      } as MediaElementsRef,
      currentTime: 2.0,
      totalDuration: 10,
    });

    nowRef.current = 1000;
    hook.result.current.loop(false, 1);
    nowRef.current = 6000;
    hook.result.current.loop(false, 1);
    nowRef.current = 6400;
    hook.result.current.loop(false, 1);

    expect(logInfo.mock.calls.some(([, msg]) => msg === 'preview.boundary.smoothPlan')).toBe(false);
    expect(logInfo.mock.calls.some(([, msg]) => msg === 'preview.boundary.judgement')).toBe(false);
    expect(logInfo.mock.calls.some(([, msg]) => msg === 'preview.nextVideo.startLatency')).toBe(false);
    expect(logInfo.mock.calls.some(([, msg]) => msg === 'preview.android.boundary.passive-switch')).toBe(false);
    expect(logInfo.mock.calls.some(([, msg]) => msg === 'preview.boundary.sample')).toBe(false);
  });

  it('preview.log.mode=boundary では video→video 境界サンプルログが出る', () => {
    vi.useFakeTimers();
    globalThis.localStorage?.setItem('preview.log.mode', 'boundary');
    const video1 = createVideoItem({ id: 'v1', duration: 5, trimStart: 0, trimEnd: 5 });
    const video2 = createVideoItem({ id: 'v2', duration: 5, trimStart: 1, trimEnd: 6 });
    const el1 = createMockVideoElement();
    el1.readyState = 4;
    el1.seeking = false;
    el1.paused = false;
    el1.currentTime = 4.5;
    const el2 = createMockVideoElement();
    el2.readyState = 4;
    el2.seeking = false;
    el2.paused = false;
    el2.currentTime = 1;

    const nowRef = { current: 4500 };
    vi.spyOn(playbackClock, 'getStandardPreviewNow').mockImplementation(() => nowRef.current);

    const { hook, logInfo } = setupRenderFrameHarness({
      mediaItems: [video1, video2],
      mediaElements: {
        v1: el1 as unknown as HTMLVideoElement,
        v2: el2 as unknown as HTMLVideoElement,
      } as MediaElementsRef,
      currentTime: 4.5,
      totalDuration: 10,
    });

    nowRef.current = 4500;
    hook.result.current.loop(false, 1);
    nowRef.current = 5000;
    hook.result.current.loop(false, 1);
    nowRef.current = 5100;
    hook.result.current.loop(false, 1);
    nowRef.current = 5200;
    hook.result.current.loop(false, 1);
    nowRef.current = 5300;
    hook.result.current.loop(false, 1);

    const phases = logInfo.mock.calls
      .filter(([, msg]) => msg === 'preview.boundary.sample')
      .map(([, , details]) => details?.phase);
    expect(phases).toContain('before-500ms');
    expect(phases).toContain('enter');
    expect(phases).toContain('after-100ms');
    expect(phases).toContain('after-200ms');
    expect(phases).toContain('after-300ms');
  });

  it('iOS Safari では Android 境界診断ログが出ない', () => {
    vi.useFakeTimers();
    const video1 = createVideoItem({ id: 'v1', duration: 5, trimStart: 0, trimEnd: 5 });
    const video2 = createVideoItem({ id: 'v2', duration: 5, trimStart: 1, trimEnd: 6 });
    const el1 = createMockVideoElement();
    el1.readyState = 4;
    const el2 = createMockVideoElement();
    el2.readyState = 4;
    el2.currentTime = 1;

    const nowRef = { current: 1000 };
    vi.spyOn(playbackClock, 'getStandardPreviewNow').mockImplementation(() => nowRef.current);

    const { hook, logInfo } = setupRenderFrameHarness({
      mediaItems: [video1, video2],
      mediaElements: {
        v1: el1 as unknown as HTMLVideoElement,
        v2: el2 as unknown as HTMLVideoElement,
      } as MediaElementsRef,
      currentTime: 2.0,
      totalDuration: 10,
      platformCapabilities: { isAndroid: false, isIosSafari: true },
    });

    nowRef.current = 1000;
    hook.result.current.loop(false, 1);
    nowRef.current = 6000;
    hook.result.current.loop(false, 1);
    nowRef.current = 6400;
    hook.result.current.loop(false, 1);

    expect(logInfo.mock.calls.some(([, msg]) => msg === 'preview.boundary.smoothPlan')).toBe(false);
    expect(logInfo.mock.calls.some(([, msg]) => msg === 'preview.boundary.judgement')).toBe(false);
    expect(logInfo.mock.calls.some(([, msg]) => msg === 'preview.nextVideo.startLatency')).toBe(false);
    expect(logInfo.mock.calls.some(([, msg]) => msg === 'preview.android.boundary.passive-switch')).toBe(false);
  });

  it('video fadeOut 中は drawImage をスキップせず globalAlpha で滑らかにフェードする', () => {
    // 回帰テスト: shouldBlackoutVideoFadeTail が true になると drawImage がスキップされ
    // 突然黒画面になる問題の修正を検証する。
    // fadeOutDuration=2s, duration=4s, localTime=3.0s → fadeOut 半分地点、alpha=0.5
    const videoItem = createVideoItem({
      id: 'video-fade',
      duration: 4,
      originalDuration: 4,
      trimStart: 0,
      trimEnd: 4,
      fadeOut: true,
      fadeOutDuration: 2,
    });
    const videoElement = createMockVideoElement();
    videoElement.readyState = 2;
    videoElement.seeking = false;
    videoElement.paused = false;
    videoElement.currentTime = 3.0;

    const { canvasContext, hook } = setupRenderFrameHarness({
      mediaItems: [videoItem],
      mediaElements: {
        [videoItem.id]: videoElement as unknown as HTMLVideoElement,
      } as MediaElementsRef,
      totalDuration: 4,
      platformCapabilities: { isAndroid: false },
    });

    // drawImage 呼び出し時点での globalAlpha をキャプチャする
    let alphaAtDraw: number | undefined;
    (canvasContext.drawImage as ReturnType<typeof vi.fn>).mockImplementation(() => {
      alphaAtDraw = canvasContext.globalAlpha as number;
    });

    const didUpdateCanvas = hook.result.current.renderFrame(3.0, true, false);

    expect(canvasContext.drawImage).toHaveBeenCalledWith(
      videoElement,
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
    );
    expect(didUpdateCanvas).toBe(true);
    expect(alphaAtDraw).toBeCloseTo(0.5);
  });

  it('video fadeIn 中は drawImage をスキップせず globalAlpha で滑らかにフェードする', () => {
    // 回帰テスト: fadeIn の先頭でも drawImage が必ず呼ばれ、0→1 の alpha で描画されることを確認する。
    // fadeInDuration=2s, duration=4s, localTime=1.0s → fadeIn 半分地点、alpha=0.5
    const videoItem = createVideoItem({
      id: 'video-fadein',
      duration: 4,
      originalDuration: 4,
      trimStart: 0,
      trimEnd: 4,
      fadeIn: true,
      fadeInDuration: 2,
    });
    const videoElement = createMockVideoElement();
    videoElement.readyState = 2;
    videoElement.seeking = false;
    videoElement.paused = false;
    videoElement.currentTime = 1.0;

    const { canvasContext, hook } = setupRenderFrameHarness({
      mediaItems: [videoItem],
      mediaElements: {
        [videoItem.id]: videoElement as unknown as HTMLVideoElement,
      } as MediaElementsRef,
      totalDuration: 4,
      platformCapabilities: { isAndroid: false },
    });

    let alphaAtDraw: number | undefined;
    (canvasContext.drawImage as ReturnType<typeof vi.fn>).mockImplementation(() => {
      alphaAtDraw = canvasContext.globalAlpha as number;
    });

    const didUpdateCanvas = hook.result.current.renderFrame(1.0, true, false);

    expect(canvasContext.drawImage).toHaveBeenCalledWith(
      videoElement,
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
    );
    expect(didUpdateCanvas).toBe(true);
    expect(alphaAtDraw).toBeCloseTo(0.5);
  });

  it('video fadeOut 描画前にキャンバスを黒で fillRect クリアして残像を防ぐ', () => {
    // 回帰テスト: フェード時に前フレームの video が残っていると alpha=0.5 で重ね描き
    // しても 0.5*new + 0.5*old = 旧フレームと同色のため「フェードしているように見えない」。
    // drawImage の直前に fillRect(black, alpha=1) でキャンバスを必ずクリアすることを検証。
    const videoItem = createVideoItem({
      id: 'video-fade',
      duration: 4,
      originalDuration: 4,
      trimStart: 0,
      trimEnd: 4,
      fadeOut: true,
      fadeOutDuration: 2,
    });
    const videoElement = createMockVideoElement();
    videoElement.readyState = 2;
    videoElement.seeking = false;
    videoElement.paused = false;
    videoElement.currentTime = 3.0;

    const { canvasContext, hook } = setupRenderFrameHarness({
      mediaItems: [videoItem],
      mediaElements: {
        [videoItem.id]: videoElement as unknown as HTMLVideoElement,
      } as MediaElementsRef,
      totalDuration: 4,
      platformCapabilities: { isAndroid: false },
    });

    const callOrder: Array<{ name: 'fillRect' | 'drawImage'; alpha: number }> = [];
    (canvasContext.fillRect as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callOrder.push({ name: 'fillRect', alpha: canvasContext.globalAlpha as number });
    });
    (canvasContext.drawImage as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callOrder.push({ name: 'drawImage', alpha: canvasContext.globalAlpha as number });
    });

    hook.result.current.renderFrame(3.0, true, false);

    const firstFill = callOrder.find((c) => c.name === 'fillRect');
    const firstDraw = callOrder.find((c) => c.name === 'drawImage');
    expect(firstFill).toBeDefined();
    expect(firstDraw).toBeDefined();
    // fillRect が drawImage よりも前に呼ばれていること
    expect(callOrder.indexOf(firstFill!)).toBeLessThan(callOrder.indexOf(firstDraw!));
    // 黒塗り時は globalAlpha=1.0 であること
    expect(firstFill!.alpha).toBeCloseTo(1.0);
    // drawImage 時は fadeOut alpha=0.5 であること
    expect(firstDraw!.alpha).toBeCloseTo(0.5);
  });

  it('video fadeIn 描画前にキャンバスを黒で fillRect クリアして残像を防ぐ', () => {
    // 回帰テスト: fadeIn でも fadeOut と同様に毎フレーム黒クリアが必要。
    const videoItem = createVideoItem({
      id: 'video-fadein',
      duration: 4,
      originalDuration: 4,
      trimStart: 0,
      trimEnd: 4,
      fadeIn: true,
      fadeInDuration: 2,
    });
    const videoElement = createMockVideoElement();
    videoElement.readyState = 2;
    videoElement.seeking = false;
    videoElement.paused = false;
    videoElement.currentTime = 1.0;

    const { canvasContext, hook } = setupRenderFrameHarness({
      mediaItems: [videoItem],
      mediaElements: {
        [videoItem.id]: videoElement as unknown as HTMLVideoElement,
      } as MediaElementsRef,
      totalDuration: 4,
      platformCapabilities: { isAndroid: false },
    });

    const callOrder: Array<{ name: 'fillRect' | 'drawImage'; alpha: number }> = [];
    (canvasContext.fillRect as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callOrder.push({ name: 'fillRect', alpha: canvasContext.globalAlpha as number });
    });
    (canvasContext.drawImage as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callOrder.push({ name: 'drawImage', alpha: canvasContext.globalAlpha as number });
    });

    hook.result.current.renderFrame(1.0, true, false);

    const firstFill = callOrder.find((c) => c.name === 'fillRect');
    const firstDraw = callOrder.find((c) => c.name === 'drawImage');
    expect(firstFill).toBeDefined();
    expect(firstDraw).toBeDefined();
    expect(callOrder.indexOf(firstFill!)).toBeLessThan(callOrder.indexOf(firstDraw!));
    expect(firstFill!.alpha).toBeCloseTo(1.0);
    expect(firstDraw!.alpha).toBeCloseTo(0.5);
  });

  it('タイムライン末尾 (last 30ms) でも fadeOut alpha を反映して描画する', () => {
    // 回帰テスト: isTimelineEnd 内の freezeFrame ロジックが fadeOut alpha を無視して
    // alpha=1.0 で video を上書き描画していると、最後の数十 ms で video が一瞬全強度に戻り
    // 「フェードアウトが効いていない」見え方になる。
    // duration=4s, fadeOutDuration=2s, totalDuration=4s, time=3.99s → fadeOut 末尾
    //   localTime=3.99 → alpha=(4 - 3.99)/2=0.005 になるはず。
    const videoItem = createVideoItem({
      id: 'video-fade-tail',
      duration: 4,
      originalDuration: 4,
      trimStart: 0,
      trimEnd: 4,
      fadeOut: true,
      fadeOutDuration: 2,
    });
    const videoElement = createMockVideoElement();
    videoElement.readyState = 4;
    videoElement.seeking = false;
    videoElement.paused = false;
    videoElement.currentTime = 3.99;
    videoElement.duration = 4;
    videoElement.ended = false;

    const { canvasContext, hook } = setupRenderFrameHarness({
      mediaItems: [videoItem],
      mediaElements: {
        [videoItem.id]: videoElement as unknown as HTMLVideoElement,
      } as MediaElementsRef,
      totalDuration: 4,
      platformCapabilities: { isAndroid: false },
    });

    const drawAlphas: number[] = [];
    (canvasContext.drawImage as ReturnType<typeof vi.fn>).mockImplementation(() => {
      drawAlphas.push(canvasContext.globalAlpha as number);
    });

    hook.result.current.renderFrame(3.99, true, false);

    expect(drawAlphas.length).toBeGreaterThan(0);
    // alpha=1.0 で描画されていたら freezeFrame が fade を無視していることになる
    expect(drawAlphas.every((a) => a < 0.5)).toBe(true);
    // 期待値: (4 - 3.99) / 2 = 0.005
    expect(Math.min(...drawAlphas)).toBeLessThan(0.05);
  });

  it('Android プレビュー再生中の fadeOut でも canvas を黒クリアする (shouldSuppressEndClear バイパス)', () => {
    // 回帰テスト (0df405e 退行): shouldSuppressEndClear が Android playback 中
    // 常に endClear を抑止していたため、fadeOut でも前フレームが残留し
    // result = 0.5*V + 0.5*previousV = V となって fade が見えなくなっていた。
    // fade 中は suppress を解除し、毎フレーム黒クリアされることを検証する。
    const videoItem = createVideoItem({
      id: 'video-fade-android',
      duration: 4,
      originalDuration: 4,
      trimStart: 0,
      trimEnd: 4,
      fadeOut: true,
      fadeOutDuration: 2,
    });
    const videoElement = createMockVideoElement();
    videoElement.readyState = 4;
    videoElement.seeking = false;
    videoElement.paused = false;
    videoElement.currentTime = 3.0;
    videoElement.duration = 4;

    const { canvasContext, hook } = setupRenderFrameHarness({
      mediaItems: [videoItem],
      mediaElements: {
        [videoItem.id]: videoElement as unknown as HTMLVideoElement,
      } as MediaElementsRef,
      totalDuration: 4,
      platformCapabilities: { isAndroid: true, isIosSafari: false },
    });

    const order: Array<'fillRect' | 'drawImage'> = [];
    (canvasContext.fillRect as ReturnType<typeof vi.fn>).mockImplementation(() => {
      order.push('fillRect');
    });
    (canvasContext.drawImage as ReturnType<typeof vi.fn>).mockImplementation(() => {
      order.push('drawImage');
    });

    hook.result.current.renderFrame(3.0, true, false);

    // fadeOut 中なので fillRect (黒クリア) が drawImage より前に必ず呼ばれること
    const firstFill = order.indexOf('fillRect');
    const firstDraw = order.indexOf('drawImage');
    expect(firstFill).toBeGreaterThanOrEqual(0);
    expect(firstDraw).toBeGreaterThanOrEqual(0);
    expect(firstFill).toBeLessThan(firstDraw);
  });

  it('Android プレビュー再生中の fadeIn でも canvas を黒クリアする', () => {
    const videoItem = createVideoItem({
      id: 'video-fadein-android',
      duration: 4,
      originalDuration: 4,
      trimStart: 0,
      trimEnd: 4,
      fadeIn: true,
      fadeInDuration: 2,
    });
    const videoElement = createMockVideoElement();
    videoElement.readyState = 4;
    videoElement.seeking = false;
    videoElement.paused = false;
    videoElement.currentTime = 1.0;
    videoElement.duration = 4;

    const { canvasContext, hook } = setupRenderFrameHarness({
      mediaItems: [videoItem],
      mediaElements: {
        [videoItem.id]: videoElement as unknown as HTMLVideoElement,
      } as MediaElementsRef,
      totalDuration: 4,
      platformCapabilities: { isAndroid: true, isIosSafari: false },
    });

    const order: Array<'fillRect' | 'drawImage'> = [];
    (canvasContext.fillRect as ReturnType<typeof vi.fn>).mockImplementation(() => {
      order.push('fillRect');
    });
    (canvasContext.drawImage as ReturnType<typeof vi.fn>).mockImplementation(() => {
      order.push('drawImage');
    });

    hook.result.current.renderFrame(1.0, true, false);

    const firstFill = order.indexOf('fillRect');
    const firstDraw = order.indexOf('drawImage');
    expect(firstFill).toBeGreaterThanOrEqual(0);
    expect(firstDraw).toBeGreaterThanOrEqual(0);
    expect(firstFill).toBeLessThan(firstDraw);
  });

  it('Android プレビュー再生中の image fadeOut でも canvas を黒クリアする (型制約バグ修正)', () => {
    // 回帰テスト: isInFadeRegion が type === 'video' を要求しているため、
    // 画像クリップで shouldSuppressEndClear が解除されず fade が見えない問題を防ぐ。
    const imageItem = createImageItem({
      id: 'image-fade-android',
      duration: 4,
      originalDuration: 4,
      fadeOut: true,
      fadeOutDuration: 2,
    });
    const imageEl = {
      tagName: 'IMG',
      complete: true,
      naturalWidth: 1920,
      naturalHeight: 1080,
    } as unknown as HTMLImageElement;

    const { canvasContext, hook } = setupRenderFrameHarness({
      mediaItems: [imageItem],
      mediaElements: {
        [imageItem.id]: imageEl as unknown as HTMLImageElement,
      } as MediaElementsRef,
      totalDuration: 4,
      platformCapabilities: { isAndroid: true, isIosSafari: false },
    });

    const order: Array<'fillRect' | 'drawImage'> = [];
    (canvasContext.fillRect as ReturnType<typeof vi.fn>).mockImplementation(() => {
      order.push('fillRect');
    });
    (canvasContext.drawImage as ReturnType<typeof vi.fn>).mockImplementation(() => {
      order.push('drawImage');
    });

    hook.result.current.renderFrame(3.0, true, false);

    const firstFill = order.indexOf('fillRect');
    const firstDraw = order.indexOf('drawImage');
    expect(firstFill).toBeGreaterThanOrEqual(0);
    expect(firstDraw).toBeGreaterThanOrEqual(0);
    expect(firstFill).toBeLessThan(firstDraw);
  });

  it('Android プレビュー再生中で fade 外の通常区間では endClear が依然 suppress される (退行防止)', () => {
    // fade 中だけ suppress を解除する設計を担保する。fade 外では従来通り
    // Android クリップ境界のチラつき対策として endClear が suppress されること。
    const videoItem = createVideoItem({
      id: 'video-no-fade-android',
      duration: 4,
      originalDuration: 4,
      trimStart: 0,
      trimEnd: 4,
      fadeIn: false,
      fadeOut: false,
    });
    const videoElement = createMockVideoElement();
    videoElement.readyState = 4;
    videoElement.seeking = false;
    videoElement.paused = false;
    videoElement.currentTime = 2.0;
    videoElement.duration = 4;

    const { canvasContext, hook, logInfo } = setupRenderFrameHarness({
      mediaItems: [videoItem],
      mediaElements: {
        [videoItem.id]: videoElement as unknown as HTMLVideoElement,
      } as MediaElementsRef,
      totalDuration: 4,
      platformCapabilities: { isAndroid: true, isIosSafari: false },
    });

    // fade 外の中盤 (localTime=2.0, fadeIn/Out 共に false)
    hook.result.current.renderFrame(2.0, true, false);

    const suppressed = logInfo.mock.calls.some(([, msg]) => msg === 'preview.endClear.suppressed');
    expect(suppressed).toBe(true);
    // suppress されているので fillRect は呼ばれていないはず
    expect((canvasContext.fillRect as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('複数クリップで 2 番目クリップの fadeIn が描画される', () => {
    // 回帰テスト: clip1(no fade, 4s) -> clip2(fadeIn=1s, 4s)
    // 時刻 4.5s (clip2 の localTime=0.5) で alpha=0.5 になることを確認。
    const clip1 = createVideoItem({
      id: 'video-1',
      duration: 4,
      originalDuration: 4,
      trimStart: 0,
      trimEnd: 4,
    });
    const clip2 = createVideoItem({
      id: 'video-2',
      duration: 4,
      originalDuration: 4,
      trimStart: 0,
      trimEnd: 4,
      fadeIn: true,
      fadeInDuration: 1,
    });

    const el1 = createMockVideoElement();
    el1.readyState = 4;
    el1.seeking = false;
    el1.paused = true;
    el1.currentTime = 4.0;

    const el2 = createMockVideoElement();
    el2.readyState = 4;
    el2.seeking = false;
    el2.paused = false;
    el2.currentTime = 0.5;
    el2.duration = 4;

    const { canvasContext, hook } = setupRenderFrameHarness({
      mediaItems: [clip1, clip2],
      mediaElements: {
        [clip1.id]: el1 as unknown as HTMLVideoElement,
        [clip2.id]: el2 as unknown as HTMLVideoElement,
      } as MediaElementsRef,
      totalDuration: 8,
      platformCapabilities: { isAndroid: false },
    });

    const drawCalls: Array<{ source: unknown; alpha: number }> = [];
    (canvasContext.drawImage as ReturnType<typeof vi.fn>).mockImplementation((src) => {
      drawCalls.push({ source: src, alpha: canvasContext.globalAlpha as number });
    });

    hook.result.current.renderFrame(4.5, true, false);

    // clip2 が alpha=0.5 で描画されていること
    const clip2Draws = drawCalls.filter((d) => d.source === el2);
    expect(clip2Draws.length).toBeGreaterThan(0);
    expect(clip2Draws[0].alpha).toBeCloseTo(0.5);
  });

  it('タイムライン末尾でも fadeIn alpha を反映して描画する', () => {
    // 回帰テスト: 短いクリップ(1s)で fadeIn=1s だと fadeIn region が duration いっぱいに広がる。
    // duration=1s, fadeIn=true, fadeInDuration=1s, time=0.99s
    //   localTime=0.99 → alpha=0.99/1.0=0.99 (まだ fadeIn 中)
    // ただし isTimelineEnd の freezeFrame が alpha=1.0 で上書きすると 0.99 ではなく 1.0 になる。
    const videoItem = createVideoItem({
      id: 'video-fade-in-tail',
      duration: 1,
      originalDuration: 1,
      trimStart: 0,
      trimEnd: 1,
      fadeIn: true,
      fadeInDuration: 1,
    });
    const videoElement = createMockVideoElement();
    videoElement.readyState = 4;
    videoElement.seeking = false;
    videoElement.paused = false;
    videoElement.currentTime = 0.99;
    videoElement.duration = 1;
    videoElement.ended = false;

    const { canvasContext, hook } = setupRenderFrameHarness({
      mediaItems: [videoItem],
      mediaElements: {
        [videoItem.id]: videoElement as unknown as HTMLVideoElement,
      } as MediaElementsRef,
      totalDuration: 1,
      platformCapabilities: { isAndroid: false },
    });

    const drawAlphas: number[] = [];
    (canvasContext.drawImage as ReturnType<typeof vi.fn>).mockImplementation(() => {
      drawAlphas.push(canvasContext.globalAlpha as number);
    });

    hook.result.current.renderFrame(0.99, true, false);

    expect(drawAlphas.length).toBeGreaterThan(0);
    // 期待値 ~0.99 (1.0 で描画されたら freezeFrame が fade を無視している)
    expect(Math.max(...drawAlphas)).toBeLessThan(1.0);
    expect(Math.max(...drawAlphas)).toBeCloseTo(0.99, 2);
  });

  it('export モードでは Android preview 境界診断が出ない', () => {
    vi.useFakeTimers();
    const video1 = createVideoItem({ id: 'v1', duration: 5, trimStart: 0, trimEnd: 5 });
    const video2 = createVideoItem({ id: 'v2', duration: 5, trimStart: 1, trimEnd: 6 });
    const el1 = createMockVideoElement();
    el1.readyState = 4;
    const el2 = createMockVideoElement();
    el2.readyState = 4;
    el2.currentTime = 1;

    const nowRef = { current: 1000 };
    vi.spyOn(playbackClock, 'getStandardPreviewNow').mockImplementation(() => nowRef.current);

    const { hook, logInfo } = setupRenderFrameHarness({
      mediaItems: [video1, video2],
      mediaElements: {
        v1: el1 as unknown as HTMLVideoElement,
        v2: el2 as unknown as HTMLVideoElement,
      } as MediaElementsRef,
      currentTime: 2.0,
      totalDuration: 10,
    });

    nowRef.current = 1000;
    hook.result.current.loop(true, 1); // isExportMode = true
    nowRef.current = 6000;
    hook.result.current.loop(true, 1);
    nowRef.current = 6400;
    hook.result.current.loop(true, 1);

    expect(logInfo.mock.calls.some(([, msg]) => msg === 'preview.boundary.smoothPlan')).toBe(false);
    expect(logInfo.mock.calls.some(([, msg]) => msg === 'preview.boundary.judgement')).toBe(false);
    expect(logInfo.mock.calls.some(([, msg]) => msg === 'preview.nextVideo.startLatency')).toBe(false);
    expect(logInfo.mock.calls.some(([, msg]) => msg === 'preview.android.boundary.passive-switch')).toBe(false);
  });

});
