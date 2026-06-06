import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MutableRefObject } from 'react';

import { usePreviewEngine } from '../flavors/apple-safari/preview/usePreviewEngine';
import {
  appleSafariPreviewRuntime,
  getAppleSafariPreviewPlatformCapabilities,
} from '../flavors/apple-safari/appleSafariPreviewRuntime';
import type {
  AudioTrack,
  Caption,
  CaptionSettings,
  MediaElementsRef,
  MediaItem,
  NarrationClip,
} from '../types';
import type { PlatformCapabilities } from '../utils/platform';

function createCapabilities(
  overrides: Partial<PlatformCapabilities> = {},
): PlatformCapabilities {
  return {
    userAgent: 'test-agent',
    platform: 'test-platform',
    maxTouchPoints: 1,
    isAndroid: false,
    isIOS: true,
    isSafari: true,
    isIosSafari: true,
    supportsShowSaveFilePicker: false,
    supportsShowOpenFilePicker: false,
    supportsTrackProcessor: false,
    supportsMp4MediaRecorder: true,
    audioContextMayInterrupt: true,
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
    url: overrides.url ?? `blob:${overrides.id ?? 'video-1'}`,
    volume: overrides.volume ?? 1,
    isMuted: overrides.isMuted ?? false,
    fadeIn: overrides.fadeIn ?? false,
    fadeOut: overrides.fadeOut ?? false,
    fadeInDuration: overrides.fadeInDuration ?? 1,
    fadeOutDuration: overrides.fadeOutDuration ?? 1,
    duration: overrides.duration ?? 2,
    originalDuration: overrides.originalDuration ?? (overrides.duration ?? 2),
    trimStart: overrides.trimStart ?? 0,
    trimEnd: overrides.trimEnd ?? (overrides.duration ?? 2),
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
    url: overrides.url ?? `blob:${overrides.id ?? 'image-1'}`,
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

function createMockVideoElement() {
  const listeners = new Map<string, Set<EventListener>>();

  const element = {
    tagName: 'VIDEO' as const,
    readyState: 0,
    seeking: false,
    paused: true,
    currentTime: 0,
    duration: 2,
    ended: false,
    error: null,
    videoWidth: 1280,
    videoHeight: 720,
    defaultMuted: false,
    muted: false,
    preload: 'metadata',
    playsInline: true,
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
    listenerCount(type: string) {
      return listeners.get(type)?.size ?? 0;
    },
    dispatch(type: string) {
      const event = new Event(type);
      for (const listener of listeners.get(type) ?? []) {
        listener(event);
      }
    },
  };

  return element;
}

function createMockAudioContext() {
  return {
    state: 'running' as AudioContextState,
    currentTime: 0,
    destination: {} as AudioDestinationNode,
    onstatechange: null as null | (() => void),
    resume: vi.fn(() => Promise.resolve()),
    suspend: vi.fn(() => Promise.resolve()),
  } as unknown as AudioContext;
}

function createMockCanvasContext() {
  return {
    canvas: { width: 1280, height: 720 },
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

describe('apple-safari preview engine boundary kick', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function setupRenderFrameHarness(options: {
    mediaItems: MediaItem[];
    mediaElements: MediaElementsRef;
    activeVideoIdRef?: MutableRefObject<string | null>;
    isPlayingRef?: MutableRefObject<boolean>;
    isSeekingRef?: MutableRefObject<boolean>;
    getAudioContext?: () => AudioContext;
  }) {
    const canvasContext = createMockCanvasContext();
    const logInfo = vi.fn();
    const logWarn = vi.fn();
    const play = vi.fn();
    const pause = vi.fn();
    const platformCapabilities = getAppleSafariPreviewPlatformCapabilities(createCapabilities());
    const previewPlatformPolicy = appleSafariPreviewRuntime.getPreviewPlatformPolicy(
      platformCapabilities,
    );
    const totalDuration = options.mediaItems.reduce((sum, item) => sum + item.duration, 0);
    const activeVideoIdRef = options.activeVideoIdRef ?? createRef<string | null>(null);
    const isPlayingRef = options.isPlayingRef ?? createRef(true);
    const isSeekingRef = options.isSeekingRef ?? createRef(false);

    const hook = renderHook(() =>
      usePreviewEngine({
        captions: [] as Caption[],
        captionSettings: { enabled: false } as unknown as CaptionSettings,
        mediaItemsRef: createRef(options.mediaItems),
        bgmRef: createRef<AudioTrack | null>(null),
        narrationsRef: createRef<NarrationClip[]>([]),
        captionsRef: createRef<Caption[]>([]),
        captionSettingsRef: createRef({ enabled: false } as unknown as CaptionSettings),
        totalDurationRef: createRef(totalDuration),
        currentTimeRef: createRef(0),
        canvasRef: createRef({
          getContext: vi.fn(() => canvasContext),
        } as unknown as HTMLCanvasElement),
        mediaElementsRef: createRef(options.mediaElements),
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
        isPlayingRef,
        isSeekingRef,
        isSeekPlaybackPreparingRef: createRef(false),
        activeVideoIdRef,
        videoRecoveryAttemptsRef: createRef({}),
        exportPlayFailedRef: createRef({}),
        exportFallbackSeekAtRef: createRef({}),
        seekingVideosRef: createRef(new Set<string>()),
        pendingSeekRef: createRef<number | null>(null),
        wasPlayingBeforeSeekRef: createRef(false),
        pendingSeekTimeoutRef: createRef<ReturnType<typeof setTimeout> | null>(null),
        previewPlaybackAttemptRef: createRef(1),
        requestPreviewAudioRouteRefreshRef: createRef(() => { }),
        primePreviewAudioOnlyTracksAtTimeRef: createRef(() => { }),
        endFinalizedRef: createRef(false),
        previewPlatformPolicy,
        platformCapabilities,
        setVideoDuration: vi.fn(),
        setCurrentTime: vi.fn(),
        setProcessing: vi.fn(),
        setLoading: vi.fn(),
        setExportPreparationStep: vi.fn(),
        setExportUrl: vi.fn(),
        setExportExt: vi.fn(),
        clearExport: vi.fn(),
        setError: vi.fn(),
        play,
        pause,
        getAudioContext: options.getAudioContext ?? vi.fn(),
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

    return { canvasContext, hook, logInfo, logWarn, activeVideoIdRef, play, pause };
  }

  it('動画→動画境界で 2 本目の active video に対し 1 度だけ境界キックを掛ける', () => {
    const video1 = createVideoItem({ id: 'v1', duration: 2 });
    const video2 = createVideoItem({ id: 'v2', duration: 2 });
    const video1El = createMockVideoElement();
    const video2El = createMockVideoElement();
    // v1 は active 再生中の状態。v2 は paused / メタデータ未到達のまま放置されたケースを模す。
    video1El.readyState = 4;
    video1El.paused = false;
    video2El.readyState = 1;
    video2El.paused = true;
    video2El.currentTime = 0;

    const activeVideoIdRef = createRef<string | null>('v1');

    const { hook, logInfo } = setupRenderFrameHarness({
      mediaItems: [video1, video2],
      mediaElements: {
        [video1.id]: video1El as unknown as HTMLVideoElement,
        [video2.id]: video2El as unknown as HTMLVideoElement,
      } as MediaElementsRef,
      activeVideoIdRef,
    });

    // v2 区間 (時刻=2.05s) を描画。activeVideoIdRef が v1→v2 へ切替わるフレーム。
    hook.result.current.renderFrame(2.05, true, false);

    expect(activeVideoIdRef.current).toBe('v2');
    expect(video2El.listenerCount('loadedmetadata')).toBe(1);
    expect(video2El.listenerCount('loadeddata')).toBe(1);
    expect(video2El.listenerCount('canplay')).toBe(1);
    expect(video2El.listenerCount('seeked')).toBe(1);
    expect(
      logInfo.mock.calls.some(([, message]) => message === 'iOS Safari preview video 境界キック'),
    ).toBe(true);

    // 続けて同じフレームを再描画しても境界キックは再発火しない (1回限り)。
    const before = video2El.listenerCount('canplay');
    hook.result.current.renderFrame(2.06, true, false);
    expect(video2El.listenerCount('canplay')).toBe(before);
  });

  it('動画→画像→動画境界でも 3 本目の active video へ境界キックを掛ける', () => {
    const video1 = createVideoItem({ id: 'v1', duration: 2 });
    const imageGap = createImageItem({ id: 'img', duration: 1 });
    const video2 = createVideoItem({ id: 'v2', duration: 2 });
    const video1El = createMockVideoElement();
    const video2El = createMockVideoElement();
    video1El.readyState = 4;
    video2El.readyState = 1;
    video2El.paused = true;

    // image 区間中は activeVideoIdRef が null になっている前提から開始する。
    const activeVideoIdRef = createRef<string | null>(null);

    const { hook, logInfo } = setupRenderFrameHarness({
      mediaItems: [video1, imageGap, video2],
      mediaElements: {
        [video1.id]: video1El as unknown as HTMLVideoElement,
        [video2.id]: video2El as unknown as HTMLVideoElement,
      } as MediaElementsRef,
      activeVideoIdRef,
    });

    // v2 区間 (時刻=3.05s) を描画。null → v2 への切替で境界キックが掛かる。
    hook.result.current.renderFrame(3.05, true, false);

    expect(activeVideoIdRef.current).toBe('v2');
    expect(video2El.listenerCount('canplay')).toBe(1);
    expect(video2El.listenerCount('seeked')).toBe(1);
    expect(
      logInfo.mock.calls.some(([, message]) => message === 'iOS Safari preview video 境界キック'),
    ).toBe(true);
  });

  it('画像区間中の次動画は silent play せず paused のまま current frame を先読みする', () => {
    const video1 = createVideoItem({ id: 'v1', duration: 2 });
    const imageGap = createImageItem({ id: 'img', duration: 1 });
    const video2 = createVideoItem({ id: 'v2', duration: 2 });
    const video1El = createMockVideoElement();
    const video2El = createMockVideoElement();
    video1El.readyState = 4;
    video2El.readyState = 1;
    video2El.paused = true;
    video2El.currentTime = 0;

    const { hook } = setupRenderFrameHarness({
      mediaItems: [video1, imageGap, video2],
      mediaElements: {
        [video1.id]: video1El as unknown as HTMLVideoElement,
        [video2.id]: video2El as unknown as HTMLVideoElement,
      } as MediaElementsRef,
      activeVideoIdRef: createRef<string | null>(null),
    });

    // image 区間終盤で next video が HAVE_METADATA 止まりの場合、play() は使わず
    // trimStart 直後へ小さく seek して current frame の取得だけを促す。
    hook.result.current.renderFrame(2.75, true, false);

    expect(video2El.play).not.toHaveBeenCalled();
    expect(video2El.currentTime).toBeGreaterThan(0);
    expect(video2El.currentTime).toBeLessThan(0.01);
  });

  it('preview startEngine は future video に gesture credit (play→pause) を付与する', async () => {
    const rafSpy = vi
      .spyOn(globalThis, 'requestAnimationFrame')
      .mockImplementation(() => 1 as unknown as number);
    vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => { });

    try {
      const video1 = createVideoItem({ id: 'v1', duration: 2 });
      const imageGap = createImageItem({ id: 'img', duration: 1 });
      const video2 = createVideoItem({ id: 'v2', duration: 2 });
      const video1El = createMockVideoElement();
      const video2El = createMockVideoElement();
      // メタデータ済み (readyState=2) で待機を発生させない。
      video1El.readyState = 2;
      video1El.duration = 2;
      video2El.readyState = 2;
      video2El.duration = 2;

      // gesture credit は play() 呼び出し時点の native volume / muted で決まる
      // (renderFrame が後段で音量を正規化するため、呼び出し時点の値を捕捉する)。
      const creditPlayVolumes: number[] = [];
      const creditPlayMuted: boolean[] = [];
      video2El.play.mockImplementation(() => {
        creditPlayVolumes.push(video2El.volume);
        creditPlayMuted.push(video2El.muted);
        video2El.paused = false;
        return Promise.resolve();
      });

      const { hook, play } = setupRenderFrameHarness({
        mediaItems: [video1, imageGap, video2],
        mediaElements: {
          [video1.id]: video1El as unknown as HTMLVideoElement,
          [video2.id]: video2El as unknown as HTMLVideoElement,
        } as MediaElementsRef,
        activeVideoIdRef: createRef<string | null>(null),
        getAudioContext: () => createMockAudioContext(),
      });

      const startPromise = hook.result.current.startEngine(0, false);
      // startEngine 内の各 await / setTimeout(50ms) を消化する。
      await vi.advanceTimersByTimeAsync(100);
      await startPromise;

      // future video (v2) は gesture 内で credit 用に play() される。
      expect(video2El.play).toHaveBeenCalled();
      // credit 取得後は持続再生せず pause() で戻す (v5.1.14 freeze を再現させない)。
      expect(video2El.pause).toHaveBeenCalled();
      expect(video2El.paused).toBe(true);
      // credit 用の play() は可聴域以下 (0.001) かつ unmuted で呼ばれている
      // (volume=0 / muted=true だと unmuted credit が付かない)。
      expect(creditPlayVolumes.some((v) => Math.abs(v - 0.001) < 0.0005)).toBe(true);
      expect(creditPlayMuted.every((m) => m === false)).toBe(true);
      // engine 全体の再生も開始している。
      expect(play).toHaveBeenCalled();
    } finally {
      rafSpy.mockRestore();
    }
  });

  it('境界キックの canplay リスナー発火で 2 本目の動画を play() する', () => {
    const video1 = createVideoItem({ id: 'v1', duration: 2 });
    const video2 = createVideoItem({ id: 'v2', duration: 2 });
    const video1El = createMockVideoElement();
    const video2El = createMockVideoElement();
    video1El.readyState = 4;
    // v2 はメタデータすら無い状態 (readyState=0) で境界に到達する想定。
    video2El.readyState = 0;
    video2El.paused = true;

    const activeVideoIdRef = createRef<string | null>('v1');

    const { hook } = setupRenderFrameHarness({
      mediaItems: [video1, video2],
      mediaElements: {
        [video1.id]: video1El as unknown as HTMLVideoElement,
        [video2.id]: video2El as unknown as HTMLVideoElement,
      } as MediaElementsRef,
      activeVideoIdRef,
    });

    hook.result.current.renderFrame(2.05, true, false);

    // readyState=0 のため synchronous play() は走らない (load 戦略に委ねる)。
    expect(video2El.play).not.toHaveBeenCalled();

    // 後で canplay が届くと、境界キックで仕掛けた1回限りのリスナーが play() を呼ぶ。
    video2El.readyState = 4;
    video2El.dispatch('canplay');

    expect(video2El.play).toHaveBeenCalled();
  });

  it('エクスポート中は境界キックを掛けない', () => {
    const video1 = createVideoItem({ id: 'v1', duration: 2 });
    const video2 = createVideoItem({ id: 'v2', duration: 2 });
    const video1El = createMockVideoElement();
    const video2El = createMockVideoElement();
    video1El.readyState = 4;
    video2El.readyState = 1;

    const activeVideoIdRef = createRef<string | null>('v1');

    const { hook, logInfo } = setupRenderFrameHarness({
      mediaItems: [video1, video2],
      mediaElements: {
        [video1.id]: video1El as unknown as HTMLVideoElement,
        [video2.id]: video2El as unknown as HTMLVideoElement,
      } as MediaElementsRef,
      activeVideoIdRef,
    });

    // isExporting=true で renderFrame を呼ぶ。
    hook.result.current.renderFrame(2.05, true, true);

    expect(video2El.listenerCount('canplay')).toBe(0);
    expect(video2El.listenerCount('seeked')).toBe(0);
    expect(
      logInfo.mock.calls.some(([, message]) => message === 'iOS Safari preview video 境界キック'),
    ).toBe(false);
  });

  it('ユーザーシーク中は境界キックを掛けない', () => {
    const video1 = createVideoItem({ id: 'v1', duration: 2 });
    const video2 = createVideoItem({ id: 'v2', duration: 2 });
    const video1El = createMockVideoElement();
    const video2El = createMockVideoElement();
    video1El.readyState = 4;
    video2El.readyState = 1;

    const activeVideoIdRef = createRef<string | null>('v1');
    const isSeekingRef = createRef(true);

    const { hook, logInfo } = setupRenderFrameHarness({
      mediaItems: [video1, video2],
      mediaElements: {
        [video1.id]: video1El as unknown as HTMLVideoElement,
        [video2.id]: video2El as unknown as HTMLVideoElement,
      } as MediaElementsRef,
      activeVideoIdRef,
      isSeekingRef,
    });

    hook.result.current.renderFrame(2.05, true, false);

    expect(video2El.listenerCount('canplay')).toBe(0);
    expect(
      logInfo.mock.calls.some(([, message]) => message === 'iOS Safari preview video 境界キック'),
    ).toBe(false);
  });

  it('prewarm 済みで既に再生中の動画には境界キックを掛けない (currentTime も触らない)', () => {
    const video1 = createVideoItem({ id: 'v1', duration: 2 });
    const video2 = createVideoItem({ id: 'v2', duration: 2 });
    const video1El = createMockVideoElement();
    const video2El = createMockVideoElement();
    video1El.readyState = 4;
    video1El.paused = false;
    // v2 は無音 prewarm で既に paused=false / readyState=4 / currentTime が trimStart より先へ進んだ状態。
    // BGM 経路で active 化前に silent-play されたケースを模す。
    video2El.readyState = 4;
    video2El.paused = false;
    video2El.currentTime = 0.35;

    const activeVideoIdRef = createRef<string | null>('v1');

    const { hook, logInfo } = setupRenderFrameHarness({
      mediaItems: [video1, video2],
      mediaElements: {
        [video1.id]: video1El as unknown as HTMLVideoElement,
        [video2.id]: video2El as unknown as HTMLVideoElement,
      } as MediaElementsRef,
      activeVideoIdRef,
    });

    hook.result.current.renderFrame(2.05, true, false);

    // 既に再生中なので追加の play() は呼ばない、currentTime も上書きしない、
    // リスナーも仕掛けない。currentTime の上書きは iOS Safari で seeking=true のまま
    // 戻らず、音だけ鳴って映像が固まる退行を引き起こすため避ける。
    expect(video2El.play).not.toHaveBeenCalled();
    expect(video2El.currentTime).toBeCloseTo(0.35);
    expect(video2El.listenerCount('canplay')).toBe(0);
    expect(video2El.listenerCount('seeked')).toBe(0);
    expect(
      logInfo.mock.calls.some(([, message]) => message === 'iOS Safari preview video 境界キック'),
    ).toBe(false);
  });

  it('export 中の stopAll は MediaRecorder に対し requestData() を呼んでから 180ms 遅延で stop() する', () => {
    const video1 = createVideoItem({ id: 'v1', duration: 2 });
    const video1El = createMockVideoElement();
    video1El.readyState = 4;
    video1El.paused = false;

    // MediaRecorder のモック。iOS Safari は recorder.stop() の前に requestData() で
    // バッファをフラッシュしないと onstop が発火しないため、stopAll() が
    // 「requestData() → 180ms 遅延 → stop()」を実行することを確認する。
    const recorderMock = {
      state: 'recording' as RecordingState,
      requestData: vi.fn(),
      stop: vi.fn(() => {
        recorderMock.state = 'inactive';
      }),
    };
    const recorderRef = createRef<MediaRecorder | null>(
      recorderMock as unknown as MediaRecorder,
    );

    const canvasContext = createMockCanvasContext();
    const logInfo = vi.fn();
    const logWarn = vi.fn();
    const stopWebCodecsExport = vi.fn();
    const platformCapabilities = getAppleSafariPreviewPlatformCapabilities(createCapabilities());
    const previewPlatformPolicy = appleSafariPreviewRuntime.getPreviewPlatformPolicy(
      platformCapabilities,
    );

    const hook = renderHook(() =>
      usePreviewEngine({
        captions: [] as Caption[],
        captionSettings: { enabled: false } as unknown as CaptionSettings,
        mediaItemsRef: createRef([video1]),
        bgmRef: createRef<AudioTrack | null>(null),
        narrationsRef: createRef<NarrationClip[]>([]),
        captionsRef: createRef<Caption[]>([]),
        captionSettingsRef: createRef({ enabled: false } as unknown as CaptionSettings),
        totalDurationRef: createRef(2),
        currentTimeRef: createRef(0),
        canvasRef: createRef({
          getContext: vi.fn(() => canvasContext),
        } as unknown as HTMLCanvasElement),
        mediaElementsRef: createRef({
          [video1.id]: video1El as unknown as HTMLVideoElement,
        } as MediaElementsRef),
        audioCtxRef: createRef(null),
        sourceNodesRef: createRef({}),
        gainNodesRef: createRef({}),
        masterDestRef: createRef(null),
        audioRoutingModeRef: createRef<'preview' | 'export'>('export'),
        reqIdRef: createRef<number | null>(null),
        startTimeRef: createRef(0),
        audioResumeWaitFramesRef: createRef(0),
        recorderRef,
        loopIdRef: createRef(1),
        isPlayingRef: createRef(true),
        isSeekingRef: createRef(false),
        isSeekPlaybackPreparingRef: createRef(false),
        activeVideoIdRef: createRef<string | null>('v1'),
        videoRecoveryAttemptsRef: createRef({}),
        exportPlayFailedRef: createRef({}),
        exportFallbackSeekAtRef: createRef({}),
        seekingVideosRef: createRef(new Set<string>()),
        pendingSeekRef: createRef<number | null>(null),
        wasPlayingBeforeSeekRef: createRef(false),
        pendingSeekTimeoutRef: createRef<ReturnType<typeof setTimeout> | null>(null),
        previewPlaybackAttemptRef: createRef(1),
        requestPreviewAudioRouteRefreshRef: createRef(() => { }),
        primePreviewAudioOnlyTracksAtTimeRef: createRef(() => { }),
        endFinalizedRef: createRef(false),
        previewPlatformPolicy,
        platformCapabilities,
        setVideoDuration: vi.fn(),
        setCurrentTime: vi.fn(),
        setProcessing: vi.fn(),
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
        stopWebCodecsExport,
        completeWebCodecsExport: vi.fn(),
        logInfo,
        logWarn,
        logDebug: vi.fn(),
      }),
    );

    hook.result.current.stopAll();

    // requestData() は即時に呼ばれる
    expect(recorderMock.requestData).toHaveBeenCalledTimes(1);
    // 180ms 経過前は stop() は呼ばれない
    expect(recorderMock.stop).not.toHaveBeenCalled();

    vi.advanceTimersByTime(180);

    // 180ms 後に stop() が呼ばれる
    expect(recorderMock.stop).toHaveBeenCalledTimes(1);
    // stopWebCodecsExport({ reason: 'user' }) は呼ばれない (callback suppression 回避のため)
    expect(stopWebCodecsExport).not.toHaveBeenCalled();
  });

  it('stopAll は inactive な MediaRecorder には requestData/stop を呼ばず stopWebCodecsExport にフォールバックする', () => {
    const video1 = createVideoItem({ id: 'v1', duration: 2 });
    const video1El = createMockVideoElement();

    const recorderMock = {
      state: 'inactive' as RecordingState,
      requestData: vi.fn(),
      stop: vi.fn(),
    };
    const recorderRef = createRef<MediaRecorder | null>(
      recorderMock as unknown as MediaRecorder,
    );

    const canvasContext = createMockCanvasContext();
    const stopWebCodecsExport = vi.fn();
    const platformCapabilities = getAppleSafariPreviewPlatformCapabilities(createCapabilities());
    const previewPlatformPolicy = appleSafariPreviewRuntime.getPreviewPlatformPolicy(
      platformCapabilities,
    );

    const hook = renderHook(() =>
      usePreviewEngine({
        captions: [] as Caption[],
        captionSettings: { enabled: false } as unknown as CaptionSettings,
        mediaItemsRef: createRef([video1]),
        bgmRef: createRef<AudioTrack | null>(null),
        narrationsRef: createRef<NarrationClip[]>([]),
        captionsRef: createRef<Caption[]>([]),
        captionSettingsRef: createRef({ enabled: false } as unknown as CaptionSettings),
        totalDurationRef: createRef(2),
        currentTimeRef: createRef(0),
        canvasRef: createRef({
          getContext: vi.fn(() => canvasContext),
        } as unknown as HTMLCanvasElement),
        mediaElementsRef: createRef({
          [video1.id]: video1El as unknown as HTMLVideoElement,
        } as MediaElementsRef),
        audioCtxRef: createRef(null),
        sourceNodesRef: createRef({}),
        gainNodesRef: createRef({}),
        masterDestRef: createRef(null),
        audioRoutingModeRef: createRef<'preview' | 'export'>('preview'),
        reqIdRef: createRef<number | null>(null),
        startTimeRef: createRef(0),
        audioResumeWaitFramesRef: createRef(0),
        recorderRef,
        loopIdRef: createRef(1),
        isPlayingRef: createRef(true),
        isSeekingRef: createRef(false),
        isSeekPlaybackPreparingRef: createRef(false),
        activeVideoIdRef: createRef<string | null>('v1'),
        videoRecoveryAttemptsRef: createRef({}),
        exportPlayFailedRef: createRef({}),
        exportFallbackSeekAtRef: createRef({}),
        seekingVideosRef: createRef(new Set<string>()),
        pendingSeekRef: createRef<number | null>(null),
        wasPlayingBeforeSeekRef: createRef(false),
        pendingSeekTimeoutRef: createRef<ReturnType<typeof setTimeout> | null>(null),
        previewPlaybackAttemptRef: createRef(1),
        requestPreviewAudioRouteRefreshRef: createRef(() => { }),
        primePreviewAudioOnlyTracksAtTimeRef: createRef(() => { }),
        endFinalizedRef: createRef(false),
        previewPlatformPolicy,
        platformCapabilities,
        setVideoDuration: vi.fn(),
        setCurrentTime: vi.fn(),
        setProcessing: vi.fn(),
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
        stopWebCodecsExport,
        completeWebCodecsExport: vi.fn(),
        logInfo: vi.fn(),
        logWarn: vi.fn(),
        logDebug: vi.fn(),
      }),
    );

    hook.result.current.stopAll();

    // recorder が inactive のときは MediaRecorder 経路には触れない
    expect(recorderMock.requestData).not.toHaveBeenCalled();
    expect(recorderMock.stop).not.toHaveBeenCalled();
    // 通常停止 (preview 終了等) は従来通り stopWebCodecsExport にフォールバック
    expect(stopWebCodecsExport).toHaveBeenCalledWith({ reason: 'user' });
  });

  it('export 自然終了で active な MediaRecorder には requestData()→180ms 遅延→stop() を呼び stopWebCodecsExport は呼ばない', () => {
    // export 自然終了 (totalDuration 到達) では、stopAll() ではなく loop() の natural-end
    // ハンドラが直接 requestData/stop を呼ぶ。これにより iOS Safari でも onstop が
    // 確実に発火し、onRecordingStop callback で setExportUrl が走ってダウンロードボタン
    // (緑) へ切り替わる。stopWebCodecsExport({reason:'user'}) は呼ばないため callback
    // suppression が起きない。
    const video1 = createVideoItem({ id: 'v1', duration: 6 });
    const video1El = createMockVideoElement();
    video1El.readyState = 4;
    video1El.paused = false;
    video1El.currentTime = 5.95;

    const recorderMock = {
      state: 'recording' as RecordingState,
      requestData: vi.fn(),
      stop: vi.fn(() => {
        recorderMock.state = 'inactive';
      }),
    };
    const recorderRef = createRef<MediaRecorder | null>(
      recorderMock as unknown as MediaRecorder,
    );

    const canvasContext = createMockCanvasContext();
    const logInfo = vi.fn();
    const stopWebCodecsExport = vi.fn();
    const completeWebCodecsExport = vi.fn();
    const platformCapabilities = getAppleSafariPreviewPlatformCapabilities(createCapabilities());
    const previewPlatformPolicy = appleSafariPreviewRuntime.getPreviewPlatformPolicy(
      platformCapabilities,
    );

    vi.spyOn(Date, 'now').mockReturnValue(6500); // elapsed = 6.5s >= totalDuration=6s
    // loop の時刻基準は performance.now() 優先のため、こちらも揃えて elapsed=6.5s を再現する
    vi.spyOn(performance, 'now').mockReturnValue(6500);
    vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {});

    const hook = renderHook(() =>
      usePreviewEngine({
        captions: [] as Caption[],
        captionSettings: { enabled: false } as unknown as CaptionSettings,
        mediaItemsRef: createRef([video1]),
        bgmRef: createRef<AudioTrack | null>(null),
        narrationsRef: createRef<NarrationClip[]>([]),
        captionsRef: createRef<Caption[]>([]),
        captionSettingsRef: createRef({ enabled: false } as unknown as CaptionSettings),
        totalDurationRef: createRef(6),
        currentTimeRef: createRef(5.95),
        canvasRef: createRef({
          getContext: vi.fn(() => canvasContext),
        } as unknown as HTMLCanvasElement),
        mediaElementsRef: createRef({
          [video1.id]: video1El as unknown as HTMLVideoElement,
        } as MediaElementsRef),
        audioCtxRef: createRef(null),
        sourceNodesRef: createRef({}),
        gainNodesRef: createRef({}),
        masterDestRef: createRef(null),
        audioRoutingModeRef: createRef<'preview' | 'export'>('export'),
        reqIdRef: createRef<number | null>(42),
        startTimeRef: createRef(0),
        audioResumeWaitFramesRef: createRef(0),
        recorderRef,
        loopIdRef: createRef(1),
        isPlayingRef: createRef(true),
        isSeekingRef: createRef(false),
        isSeekPlaybackPreparingRef: createRef(false),
        activeVideoIdRef: createRef<string | null>('v1'),
        videoRecoveryAttemptsRef: createRef({}),
        exportPlayFailedRef: createRef({}),
        exportFallbackSeekAtRef: createRef({}),
        seekingVideosRef: createRef(new Set<string>()),
        pendingSeekRef: createRef<number | null>(null),
        wasPlayingBeforeSeekRef: createRef(false),
        pendingSeekTimeoutRef: createRef<ReturnType<typeof setTimeout> | null>(null),
        previewPlaybackAttemptRef: createRef(1),
        requestPreviewAudioRouteRefreshRef: createRef(() => { }),
        primePreviewAudioOnlyTracksAtTimeRef: createRef(() => { }),
        endFinalizedRef: createRef(false),
        previewPlatformPolicy,
        platformCapabilities,
        setVideoDuration: vi.fn(),
        setCurrentTime: vi.fn(),
        setProcessing: vi.fn(),
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
        stopWebCodecsExport,
        completeWebCodecsExport,
        logInfo,
        logWarn: vi.fn(),
        logDebug: vi.fn(),
      }),
    );

    // loop を export モードで起動 (myLoopId=1, loopIdRef=1 で一致)
    hook.result.current.loop(true, 1);

    // requestData() は即時発火
    expect(recorderMock.requestData).toHaveBeenCalledTimes(1);
    // 180ms 未満では stop() は呼ばれない
    expect(recorderMock.stop).not.toHaveBeenCalled();
    // stopWebCodecsExport / completeWebCodecsExport はどちらも呼ばない
    // (MediaRecorder 経路では recorder.stop() の onstop → onRecordingStop callback で UI を更新)
    expect(stopWebCodecsExport).not.toHaveBeenCalled();
    expect(completeWebCodecsExport).not.toHaveBeenCalled();

    vi.advanceTimersByTime(180);

    // 180ms 後に recorder.stop() が呼ばれる
    expect(recorderMock.stop).toHaveBeenCalledTimes(1);
    // ログにも natural end → MediaRecorder の経路情報が残る
    expect(
      logInfo.mock.calls.some(([, msg]) => msg === 'iOS Safari: natural end -> MediaRecorder requestData+stop'),
    ).toBe(true);
  });

  it('export 自然終了で recorder が無い (WebCodecs 経路) 場合は completeWebCodecsExport を呼び stopWebCodecsExport は呼ばない', () => {
    // WebCodecs 経路 (recorder が null または inactive) の natural end では、
    // stopWebCodecsExport({reason:'user'}) を呼ぶと exportCancelReasonRef='user' に
    // なり notifyRecordingStop が callback を suppress するため、setExportUrl が
    // 走らずダウンロードボタンへ切り替わらない退行になる。completeWebCodecsExport()
    // を呼ぶことで cancelReason='none' のまま reader を cancel し、WebCodecs encoder
    // を自然完了させる。
    const video1 = createVideoItem({ id: 'v1', duration: 6 });
    const video1El = createMockVideoElement();
    video1El.readyState = 4;
    video1El.paused = false;
    video1El.currentTime = 5.95;

    const canvasContext = createMockCanvasContext();
    const logInfo = vi.fn();
    const stopWebCodecsExport = vi.fn();
    const completeWebCodecsExport = vi.fn();
    const platformCapabilities = getAppleSafariPreviewPlatformCapabilities(createCapabilities());
    const previewPlatformPolicy = appleSafariPreviewRuntime.getPreviewPlatformPolicy(
      platformCapabilities,
    );

    vi.spyOn(Date, 'now').mockReturnValue(6500); // elapsed = 6.5s >= totalDuration=6s
    // loop の時刻基準は performance.now() 優先のため、こちらも揃えて elapsed=6.5s を再現する
    vi.spyOn(performance, 'now').mockReturnValue(6500);
    vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {});

    const hook = renderHook(() =>
      usePreviewEngine({
        captions: [] as Caption[],
        captionSettings: { enabled: false } as unknown as CaptionSettings,
        mediaItemsRef: createRef([video1]),
        bgmRef: createRef<AudioTrack | null>(null),
        narrationsRef: createRef<NarrationClip[]>([]),
        captionsRef: createRef<Caption[]>([]),
        captionSettingsRef: createRef({ enabled: false } as unknown as CaptionSettings),
        totalDurationRef: createRef(6),
        currentTimeRef: createRef(5.95),
        canvasRef: createRef({
          getContext: vi.fn(() => canvasContext),
        } as unknown as HTMLCanvasElement),
        mediaElementsRef: createRef({
          [video1.id]: video1El as unknown as HTMLVideoElement,
        } as MediaElementsRef),
        audioCtxRef: createRef(null),
        sourceNodesRef: createRef({}),
        gainNodesRef: createRef({}),
        masterDestRef: createRef(null),
        audioRoutingModeRef: createRef<'preview' | 'export'>('export'),
        reqIdRef: createRef<number | null>(42),
        startTimeRef: createRef(0),
        audioResumeWaitFramesRef: createRef(0),
        recorderRef: createRef<MediaRecorder | null>(null), // ← recorder なし (WebCodecs 経路)
        loopIdRef: createRef(1),
        isPlayingRef: createRef(true),
        isSeekingRef: createRef(false),
        isSeekPlaybackPreparingRef: createRef(false),
        activeVideoIdRef: createRef<string | null>('v1'),
        videoRecoveryAttemptsRef: createRef({}),
        exportPlayFailedRef: createRef({}),
        exportFallbackSeekAtRef: createRef({}),
        seekingVideosRef: createRef(new Set<string>()),
        pendingSeekRef: createRef<number | null>(null),
        wasPlayingBeforeSeekRef: createRef(false),
        pendingSeekTimeoutRef: createRef<ReturnType<typeof setTimeout> | null>(null),
        previewPlaybackAttemptRef: createRef(1),
        requestPreviewAudioRouteRefreshRef: createRef(() => { }),
        primePreviewAudioOnlyTracksAtTimeRef: createRef(() => { }),
        endFinalizedRef: createRef(false),
        previewPlatformPolicy,
        platformCapabilities,
        setVideoDuration: vi.fn(),
        setCurrentTime: vi.fn(),
        setProcessing: vi.fn(),
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
        stopWebCodecsExport,
        completeWebCodecsExport,
        logInfo,
        logWarn: vi.fn(),
        logDebug: vi.fn(),
      }),
    );

    hook.result.current.loop(true, 1);

    // completeWebCodecsExport() が呼ばれる (自然完了)
    expect(completeWebCodecsExport).toHaveBeenCalledTimes(1);
    // stopWebCodecsExport は呼ばれない (callback suppression 回避のため)
    expect(stopWebCodecsExport).not.toHaveBeenCalled();
    // ログにも natural end → WebCodecs の経路情報が残る
    expect(
      logInfo.mock.calls.some(([, msg]) => msg === 'iOS Safari: natural end -> completeWebCodecsExport'),
    ).toBe(true);
  });
});
