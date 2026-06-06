import { useCallback, useRef, type MutableRefObject } from 'react';

import {
  FPS,
} from '../../../constants';
import { createCaptionGlyphCanvas } from '../../../utils/canvas';
import type {
  AudioTrack,
  Caption,
  CaptionSettings,
  MediaElementsRef,
  MediaItem,
  NarrationClip,
} from '../../../types';
import type { ExportPreparationStep, UseExportReturn } from '../../../hooks/useExport';
import type { LogCategory } from '../../../stores/logStore';
import { useMediaStore } from '../../../stores';
import { useProjectStore } from '../../../stores/projectStore';
import type { PlatformCapabilities } from '../../../utils/platform';
import { collectPlaybackBlockingVideos, findActiveTimelineItem } from '../../../utils/playbackTimeline';
import { isCaptionActiveAtTime } from '../../../utils/captionTimeline';
import { getExportFrameTiming, resolveExportDuration } from '../../../utils/exportTimeline';
import {
  ANDROID_PREVIEW_RESYNC_THRESHOLD_SEC,
  ANDROID_PREVIEW_SOFT_DRAW_DRIFT_THRESHOLD_SEC,
  EXPORT_IMAGE_TO_VIDEO_STABILIZATION_SYNC_TOLERANCE_SEC,
  getPreviewAudioOutputMode,
  getPreviewVideoSyncThreshold,
  shouldAttemptDeferredPreviewPlay,
  shouldBlackoutVideoFadeTail,
  shouldBundlePreviewStartForWebAudioMix,
  shouldHoldFrameForImageToVideoExportTransition,
  shouldHoldVideoFrameAtClipEnd,
  shouldKeepInactiveVideoPrewarmed,
  shouldMuteNativeMediaElement,
  shouldPrimeFutureInactiveVideoInPreview,
  getAndroidPreviewRecoveryDecision,
  shouldRecoverAudioOnlyAfterVideoBoundary,
  shouldReinitializeAudioRoute,
  shouldRetryAudioOnlyPrimeAtPreviewStart,
  shouldStabilizeImageToVideoTransitionDuringExport,
  shouldStopBeforePreviewAudioRouteInit,
  shouldUseCaptionBlurFallback,
  shouldAvoidPauseInactiveVideoInPreview,
  type PreviewPlatformPolicy,
} from './previewPlatform';
import { getStandardPreviewNow } from './playbackClock';
import type { ResetInactiveVideosOptions } from './useInactiveVideoManager';
import {
  clampPreviewAudioGain,
  resolvePreviewAudioGain,
  resolvePreviewBgmGain,
} from './usePreviewAudioSession';
import type {
  PreviewCacheEntry,
  PreviewCacheStatus,
} from './androidPreviewCache';

type LogFn = (category: LogCategory, message: string, details?: Record<string, unknown>) => void;

interface PreparedPreviewAudioNodesResult {
  activeVideoId: string | null;
  audibleSourceCount: number;
  requiresWebAudio: boolean;
}

interface UsePreviewEngineParams {
  captions: Caption[];
  captionSettings: CaptionSettings;
  mediaItemsRef: MutableRefObject<MediaItem[]>;
  bgmRef: MutableRefObject<AudioTrack | null>;
  narrationsRef: MutableRefObject<NarrationClip[]>;
  captionsRef: MutableRefObject<Caption[]>;
  captionSettingsRef: MutableRefObject<CaptionSettings>;
  totalDurationRef: MutableRefObject<number>;
  currentTimeRef: MutableRefObject<number>;
  canvasRef: MutableRefObject<HTMLCanvasElement | null>;
  mediaElementsRef: MutableRefObject<MediaElementsRef>;
  audioCtxRef: MutableRefObject<AudioContext | null>;
  sourceNodesRef: MutableRefObject<Record<string, MediaElementAudioSourceNode>>;
  gainNodesRef: MutableRefObject<Record<string, GainNode>>;
  masterDestRef: MutableRefObject<MediaStreamAudioDestinationNode | null>;
  audioRoutingModeRef: MutableRefObject<'preview' | 'export'>;
  reqIdRef: MutableRefObject<number | null>;
  startTimeRef: MutableRefObject<number>;
  audioResumeWaitFramesRef: MutableRefObject<number>;
  recorderRef: MutableRefObject<MediaRecorder | null>;
  loopIdRef: MutableRefObject<number>;
  isPlayingRef: MutableRefObject<boolean>;
  isSeekingRef: MutableRefObject<boolean>;
  isSeekPlaybackPreparingRef: MutableRefObject<boolean>;
  activeVideoIdRef: MutableRefObject<string | null>;
  videoRecoveryAttemptsRef: MutableRefObject<Record<string, number>>;
  exportPlayFailedRef: MutableRefObject<Record<string, boolean>>;
  exportFallbackSeekAtRef: MutableRefObject<Record<string, number>>;
  seekingVideosRef: MutableRefObject<Set<string>>;
  pendingSeekRef: MutableRefObject<number | null>;
  wasPlayingBeforeSeekRef: MutableRefObject<boolean>;
  pendingSeekTimeoutRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  previewPlaybackAttemptRef: MutableRefObject<number>;
  requestPreviewAudioRouteRefreshRef: MutableRefObject<() => void>;
  primePreviewAudioOnlyTracksAtTimeRef: MutableRefObject<(playbackTime: number) => void>;
  endFinalizedRef: MutableRefObject<boolean>;
  previewCacheEnabled?: boolean;
  previewCacheKeyRef?: MutableRefObject<string | null>;
  previewCacheStatusRef?: MutableRefObject<PreviewCacheStatus>;
  previewCacheEntryRef?: MutableRefObject<PreviewCacheEntry | null>;
  previewCacheVideoRef?: MutableRefObject<HTMLVideoElement | null>;
  previewCacheGenerationRef?: MutableRefObject<number>;
  previewCachePlaybackActiveRef?: MutableRefObject<boolean>;
  previewCacheHasBuiltOnceRef?: MutableRefObject<boolean>;
  setPreviewCacheStatus?: (status: PreviewCacheStatus) => void;
  setPreviewLoadingLabel?: (label?: string) => void;
  previewPlatformPolicy: PreviewPlatformPolicy;
  platformCapabilities: Pick<PlatformCapabilities, 'isAndroid' | 'isIosSafari'>;
  setVideoDuration: (id: string, duration: number) => void;
  setCurrentTime: (time: number) => void;
  setProcessing: (processing: boolean) => void;
  setPreviewPlaying: (playing: boolean) => void;
  setLoading: (loading: boolean) => void;
  setExportPreparationStep: (step: ExportPreparationStep | null) => void;
  setExportUrl: (url: string | null) => void;
  setExportExt: (ext: 'mp4' | 'webm') => void;
  clearExport: () => void;
  setError: (message: string) => void;
  play: () => void;
  pause: () => void;
  getAudioContext: () => AudioContext;
  cancelPendingPausedSeekWait: () => void;
  cancelPendingSeekPlaybackPrepare: () => void;
  detachGlobalSeekEndListeners: () => void;
  ensureAudioNodeForElement: (id: string, mediaEl: HTMLMediaElement) => boolean;
  detachAudioNode: (id: string) => void;
  preparePreviewAudioNodesForTime: (time: number) => PreparedPreviewAudioNodesResult;
  preparePreviewAudioNodesForUpcomingVideos: (fromTime: number) => void;
  primePreviewAudioOnlyTracksAtTime: (playbackTime: number) => void;
  resetInactiveVideos: (options?: ResetInactiveVideosOptions) => void;
  startWebCodecsExport: UseExportReturn['startExport'];
  stopWebCodecsExport: UseExportReturn['stopExport'];
  completeWebCodecsExport: UseExportReturn['completeExport'];
  startPreviewCacheExport?: UseExportReturn['startExport'];
  stopPreviewCacheExport?: UseExportReturn['stopExport'];
  completePreviewCacheExport?: UseExportReturn['completeExport'];
  logInfo: LogFn;
  logWarn: LogFn;
  logDebug: LogFn;
}

interface UsePreviewEngineResult {
  handleMediaElementLoaded: (id: string, element: HTMLVideoElement | HTMLImageElement | HTMLAudioElement) => void;
  handleSeeked: () => void;
  handleVideoLoadedData: () => void;
  renderFrame: (time: number, isActivePlaying?: boolean, isExporting?: boolean) => boolean;
  stopAll: () => void;
  loop: (isExportMode: boolean, myLoopId: number) => void;
  startEngine: (fromTime: number, isExportMode: boolean) => Promise<void>;
}

type PreviewEngineMode =
  | 'idle'
  | 'preview'
  | 'export'
  | 'preview-cache-build'
  | 'preview-cache-playback';

const resetNativeMediaAudioState = (mediaEl: HTMLMediaElement) => {
  mediaEl.defaultMuted = false;
  mediaEl.muted = false;
  mediaEl.volume = 1;
};

const silencePreviewBgmOutput = (
  mediaElementsRef: MutableRefObject<MediaElementsRef>,
  gainNodesRef: MutableRefObject<Record<string, GainNode>>,
  audioCtxRef: MutableRefObject<AudioContext | null>,
) => {
  const bgmEl = mediaElementsRef.current.bgm as HTMLAudioElement | undefined;
  if (bgmEl) {
    try {
      bgmEl.defaultMuted = false;
      bgmEl.muted = false;
      bgmEl.volume = 0;
      bgmEl.pause();
    } catch {
      /* ignore */
    }
  }

  const ctx = audioCtxRef.current;
  const bgmGain = gainNodesRef.current.bgm;
  if (bgmGain && ctx) {
    try {
      bgmGain.gain.setValueAtTime(0, ctx.currentTime);
    } catch {
      /* ignore */
    }
  }
};

const applyPreviewAudioOutputState = (
  policy: PreviewPlatformPolicy,
  mediaEl: HTMLMediaElement,
  options: {
    hasAudioNode: boolean;
    desiredVolume: number;
    audibleSourceCount: number;
    isExporting: boolean;
  },
) => {
  const sourceType = mediaEl.tagName === 'AUDIO' ? 'audio' : 'video';
  const outputMode = getPreviewAudioOutputMode(policy, {
    hasAudioNode: options.hasAudioNode,
    isExporting: options.isExporting,
    audibleSourceCount: options.audibleSourceCount,
    desiredVolume: options.desiredVolume,
    sourceType,
  });
  const shouldMuteNative =
    outputMode === 'webaudio'
      && shouldMuteNativeMediaElement(policy, {
        hasAudioNode: options.hasAudioNode,
        isExporting: options.isExporting,
      });

  if (shouldMuteNative && options.hasAudioNode) {
    mediaEl.defaultMuted = false;
    mediaEl.muted = false;
    mediaEl.volume = 0;
  } else {
    mediaEl.defaultMuted = shouldMuteNative;
    mediaEl.muted = shouldMuteNative;
    mediaEl.volume = outputMode === 'native'
      ? Math.max(0, Math.min(1, options.desiredVolume))
      : 1;
  }

  return outputMode;
};

const findNextVideoItem = (items: MediaItem[], activeIndex: number): MediaItem | null => {
  if (activeIndex < 0 || activeIndex + 1 >= items.length) {
    return null;
  }

  return items.slice(activeIndex + 1).find((item) => item.type === 'video') ?? null;
};

// HTMLMediaElement.HAVE_METADATA: currentTime を安全に合わせ直せる最小 readyState。
const MIN_VIDEO_READY_STATE_FOR_SEEK = 1;
// HTMLMediaElement.HAVE_CURRENT_DATA: canvas 描画と play retry を始められる最小 readyState。
const MIN_VIDEO_READY_STATE_FOR_CURRENT_FRAME = 2;
// 再生開始前に許容する currentTime のずれ。既存 preview sync しきい値より厳しく合わせる。
const PREVIEW_START_READY_SYNC_TOLERANCE_SEC = 0.05;
// Android preview の trim 済み video 先頭だけは厳しめに currentTime を合わせてカクつきを抑える。
const PREVIEW_ANDROID_BGM_SOFT_SYNC_TOLERANCE_SEC = 0.3;
// 次動画を trimStart に合わせ直す際の許容ずれ。ブラウザの自然な buffering を尊重しつつ
// 大きく外れているときだけ補正する。
const STANDARD_PREVIEW_NEXT_VIDEO_PREWARM_DRIFT_TOLERANCE_SEC = 0.05;
// 描画不能時に last stable frame を許容する上限。問題を hold で隠さないよう 200ms で打ち切る。
const PREVIEW_ANDROID_PASSIVE_HOLD_MAX_SEC = 0.2;
// recovery seek は Android Chrome の seek 連打を避けるため 1 秒以上あける。
const PREVIEW_ANDROID_RECOVERY_MIN_INTERVAL_MS = 1000;
// timeline drift が 0.8s を超える明確な破綻時だけ recovery seek を許可する。
const PREVIEW_ANDROID_RECOVERY_DRIFT_THRESHOLD_SEC = 0.8;
// 境界通過直後 500ms は media clock の自然再生に任せ、recovery seek を抑止する。
const PREVIEW_ANDROID_RECOVERY_SKIP_AFTER_BOUNDARY_SEC = 0.5;
const PREVIEW_END_THRESHOLD_SEC = 0.03;
// 再生開始直後は seeked / canplay の到着を数フレームだけ待ち、遅ければ loop を止めない。
const PREVIEW_START_READY_POLL_INTERVAL_MS = 40;
const PREVIEW_START_READY_TIMEOUT_MS = 800;
const DISPLAY_TIME_CLAMP_EPSILON_SEC = 0.001;
const PREVIEW_DETAILED_TICK_LOG_INTERVAL_MS = 500;
const MIN_VIDEO_READY_STATE_FOR_PLAY = MIN_VIDEO_READY_STATE_FOR_SEEK;

type PreviewLogMode = 'smooth' | 'detailed' | 'boundary';

const resolvePreviewLogMode = (): PreviewLogMode => {
  if (typeof globalThis === 'undefined') {
    return 'smooth';
  }

  let mode: string | null = null;
  try {
    mode = globalThis.localStorage?.getItem('preview.log.mode') ?? null;
  } catch {
    mode = null;
  }
  if (mode === 'detailed') {
    return 'detailed';
  }
  if (mode === 'boundary') {
    return 'boundary';
  }

  return 'smooth';
};

const isPreviewDiagnosticsLogMode = (mode: PreviewLogMode): boolean => mode !== 'smooth';

let previewExportSessionSequence = 0;

const createPreviewExportSessionId = (): string => {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    const randomValues = new Uint32Array(4);
    globalThis.crypto.getRandomValues(randomValues);
    return `preview-export-${Date.now()}-${Array.from(randomValues).join('-')}`;
  }

  previewExportSessionSequence += 1;
  return `preview-export-${Date.now()}-${previewExportSessionSequence}`;
};
interface BoundaryDiagState {
  boundaryGlobalTimeMs: number;
  enterRafNowMs: number;
  previousId: string | null;
  activeId: string | null;
  segmentIndex: number;
  trimStart: number;
  prerollStartedAtMs: number | null;
  prerollTargetSec: number | null;
  prerollLeadSec: number | null;
  readyStateAtBoundary: number | null;
  seekingAtBoundary: boolean | null;
  pausedAtBoundary: boolean | null;
  currentTimeAtBoundary: number | null;
  targetTimeAtBoundary: number | null;
  driftAtBoundaryMs: number | null;
  prerollArmed: boolean;
  maxFrameGapMs: number;
  holdFrameCount: number;
  clockAbsorbMs: number;
  isAutoSaveRunningAtBoundary: boolean;
  isProjectSavingAtBoundary: boolean;
  isProjectLoadingAtBoundary: boolean;
  samplePhasesDone: Set<string>;
  smoothPlanEmitted: boolean;
  currentTimeAt100ms: number | null;
  targetTimeAt100ms: number | null;
  readyStateAt100ms: number | null;
  seekingAt100ms: boolean | null;
  pausedAt100ms: boolean | null;
  readyStateAt200ms: number | null;
  seekingAt200ms: boolean | null;
}

interface NextVideoPrebufferDiagState {
  videoId: string;
  startedAtMs: number;
  targetSec: number;
  leadSec: number | null;
  armed: boolean;
}

// Android 実機で一発 play が落ちても数回は吸収するための retry 設定。
const PREVIEW_PLAY_RETRY_INTERVAL_MS = 160;
const PREVIEW_PLAY_RETRY_MAX_ATTEMPTS = 4;
const ANDROID_PREVIEW_HOLD_LOG_INTERVAL_MS = 1000;

/**
 * standard preview の開始直後に `play()` が一発失敗しても置き去りにしないための retry。
 * 呼び出し側は `shouldContinue()` で loop 世代や seek 状態を監視し、古い再生試行を自然終了させる。
 */
const requestVideoPlayWithRetry = (
  videoElement: HTMLVideoElement,
  shouldContinue: () => boolean,
  retryIntervalMs = PREVIEW_PLAY_RETRY_INTERVAL_MS,
  minReadyState = MIN_VIDEO_READY_STATE_FOR_PLAY,
) => {
  const tryPlay = (currentAttempt: number) => {
    if (!shouldContinue() || !videoElement.paused) return;
    if (videoElement.readyState === 0 && !videoElement.error) {
      try {
        videoElement.load();
      } catch {
        /* ignore */
      }
    }
    if (videoElement.readyState >= minReadyState && !videoElement.seeking) {
      videoElement.play().catch(() => {
        // play() の失敗要因は毎回変わりうるため、次回 retry 時に readyState / seeking を再評価する。
        if (currentAttempt < PREVIEW_PLAY_RETRY_MAX_ATTEMPTS) {
          setTimeout(() => tryPlay(currentAttempt + 1), retryIntervalMs);
        }
      });
      return;
    }
    if (currentAttempt < PREVIEW_PLAY_RETRY_MAX_ATTEMPTS) {
      setTimeout(() => tryPlay(currentAttempt + 1), retryIntervalMs);
    }
  };
  tryPlay(1);
};

const canDrawVideo = (video: HTMLVideoElement): boolean => (
  video.readyState >= MIN_VIDEO_READY_STATE_FOR_CURRENT_FRAME
  && !video.seeking
  && video.videoWidth > 0
  && video.videoHeight > 0
);

/**
 * standard preview の startEngine で、active video が seek 完了・描画可能 readyState に入るまで短時間待機する。
 * timeout やキャンセル時も resolve して呼び出し元へ制御を返し、古い試行は `shouldContinue()` 側で打ち切る。
 */
const waitForPreviewStartVideoReady = async (
  videoElement: HTMLVideoElement,
  targetTime: number,
  shouldContinue: () => boolean,
): Promise<void> => {
  const needsWait =
    videoElement.seeking
    || videoElement.readyState < MIN_VIDEO_READY_STATE_FOR_CURRENT_FRAME
    || Math.abs(videoElement.currentTime - targetTime) > PREVIEW_START_READY_SYNC_TOLERANCE_SEC;

  if (!needsWait) {
    return;
  }

  await new Promise<void>((resolve) => {
    let settled = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      videoElement.removeEventListener('seeked', onReady);
      videoElement.removeEventListener('loadeddata', onReady);
      videoElement.removeEventListener('canplay', onReady);
      videoElement.removeEventListener('error', onReady);
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    };

    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };

    const onReady = () => {
      if (!shouldContinue()) {
        finish();
        return;
      }
      if (videoElement.readyState === 0 && !videoElement.error) {
        try {
          videoElement.load();
        } catch {
          /* ignore */
        }
      }
      const drift = Math.abs(videoElement.currentTime - targetTime);
      if (
        !videoElement.seeking
        && videoElement.readyState >= MIN_VIDEO_READY_STATE_FOR_SEEK
        && drift > PREVIEW_START_READY_SYNC_TOLERANCE_SEC
      ) {
        try {
          videoElement.currentTime = targetTime;
        } catch {
          /* ignore */
        }
        // currentTime 補正で新しい seek が走るため、この回は終了して次の seeked / poll で再評価する。
        return;
      }
      if (
        videoElement.readyState >= MIN_VIDEO_READY_STATE_FOR_CURRENT_FRAME
        && !videoElement.seeking
        && drift <= PREVIEW_START_READY_SYNC_TOLERANCE_SEC
      ) {
        finish();
      }
    };

    pollTimer = setInterval(onReady, PREVIEW_START_READY_POLL_INTERVAL_MS);
    timeoutId = setTimeout(finish, PREVIEW_START_READY_TIMEOUT_MS);
    videoElement.addEventListener('seeked', onReady);
    videoElement.addEventListener('loadeddata', onReady);
    videoElement.addEventListener('canplay', onReady);
    videoElement.addEventListener('error', onReady);
    onReady();
  });
};

const waitForPreviewCacheVideoReady = async (
  videoElement: HTMLVideoElement,
  targetTime: number,
  shouldContinue: () => boolean,
): Promise<void> => {
  if (videoElement.readyState >= MIN_VIDEO_READY_STATE_FOR_CURRENT_FRAME && !videoElement.seeking) {
    if (Math.abs(videoElement.currentTime - targetTime) <= PREVIEW_START_READY_SYNC_TOLERANCE_SEC) {
      return;
    }
  }

  await new Promise<void>((resolve) => {
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      videoElement.removeEventListener('seeked', onReady);
      videoElement.removeEventListener('loadeddata', onReady);
      videoElement.removeEventListener('canplay', onReady);
      videoElement.removeEventListener('error', onReady);
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    };

    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };

    const onReady = () => {
      if (!shouldContinue()) {
        finish();
        return;
      }

      if (videoElement.readyState === 0 && !videoElement.error) {
        try {
          videoElement.load();
        } catch {
          /* ignore */
        }
      }

      if (videoElement.readyState < MIN_VIDEO_READY_STATE_FOR_SEEK || videoElement.seeking) {
        return;
      }

      const drift = Math.abs(videoElement.currentTime - targetTime);
      if (drift > PREVIEW_START_READY_SYNC_TOLERANCE_SEC) {
        try {
          videoElement.currentTime = targetTime;
        } catch {
          /* ignore */
        }
        return;
      }

      if (videoElement.readyState >= MIN_VIDEO_READY_STATE_FOR_CURRENT_FRAME) {
        finish();
      }
    };

    timeoutId = setTimeout(finish, PREVIEW_START_READY_TIMEOUT_MS);
    videoElement.addEventListener('seeked', onReady);
    videoElement.addEventListener('loadeddata', onReady);
    videoElement.addEventListener('canplay', onReady);
    videoElement.addEventListener('error', onReady);
    onReady();
  });
};

export function usePreviewEngine({
  captions,
  captionSettings,
  mediaItemsRef,
  bgmRef,
  narrationsRef,
  captionsRef,
  captionSettingsRef,
  totalDurationRef,
  currentTimeRef,
  canvasRef,
  mediaElementsRef,
  audioCtxRef,
  sourceNodesRef,
  gainNodesRef,
  masterDestRef,
  audioRoutingModeRef,
  reqIdRef,
  startTimeRef,
  audioResumeWaitFramesRef,
  recorderRef,
  loopIdRef,
  isPlayingRef,
  isSeekingRef,
  isSeekPlaybackPreparingRef,
  activeVideoIdRef,
  videoRecoveryAttemptsRef,
  exportPlayFailedRef,
  exportFallbackSeekAtRef,
  seekingVideosRef,
  pendingSeekRef,
  wasPlayingBeforeSeekRef,
  pendingSeekTimeoutRef,
  previewPlaybackAttemptRef,
  requestPreviewAudioRouteRefreshRef,
  primePreviewAudioOnlyTracksAtTimeRef,
  endFinalizedRef,
  previewCacheEnabled,
  previewCacheKeyRef,
  previewCacheStatusRef,
  previewCacheEntryRef,
  previewCacheVideoRef,
  previewCacheGenerationRef,
  previewCachePlaybackActiveRef,
  previewCacheHasBuiltOnceRef,
  setPreviewCacheStatus,
  setPreviewLoadingLabel,
  previewPlatformPolicy,
  platformCapabilities,
  setVideoDuration,
  setCurrentTime,
  setProcessing,
  setPreviewPlaying,
  setLoading,
  setExportPreparationStep,
  setExportUrl,
  setExportExt,
  clearExport,
  setError,
  play,
  pause,
  getAudioContext,
  cancelPendingPausedSeekWait,
  cancelPendingSeekPlaybackPrepare,
  detachGlobalSeekEndListeners,
  ensureAudioNodeForElement,
  detachAudioNode,
  preparePreviewAudioNodesForTime,
  preparePreviewAudioNodesForUpcomingVideos,
  primePreviewAudioOnlyTracksAtTime,
  resetInactiveVideos,
  startWebCodecsExport,
  stopWebCodecsExport,
  completeWebCodecsExport,
  startPreviewCacheExport,
  stopPreviewCacheExport,
  completePreviewCacheExport,
  logInfo,
  logWarn,
  logDebug,
}: UsePreviewEngineParams): UsePreviewEngineResult {
  const safeSetPreviewPlaying = (playing: boolean) => {
    setPreviewPlaying(playing);
  };
  const previewCacheKeyFallbackRef = useRef<string | null>(null);
  const previewCacheStatusFallbackRef = useRef<PreviewCacheStatus>('idle');
  const previewCacheEntryFallbackRef = useRef<PreviewCacheEntry | null>(null);
  const previewCacheVideoFallbackRef = useRef<HTMLVideoElement | null>(null);
  const previewCacheGenerationFallbackRef = useRef(0);
  const previewCachePlaybackActiveFallbackRef = useRef(false);
  const previewCacheHasBuiltOnceFallbackRef = useRef(false);
  const previewCacheEnabledFlag = previewCacheEnabled ?? false;
  const previewCacheKeyRefValue = previewCacheKeyRef ?? previewCacheKeyFallbackRef;
  const previewCacheStatusRefValue = previewCacheStatusRef ?? previewCacheStatusFallbackRef;
  const previewCacheEntryRefValue = previewCacheEntryRef ?? previewCacheEntryFallbackRef;
  const previewCacheVideoRefValue = previewCacheVideoRef ?? previewCacheVideoFallbackRef;
  const previewCacheGenerationRefValue = previewCacheGenerationRef ?? previewCacheGenerationFallbackRef;
  const previewCachePlaybackActiveRefValue = previewCachePlaybackActiveRef ?? previewCachePlaybackActiveFallbackRef;
  const previewCacheHasBuiltOnceRefValue = previewCacheHasBuiltOnceRef ?? previewCacheHasBuiltOnceFallbackRef;
  const setPreviewCacheStatusValue = setPreviewCacheStatus ?? (() => undefined);
  const setPreviewLoadingLabelValue = setPreviewLoadingLabel ?? (() => undefined);
  const activePreviewModeRef = useRef<PreviewEngineMode>('idle');
  const currentExportSessionIdRef = useRef<string | null>(null);
  const currentPreviewCacheBuildSessionIdRef = useRef<string | null>(null);
  const pendingPreviewCacheBuildResolverRef = useRef<((success: boolean) => void) | null>(null);
  const androidPreviewRecoveryRef = useRef<Record<string, {
    active: boolean;
    reason: string;
    startedAt: number;
    lastAttemptAt: number;
    lastTargetTime: number;
    attempts: number;
  }>>({});
  const androidPreviewHoldLogAtRef = useRef<Record<string, number>>({});
  const androidPreviewLastSeekAtRef = useRef<Record<string, number>>({});
  const androidPreviewRecoveredSegmentRef = useRef<Record<string, string>>({});
  const standardNextVideoPrebufferDiagRef = useRef<Record<string, NextVideoPrebufferDiagState>>({});
  const previewTimelineDiagnosticsRef = useRef<{
    lastRafNowMs: number | null;
    lastSegmentIndex: number;
    lastTickLogAtMs: number | null;
    lastShouldSuppressEndClear: boolean | null;
    activeBoundary: BoundaryDiagState | null;
    beforeBoundarySampled: boolean;
  }>({
    lastRafNowMs: null,
    lastSegmentIndex: -1,
    lastTickLogAtMs: null,
    lastShouldSuppressEndClear: null,
    activeBoundary: null,
    beforeBoundarySampled: false,
  });
  const previewLogModeRef = useRef<PreviewLogMode>(resolvePreviewLogMode());
  const resetBoundaryDiagnosticsState = useCallback(() => {
    previewTimelineDiagnosticsRef.current.lastRafNowMs = null;
    previewTimelineDiagnosticsRef.current.lastSegmentIndex = -1;
    previewTimelineDiagnosticsRef.current.lastTickLogAtMs = null;
    previewTimelineDiagnosticsRef.current.lastShouldSuppressEndClear = null;
    previewTimelineDiagnosticsRef.current.activeBoundary = null;
    previewTimelineDiagnosticsRef.current.beforeBoundarySampled = false;
    androidPreviewRecoveredSegmentRef.current = {};
    standardNextVideoPrebufferDiagRef.current = {};
  }, []);
  const maybeAssignAndroidPreviewSeek = useCallback((
    {
      videoEl,
      reason,
      videoId,
      segmentIndex,
      segmentRecoveryKey,
      targetTime,
      currentTimeBefore,
      drift,
      sinceLastSeekMs,
    }: {
      videoEl: HTMLVideoElement;
      reason: string;
      videoId: string;
      segmentIndex: number;
      segmentRecoveryKey: string;
      targetTime: number;
      currentTimeBefore: number;
      drift: number;
      sinceLastSeekMs: number;
    },
  ) => {
    try {
      videoEl.currentTime = targetTime;
      androidPreviewLastSeekAtRef.current[videoId] = Date.now();
      androidPreviewRecoveredSegmentRef.current[videoId] = segmentRecoveryKey;
      logWarn('RENDER', 'preview.android.seek-assignment', {
        reason,
        videoId,
        segmentIndex,
        targetTime,
        currentTimeBefore,
        drift,
        sinceLastSeekMs,
      });
      return true;
    } catch {
      return false;
    }
  }, [logWarn]);
  const toDisplayTime = useCallback((globalTimeSec: number) => {
    const totalDuration = Math.max(0, totalDurationRef.current);
    if (totalDuration <= 0) return 0;
    const clamped = Math.max(0, Math.min(globalTimeSec, Math.max(0, totalDuration - DISPLAY_TIME_CLAMP_EPSILON_SEC)));
    if (clamped !== globalTimeSec) {
      logInfo('RENDER', 'segment.display.clamped', {
        globalTimeMs: Math.round(globalTimeSec * 1000),
        displayGlobalTimeMs: Math.round(clamped * 1000),
        totalDurationMs: Math.round(totalDuration * 1000),
        isCompleted: globalTimeSec >= totalDuration,
      });
    }
    return clamped;
  }, [logInfo, totalDurationRef]);
  const logAndroidPreviewHold = useCallback(
    (videoId: string, timelineTime: number, activeEl?: HTMLVideoElement) => {
      const now = Date.now();
      const lastLoggedAt = androidPreviewHoldLogAtRef.current[videoId] ?? 0;
      if (now - lastLoggedAt < ANDROID_PREVIEW_HOLD_LOG_INTERVAL_MS) {
        return;
      }

      androidPreviewHoldLogAtRef.current[videoId] = now;
      logInfo('RENDER', 'Android preview hold frame instead of black clear', {
        videoId,
        readyState: activeEl?.readyState,
        paused: activeEl?.paused,
        seeking: activeEl?.seeking,
        videoWidth: activeEl?.videoWidth,
        videoHeight: activeEl?.videoHeight,
        currentTime: activeEl?.currentTime,
        timelineTime,
      });
    },
    [logInfo],
  );
  const handleMediaElementLoaded = useCallback(
    (id: string, element: HTMLVideoElement | HTMLImageElement | HTMLAudioElement) => {
      if (element.tagName === 'VIDEO') {
        const videoEl = element as HTMLVideoElement;
        const duration = videoEl.duration;
        if (!isNaN(duration) && duration !== Infinity) {
          setVideoDuration(id, duration);
          if (videoEl.videoWidth > 0 && videoEl.videoHeight > 0) {
            useMediaStore.getState().setMediaSourceDimensions(id, videoEl.videoWidth, videoEl.videoHeight);
          }
          logInfo('MEDIA', `ビデオロード完了: ${id.substring(0, 8)}...`, {
            duration: Math.round(duration * 10) / 10,
            readyState: videoEl.readyState,
            videoWidth: videoEl.videoWidth,
            videoHeight: videoEl.videoHeight,
          });
        }
      }
    },
    [setVideoDuration, logInfo],
  );

  const waitForVideoMetadata = useCallback(
    async (item: MediaItem, timeoutMs: number = 5000): Promise<boolean> => {
      if (item.type !== 'video') return true;

      let videoEl = mediaElementsRef.current[item.id] as HTMLVideoElement | undefined;
      if (!videoEl) {
        for (let i = 0; i < 10; i++) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          videoEl = mediaElementsRef.current[item.id] as HTMLVideoElement | undefined;
          if (videoEl) break;
        }
      }

      if (!videoEl) {
        logWarn('MEDIA', '動画要素の取得に失敗', { id: item.id.substring(0, 8) });
        return false;
      }

      const syncDurationFromElement = (): boolean => {
        const duration = videoEl.duration;
        if (Number.isFinite(duration) && duration > 0) {
          setVideoDuration(item.id, duration);
          return true;
        }
        return false;
      };

      if (syncDurationFromElement()) {
        return true;
      }

      if (videoEl.readyState === 0 && !videoEl.error) {
        try {
          videoEl.load();
        } catch {
          // ignore
        }
      }

      return await new Promise<boolean>((resolve) => {
        let settled = false;

        const settle = (ok: boolean) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutId);
          videoEl.removeEventListener('loadedmetadata', onReady);
          videoEl.removeEventListener('durationchange', onReady);
          videoEl.removeEventListener('canplay', onReady);
          videoEl.removeEventListener('error', onError);
          resolve(ok);
        };

        const onReady = () => {
          if (syncDurationFromElement()) {
            settle(true);
          }
        };

        const onError = () => settle(false);

        const timeoutId = setTimeout(() => settle(false), timeoutMs);
        videoEl.addEventListener('loadedmetadata', onReady);
        videoEl.addEventListener('durationchange', onReady);
        videoEl.addEventListener('canplay', onReady);
        videoEl.addEventListener('error', onError);

        onReady();
      });
    },
    [logWarn, mediaElementsRef, setVideoDuration],
  );

  const ensureVideoMetadataReady = useCallback(
    async (targets: MediaItem[], fromTime: number): Promise<boolean> => {
      if (targets.length === 0) return true;

      logInfo('MEDIA', '再生前に動画メタデータ読み込み待機', {
        fromTime,
        videoCount: targets.length,
        ids: targets.map((v) => v.id.substring(0, 8)),
      });

      const results = await Promise.all(targets.map((item) => waitForVideoMetadata(item)));
      const allReady = results.every(Boolean);

      const latest = useMediaStore.getState();
      mediaItemsRef.current = latest.mediaItems;
      totalDurationRef.current = latest.totalDuration;

      if (!allReady) {
        logWarn('MEDIA', '動画メタデータの読み込み待機がタイムアウト', {
          fromTime,
          failedIds: targets
            .filter((_, index) => !results[index])
            .map((item) => item.id.substring(0, 8)),
        });
      }

      return allReady;
    },
    [logInfo, logWarn, mediaItemsRef, totalDurationRef, waitForVideoMetadata],
  );

  const hasReadyPreviewCache = useCallback(() => {
    return previewCacheEnabledFlag
      && previewCacheStatusRefValue.current === 'ready'
      && !!previewCacheEntryRefValue.current
      && previewCacheEntryRefValue.current.cacheKey === previewCacheKeyRefValue.current
      && !!previewCacheVideoRefValue.current;
  }, [previewCacheEnabledFlag]);

  const startPreviewCachePlayback = async (fromTime: number): Promise<boolean> => {
    if (!hasReadyPreviewCache()) {
      return false;
    }

    const previewCacheVideo = previewCacheVideoRefValue.current;
    const previewCacheEntry = previewCacheEntryRefValue.current;
    if (!previewCacheVideo || !previewCacheEntry) {
      return false;
    }

    activePreviewModeRef.current = 'preview-cache-playback';
    previewCachePlaybackActiveRefValue.current = true;
    safeSetPreviewPlaying(true);
    setPreviewCacheStatusValue('ready');
    setPreviewLoadingLabelValue(undefined);

    const targetTime = Math.max(0, Math.min(fromTime, previewCacheEntry.duration));
    currentTimeRef.current = targetTime;
    setCurrentTime(targetTime);

    if (previewCacheVideo.src !== previewCacheEntry.url) {
      previewCacheVideo.src = previewCacheEntry.url;
    }

    if (previewCacheVideo.readyState === 0 && !previewCacheVideo.error) {
      try {
        previewCacheVideo.load();
      } catch {
        /* ignore */
      }
    }

    await waitForPreviewCacheVideoReady(
      previewCacheVideo,
      targetTime,
      () => activePreviewModeRef.current === 'preview-cache-playback' && !isSeekingRef.current,
    );

    if (activePreviewModeRef.current !== 'preview-cache-playback') {
      return false;
    }

    if (Math.abs(previewCacheVideo.currentTime - targetTime) > PREVIEW_START_READY_SYNC_TOLERANCE_SEC) {
      try {
        previewCacheVideo.currentTime = targetTime;
      } catch {
        /* ignore */
      }
    }

    renderFrame(targetTime, false, false);

    isPlayingRef.current = true;
    play();
    try {
      await previewCacheVideo.play();
    } catch (error) {
      previewCachePlaybackActiveRefValue.current = false;
      activePreviewModeRef.current = 'preview';
      logWarn('RENDER', 'preview.cache.failed', {
        reason: error instanceof Error ? error.message : String(error),
        fallback: 'live-element-preview',
      });
      return false;
    }

    setLoading(false);
    startTimeRef.current = getStandardPreviewNow() - targetTime * 1000;
    logInfo('RENDER', 'preview.cache.play', {
      globalTimeMs: Math.round(targetTime * 1000),
      totalDurationMs: Math.round(totalDurationRef.current * 1000),
    });
    return true;
  };

  const buildPreviewCache = async (myLoopId: number): Promise<boolean> => {
    if (
      !previewCacheEnabledFlag
      || !startPreviewCacheExport
      || !canvasRef.current
      || !masterDestRef.current
      || !previewCacheKeyRefValue.current
    ) {
      return false;
    }

    const sessionId = createPreviewExportSessionId();
    const cacheKey = previewCacheKeyRefValue.current;
    const generation = previewCacheGenerationRefValue.current + 1;
    previewCacheGenerationRefValue.current = generation;
    currentPreviewCacheBuildSessionIdRef.current = sessionId;
    activePreviewModeRef.current = 'preview-cache-build';
    previewCachePlaybackActiveRefValue.current = false;
    previewCacheStatusRefValue.current = 'preparing';
    setPreviewCacheStatusValue('preparing');
    setPreviewLoadingLabelValue(previewCacheHasBuiltOnceRefValue.current ? 'プレビューを更新中...' : 'プレビュー準備中...');
    setLoading(true);
    safeSetPreviewPlaying(false);
    isPlayingRef.current = false;
    pause();
    logInfo('RENDER', 'preview.cache.start', {
      cacheKey,
      totalDurationMs: Math.round(totalDurationRef.current * 1000),
    });

    return await new Promise<boolean>((resolve) => {
      const settle = (success: boolean) => {
        if (pendingPreviewCacheBuildResolverRef.current) {
          pendingPreviewCacheBuildResolverRef.current = null;
        }
        if (currentPreviewCacheBuildSessionIdRef.current === sessionId) {
          currentPreviewCacheBuildSessionIdRef.current = null;
        }
        resolve(success);
      };

      pendingPreviewCacheBuildResolverRef.current = settle;

      startPreviewCacheExport(
        canvasRef,
        masterDestRef,
        (url) => {
          const isCurrentBuild =
            currentPreviewCacheBuildSessionIdRef.current === sessionId
            && previewCacheGenerationRefValue.current === generation
            && previewCacheKeyRefValue.current === cacheKey;
          if (!isCurrentBuild) {
            try {
              URL.revokeObjectURL(url);
            } catch {
              /* ignore */
            }
            settle(false);
            return;
          }

          const previousUrl = previewCacheEntryRefValue.current?.url;
          previewCacheEntryRefValue.current = {
            url,
            duration: totalDurationRef.current,
            cacheKey,
            createdAt: Date.now(),
          };
          previewCacheHasBuiltOnceRefValue.current = true;
          previewCacheStatusRefValue.current = 'ready';
          setPreviewCacheStatusValue('ready');
          setPreviewLoadingLabelValue(undefined);
          setLoading(false);

          if (previousUrl && previousUrl !== url) {
            try {
              URL.revokeObjectURL(previousUrl);
            } catch {
              /* ignore */
            }
          }

          const previewCacheVideo = previewCacheVideoRefValue.current;
          if (previewCacheVideo && previewCacheVideo.src !== url) {
            previewCacheVideo.pause();
            previewCacheVideo.src = url;
            previewCacheVideo.load();
          }

          logInfo('RENDER', 'preview.cache.ready', {
            totalDurationMs: Math.round(totalDurationRef.current * 1000),
          });
          settle(true);
        },
        (message) => {
          if (currentPreviewCacheBuildSessionIdRef.current !== sessionId) {
            settle(false);
            return;
          }

          previewCacheStatusRefValue.current = 'failed';
          setPreviewCacheStatusValue('failed');
          setPreviewLoadingLabelValue(undefined);
          setLoading(false);
          logWarn('RENDER', 'preview.cache.failed', {
            reason: message,
            fallback: 'live-element-preview',
          });
          settle(false);
        },
        {
          mediaItems: mediaItemsRef.current,
          bgm: bgmRef.current,
          narrations: narrationsRef.current,
          totalDuration: totalDurationRef.current,
          getPlaybackTimeSec: () => currentTimeRef.current,
          onAudioPreRenderComplete: () => {
            startTimeRef.current = getStandardPreviewNow();
            loop(true, myLoopId);
          },
        },
      );
    });
  };

  const renderFrame = useCallback(
    (time: number, isActivePlaying = false, _isExporting = false) => {
      try {
        const canvas = canvasRef.current;
        if (!canvas) return false;
        const ctx = canvas.getContext('2d');
        if (!ctx) return false;
        let didUpdateCanvas = false;

        if (!_isExporting && hasReadyPreviewCache()) {
          const previewCacheVideo = previewCacheVideoRefValue.current;
          if (previewCacheVideo?.readyState && previewCacheVideo.readyState >= MIN_VIDEO_READY_STATE_FOR_CURRENT_FRAME) {
            ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
            ctx.fillStyle = '#000000';
            ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
            ctx.drawImage(previewCacheVideo, 0, 0, ctx.canvas.width, ctx.canvas.height);
            return true;
          }
        }

        const currentItems = mediaItemsRef.current;
        const currentBgm = bgmRef.current;
        const currentNarrations = narrationsRef.current;
        const timelineRanges = new Map<string, { start: number; end: number }>();
        let timelineCursor = 0;
        currentItems.forEach((item) => {
          const start = timelineCursor;
          const end = start + Math.max(0, item.duration);
          timelineRanges.set(item.id, { start, end });
          timelineCursor = end;
        });

        let activeId: string | null = null;
        let localTime = 0;
        let activeIndex = -1;
        const currentLoopId = loopIdRef.current;
        const isStandardLivePreviewPlayback =
          !platformCapabilities.isIosSafari
          && isActivePlaying
          && !_isExporting
          && !isSeekingRef.current;
        const isAndroidPreviewPlayback =
          platformCapabilities.isAndroid
          && isStandardLivePreviewPlayback;
        const active = findActiveTimelineItem(currentItems, time, totalDurationRef.current);
        if (active) {
          activeId = active.id;
          activeIndex = active.index;
          localTime = active.localTime;
        } else if (currentItems.length > 0) {
          const END_FALLBACK_TOLERANCE_SEC = 0.2;
          if (time >= totalDurationRef.current - END_FALLBACK_TOLERANCE_SEC) {
            const lastIndex = currentItems.length - 1;
            const lastItem = currentItems[lastIndex];
            activeId = lastItem.id;
            activeIndex = lastIndex;
            localTime = Math.max(0, lastItem.duration - 0.001);
          }
        }
        const holdAudioThisFrame = isActivePlaying && audioResumeWaitFramesRef.current > 0;
        const isNearTimelineStart =
          currentItems.length > 0 &&
          time <= 0.05;
        const activePreviewAudioSourceCount = (() => {
          if (!isActivePlaying || holdAudioThisFrame) {
            return 0;
          }

          let count = 0;
          if (activeIndex !== -1) {
            const activeItem = currentItems[activeIndex];
            if (activeItem?.type === 'video' && !activeItem.isMuted && activeItem.volume > 0) {
              count += 1;
            }
          }

          if (currentBgm && currentBgm.volume > 0 && time >= currentBgm.delay) {
            const trackTime = time - currentBgm.delay + currentBgm.startPoint;
            if (trackTime >= 0 && trackTime <= currentBgm.duration) {
              count += 1;
            }
          }

          for (const clip of currentNarrations) {
            if (clip.isMuted || clip.volume <= 0) {
              continue;
            }
            const trimStart = Number.isFinite(clip.trimStart) ? Math.max(0, clip.trimStart) : 0;
            const trimEnd = Number.isFinite(clip.trimEnd)
              ? Math.max(trimStart, Math.min(clip.duration, clip.trimEnd))
              : clip.duration;
            const playableDuration = Math.max(0, trimEnd - trimStart);
            const clipTime = time - clip.startTime;
            if (clipTime >= 0 && clipTime <= playableDuration) {
              count += 1;
            }
          }

          return count;
        })();

        let holdFrame = false;
        let shouldBlackoutFadeTail = false;
        let shouldSkipAndroidPreviewActiveDraw = false;
        let shouldPlayAndroidPreviewActiveVideoAfterDraw = false;
        // fade 中であるかは canvas clear 制御 (line ~1530 の shouldSuppressEndClear) でも参照するため、
        // active item ブロックの外で初期化しておき、active が無いときは false で扱う。
        let isInFadeInRegion = false;
        let isInFadeOutRegion = false;
        let isInFadeRegion = false;
        if (activeId && activeIndex !== -1) {
          const activeItem = currentItems[activeIndex];
          const previousItem = activeIndex > 0 ? currentItems[activeIndex - 1] : null;
          const activeFadeOutDur = activeItem.fadeOutDuration || 1.0;
          const hasExplicitFadeToBlack = !!activeItem.fadeOut;
          const shouldPreferBlackoutAtFadeTail = shouldBlackoutVideoFadeTail({
            clipLocalTime: localTime,
            clipDuration: activeItem.duration,
            fadeOut: hasExplicitFadeToBlack,
            fadeOutDuration: activeFadeOutDur,
          });

          const activeFadeInDur = activeItem.fadeInDuration || 1.0;
          // fade region は video / image の両方に適用される (MediaItem 共通プロパティ)。
          // type==='video' に絞ると画像クリップで fade region が拾われず、
          // 下流の shouldSuppressEndClear / freezeFrame / holdFrame ガードが効かなくなる。
          isInFadeOutRegion =
            activeItem.fadeOut &&
            localTime > activeItem.duration - activeFadeOutDur;
          isInFadeInRegion =
            activeItem.fadeIn &&
            localTime < activeFadeInDur;
          isInFadeRegion = isInFadeInRegion || isInFadeOutRegion;

          if (activeItem.type === 'video' && hasExplicitFadeToBlack && shouldPreferBlackoutAtFadeTail) {
            shouldBlackoutFadeTail = true;
          }

          if (activeItem.type === 'video') {
            const activeEl = mediaElementsRef.current[activeId] as HTMLVideoElement | undefined;

            if (!activeEl) {
              if (isAndroidPreviewPlayback) {
                holdFrame = true;
                shouldSkipAndroidPreviewActiveDraw = true;
                logAndroidPreviewHold(activeId, time);
              }
              if (!shouldPreferBlackoutAtFadeTail && !isInFadeRegion) {
                holdFrame = true;
              }
            } else {
              const trimStart = activeItem.trimStart || 0;
              const targetTime = trimStart + localTime;
              const activeVideoDrift = Math.abs(activeEl.currentTime - targetTime);
              const isAndroidPassiveBoundaryWindow =
                isAndroidPreviewPlayback
                && localTime >= 0
                && localTime <= PREVIEW_ANDROID_PASSIVE_HOLD_MAX_SEC;
              const isTimelineEnd =
                totalDurationRef.current > 0 &&
                time >= totalDurationRef.current - PREVIEW_END_THRESHOLD_SEC;
              const isLastTimelineItem = activeIndex === currentItems.length - 1;
              const isNearTimelineEnd =
                totalDurationRef.current > 0 &&
                time >= totalDurationRef.current - 0.05;
              const safeEndTime = trimStart + Math.max(0, activeItem.duration - 0.001);
              const shouldForceEndFrameAlign =
                _isExporting &&
                !isActivePlaying &&
                isLastTimelineItem &&
                isNearTimelineEnd;
              const exportSyncThreshold = getPreviewVideoSyncThreshold(previewPlatformPolicy, {
                isExporting: _isExporting,
                hasExportPlayFailure: false,
              });
              const shouldHoldForImageToVideoTransition = shouldHoldFrameForImageToVideoExportTransition({
                isExporting: _isExporting,
                isAndroid: platformCapabilities.isAndroid,
                activeItemType: activeItem.type,
                previousItemType: previousItem?.type ?? null,
                clipLocalTime: localTime,
                videoReadyState: activeEl.readyState,
                isVideoSeeking: activeEl.seeking,
                videoCurrentTime: activeEl.currentTime,
                targetTime,
                syncToleranceSec: EXPORT_IMAGE_TO_VIDEO_STABILIZATION_SYNC_TOLERANCE_SEC,
              });
              const hasExportPlayFailure = _isExporting && !!exportPlayFailedRef.current[activeId];
              const needsCorrection =
                _isExporting &&
                isActivePlaying &&
                !isSeekingRef.current &&
                !activeEl.seeking &&
                !activeEl.paused &&
                !hasExportPlayFailure &&
                Math.abs(activeEl.currentTime - targetTime) > exportSyncThreshold;

              if (
                !_isExporting
                && isActivePlaying
                && isTimelineEnd
                // フェード途中で freezeFrame を alpha=1.0 で上書きすると fade が見えなくなるため、
                // fadeIn / fadeOut の途中であれば下流の通常 drawImage パス (line ~1916) に処理を委ねる。
                && !isInFadeRegion
                && activeEl.readyState >= MIN_VIDEO_READY_STATE_FOR_CURRENT_FRAME
                && !activeEl.seeking
                && activeEl.videoWidth > 0
                && activeEl.videoHeight > 0
              ) {
                activeEl.pause();
                ctx.globalAlpha = 1.0;
                ctx.drawImage(activeEl, 0, 0, ctx.canvas.width, ctx.canvas.height);
                didUpdateCanvas = true;
                holdFrame = true;
                shouldSkipAndroidPreviewActiveDraw = true;
                logInfo('RENDER', 'preview.end.freezeFrame', {
                  activeId,
                  activeIndex,
                  isLastTimelineItem,
                  localTime,
                  trimStart,
                  videoCurrentTime: activeEl.currentTime,
                  readyState: activeEl.readyState,
                  paused: activeEl.paused,
                  seeking: activeEl.seeking,
                  ended: activeEl.ended,
                });
              } else if (shouldForceEndFrameAlign && activeEl.readyState >= 1 && !activeEl.seeking) {
                const endAlignThreshold = 0.0001;
                const desired = Math.min(targetTime, safeEndTime);
                const drift = Math.abs(activeEl.currentTime - desired);
                const isAhead = activeEl.currentTime > desired + endAlignThreshold;
                if (drift > endAlignThreshold || isAhead) {
                  activeEl.currentTime = desired;
                }
              }

              if (activeEl.readyState === 0 && !activeEl.error) {
                const now = Date.now();
                const lastAttempt = videoRecoveryAttemptsRef.current[activeId] || 0;
                if (now - lastAttempt > 2000) {
                  videoRecoveryAttemptsRef.current[activeId] = now;
                  try { activeEl.load(); } catch { /* ignore */ }
                }
              }

              const hasFrame =
                activeEl.readyState >= 2 &&
                activeEl.videoWidth > 0 &&
                activeEl.videoHeight > 0 &&
                !activeEl.seeking;

              const shouldHoldForVideoEnd = shouldHoldVideoFrameAtClipEnd({
                clipLocalTime: localTime,
                clipDuration: activeItem.duration,
                trimStart,
                videoCurrentTime: activeEl.currentTime,
                videoEnded: activeEl.ended,
                isExporting: _isExporting,
                isIosSafari: platformCapabilities.isIosSafari,
                isLastTimelineItem,
                nextItemType: activeIndex + 1 < currentItems.length
                  ? currentItems[activeIndex + 1]?.type ?? null
                  : null,
                fps: FPS,
              });

              const shouldHoldForAndroidPreviewNotDrawable = isAndroidPreviewPlayback
                && isAndroidPassiveBoundaryWindow
                && !canDrawVideo(activeEl)
                && (
                  activeEl.seeking
                  || activeEl.readyState < MIN_VIDEO_READY_STATE_FOR_CURRENT_FRAME
                  || activeEl.videoWidth <= 0
                  || activeEl.videoHeight <= 0
                );

              const shouldHoldActiveVideoFrame =
                !hasFrame
                || shouldHoldForAndroidPreviewNotDrawable
                || needsCorrection
                || shouldHoldForVideoEnd
                || shouldHoldForImageToVideoTransition;

              const shouldBypassHoldForReadyActiveVideo =
                isAndroidPreviewPlayback
                && canDrawVideo(activeEl)
                && activeEl.paused;

              if (shouldBypassHoldForReadyActiveVideo) {
                holdFrame = false;
                shouldSkipAndroidPreviewActiveDraw = false;
                shouldPlayAndroidPreviewActiveVideoAfterDraw = true;
                if (isPreviewDiagnosticsLogMode(previewLogModeRef.current)) {
                  logInfo('RENDER', '[DIAG-BOUNDARY-ACTIVE] Android active video ready', {
                    activeId,
                    localTime,
                    targetTime,
                    videoCurrentTime: activeEl.currentTime,
                    drift: Math.abs(activeEl.currentTime - targetTime),
                    readyState: activeEl.readyState,
                    paused: activeEl.paused,
                    seeking: activeEl.seeking,
                    holdFrame,
                  });
                }
              }

              if (shouldHoldActiveVideoFrame) {
                // fade 中 (fadeIn / fadeOut) は holdFrame で前フレームを保持すると
                // 旧 clip の絵柄が透けて見え、フェードが効いていないように見える。
                // fade 中は canvas を毎フレーム黒クリアして alpha 付きで描画するパスへ委ねる。
                if (!shouldPreferBlackoutAtFadeTail && !isInFadeRegion) {
                  holdFrame = true;
                }
                if (shouldHoldForAndroidPreviewNotDrawable) {
                  shouldSkipAndroidPreviewActiveDraw = true;
                  logAndroidPreviewHold(activeId, time, activeEl);
                  if (previewTimelineDiagnosticsRef.current.activeBoundary !== null) {
                    previewTimelineDiagnosticsRef.current.activeBoundary.holdFrameCount += 1;
                  }
                } else if (previewLogModeRef.current === 'detailed') {
                  logInfo('RENDER', shouldPreferBlackoutAtFadeTail ? 'fade tail blackout' : 'active video frame hold', {
                    videoId: activeId,
                    readyState: activeEl.readyState,
                    seeking: activeEl.seeking,
                    ended: activeEl.ended,
                    videoCT: Math.round(activeEl.currentTime * 10000) / 10000,
                    videoDur: activeEl.duration,
                    currentTime: time,
                    needsCorrection,
                    shouldHoldForVideoEnd,
                    shouldHoldForImageToVideoTransition,
                    shouldHoldActiveVideoFrame,
                    shouldBlackoutFadeTail: shouldPreferBlackoutAtFadeTail,
                  });
                }
              }
              if (
                !isTimelineEnd
                && isAndroidPreviewPlayback
                && activeEl.readyState >= MIN_VIDEO_READY_STATE_FOR_CURRENT_FRAME
                && !activeEl.seeking
                && (localTime > 0.3 || activeVideoDrift > ANDROID_PREVIEW_SOFT_DRAW_DRIFT_THRESHOLD_SEC)
                && activeEl.paused
                && !shouldPlayAndroidPreviewActiveVideoAfterDraw
              ) {
                requestVideoPlayWithRetry(activeEl, () =>
                  isPlayingRef.current
                  && !isSeekingRef.current
                  && loopIdRef.current === currentLoopId,
                );
              }
            }
          } else if (activeItem.type === 'image') {
            const activeEl = mediaElementsRef.current[activeId] as HTMLImageElement | undefined;
            const isImageReady =
              !!activeEl &&
              activeEl.complete &&
              activeEl.naturalWidth > 0 &&
              activeEl.naturalHeight > 0;
            if (!isImageReady) {
              holdFrame = true;
            }
          }
        }

        const shouldHoldAtTimelineEnd =
          !activeId &&
          currentItems.length > 0 &&
          totalDurationRef.current > 0 &&
          time >= totalDurationRef.current - 0.0005;

        const shouldGuardNearEnd =
          !isActivePlaying &&
          currentItems.length > 0 &&
          totalDurationRef.current > 0 &&
          time >= totalDurationRef.current - 0.1;

        const shouldGuardAfterFinalize = endFinalizedRef.current && !isActivePlaying;

        const shouldForceStartClear = isNearTimelineStart && (
          _isExporting || (!isActivePlaying && !isPlayingRef.current)
        );
        const shouldSuppressAndroidPreviewClear =
          isAndroidPreviewPlayback
          && holdFrame;
        const shouldClearCanvas = !shouldSuppressAndroidPreviewClear
          && (
            shouldForceStartClear
            || shouldBlackoutFadeTail
            || (!holdFrame && !shouldHoldAtTimelineEnd && !shouldGuardNearEnd && !shouldGuardAfterFinalize)
          );

        if (shouldClearCanvas) {
          const hasExplicitFadeToBlack = activeIndex !== -1 && !!currentItems[activeIndex]?.fadeOut;
          const hasActiveItem = activeIndex !== -1;
          const isBeforeTimelineEnd = totalDurationRef.current > 0 && time < totalDurationRef.current;
          const shouldSuppressEndClear =
            isAndroidPreviewPlayback
            && isActivePlaying
            && hasActiveItem
            && isBeforeTimelineEnd
            && !endFinalizedRef.current
            && !shouldBlackoutFadeTail
            // fade 中 (fadeIn / fadeOut) は毎フレーム黒クリア + alpha 描画で
            // 仕様通りの「黒へ落とす / 黒から立ち上げる」を実現する必要があるため、
            // Android end-clear suppression を fade region では無効化する。
            // これを外すと canvas 上に直前フレーム (= 同じ動画) が残留し、
            // alpha 付き drawImage の math が
            //   result = 0.5*V + 0.5*previousV = V
            // となって fade が視認できない (0df405e 退行).
            && !isInFadeRegion;
          if (shouldSuppressEndClear) {
            if (previewTimelineDiagnosticsRef.current.lastShouldSuppressEndClear !== true) {
              logInfo('RENDER', 'preview.endClear.suppressed', {
                globalTimeMs: Math.round(time * 1000),
                totalDurationMs: Math.round(totalDurationRef.current * 1000),
                isActivePlaying,
                endFinalized: endFinalizedRef.current,
                hasExplicitFadeToBlack,
                shouldBlackoutFadeTail,
                loopId: currentLoopId,
                currentLoopId: loopIdRef.current,
              });
            }
            previewTimelineDiagnosticsRef.current.lastShouldSuppressEndClear = true;
          } else {
            if (previewTimelineDiagnosticsRef.current.lastShouldSuppressEndClear !== false) {
              logInfo('RENDER', 'preview.endClear.executed', {
                globalTimeMs: Math.round(time * 1000),
                totalDurationMs: Math.round(totalDurationRef.current * 1000),
                isActivePlaying,
                endFinalized: endFinalizedRef.current,
                hasExplicitFadeToBlack,
                shouldBlackoutFadeTail,
                loopId: currentLoopId,
                currentLoopId: loopIdRef.current,
              });
            }
            previewTimelineDiagnosticsRef.current.lastShouldSuppressEndClear = false;
            ctx.globalAlpha = 1.0;
            ctx.fillStyle = '#000000';
            ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
            didUpdateCanvas = true;
          }
        }

        // video -> video 境界では、次動画 element を境界までの残り時間に依存せず常に preload="auto"
        // で trimStart に合わせて待機させる。これにより境界到達時に .load() で readyState を 0 へ
        // 戻すような破壊的再フェッチを必要としない (端末性能や負荷に依存しない不変条件)。
        // image -> video 境界は Android Chrome の seek 挙動を考慮し対象外とする (旧挙動を踏襲)。
        let standardImmediateNextVideoId: string | null = null;
        if (isStandardLivePreviewPlayback && activeIndex !== -1) {
          const activeItemForPrewarm = currentItems[activeIndex];
          const immediateNextItem = activeIndex + 1 < currentItems.length
            ? currentItems[activeIndex + 1]
            : null;
          if (
            activeItemForPrewarm?.type === 'video'
            && immediateNextItem?.type === 'video'
          ) {
            const nextElement = mediaElementsRef.current[immediateNextItem.id] as HTMLVideoElement | undefined;
            if (nextElement) {
              standardImmediateNextVideoId = immediateNextItem.id;
              const nextStart = immediateNextItem.trimStart || 0;
              let prebufferDiag: NextVideoPrebufferDiagState | null = null;
              if (isPreviewDiagnosticsLogMode(previewLogModeRef.current)) {
                const remainingToBoundarySec = Math.max(0, activeItemForPrewarm.duration - localTime);
                const existingPrebufferDiag = standardNextVideoPrebufferDiagRef.current[immediateNextItem.id];
                prebufferDiag =
                  existingPrebufferDiag &&
                  Math.abs(existingPrebufferDiag.targetSec - nextStart) <= 0.001
                    ? existingPrebufferDiag
                    : {
                      videoId: immediateNextItem.id,
                      startedAtMs: Date.now(),
                      targetSec: nextStart,
                      leadSec: Number.isFinite(remainingToBoundarySec) ? remainingToBoundarySec : null,
                      armed: false,
                    };
                standardNextVideoPrebufferDiagRef.current[immediateNextItem.id] = prebufferDiag;
              }
              if (nextElement.preload !== 'auto') {
                nextElement.preload = 'auto';
              }
              // .load() は readyState を 0 にリセットする破壊的操作なので、自然復旧目的
              // (まだ何も読まれていない、かつエラーも無い) のときだけ初回ロードを促す。
              if (nextElement.readyState === 0 && !nextElement.error) {
                try { nextElement.load(); } catch { /* ignore */ }
              }
              // 停止中で seek 完了済みなら、trimStart から大きく外れたときだけ静かに合わせる。
              // 再生中の動画 (= 直前 clip と入れ替わる直前) は触らずに browser の buffering に任せる。
              if (
                nextElement.paused
                && !nextElement.seeking
                && nextElement.readyState >= MIN_VIDEO_READY_STATE_FOR_SEEK
                && Math.abs(nextElement.currentTime - nextStart)
                  > STANDARD_PREVIEW_NEXT_VIDEO_PREWARM_DRIFT_TOLERANCE_SEC
              ) {
                nextElement.currentTime = nextStart;
              }
              if (prebufferDiag) {
                prebufferDiag.armed =
                  nextElement.readyState >= MIN_VIDEO_READY_STATE_FOR_SEEK
                  && !nextElement.seeking
                  && Math.abs(nextElement.currentTime - nextStart)
                    <= STANDARD_PREVIEW_NEXT_VIDEO_PREWARM_DRIFT_TOLERANCE_SEC;
              }
            }
          }
        }
        const allowExtendedFutureVideoPrewarm = !activeId || currentItems[activeIndex]?.type !== 'video';
        let nearestFutureVideoId: string | null = null;
        for (const item of currentItems) {
          const timelineRange = timelineRanges.get(item.id);
          if (!timelineRange || item.type !== 'video') {
            continue;
          }
          if (timelineRange.start - time > 0.0005) {
            nearestFutureVideoId = item.id;
            break;
          }
        }

        Object.keys(mediaElementsRef.current).forEach((id) => {
          if (id === 'bgm' || id.startsWith('narration:')) return;

          const element = mediaElementsRef.current[id];
          const gainNode = gainNodesRef.current[id];
          const conf = currentItems.find((v) => v.id === id);

          if (!element || !conf) return;

          if (id === activeId) {
            const shouldStabilizeImageToVideoTransition =
              shouldStabilizeImageToVideoTransitionDuringExport({
                isExporting: _isExporting,
                isAndroid: platformCapabilities.isAndroid,
                activeItemType: conf.type,
                previousItemType: activeIndex > 0 ? currentItems[activeIndex - 1]?.type ?? null : null,
                clipLocalTime: localTime,
              });
            if (conf.type === 'video') {
              const videoEl = element as HTMLVideoElement;
              const targetTime = (conf.trimStart || 0) + localTime;
              const activeVideoDrift = Math.abs(videoEl.currentTime - targetTime);
              const hasExportPlayFailure = _isExporting && !!exportPlayFailedRef.current[id];
              const syncThreshold = shouldStabilizeImageToVideoTransition
                ? 0.01
                : getPreviewVideoSyncThreshold(previewPlatformPolicy, {
                  isExporting: _isExporting,
                  hasExportPlayFailure,
                });

              if (isActivePlaying && activeVideoIdRef.current !== id) {
                activeVideoIdRef.current = id;
              }

              if (videoEl.readyState === 0 && !videoEl.error) {
                const now = Date.now();
                const lastAttempt = videoRecoveryAttemptsRef.current[id] || 0;
                if (now - lastAttempt > 2000) {
                  videoRecoveryAttemptsRef.current[id] = now;
                  try { videoEl.load(); } catch { /* ignore */ }
                }
              }

              const isUserSeeking = isSeekingRef.current;
              const isVideoSeeking = videoEl.seeking;

              if (isActivePlaying && !isUserSeeking) {
                if (shouldStabilizeImageToVideoTransition) {
                  if (
                    !isVideoSeeking
                    && Math.abs(videoEl.currentTime - targetTime)
                    > EXPORT_IMAGE_TO_VIDEO_STABILIZATION_SYNC_TOLERANCE_SEC
                  ) {
                    videoEl.currentTime = targetTime;
                  }
                  if (!videoEl.paused) {
                    videoEl.pause();
                  }
                }
                const shouldHoldVideoAtClipEnd = shouldHoldVideoFrameAtClipEnd({
                  clipLocalTime: localTime,
                  clipDuration: conf.duration,
                  trimStart: conf.trimStart || 0,
                  videoCurrentTime: videoEl.currentTime,
                  videoEnded: videoEl.ended,
                  isExporting: _isExporting,
                  isIosSafari: platformCapabilities.isIosSafari,
                  isLastTimelineItem: activeIndex === currentItems.length - 1,
                  nextItemType: activeIndex + 1 < currentItems.length
                    ? currentItems[activeIndex + 1]?.type ?? null
                    : null,
                  fps: FPS,
                });

                const shouldUseExportFallbackSeek =
                  _isExporting &&
                  hasExportPlayFailure &&
                  videoEl.paused &&
                  !isVideoSeeking &&
                  !shouldHoldVideoAtClipEnd &&
                  Math.abs(videoEl.currentTime - targetTime) > 0.04;
                if (shouldUseExportFallbackSeek) {
                  const nowMs = Date.now();
                  const lastSeekAtMs = exportFallbackSeekAtRef.current[id] || 0;
                  if (nowMs - lastSeekAtMs >= 140) {
                    exportFallbackSeekAtRef.current[id] = nowMs;
                    videoEl.currentTime = targetTime;
                  }
                }
                  const shouldDeferTrimmedHeadSync =
                  // trimStart 付き clip の head は hold 優先で安定させる。ここで currentTime correction を強制すると
                  // Android fallback が boundary 到達後の場当たり seek に戻りやすい。
                    isAndroidPreviewPlayback
                    && conf.trimStart > 0.001
                    && localTime <= 0.3;
                  const androidPreviewSyncThreshold = isAndroidPreviewPlayback
                    ? Math.max(syncThreshold, ANDROID_PREVIEW_RESYNC_THRESHOLD_SEC)
                    : syncThreshold;

                  if (
                    !isAndroidPreviewPlayback &&
                    !shouldDeferTrimmedHeadSync &&
                    !isVideoSeeking &&
                    !shouldHoldVideoAtClipEnd &&
                    !hasExportPlayFailure &&
                    !(
                      isAndroidPreviewPlayback
                      && localTime <= 0.3
                      && videoEl.readyState >= MIN_VIDEO_READY_STATE_FOR_CURRENT_FRAME
                      && Math.abs(videoEl.currentTime - targetTime) <= ANDROID_PREVIEW_SOFT_DRAW_DRIFT_THRESHOLD_SEC
                  ) &&
                    Math.abs(videoEl.currentTime - targetTime) > androidPreviewSyncThreshold
                  ) {
                    videoEl.currentTime = targetTime;
                  }
                if (
                  !shouldStabilizeImageToVideoTransition &&
                  videoEl.paused &&
                  videoEl.readyState >= 1 &&
                  !shouldHoldVideoAtClipEnd &&
                  !hasExportPlayFailure
                ) {
                  const canPlayAndroidPreviewActiveVideoAfterDraw =
                    isAndroidPreviewPlayback
                    && !isVideoSeeking
                    && canDrawVideo(videoEl);
                  if (isAndroidPreviewPlayback) {
                    if (canPlayAndroidPreviewActiveVideoAfterDraw) {
                      shouldPlayAndroidPreviewActiveVideoAfterDraw = true;
                    } else {
                      requestVideoPlayWithRetry(videoEl, () =>
                        isPlayingRef.current
                        && !isSeekingRef.current
                        && loopIdRef.current === currentLoopId,
                      );
                    }
                  } else {
                    videoEl.play().then(() => {
                      if (_isExporting) {
                        delete exportPlayFailedRef.current[id];
                        delete exportFallbackSeekAtRef.current[id];
                      }
                    }).catch((err) => {
                      if (_isExporting && !exportPlayFailedRef.current[id]) {
                        exportPlayFailedRef.current[id] = true;
                        exportFallbackSeekAtRef.current[id] = 0;
                        logWarn('RENDER', 'エクスポート中の動画再生開始に失敗。シーク同期フォールバックへ切替', {
                          videoId: id,
                          error: err instanceof Error ? err.message : String(err),
                        });
                      }
                    });
                  }
                }

                const androidRecoveryDecision = getAndroidPreviewRecoveryDecision({
                  isAndroid: platformCapabilities.isAndroid,
                  isIosSafari: platformCapabilities.isIosSafari,
                  isExporting: _isExporting,
                  isActivePlaying,
                  isUserSeeking,
                  videoPaused: videoEl.paused,
                  videoSeeking: isVideoSeeking,
                  videoReadyState: videoEl.readyState,
                  videoWidth: videoEl.videoWidth,
                  videoHeight: videoEl.videoHeight,
                  videoCurrentTime: videoEl.currentTime,
                  targetTime,
                  syncThresholdSec: PREVIEW_ANDROID_RECOVERY_DRIFT_THRESHOLD_SEC,
                  softDrawDriftThresholdSec: ANDROID_PREVIEW_SOFT_DRAW_DRIFT_THRESHOLD_SEC,
                });
                if (androidRecoveryDecision.shouldRecover) {
                  const now = Date.now();
                  const lastAttempt = videoRecoveryAttemptsRef.current[id] || 0;
                  const shouldHoldRecoveryFrame =
                    androidRecoveryDecision.shouldHoldFrame
                    && localTime >= 0
                    && localTime <= PREVIEW_ANDROID_PASSIVE_HOLD_MAX_SEC;
                  holdFrame = holdFrame || shouldHoldRecoveryFrame;
                  if (now - lastAttempt > 220) {
                    videoRecoveryAttemptsRef.current[id] = now;
                    const recoveryState = androidPreviewRecoveryRef.current[id] ?? {
                      active: true,
                      reason: androidRecoveryDecision.reason ?? 'ready-state-low',
                      startedAt: now,
                      lastAttemptAt: 0,
                      lastTargetTime: targetTime,
                      attempts: 0,
                    };
                    recoveryState.attempts += 1;
                    recoveryState.lastAttemptAt = now;
                    recoveryState.lastTargetTime = targetTime;
                    androidPreviewRecoveryRef.current[id] = recoveryState;
                    if (videoEl.readyState === 0 && !videoEl.error) {
                      try { videoEl.load(); } catch { /* ignore */ }
                    }
                    if (
                      androidRecoveryDecision.shouldResyncTime
                      && !videoEl.seeking
                      && videoEl.readyState >= 1
                    ) {
                      const lastSeekAtMs = androidPreviewLastSeekAtRef.current[id] || 0;
                      const sinceLastSeekMs = now - lastSeekAtMs;
                      const segmentRecoveryKey = `${activeIndex}:${id}`;
                      const alreadyRecoveredSegment =
                        androidPreviewRecoveredSegmentRef.current[id] === segmentRecoveryKey;
                      // recovery seek は Android passive preview の最後の手段で、1 segment あたり 1 回だけ許可する。
                      if (
                        localTime >= 0
                        &&
                        sinceLastSeekMs >= PREVIEW_ANDROID_RECOVERY_MIN_INTERVAL_MS
                        && activeVideoDrift >= PREVIEW_ANDROID_RECOVERY_DRIFT_THRESHOLD_SEC
                        && localTime > PREVIEW_ANDROID_RECOVERY_SKIP_AFTER_BOUNDARY_SEC
                        && !alreadyRecoveredSegment
                      ) {
                        maybeAssignAndroidPreviewSeek({
                          videoEl,
                          reason: androidRecoveryDecision.reason ?? 'timeline-drift',
                          videoId: id,
                          segmentIndex: activeIndex,
                          segmentRecoveryKey,
                          targetTime,
                          currentTimeBefore: videoEl.currentTime,
                          drift: activeVideoDrift,
                          sinceLastSeekMs,
                        });
                      }
                    }
                    if (
                      androidRecoveryDecision.shouldRetryPlay
                      && !shouldPlayAndroidPreviewActiveVideoAfterDraw
                      && !isVideoSeeking
                      && videoEl.readyState >= MIN_VIDEO_READY_STATE_FOR_CURRENT_FRAME
                    ) {
                      requestVideoPlayWithRetry(videoEl, () =>
                        isPlayingRef.current
                        && !isSeekingRef.current
                        && loopIdRef.current === currentLoopId,
                      );
                    }
                  }
                } else if (androidPreviewRecoveryRef.current[id]) {
                  delete androidPreviewRecoveryRef.current[id];
                  const rebasedStartTime = getStandardPreviewNow() - currentTimeRef.current * 1000;
                  const clockAbsorbMs = Math.abs(rebasedStartTime - startTimeRef.current);
                  startTimeRef.current = rebasedStartTime;
                  if (previewTimelineDiagnosticsRef.current.activeBoundary !== null) {
                    previewTimelineDiagnosticsRef.current.activeBoundary.clockAbsorbMs += clockAbsorbMs;
                  }
                  primePreviewAudioOnlyTracksAtTimeRef.current(currentTimeRef.current);
                }
              } else if (!isActivePlaying && !isUserSeeking) {
                if (!videoEl.paused) {
                  videoEl.pause();
                }
              }
            } else {
              if (isActivePlaying && activeVideoIdRef.current !== null) {
                activeVideoIdRef.current = null;
              }
            }

            const isVideo = conf.type === 'video';
            const videoEl = element as HTMLVideoElement;
            const imgEl = element as HTMLImageElement;
            const isVideoReady = isVideo
              ? videoEl.readyState >= 2 && !videoEl.seeking
              : false;
            const isReady = isVideo ? isVideoReady : imgEl.complete;
            const shouldSkipVideoDrawForFadeTail =
              isVideo
              && id === activeId
              && shouldBlackoutFadeTail;
            const shouldSkipVideoDrawForAndroidHold =
              isVideo
              && id === activeId
              && shouldSkipAndroidPreviewActiveDraw;

            if (isReady && !shouldSkipVideoDrawForFadeTail && !shouldSkipVideoDrawForAndroidHold) {
              const elemW = isVideo ? videoEl.videoWidth : imgEl.naturalWidth;
              const elemH = isVideo ? videoEl.videoHeight : imgEl.naturalHeight;
              if (elemW && elemH) {
                const scaleFactor = conf.scale || 1.0;
                const userX = conf.positionX || 0;
                const userY = conf.positionY || 0;

                const baseScale = Math.min(ctx.canvas.width / elemW, ctx.canvas.height / elemH);

                ctx.save();
                ctx.translate(ctx.canvas.width / 2 + userX, ctx.canvas.height / 2 + userY);
                ctx.scale(baseScale * scaleFactor, baseScale * scaleFactor);

                let alpha = 1.0;
                let fadeInDur = conf.fadeIn ? (conf.fadeInDuration || 1.0) : 0;
                let fadeOutDur = conf.fadeOut ? (conf.fadeOutDuration || 1.0) : 0;
                // フェード時間のクランプ（フェードイン + フェードアウト > クリップ長の場合に按分）。
                // export と同じロジックを使い、プレビューと書き出しでフェード挙動を一致させる。
                if (fadeInDur + fadeOutDur > conf.duration && conf.duration > 0) {
                  const ratio = conf.duration / (fadeInDur + fadeOutDur);
                  fadeInDur *= ratio;
                  fadeOutDur *= ratio;
                }

                if (fadeInDur > 0 && localTime < fadeInDur) {
                  alpha = localTime / fadeInDur;
                } else if (fadeOutDur > 0 && localTime > conf.duration - fadeOutDur) {
                  const remaining = conf.duration - localTime;
                  alpha = remaining / fadeOutDur;
                }

                ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
                try {
                  ctx.drawImage(element as CanvasImageSource, -elemW / 2, -elemH / 2, elemW, elemH);
                  didUpdateCanvas = true;
                } finally {
                  if (
                    shouldPlayAndroidPreviewActiveVideoAfterDraw
                    && isVideo
                    && id === activeId
                    && videoEl.paused
                  ) {
                    shouldPlayAndroidPreviewActiveVideoAfterDraw = false;
                    requestVideoPlayWithRetry(videoEl, () =>
                      isPlayingRef.current
                      && !isSeekingRef.current
                      && loopIdRef.current === currentLoopId,
                    );
                  }
                  ctx.restore();
                  ctx.globalAlpha = 1.0;
                }
              }
            }

            if (conf.type === 'video') {
              const videoMediaEl = element as HTMLMediaElement;
              let hasAudioNode = !!sourceNodesRef.current[id];
              const currentGainNode = gainNodesRef.current[id];
              if (isActivePlaying) {
                let vol = holdAudioThisFrame ? 0 : (conf.isMuted ? 0 : conf.volume);
                const fadeInDur = conf.fadeInDuration || 1.0;
                const fadeOutDur = conf.fadeOutDuration || 1.0;

                if (conf.fadeIn && localTime < fadeInDur) {
                  vol *= localTime / fadeInDur;
                } else if (conf.fadeOut && localTime > conf.duration - fadeOutDur) {
                  const remaining = conf.duration - localTime;
                  vol *= remaining / fadeOutDur;
                }

                if (
                  !hasAudioNode &&
                  getPreviewAudioOutputMode(previewPlatformPolicy, {
                    hasAudioNode: false,
                    isExporting: _isExporting,
                    audibleSourceCount: vol > 0 ? activePreviewAudioSourceCount : 0,
                    desiredVolume: vol,
                    sourceType: 'video',
                  }) === 'webaudio'
                ) {
                  hasAudioNode = ensureAudioNodeForElement(id, videoMediaEl);
                  if (hasAudioNode && !_isExporting) {
                    requestPreviewAudioRouteRefreshRef.current();
                  }
                }

                const outputMode = applyPreviewAudioOutputState(previewPlatformPolicy, videoMediaEl, {
                  hasAudioNode,
                  desiredVolume: vol,
                  audibleSourceCount: vol > 0 ? activePreviewAudioSourceCount : 0,
                  isExporting: _isExporting,
                });

                if (outputMode === 'native' && hasAudioNode) {
                  detachAudioNode(id);
                  hasAudioNode = false;
                }

                const effectiveGain = outputMode === 'native' ? 0 : vol;
                if (currentGainNode && audioCtxRef.current) {
                  const currentGain = currentGainNode.gain.value;
                  if (Math.abs(currentGain - effectiveGain) > 0.01) {
                    currentGainNode.gain.setTargetAtTime(
                      effectiveGain,
                      audioCtxRef.current.currentTime,
                      shouldStabilizeImageToVideoTransition ? 0.01 : 0.05,
                    );
                  }
                }
              } else {
                applyPreviewAudioOutputState(previewPlatformPolicy, videoMediaEl, {
                  hasAudioNode,
                  desiredVolume: 0,
                  audibleSourceCount: 0,
                  isExporting: _isExporting,
                });
                if (currentGainNode && audioCtxRef.current) {
                  currentGainNode.gain.setTargetAtTime(0, audioCtxRef.current.currentTime, 0.05);
                }
              }
            }
          } else {
            if (conf.type === 'video') {
              const videoEl = element as HTMLVideoElement;
              const hasVideoAudioNode = !!sourceNodesRef.current[id];
              const timelineRange = timelineRanges.get(id);
              const timeSinceVideoEndSec = timelineRange
                ? time - timelineRange.end
                : null;
              const timeUntilVideoStartSec = timelineRange
                ? timelineRange.start - time
                : null;
              const shouldKeepVideoPrewarmed = !isAndroidPreviewPlayback && shouldKeepInactiveVideoPrewarmed(previewPlatformPolicy, {
                hasAudioNode: hasVideoAudioNode,
                isExporting: _isExporting,
                isActivePlaying,
                timeSinceVideoEndSec,
                timeUntilVideoStartSec,
                isNearestFutureVideo: id === nearestFutureVideoId,
                allowExtendedFuturePrewarm: allowExtendedFutureVideoPrewarm,
              });
              const avoidPausePlayForInactive = shouldAvoidPauseInactiveVideoInPreview(previewPlatformPolicy, {
                hasAudioNode: hasVideoAudioNode,
                isExporting: _isExporting,
                isActivePlaying,
              });
              const shouldPrimeFutureVideo = !isAndroidPreviewPlayback && shouldPrimeFutureInactiveVideoInPreview(previewPlatformPolicy, {
                hasAudioNode: hasVideoAudioNode,
                isExporting: _isExporting,
                isActivePlaying,
                shouldKeepVideoPrewarmed,
                timeUntilVideoStartSec,
              });
              const shouldRecoverAudioOnlyAfterBoundary = shouldRecoverAudioOnlyAfterVideoBoundary(previewPlatformPolicy, {
                hasAudioNode: hasVideoAudioNode,
                isExporting: _isExporting,
                isActivePlaying,
                timeSinceVideoEndSec,
              });
              const isStandardImmediateNextVideo = id === standardImmediateNextVideoId;

              if (shouldRecoverAudioOnlyAfterBoundary) {
                const ctx = audioCtxRef.current;
                if (ctx && (ctx.state as AudioContextState | 'interrupted') !== 'running') {
                  ctx.resume().catch(() => { });
                }
                primePreviewAudioOnlyTracksAtTimeRef.current(time);
              }

              if (shouldPrimeFutureVideo && videoEl.paused && !videoEl.seeking && videoEl.readyState >= 2) {
                const startTime = conf.trimStart || 0;
                if (Math.abs(videoEl.currentTime - startTime) > 0.1) {
                  videoEl.currentTime = startTime;
                }
                videoEl.play().catch(() => { });
              }

              if (!shouldKeepVideoPrewarmed && !isStandardImmediateNextVideo && id !== activeVideoIdRef.current) {
                videoEl.preload = 'metadata';
              }

              if (!shouldKeepVideoPrewarmed && !avoidPausePlayForInactive && !videoEl.paused) {
                videoEl.pause();
                if (
                  hasVideoAudioNode
                  && isActivePlaying
                  && previewPlatformPolicy.muteNativeMediaWhenAudioRouted
                  && !_isExporting
                ) {
                  const ctx = audioCtxRef.current;
                  if (ctx && (ctx.state as AudioContextState | 'interrupted') !== 'running') {
                    ctx.resume().catch(() => { });
                  }
                  primePreviewAudioOnlyTracksAtTimeRef.current(time);
                }
              }
              applyPreviewAudioOutputState(previewPlatformPolicy, videoEl, {
                hasAudioNode: hasVideoAudioNode,
                desiredVolume: 0,
                audibleSourceCount: 0,
                isExporting: _isExporting,
              });
            }
            if (conf.type === 'video' && gainNode && audioCtxRef.current) {
              gainNode.gain.setTargetAtTime(0, audioCtxRef.current.currentTime, 0.05);
            }
          }
        });

        const currentCaptions = captionsRef.current;
        const currentCaptionSettings = captionSettingsRef.current;
        const exportFrameIndex = _isExporting ? Math.max(0, Math.floor(time * FPS + 1e-9)) : null;
        const exportDurationAlignment = _isExporting
          ? resolveExportDuration(totalDurationRef.current, FPS)
          : null;
        const exportFrameTiming = (_isExporting && exportDurationAlignment && exportFrameIndex !== null && exportFrameIndex < exportDurationAlignment.frameCount)
          ? getExportFrameTiming(exportDurationAlignment, FPS, exportFrameIndex)
          : null;
        if (currentCaptionSettings.enabled && currentCaptions.length > 0) {
          const activeCaptions = currentCaptions.filter(
            (c) => isCaptionActiveAtTime(c, time),
          );
          for (const activeCaption of activeCaptions) {
            if (_isExporting && exportFrameTiming && time <= 3) {
              logInfo('RENDER', '[DIAG-CAPTION-EXPORT-TIMING]', {
                frameIndex: exportFrameIndex,
                frameTimestampUs: exportFrameTiming.timestampUs,
                exportFrameTimeSec: time,
                captionId: activeCaption.id,
                captionStart: activeCaption.startTime,
                captionEnd: activeCaption.endTime,
                isActive: isCaptionActiveAtTime(activeCaption, time),
              });
            }
            // fontSize は 1080p export を基準にした絶対 px (medium = 7.41% of 1080)。
            // 解像度に応じて captionScale で按分するため、SNS 等で異なるサイズの画面で
            // 再生されても「フレームに対する文字の比率」は常に同じになる (WYSIWYG)。
            // 各段階 ~1.4 倍ずつ拡大する読みやすさ重視のサイズスケール。
            const fontSizeMap = { small: 56, medium: 80, large: 112, xlarge: 148 };
            const effectiveFontSizeKey = activeCaption.overrideFontSize ?? currentCaptionSettings.fontSize;
            const baseFontSize = fontSizeMap[effectiveFontSizeKey];

            // プレビューは 720p、エクスポートは 1080p で同じ canvas を使い回すため、
            // 1080p を基準にスケールしておくと「プレビューで見たまま export される (WYSIWYG)」になる。
            // 720p プレビュー時は fontSize/padding/stroke/blur を 0.667 倍に縮小し、
            // export と同じキャンバス高さ比率で配置する。
            const CAPTION_REFERENCE_HEIGHT = 1080;
            const captionScale = Math.max(0.1, ctx.canvas.height / CAPTION_REFERENCE_HEIGHT);
            const fontSize = Math.max(1, baseFontSize * captionScale);

            const fontFamilyMap = {
              gothic: 'sans-serif',
              mincho: '"游明朝", "Yu Mincho", "ヒラギノ明朝 ProN", "Hiragino Mincho ProN", serif',
            };
            const effectiveFontStyle = activeCaption.overrideFontStyle ?? currentCaptionSettings.fontStyle;
            const fontFamily = fontFamilyMap[effectiveFontStyle];

            const effectivePosition = activeCaption.overridePosition ?? currentCaptionSettings.position;
            const padding = 50 * captionScale;
            let y: number;
            if (effectivePosition === 'top') {
              y = padding + fontSize / 2;
            } else if (effectivePosition === 'center') {
              y = ctx.canvas.height / 2;
            } else {
              y = ctx.canvas.height - padding - fontSize / 2;
            }

            const captionDuration = activeCaption.endTime - activeCaption.startTime;
            const captionLocalTime = time - activeCaption.startTime;

            const useFadeIn = activeCaption.overrideFadeIn !== undefined
              ? activeCaption.overrideFadeIn === 'on'
              : currentCaptionSettings.bulkFadeIn;
            const useFadeOut = activeCaption.overrideFadeOut !== undefined
              ? activeCaption.overrideFadeOut === 'on'
              : currentCaptionSettings.bulkFadeOut;

            const fadeInDur = activeCaption.overrideFadeIn === 'on' && activeCaption.overrideFadeInDuration !== undefined
              ? activeCaption.overrideFadeInDuration
              : (currentCaptionSettings.bulkFadeInDuration || 1.0);
            const fadeOutDur = activeCaption.overrideFadeOut === 'on' && activeCaption.overrideFadeOutDuration !== undefined
              ? activeCaption.overrideFadeOutDuration
              : (currentCaptionSettings.bulkFadeOutDuration || 1.0);

            let fadeInAlpha = 1.0;
            let fadeOutAlpha = 1.0;

            if (useFadeIn && captionLocalTime < fadeInDur) {
              fadeInAlpha = captionLocalTime / fadeInDur;
            }
            if (useFadeOut && captionLocalTime > captionDuration - fadeOutDur) {
              const remaining = captionDuration - captionLocalTime;
              fadeOutAlpha = remaining / fadeOutDur;
            }

            const alpha = Math.max(0, Math.min(1, fadeInAlpha * fadeOutAlpha));

            ctx.save();
            ctx.font = `bold ${fontSize}px ${fontFamily}`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            // strokeWidth / blur も fontSize と同じスケールで縮小し、プレビュー/export で太さの比率を保つ。
            const scaledStrokeWidth = Math.max(0, currentCaptionSettings.strokeWidth * captionScale);
            const blurStrength = Math.max(0, currentCaptionSettings.blur * captionScale);
            const centerX = ctx.canvas.width / 2;

            // フェード時の輪郭残りを防ぐため、stroke+fill を 1 枚のオフスクリーン Canvas に
            // 100% の不透明度で合成してから、メインキャンバスへ globalAlpha 付きで転写する。
            const glyphCanvas = createCaptionGlyphCanvas({
              text: activeCaption.text,
              font: `bold ${fontSize}px ${fontFamily}`,
              fillColor: currentCaptionSettings.fontColor,
              strokeColor: currentCaptionSettings.strokeColor,
              strokeWidth: scaledStrokeWidth,
            });
            const glyphW = glyphCanvas.width;
            const glyphH = glyphCanvas.height;
            const drawGlyphAt = (cx: number, cy: number, localAlpha: number) => {
              const clamped = Math.max(0, Math.min(1, localAlpha));
              if (clamped <= 0) return;
              didUpdateCanvas = true;
              ctx.globalAlpha = alpha * clamped;
              ctx.drawImage(glyphCanvas, cx - glyphW / 2, cy - glyphH / 2);
            };

            if (shouldUseCaptionBlurFallback(previewPlatformPolicy, blurStrength)) {
              const blurNorm = Math.min(1, blurStrength / 5);
              const ringCount = Math.max(3, Math.round(blurStrength * 3.5));
              const samplesPerRing = 18;
              const maxRadius = Math.max(1.5, blurStrength * 2.6);
              const totalSamples = ringCount * samplesPerRing;
              const prevComposite = ctx.globalCompositeOperation;

              ctx.globalCompositeOperation = 'lighter';

              for (let ring = 1; ring <= ringCount; ring++) {
                const radius = (ring / ringCount) * maxRadius;
                const ringWeight = Math.max(0.3, 1 - ((ring - 1) / Math.max(1, ringCount - 1)) * 0.55);
                const sampleAlpha = ((0.95 + blurNorm * 0.55) * ringWeight) / totalSamples;
                for (let i = 0; i < samplesPerRing; i++) {
                  const angle = (Math.PI * 2 * i) / samplesPerRing;
                  const offsetX = Math.cos(angle) * radius;
                  const offsetY = Math.sin(angle) * radius;
                  drawGlyphAt(centerX + offsetX, y + offsetY, sampleAlpha);
                }
              }

              ctx.globalCompositeOperation = prevComposite;

              // 中央のクリスプなコア層。stroke と fill は glyphCanvas 内で既に合成済みのため、
              // 単一のアルファ値で同期してフェードする (輪郭だけ残る現象を回避)。
              const coreAlpha = Math.max(0.35, 0.9 - blurNorm * 0.45);
              if (coreAlpha > 0.01) {
                drawGlyphAt(centerX, y, coreAlpha);
              }
              ctx.restore();
              continue;
            }

            ctx.filter = blurStrength > 0 ? `blur(${blurStrength}px)` : 'none';
            drawGlyphAt(centerX, y, 1);
            ctx.restore();
          }
        }

        const ensurePreviewAudioGainNode = (trackId: string, element: HTMLAudioElement) => {
          let gainNode = gainNodesRef.current[trackId];
          let hasAudioNode = !!sourceNodesRef.current[trackId];

          if (!_isExporting && !hasAudioNode) {
            hasAudioNode = ensureAudioNodeForElement(trackId, element);
            gainNode = gainNodesRef.current[trackId];
          }

          return { hasAudioNode, gainNode };
        };

        const processAudioTrack = (track: AudioTrack | null, trackId: 'bgm') => {
          const element = mediaElementsRef.current[trackId] as HTMLAudioElement;
          let { gainNode, hasAudioNode } = element
            ? ensurePreviewAudioGainNode(trackId, element)
            : { gainNode: gainNodesRef.current[trackId], hasAudioNode: !!sourceNodesRef.current[trackId] };
          const isAndroidPreviewBgmTrack =
            isAndroidPreviewPlayback
            && trackId === 'bgm';

          if (track && element) {
            const avoidPausePlay = hasAudioNode
              && previewPlatformPolicy.muteNativeMediaWhenAudioRouted
              && !_isExporting;

            if (isActivePlaying) {
              if (time < track.delay) {
                applyPreviewAudioOutputState(previewPlatformPolicy, element, {
                  hasAudioNode,
                  desiredVolume: 0,
                  audibleSourceCount: 0,
                  isExporting: _isExporting,
                });
                if (gainNode && audioCtxRef.current) {
                  gainNode.gain.setTargetAtTime(0, audioCtxRef.current.currentTime, 0.01);
                }
                if (!avoidPausePlay && !element.paused) element.pause();
              } else {
                let vol = clampPreviewAudioGain(track.volume);
                const trackTime = time - track.delay + track.startPoint;

                if (trackTime <= track.duration) {
                  if (isAndroidPreviewBgmTrack) {
                    // Android standard preview の BGM は active video を待たせないため、
                    // readyState を待たずに緩めのしきい値で fire-and-forget に同期する。
                    if (element.readyState === 0 && !element.error) {
                      try { element.load(); } catch { /* ignore */ }
                    }
                    if (
                      element.readyState >= MIN_VIDEO_READY_STATE_FOR_SEEK
                      && !element.seeking
                      && Math.abs(element.currentTime - trackTime) > PREVIEW_ANDROID_BGM_SOFT_SYNC_TOLERANCE_SEC
                    ) {
                      element.currentTime = trackTime;
                    }
                    if (holdAudioThisFrame) {
                      if (!element.paused) {
                        element.pause();
                      }
                    } else if (element.paused && element.readyState >= MIN_VIDEO_READY_STATE_FOR_CURRENT_FRAME) {
                      element.play().catch(() => { });
                    }
                  } else {
                    const needsSeek = Math.abs(element.currentTime - trackTime) > (avoidPausePlay ? 2.0 : 0.5);

                    if (needsSeek) {
                      if (avoidPausePlay) {
                        element.currentTime = trackTime;
                      } else {
                        if (!element.paused) {
                          element.pause();
                        }
                        element.currentTime = trackTime;
                      }
                    }

                    if (avoidPausePlay) {
                      if (element.paused && !element.seeking && element.readyState >= 2) {
                        element.play().catch(() => { });
                      }
                    } else if (holdAudioThisFrame) {
                      if (!element.paused) {
                        element.pause();
                      }
                    } else if (!element.seeking && element.readyState >= 2 && element.paused) {
                      element.play().catch(() => { });
                    }
                  }

                    vol = resolvePreviewAudioGain({
                      baseVolume: track.volume,
                      time,
                      startTime: track.delay,
                      totalDuration: totalDurationRef.current,
                      fadeIn: track.fadeIn,
                      fadeOut: track.fadeOut,
                      fadeInDuration: track.fadeInDuration,
                      fadeOutDuration: track.fadeOutDuration,
                    });

                  // BGM soft sync 中は active video 優先で進めたいので、
                  // audio resume wait による追加ミュートを掛けず独立に追従させる。
                  if (element.seeking || (!isAndroidPreviewBgmTrack && !avoidPausePlay && holdAudioThisFrame)) {
                    vol = 0;
                  }

                    const outputMode = applyPreviewAudioOutputState(previewPlatformPolicy, element, {
                      hasAudioNode,
                      desiredVolume: vol,
                      audibleSourceCount: vol > 0 ? activePreviewAudioSourceCount : 0,
                      isExporting: _isExporting,
                    });
                    const effectiveGain = outputMode === 'native' ? 0 : vol;
                    if (gainNode && audioCtxRef.current) {
                      const currentGain = gainNode.gain.value;
                      if (Math.abs(currentGain - effectiveGain) > 0.01) {
                        gainNode.gain.setTargetAtTime(effectiveGain, audioCtxRef.current.currentTime, 0.1);
                    }
                  }
                } else {
                  applyPreviewAudioOutputState(previewPlatformPolicy, element, {
                    hasAudioNode,
                    desiredVolume: 0,
                    audibleSourceCount: 0,
                    isExporting: _isExporting,
                  });
                  if (gainNode && audioCtxRef.current) {
                    const endAt = Math.max(0, track.delay + track.duration);
                    gainNode.gain.setValueAtTime(0, endAt);
                  }
                  if (!avoidPausePlay && !element.paused) element.pause();
                }
              }
            } else {
              applyPreviewAudioOutputState(previewPlatformPolicy, element, {
                hasAudioNode,
                desiredVolume: 0,
                audibleSourceCount: 0,
                isExporting: _isExporting,
              });
              if (gainNode && audioCtxRef.current) {
                gainNode.gain.setTargetAtTime(0, audioCtxRef.current.currentTime, 0.1);
              }
              if (!element.paused) element.pause();

              const trackTime = time - track.delay + track.startPoint;
              if (trackTime >= 0 && trackTime <= track.duration) {
                if (Math.abs(element.currentTime - trackTime) > 0.1) {
                  element.currentTime = trackTime;
                }
              }
            }
          }
        };

        const processNarrationClip = (clip: NarrationClip) => {
          const trackId = `narration:${clip.id}`;
          const element = mediaElementsRef.current[trackId] as HTMLAudioElement;
          let { gainNode, hasAudioNode } = element
            ? ensurePreviewAudioGainNode(trackId, element)
            : { gainNode: gainNodesRef.current[trackId], hasAudioNode: !!sourceNodesRef.current[trackId] };

          if (!element) return;

          const trimStart = Number.isFinite(clip.trimStart) ? Math.max(0, clip.trimStart) : 0;
          const trimEnd = Number.isFinite(clip.trimEnd) ? Math.max(trimStart, Math.min(clip.duration, clip.trimEnd)) : clip.duration;
          const playableDuration = Math.max(0, trimEnd - trimStart);
          const clipTime = time - clip.startTime;
          const sourceTime = trimStart + clipTime;
          const inRange = clipTime >= 0 && clipTime <= playableDuration;

          const avoidNarPause = hasAudioNode
            && previewPlatformPolicy.muteNativeMediaWhenAudioRouted
            && !_isExporting;

          if (isActivePlaying) {
            if (!inRange) {
              applyPreviewAudioOutputState(previewPlatformPolicy, element, {
                hasAudioNode,
                desiredVolume: 0,
                audibleSourceCount: 0,
                isExporting: _isExporting,
              });
              if (gainNode && audioCtxRef.current) {
                gainNode.gain.setTargetAtTime(0, audioCtxRef.current.currentTime, 0.1);
              }
              if (!avoidNarPause && !element.paused) element.pause();
              return;
            }

            const needsSeek = Math.abs(element.currentTime - sourceTime) > (avoidNarPause ? 2.0 : 0.5);
            if (needsSeek) {
              if (avoidNarPause) {
                element.currentTime = sourceTime;
              } else {
                if (!element.paused) {
                  element.pause();
                }
                element.currentTime = sourceTime;
              }
            }

            if (avoidNarPause) {
              if (element.paused && !element.seeking && element.readyState >= 2) {
                element.play().catch(() => { });
              }
            } else if (holdAudioThisFrame) {
              if (!element.paused) {
                element.pause();
              }
            } else if (!element.seeking && element.readyState >= 2 && element.paused) {
              element.play().catch(() => { });
            }

            let vol = clip.isMuted ? 0 : clampPreviewAudioGain(clip.volume);
            if (element.seeking || holdAudioThisFrame) {
              vol = 0;
            }

            const outputMode = applyPreviewAudioOutputState(previewPlatformPolicy, element, {
              hasAudioNode,
              desiredVolume: vol,
              audibleSourceCount: vol > 0 ? activePreviewAudioSourceCount : 0,
              isExporting: _isExporting,
            });
            const effectiveGain = outputMode === 'native' ? 0 : vol;
            if (gainNode && audioCtxRef.current) {
              const currentGain = gainNode.gain.value;
              if (Math.abs(currentGain - effectiveGain) > 0.01) {
                gainNode.gain.setTargetAtTime(effectiveGain, audioCtxRef.current.currentTime, 0.1);
              }
            }
          } else {
            applyPreviewAudioOutputState(previewPlatformPolicy, element, {
              hasAudioNode,
              desiredVolume: 0,
              audibleSourceCount: 0,
              isExporting: _isExporting,
            });
            if (gainNode && audioCtxRef.current) {
              gainNode.gain.setTargetAtTime(0, audioCtxRef.current.currentTime, 0.1);
            }
            if (!element.paused) element.pause();

            if (inRange && Math.abs(element.currentTime - sourceTime) > 0.1) {
              element.currentTime = sourceTime;
            }
          }
        };

        if (isActivePlaying && previewPlatformPolicy.muteNativeMediaWhenAudioRouted && !_isExporting) {
          const ctx = audioCtxRef.current;
          if (ctx && (ctx.state as AudioContextState | 'interrupted') !== 'running') {
            ctx.resume().catch(() => {});
          }
        }

        processAudioTrack(currentBgm, 'bgm');
        if (
          !_isExporting
          && currentBgm
          && (!isActivePlaying || time < totalDurationRef.current || endFinalizedRef.current)
        ) {
          const bgmGainValue = resolvePreviewBgmGain(
            currentBgm,
            time,
            totalDurationRef.current,
          );
          const bgmEl = mediaElementsRef.current.bgm as HTMLAudioElement | undefined;
          const { gainNode: bgmGain } = bgmEl
            ? ensurePreviewAudioGainNode('bgm', bgmEl)
            : { gainNode: gainNodesRef.current.bgm };
          if (bgmEl) {
            bgmEl.defaultMuted = false;
            bgmEl.muted = false;
            bgmEl.volume = 1;
          }
          if (bgmGain && audioCtxRef.current) {
            bgmGain.gain.setValueAtTime(bgmGainValue, audioCtxRef.current.currentTime);
          }
        }
        currentNarrations.forEach((clip) => processNarrationClip(clip));

        if (
          !_isExporting
          && currentBgm
          && audioCtxRef.current
          && gainNodesRef.current.bgm
          && (!isActivePlaying || time < totalDurationRef.current || endFinalizedRef.current)
        ) {
          const finalBgmGainValue = endFinalizedRef.current && time >= totalDurationRef.current
            ? 0
            : resolvePreviewBgmGain(currentBgm, time, totalDurationRef.current);
          gainNodesRef.current.bgm.gain.setValueAtTime(finalBgmGainValue, audioCtxRef.current.currentTime);
        }

        if (isActivePlaying && audioResumeWaitFramesRef.current > 0) {
          audioResumeWaitFramesRef.current -= 1;
        }
        return didUpdateCanvas;
      } catch (e) {
        console.error('Render Error:', e);
        return false;
      }
    },
    [captions, captionSettings, ensureAudioNodeForElement, logInfo, platformCapabilities, previewPlatformPolicy],
  );

  const handleSeeked = useCallback(() => {
    requestAnimationFrame(() => renderFrame(
      currentTimeRef.current,
      isPlayingRef.current && !isSeekingRef.current && !isSeekPlaybackPreparingRef.current,
    ));
  }, [currentTimeRef, isPlayingRef, isSeekPlaybackPreparingRef, isSeekingRef, renderFrame]);

  const handleVideoLoadedData = useCallback(() => {
    requestAnimationFrame(() => renderFrame(
      currentTimeRef.current,
      isPlayingRef.current && !isSeekingRef.current && !isSeekPlaybackPreparingRef.current,
    ));
  }, [currentTimeRef, isPlayingRef, isSeekPlaybackPreparingRef, isSeekingRef, renderFrame]);

  const stopAll = useCallback(() => {
    currentExportSessionIdRef.current = null;
    currentPreviewCacheBuildSessionIdRef.current = null;
    logDebug('SYSTEM', 'stopAll呼び出し', { previousLoopId: loopIdRef.current, isPlayingRef: isPlayingRef.current });

    loopIdRef.current += 1;
    previewPlaybackAttemptRef.current += 1;
    isPlayingRef.current = false;
    audioResumeWaitFramesRef.current = 0;
    activeVideoIdRef.current = null;
    previewCachePlaybackActiveRefValue.current = false;
    setLoading(false);
    setPreviewLoadingLabelValue(undefined);
    safeSetPreviewPlaying(false);

    isSeekingRef.current = false;
    wasPlayingBeforeSeekRef.current = false;
    seekingVideosRef.current.clear();
    pendingSeekRef.current = null;
    exportPlayFailedRef.current = {};
    exportFallbackSeekAtRef.current = {};
    resetBoundaryDiagnosticsState();

    if (pendingSeekTimeoutRef.current) {
      clearTimeout(pendingSeekTimeoutRef.current);
      pendingSeekTimeoutRef.current = null;
    }
    cancelPendingSeekPlaybackPrepare();
    detachGlobalSeekEndListeners();
    cancelPendingPausedSeekWait();

    if (reqIdRef.current) {
      cancelAnimationFrame(reqIdRef.current);
      reqIdRef.current = null;
    }

    silencePreviewBgmOutput(mediaElementsRef, gainNodesRef, audioCtxRef);

    if (previewCacheVideoRefValue.current) {
      try {
        previewCacheVideoRefValue.current.pause();
      } catch {
        /* ignore */
      }
    }

    Object.entries(mediaElementsRef.current).forEach(([id, el]) => {
      if (el && (el.tagName === 'VIDEO' || el.tagName === 'AUDIO')) {
        if (id === 'bgm') {
          return;
        }
        try {
          const mediaEl = el as HTMLMediaElement;
          mediaEl.pause();
          resetNativeMediaAudioState(mediaEl);
        } catch {
          /* ignore */
        }
      }
    });

    const ctx = audioCtxRef.current;
    if (ctx) {
      ctx.onstatechange = null;
      Object.values(gainNodesRef.current).forEach((node) => {
        try {
          node.gain.cancelScheduledValues(ctx.currentTime);
        } catch {
          /* ignore */
        }
      });
    }

    const previousMode = activePreviewModeRef.current;
    activePreviewModeRef.current = 'idle';
    pendingPreviewCacheBuildResolverRef.current?.(false);

    if (previousMode === 'preview-cache-build') {
      stopPreviewCacheExport?.({ silent: true, reason: 'user' });
      return;
    }

    const hasActiveRecorder = !!(recorderRef.current && recorderRef.current.state !== 'inactive');
    if (hasActiveRecorder) {
      recorderRef.current!.stop();
    } else {
      stopWebCodecsExport({ reason: 'user' });
    }
  }, [
    activePreviewModeRef,
    activeVideoIdRef,
    audioCtxRef,
    audioResumeWaitFramesRef,
    cancelPendingPausedSeekWait,
    cancelPendingSeekPlaybackPrepare,
    detachGlobalSeekEndListeners,
    exportFallbackSeekAtRef,
    exportPlayFailedRef,
    gainNodesRef,
    isPlayingRef,
    isSeekingRef,
    logDebug,
    loopIdRef,
    mediaElementsRef,
    previewCachePlaybackActiveRef,
    previewCacheVideoRef,
    pendingSeekRef,
    pendingSeekTimeoutRef,
    pendingPreviewCacheBuildResolverRef,
    previewPlaybackAttemptRef,
    recorderRef,
    reqIdRef,
    seekingVideosRef,
    setLoading,
    stopWebCodecsExport,
    stopPreviewCacheExport,
    setPreviewLoadingLabel,
    wasPlayingBeforeSeekRef,
  ]);

  const stopPreviewMediaAtTimelineEnd = useCallback(() => {
    silencePreviewBgmOutput(mediaElementsRef, gainNodesRef, audioCtxRef);

    if (previewCacheVideoRefValue.current) {
      try {
        previewCacheVideoRefValue.current.pause();
      } catch {
        /* ignore */
      }
    }

    Object.entries(mediaElementsRef.current).forEach(([id, el]) => {
      if (!el || (el.tagName !== 'VIDEO' && el.tagName !== 'AUDIO')) {
        return;
      }
      if (id === 'bgm') {
        return;
      }

      try {
        const mediaEl = el as HTMLMediaElement;
        mediaEl.pause();
        resetNativeMediaAudioState(mediaEl);
      } catch {
        /* ignore */
      }
    });
  }, [audioCtxRef, gainNodesRef, mediaElementsRef]);

  const finalizePreviewAtTimelineEnd = useCallback((myLoopId: number) => {
    if (myLoopId !== loopIdRef.current) {
      return;
    }

    const totalDuration = totalDurationRef.current;
    const displayTime = toDisplayTime(totalDuration);
    endFinalizedRef.current = true;
    currentTimeRef.current = totalDuration;
    setCurrentTime(totalDuration);
    renderFrame(displayTime, false, false);
    logInfo('RENDER', 'preview.finalFrame.hold', {
      globalTimeMs: Math.round(totalDuration * 1000),
      displayGlobalTimeMs: Math.round(displayTime * 1000),
      totalDurationMs: Math.round(totalDuration * 1000),
      isCompleted: true,
      loopId: myLoopId,
      currentLoopId: loopIdRef.current,
    });
    logInfo('RENDER', 'preview.complete', {
      globalTimeMs: Math.round(totalDuration * 1000),
      displayGlobalTimeMs: Math.round(displayTime * 1000),
      totalDurationMs: Math.round(totalDuration * 1000),
      isCompleted: true,
    });
    logInfo('RENDER', 'download.ready', {
      globalTimeMs: Math.round(totalDuration * 1000),
      totalDurationMs: Math.round(totalDuration * 1000),
      isCompleted: true,
      isDownloadReady: true,
    });
    stopPreviewMediaAtTimelineEnd();

    audioResumeWaitFramesRef.current = 0;
    activeVideoIdRef.current = null;
    activePreviewModeRef.current = 'idle';
    previewCachePlaybackActiveRefValue.current = false;
    previewPlaybackAttemptRef.current += 1;
    loopIdRef.current += 1;
    isPlayingRef.current = false;
    safeSetPreviewPlaying(false);
    pause();

    if (reqIdRef.current) {
      cancelAnimationFrame(reqIdRef.current);
      reqIdRef.current = null;
    }
    logInfo('RENDER', '[DIAG-PREVIEW-END-FREEZE] finalize preview loop', {
      loopId: myLoopId,
      currentLoopId: loopIdRef.current,
      totalDuration,
      isPlaying: isPlayingRef.current,
      reqId: reqIdRef.current,
    });

    setTimeout(() => {
      endFinalizedRef.current = false;
      resetBoundaryDiagnosticsState();
    }, 300);
  }, [
    activePreviewModeRef,
    activeVideoIdRef,
    audioResumeWaitFramesRef,
    currentTimeRef,
    endFinalizedRef,
    isPlayingRef,
    loopIdRef,
    pause,
    previewCachePlaybackActiveRef,
    previewCacheVideoRef,
    previewPlaybackAttemptRef,
    renderFrame,
    reqIdRef,
    resetBoundaryDiagnosticsState,
    setCurrentTime,
    stopPreviewMediaAtTimelineEnd,
    totalDurationRef,
    toDisplayTime,
  ]);

  const configureAudioRouting = useCallback((isExporting: boolean) => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    const dest = masterDestRef.current;
    audioRoutingModeRef.current = isExporting ? 'export' : 'preview';

    Object.keys(gainNodesRef.current).forEach((id) => {
      const gain = gainNodesRef.current[id];
      try {
        gain.disconnect();

        if (isExporting && dest) {
          gain.connect(dest);
        } else {
          gain.connect(ctx.destination);
        }
      } catch {
        /* ignore */
      }
    });
  }, [audioCtxRef, audioRoutingModeRef, gainNodesRef, masterDestRef]);

  const loop = useCallback(
    (isExportMode: boolean, myLoopId: number) => {
      if (myLoopId !== loopIdRef.current) {
        logDebug('RENDER', 'ループ終了（loopId不一致）', { myLoopId, currentLoopId: loopIdRef.current });
        return;
      }

      if (mediaItemsRef.current.length === 0) {
        logWarn('RENDER', 'ループ終了（メディアなし）', {});
        stopAll();
        return;
      }

      if (!isPlayingRef.current && !isExportMode) {
        logWarn('RENDER', 'ループ終了（再生状態でない）', { isPlayingRef: isPlayingRef.current, isExportMode });
        return;
      }

      if (isExportMode && typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        reqIdRef.current = requestAnimationFrame(() => loop(isExportMode, myLoopId));
        return;
      }

      if (!isExportMode && activePreviewModeRef.current === 'preview-cache-playback') {
        const previewCacheVideo = previewCacheVideoRefValue.current;
        if (!previewCacheVideo) {
          previewCachePlaybackActiveRefValue.current = false;
          activePreviewModeRef.current = 'preview';
          reqIdRef.current = requestAnimationFrame(() => loop(isExportMode, myLoopId));
          return;
        }

        const playbackTime = Math.max(0, Math.min(previewCacheVideo.currentTime, totalDurationRef.current));
        const reachedPreviewEnd =
          totalDurationRef.current > 0
          && (previewCacheVideo.ended || playbackTime >= totalDurationRef.current - PREVIEW_END_THRESHOLD_SEC);

        if (reachedPreviewEnd) {
          finalizePreviewAtTimelineEnd(myLoopId);
          return;
        }

        setCurrentTime(playbackTime);
        currentTimeRef.current = playbackTime;
        renderFrame(playbackTime, true, false);
        reqIdRef.current = requestAnimationFrame(() => loop(isExportMode, myLoopId));
        return;
      }

      const now = getStandardPreviewNow();
      const diagnostics = previewTimelineDiagnosticsRef.current;
      let frameGapMs: number | null = null;
      if (diagnostics.lastRafNowMs !== null) {
        frameGapMs = now - diagnostics.lastRafNowMs;
      }
      diagnostics.lastRafNowMs = now;
      const elapsed = (now - startTimeRef.current) / 1000;
      const totalDuration = totalDurationRef.current;
      const clampedElapsed = Math.min(elapsed, totalDuration);
      const reachedPreviewEnd =
        !isExportMode &&
        totalDuration > 0 &&
        // 60fps で約 2 フレーム分（33ms 弱）の余裕を持たせ、rAF の刻み誤差で終端 1 フレーム手前に残り続けるのを防ぐ。
        clampedElapsed >= totalDuration - PREVIEW_END_THRESHOLD_SEC;

      if (reachedPreviewEnd) {
        finalizePreviewAtTimelineEnd(myLoopId);
        return;
      }

      if (clampedElapsed >= totalDuration) {
        // エクスポートモードでタイムライン終端に達した場合は completeWebCodecsExport を呼び正常完了させる。
        // stopAll() を呼ぶと外部 recorderRef が null のため stopWebCodecsExport({ reason: 'user' }) が
        // 走り、blob 生成後の callback が誤ってキャンセル扱いで抑止されてしまう。
        if (isExportMode) {
          safeSetPreviewPlaying(false);
          if (activePreviewModeRef.current === 'preview-cache-build') {
            completePreviewCacheExport?.();
          } else {
            completeWebCodecsExport();
          }
        } else {
          stopAll();
        }
        return;
      }
      const exportDurationAlignment = isExportMode ? resolveExportDuration(totalDuration, FPS) : null;
      const exportFrameIndex = isExportMode && exportDurationAlignment !== null && exportDurationAlignment.frameCount > 0
        ? Math.min(exportDurationAlignment.frameCount - 1, Math.max(0, Math.floor(clampedElapsed * FPS + 1e-9)))
        : null;
      const exportFrameTiming = isExportMode && exportDurationAlignment && exportFrameIndex !== null
        ? getExportFrameTiming(exportDurationAlignment, FPS, exportFrameIndex)
        : null;
      const globalTimeSec = exportFrameTiming ? (exportFrameTiming.timestampUs / 1e6) : clampedElapsed;
      const renderTimeSec = toDisplayTime(globalTimeSec);
      const resolvedSegment = findActiveTimelineItem(mediaItemsRef.current, renderTimeSec, totalDuration);
      const resolvedSegmentIndex = resolvedSegment?.index ?? -1;
      const resolvedLocalTimeMs = resolvedSegment ? Math.round(resolvedSegment.localTime * 1000) : null;
      const segmentChanged = resolvedSegmentIndex !== diagnostics.lastSegmentIndex;
      if (frameGapMs !== null && frameGapMs >= 50) {
        const resolvedMediaItem = resolvedSegmentIndex >= 0
          ? mediaItemsRef.current[resolvedSegmentIndex]
          : null;
        const activeVideoElement = resolvedMediaItem?.type === 'video'
          ? mediaElementsRef.current[resolvedMediaItem.id] as HTMLVideoElement | undefined
          : undefined;
        logWarn('RENDER', 'preview.frame.gap', {
          frameGapMs: Math.round(frameGapMs * 100) / 100,
          globalTimeMs: Math.round(globalTimeSec * 1000),
          segmentIndex: resolvedSegmentIndex,
          localTimeMs: resolvedLocalTimeMs,
          readyState: activeVideoElement?.readyState,
          paused: activeVideoElement?.paused,
          seeking: activeVideoElement?.seeking,
          holdFrame: activeVideoElement
            ? (activeVideoElement.seeking || activeVideoElement.readyState < MIN_VIDEO_READY_STATE_FOR_CURRENT_FRAME)
            : false,
          warningThresholdMs: 50,
        });
        if (frameGapMs > 100) {
          const projectState = useProjectStore.getState();
          const hasActiveIo =
            projectState.autoSaveRuntimeStatus === 'running'
            || projectState.isSaving
            || projectState.isLoading;
          logWarn('RENDER', 'preview.frame.gap.cause', {
            frameGapMs: Math.round(frameGapMs * 100) / 100,
            likelyCause: hasActiveIo ? 'io-active' : 'unknown-main-thread-or-render',
            isPreviewPlaying: isPlayingRef.current,
            isAutoSaveRunning: projectState.autoSaveRuntimeStatus === 'running',
            isProjectSaving: projectState.isSaving,
            isProjectLoading: projectState.isLoading,
          });
        }
      }
      const isAndroidLivePreview =
        platformCapabilities.isAndroid && !platformCapabilities.isIosSafari && !isExportMode;

      // Update max frame gap for active boundary
      if (diagnostics.activeBoundary !== null && frameGapMs !== null) {
        diagnostics.activeBoundary.maxFrameGapMs = Math.max(
          diagnostics.activeBoundary.maxFrameGapMs,
          frameGapMs,
        );
      }
      // Check boundary phase samples (100ms, 200ms, 300ms)
      if (
        diagnostics.activeBoundary !== null &&
        !diagnostics.activeBoundary.smoothPlanEmitted &&
        isAndroidLivePreview
      ) {
        const ab = diagnostics.activeBoundary;
        const elapsedSinceBoundary = now - ab.enterRafNowMs;
        const activeSegmentItem =
          resolvedSegmentIndex >= 0 ? mediaItemsRef.current[resolvedSegmentIndex] : null;
        const activeEl =
          activeSegmentItem?.type === 'video'
            ? (mediaElementsRef.current[activeSegmentItem.id] as HTMLVideoElement | undefined)
            : undefined;

        // Capture 100ms snapshot
        if (elapsedSinceBoundary >= 100 && !ab.samplePhasesDone.has('after-100ms')) {
          ab.samplePhasesDone.add('after-100ms');
          const sampleTargetTime = ab.trimStart + (resolvedSegment?.localTime ?? 0);
          ab.currentTimeAt100ms = activeEl?.currentTime ?? null;
          ab.targetTimeAt100ms = sampleTargetTime;
          ab.readyStateAt100ms = activeEl?.readyState ?? null;
          ab.seekingAt100ms = activeEl?.seeking ?? null;
          ab.pausedAt100ms = activeEl?.paused ?? null;
          if (previewLogModeRef.current === 'boundary') {
            logInfo('RENDER', 'preview.boundary.sample', {
              phase: 'after-100ms',
              previousId: ab.previousId,
              activeId: ab.activeId,
              globalTimeMs: Math.round(globalTimeSec * 1000),
              localTimeMs: resolvedSegment ? Math.round(resolvedSegment.localTime * 1000) : null,
              targetTime: sampleTargetTime,
              videoCurrentTime: ab.currentTimeAt100ms,
              driftMs: ab.currentTimeAt100ms !== null
                ? Math.round(Math.abs(ab.currentTimeAt100ms - sampleTargetTime) * 1000)
                : null,
              readyState: ab.readyStateAt100ms,
              paused: ab.pausedAt100ms,
              seeking: ab.seekingAt100ms,
              videoWidth: activeEl?.videoWidth ?? null,
              videoHeight: activeEl?.videoHeight ?? null,
              canDrawVideo: activeEl != null ? canDrawVideo(activeEl) : null,
              holdFrame: ab.holdFrameCount,
              usedVisualBlend: false,
              clockAbsorbMs: Math.round(ab.clockAbsorbMs),
              frameGapMs: frameGapMs ?? 0,
            });
          }
        }
        // Capture 200ms snapshot
        if (elapsedSinceBoundary >= 200 && !ab.samplePhasesDone.has('after-200ms')) {
          ab.samplePhasesDone.add('after-200ms');
          ab.readyStateAt200ms = activeEl?.readyState ?? null;
          ab.seekingAt200ms = activeEl?.seeking ?? null;
          if (previewLogModeRef.current === 'boundary') {
            const sampleTargetTime = ab.trimStart + (resolvedSegment?.localTime ?? 0);
            logInfo('RENDER', 'preview.boundary.sample', {
              phase: 'after-200ms',
              previousId: ab.previousId,
              activeId: ab.activeId,
              globalTimeMs: Math.round(globalTimeSec * 1000),
              localTimeMs: resolvedSegment ? Math.round(resolvedSegment.localTime * 1000) : null,
              targetTime: sampleTargetTime,
              videoCurrentTime: activeEl?.currentTime ?? null,
              driftMs: activeEl !== undefined
                ? Math.round(Math.abs(activeEl.currentTime - sampleTargetTime) * 1000)
                : null,
              readyState: activeEl?.readyState ?? null,
              paused: activeEl?.paused ?? null,
              seeking: activeEl?.seeking ?? null,
              videoWidth: activeEl?.videoWidth ?? null,
              videoHeight: activeEl?.videoHeight ?? null,
              canDrawVideo: activeEl != null ? canDrawVideo(activeEl) : null,
              holdFrame: ab.holdFrameCount,
              usedVisualBlend: false,
              clockAbsorbMs: Math.round(ab.clockAbsorbMs),
              frameGapMs: frameGapMs ?? 0,
            });
          }
        }
        // Capture 300ms snapshot + emit smoothPlan + judgement
        if (elapsedSinceBoundary >= 300 && !ab.samplePhasesDone.has('after-300ms')) {
          ab.samplePhasesDone.add('after-300ms');
          ab.smoothPlanEmitted = true;
          const currentTimeAt300ms = activeEl?.currentTime ?? null;
          const currentTimeAdvancedAt100ms =
            ab.currentTimeAt100ms !== null && ab.currentTimeAtBoundary !== null
              ? Math.round((ab.currentTimeAt100ms - ab.currentTimeAtBoundary) * 1000)
              : null;
          const estimatedStartLatencyMsAt100ms =
            ab.currentTimeAt100ms !== null && ab.targetTimeAt100ms !== null
              ? Math.max(0, Math.round((ab.targetTimeAt100ms - ab.currentTimeAt100ms) * 1000))
              : null;
          const projectState = useProjectStore.getState();

          if (previewLogModeRef.current === 'boundary') {
            const sampleTargetTime = ab.trimStart + (resolvedSegment?.localTime ?? 0);
            logInfo('RENDER', 'preview.boundary.sample', {
              phase: 'after-300ms',
              previousId: ab.previousId,
              activeId: ab.activeId,
              globalTimeMs: Math.round(globalTimeSec * 1000),
              localTimeMs: resolvedSegment ? Math.round(resolvedSegment.localTime * 1000) : null,
              targetTime: sampleTargetTime,
              videoCurrentTime: currentTimeAt300ms,
              driftMs: currentTimeAt300ms !== null
                ? Math.round(Math.abs(currentTimeAt300ms - sampleTargetTime) * 1000)
                : null,
              readyState: activeEl?.readyState ?? null,
              paused: activeEl?.paused ?? null,
              seeking: activeEl?.seeking ?? null,
              videoWidth: activeEl?.videoWidth ?? null,
              videoHeight: activeEl?.videoHeight ?? null,
              canDrawVideo: activeEl != null ? canDrawVideo(activeEl) : null,
              holdFrame: ab.holdFrameCount,
              usedVisualBlend: false,
              clockAbsorbMs: Math.round(ab.clockAbsorbMs),
              frameGapMs: frameGapMs ?? 0,
            });
            logInfo('RENDER', '[DIAG-BOUNDARY-VISUAL-BRIDGE]', {
              previousId: ab.previousId,
              activeId: ab.activeId,
              usedVisualBlend: false,
              visualBlendMs: 0,
              usedPreviousFrameHold: ab.holdFrameCount > 0,
              holdFrameCount: ab.holdFrameCount,
              reason: 'standard-preview-visual-blend-disabled',
            });
          }

          logInfo('RENDER', 'preview.boundary.smoothPlan', {
            segmentIndex: ab.segmentIndex,
            previousId: ab.previousId,
            activeId: ab.activeId,
            boundaryGlobalTimeMs: ab.boundaryGlobalTimeMs,
            // preroll state
            prerollArmed: ab.prerollArmed,
            prerollStartedAtMs: ab.prerollStartedAtMs,
            prerollTargetSec: ab.prerollTargetSec,
            prerollLeadSec: ab.prerollLeadSec,
            activeTrimStartSec: ab.trimStart,
            // boundary state
            activeReadyStateAtBoundary: ab.readyStateAtBoundary,
            activeSeekingAtBoundary: ab.seekingAtBoundary,
            activePausedAtBoundary: ab.pausedAtBoundary,
            activeCurrentTimeAtBoundary: ab.currentTimeAtBoundary,
            activeTargetTimeAtBoundary: ab.targetTimeAtBoundary,
            activeDriftAtBoundaryMs: ab.driftAtBoundaryMs,
            // 100ms state
            currentTimeAdvancedAt100ms,
            estimatedStartLatencyMsAt100ms,
            readyStateAt100ms: ab.readyStateAt100ms,
            seekingAt100ms: ab.seekingAt100ms,
            pausedAt100ms: ab.pausedAt100ms,
            // 200ms state
            readyStateAt200ms: ab.readyStateAt200ms,
            seekingAt200ms: ab.seekingAt200ms,
            // visual blend (not implemented, report as false/0)
            usedVisualBlend: false,
            visualBlendMs: 0,
            usedPreviousFrameHold: ab.holdFrameCount > 0,
            holdFrameCount: ab.holdFrameCount,
            // clock absorb
            clockAbsorbMs: Math.round(ab.clockAbsorbMs),
            // rAF gap
            maxFrameGapMsAroundBoundary: Math.round(ab.maxFrameGapMs),
            // I/O state
            isPreviewPlaying: isPlayingRef.current,
            isAutoSaveRunning:
              ab.isAutoSaveRunningAtBoundary || projectState.autoSaveRuntimeStatus === 'running',
            isProjectSaving: ab.isProjectSavingAtBoundary || projectState.isSaving,
            isProjectLoading: ab.isProjectLoadingAtBoundary || projectState.isLoading,
          });

          logInfo('RENDER', 'preview.nextVideo.startLatency', {
            previousId: ab.previousId,
            activeId: ab.activeId,
            segmentIndex: ab.segmentIndex,
            boundaryGlobalTimeMs: ab.boundaryGlobalTimeMs,
            estimatedStartLatencyMsAt100ms,
            currentTimeAdvancedAt100ms,
            activeCurrentTimeAtBoundary: ab.currentTimeAtBoundary,
            activeTargetTimeAtBoundary: ab.targetTimeAtBoundary,
            currentTimeAt100ms: ab.currentTimeAt100ms,
            targetTimeAt100ms: ab.targetTimeAt100ms,
            activePausedAtBoundary: ab.pausedAtBoundary,
            pausedAt100ms: ab.pausedAt100ms,
            activeReadyStateAtBoundary: ab.readyStateAtBoundary,
            readyStateAt100ms: ab.readyStateAt100ms,
            activeSeekingAtBoundary: ab.seekingAtBoundary,
            seekingAt100ms: ab.seekingAt100ms,
            prerollArmed: ab.prerollArmed,
            prerollTargetSec: ab.prerollTargetSec,
            activeTrimStartSec: ab.trimStart,
            maxFrameGapMsAroundBoundary: Math.round(ab.maxFrameGapMs),
          });

          // Determine judgement result
          const reasons: string[] = [];
          let result: string = 'unknown';
          const isAutoSaveRunning =
            ab.isAutoSaveRunningAtBoundary || projectState.autoSaveRuntimeStatus === 'running';
          const isProjectSaving = ab.isProjectSavingAtBoundary || projectState.isSaving;
          const isProjectLoading = ab.isProjectLoadingAtBoundary || projectState.isLoading;
          if (ab.maxFrameGapMs >= 50) {
            result = 'likely-frame-gap';
            reasons.push(`maxFrameGapMs=${Math.round(ab.maxFrameGapMs)} >= 50`);
          }
          if (
            currentTimeAdvancedAt100ms !== null &&
            currentTimeAdvancedAt100ms < 20 &&
            (
              (ab.readyStateAtBoundary !== null && ab.readyStateAtBoundary < 2) ||
              (ab.readyStateAt100ms !== null && ab.readyStateAt100ms < 2) ||
              ab.seekingAtBoundary === true ||
              ab.seekingAt100ms === true
            )
          ) {
            if (result === 'unknown') result = 'likely-decoder-late';
            reasons.push(
              `currentTimeAdvancedAt100ms=${currentTimeAdvancedAt100ms}<20, readyStateAtBoundary=${ab.readyStateAtBoundary}, readyStateAt100ms=${ab.readyStateAt100ms}, seeking=${ab.seekingAt100ms}`,
            );
          }
          if ((ab.readyStateAt200ms !== null && ab.readyStateAt200ms < 2) || ab.seekingAt200ms === true) {
            if (result === 'unknown') result = 'likely-decoder-late';
            reasons.push(
              `readyStateAt200ms=${ab.readyStateAt200ms}, seekingAt200ms=${ab.seekingAt200ms} (still not ready at 200ms)`,
            );
          }
          if (ab.driftAtBoundaryMs !== null && ab.driftAtBoundaryMs > 100) {
            if (result === 'unknown') result = 'likely-preroll-misaligned';
            reasons.push(
              `driftAtBoundaryMs=${ab.driftAtBoundaryMs}>100 (currentTime=${ab.currentTimeAtBoundary}, trimStart=${ab.trimStart})`,
            );
          }
          if (isAutoSaveRunning || isProjectSaving || isProjectLoading) {
            if (result === 'unknown') result = 'likely-io-interference';
            reasons.push(
              `io: autoSave=${isAutoSaveRunning}, saving=${isProjectSaving}, loading=${isProjectLoading}`,
            );
          }
          if (result === 'unknown' || reasons.length === 0) {
            result = 'minor-platform-limit';
            reasons.push('all metrics within acceptable range');
          }

          logInfo('RENDER', 'preview.boundary.judgement', {
            previousId: ab.previousId,
            activeId: ab.activeId,
            result,
            reasons,
            maxFrameGapMs: Math.round(ab.maxFrameGapMs),
            currentTimeAdvancedAt100ms,
            estimatedStartLatencyMsAt100ms,
            activeDriftAtBoundaryMs: ab.driftAtBoundaryMs,
            readyStateAt200ms: ab.readyStateAt200ms,
            seekingAt200ms: ab.seekingAt200ms,
            visualBlendMs: 0,
            clockAbsorbMs: Math.round(ab.clockAbsorbMs),
            prerollArmed: ab.prerollArmed,
            prerollTargetSec: ab.prerollTargetSec,
            activeTrimStartSec: ab.trimStart,
            isAutoSaveRunning,
            isProjectSaving,
            isProjectLoading,
          });

          diagnostics.activeBoundary = null;
        }
      }
      if (previewLogModeRef.current === 'detailed') {
        const lastTickAt = diagnostics.lastTickLogAtMs ?? 0;
        if (now - lastTickAt >= PREVIEW_DETAILED_TICK_LOG_INTERVAL_MS) {
          logInfo('RENDER', 'preview.timeline.tick', {
            globalTimeMs: Math.round(globalTimeSec * 1000),
            displayGlobalTimeMs: Math.round(renderTimeSec * 1000),
            totalDurationMs: Math.round(totalDuration * 1000),
            segmentIndex: resolvedSegmentIndex,
            localTimeMs: resolvedLocalTimeMs,
          });
          diagnostics.lastTickLogAtMs = now;
        }
      }
      if (segmentChanged) {
        if (diagnostics.lastSegmentIndex >= 0) {
          logInfo('RENDER', 'preview.boundary.exit', {
            globalTimeMs: Math.round(globalTimeSec * 1000),
            displayGlobalTimeMs: Math.round(renderTimeSec * 1000),
            totalDurationMs: Math.round(totalDuration * 1000),
            boundaryIndex: diagnostics.lastSegmentIndex,
          });
        }
        if (resolvedSegmentIndex >= 0) {
          logInfo('RENDER', 'preview.boundary.enter', {
            globalTimeMs: Math.round(globalTimeSec * 1000),
            displayGlobalTimeMs: Math.round(renderTimeSec * 1000),
            totalDurationMs: Math.round(totalDuration * 1000),
            segmentIndex: resolvedSegmentIndex,
            localTimeMs: resolvedLocalTimeMs,
            boundaryIndex: resolvedSegmentIndex,
          });
          if (
            isAndroidLivePreview
            && isPreviewDiagnosticsLogMode(previewLogModeRef.current)
          ) {
            const activeSegmentItem = mediaItemsRef.current[resolvedSegmentIndex];
            const activeVideoElement = activeSegmentItem?.type === 'video'
              ? mediaElementsRef.current[activeSegmentItem.id] as HTMLVideoElement | undefined
              : undefined;
            logInfo('RENDER', 'preview.android.boundary.passive-switch', {
              previousId: diagnostics.lastSegmentIndex >= 0
                ? mediaItemsRef.current[diagnostics.lastSegmentIndex]?.id ?? null
                : null,
              activeId: activeSegmentItem?.id ?? null,
              segmentIndex: resolvedSegmentIndex,
              localTime: resolvedSegment?.localTime ?? null,
              activeReadyState: activeVideoElement?.readyState ?? null,
              activeSeeking: activeVideoElement?.seeking ?? null,
              activePaused: activeVideoElement?.paused ?? null,
              activeCurrentTime: activeVideoElement?.currentTime ?? null,
            });

            // Setup activeBoundary diagnostics for video→video Android boundary
            if (
              isAndroidLivePreview &&
              isPreviewDiagnosticsLogMode(previewLogModeRef.current) &&
              resolvedSegmentIndex >= 0 &&
              diagnostics.lastSegmentIndex >= 0
            ) {
              const enteringItem = mediaItemsRef.current[resolvedSegmentIndex];
              const exitingItem = mediaItemsRef.current[diagnostics.lastSegmentIndex];
              if (enteringItem?.type === 'video' && exitingItem?.type === 'video') {
                const activeEl = mediaElementsRef.current[enteringItem.id] as HTMLVideoElement | undefined;
                const trimStart = enteringItem.trimStart || 0;
                const activeTargetTimeAtBoundary = trimStart + (resolvedSegment?.localTime ?? 0);
                const currentTimeAtBoundary = activeEl?.currentTime ?? null;
                const driftAtBoundaryMs =
                  currentTimeAtBoundary !== null
                    ? Math.round(Math.abs(currentTimeAtBoundary - activeTargetTimeAtBoundary) * 1000)
                    : null;
                const prebufferDiag = standardNextVideoPrebufferDiagRef.current[enteringItem.id];
                const prerollArmed =
                  (prebufferDiag?.armed ?? false)
                  || (driftAtBoundaryMs !== null && driftAtBoundaryMs <= 50);
                const projectState = useProjectStore.getState();
                diagnostics.activeBoundary = {
                  boundaryGlobalTimeMs: Math.round(globalTimeSec * 1000),
                  enterRafNowMs: now,
                  previousId: exitingItem.id,
                  activeId: enteringItem.id,
                  segmentIndex: resolvedSegmentIndex,
                  trimStart,
                  prerollStartedAtMs: prebufferDiag?.startedAtMs ?? null,
                  prerollTargetSec: prebufferDiag?.targetSec ?? trimStart,
                  prerollLeadSec: prebufferDiag?.leadSec ?? null,
                  readyStateAtBoundary: activeEl?.readyState ?? null,
                  seekingAtBoundary: activeEl?.seeking ?? null,
                  pausedAtBoundary: activeEl?.paused ?? null,
                  currentTimeAtBoundary,
                  targetTimeAtBoundary: activeTargetTimeAtBoundary,
                  driftAtBoundaryMs,
                  prerollArmed,
                  maxFrameGapMs: frameGapMs ?? 0,
                  holdFrameCount: 0,
                  clockAbsorbMs: 0,
                  isAutoSaveRunningAtBoundary: projectState.autoSaveRuntimeStatus === 'running',
                  isProjectSavingAtBoundary: projectState.isSaving,
                  isProjectLoadingAtBoundary: projectState.isLoading,
                  samplePhasesDone: new Set(),
                  smoothPlanEmitted: false,
                  currentTimeAt100ms: null,
                  readyStateAt100ms: null,
                  seekingAt100ms: null,
                  pausedAt100ms: null,
                  readyStateAt200ms: null,
                  seekingAt200ms: null,
                  targetTimeAt100ms: null,
                };
                if (previewLogModeRef.current === 'boundary') {
                  logInfo('RENDER', 'preview.boundary.sample', {
                    phase: 'enter',
                    previousId: exitingItem.id,
                    activeId: enteringItem.id,
                    globalTimeMs: Math.round(globalTimeSec * 1000),
                    localTimeMs: resolvedSegment ? Math.round(resolvedSegment.localTime * 1000) : null,
                    targetTime: activeTargetTimeAtBoundary,
                    videoCurrentTime: currentTimeAtBoundary,
                    driftMs: driftAtBoundaryMs,
                    readyState: activeEl?.readyState ?? null,
                    paused: activeEl?.paused ?? null,
                    seeking: activeEl?.seeking ?? null,
                    videoWidth: activeEl?.videoWidth ?? null,
                    videoHeight: activeEl?.videoHeight ?? null,
                    canDrawVideo: activeEl != null
                      ? canDrawVideo(activeEl)
                      : null,
                    holdFrame: false,
                    usedVisualBlend: false,
                    clockAbsorbMs: 0,
                    frameGapMs: frameGapMs ?? 0,
                  });
                }
              }
            }
          }
        }
        diagnostics.lastSegmentIndex = resolvedSegmentIndex;
        diagnostics.beforeBoundarySampled = false;
      }
      if (previewLogModeRef.current === 'detailed' && segmentChanged) {
        logInfo('RENDER', 'preview.timeline.segmentResolved', {
          globalTimeMs: Math.round(globalTimeSec * 1000),
          segmentIndex: resolvedSegmentIndex,
          localTimeMs: resolvedLocalTimeMs,
        });
      }
      setCurrentTime(globalTimeSec);
      currentTimeRef.current = globalTimeSec;

      // Emit 'before-500ms' boundary sample in boundary log mode
      if (
        previewLogModeRef.current === 'boundary' &&
        isAndroidLivePreview &&
        !diagnostics.beforeBoundarySampled &&
        resolvedSegmentIndex >= 0
      ) {
        const currentItem = mediaItemsRef.current[resolvedSegmentIndex];
        const nextItem =
          resolvedSegmentIndex + 1 < mediaItemsRef.current.length
            ? mediaItemsRef.current[resolvedSegmentIndex + 1]
            : null;
        if (currentItem?.type === 'video' && nextItem?.type === 'video' && resolvedSegment) {
          const remainingTimeSec = currentItem.duration - resolvedSegment.localTime;
          if (remainingTimeSec > 0 && remainingTimeSec <= 0.5) {
            diagnostics.beforeBoundarySampled = true;
            const activeEl =
              mediaElementsRef.current[currentItem.id] as HTMLVideoElement | undefined;
            const trimStart = currentItem.trimStart || 0;
            const targetTime = trimStart + resolvedSegment.localTime;
            logInfo('RENDER', 'preview.boundary.sample', {
              phase: 'before-500ms',
              previousId: currentItem.id,
              activeId: nextItem.id,
              globalTimeMs: Math.round(globalTimeSec * 1000),
              localTimeMs: Math.round(resolvedSegment.localTime * 1000),
              targetTime,
              videoCurrentTime: activeEl?.currentTime ?? null,
              driftMs: activeEl !== undefined
                ? Math.round(Math.abs(activeEl.currentTime - targetTime) * 1000)
                : null,
              readyState: activeEl?.readyState ?? null,
              paused: activeEl?.paused ?? null,
              seeking: activeEl?.seeking ?? null,
              videoWidth: activeEl?.videoWidth ?? null,
              videoHeight: activeEl?.videoHeight ?? null,
              canDrawVideo: activeEl != null
                ? canDrawVideo(activeEl)
                : null,
              holdFrame: false,
              usedVisualBlend: false,
              clockAbsorbMs: 0,
              frameGapMs: frameGapMs ?? 0,
              remainingTimeMs: Math.round(remainingTimeSec * 1000),
            });
          }
        }
      }

      renderFrame(renderTimeSec, true, isExportMode);
      reqIdRef.current = requestAnimationFrame(() => loop(isExportMode, myLoopId));
    },
    [
      currentTimeRef,
      endFinalizedRef,
      isPlayingRef,
      logDebug,
      logWarn,
      loopIdRef,
      mediaElementsRef,
      mediaItemsRef,
      pause,
      renderFrame,
      reqIdRef,
      setCurrentTime,
      startTimeRef,
      stopAll,
      toDisplayTime,
      completeWebCodecsExport,
      completePreviewCacheExport,
      finalizePreviewAtTimelineEnd,
      totalDurationRef,
      previewCachePlaybackActiveRef,
      previewCacheVideoRef,
    ],
  );

  const startEngine = useCallback(
    async (fromTime: number, isExportMode: boolean) => {
      previewLogModeRef.current = resolvePreviewLogMode();
      logInfo('RENDER', 'preview.preflight.start', {
        globalTimeMs: Math.round(fromTime * 1000),
        totalDurationMs: Math.round(totalDurationRef.current * 1000),
        isExportMode,
      });
      logInfo('AUDIO', 'エンジン起動開始', { fromTime, isExportMode });

      if (platformCapabilities.isIosSafari) {
        logInfo('AUDIO', 'iOS Safari 判定結果', {
          safariDetected: platformCapabilities.isIosSafari,
          isExportMode,
          route: isExportMode ? 'export' : 'preview',
        });
      }

      const shouldStopBeforeAudioInit = shouldStopBeforePreviewAudioRouteInit(previewPlatformPolicy, {
        isExporting: isExportMode,
      });
      if (shouldStopBeforeAudioInit) {
        stopAll();
      }

      const ctx = getAudioContext();
      const stateBeforeResume = ctx.state as AudioContextState | 'interrupted';
      logDebug('AUDIO', 'AudioContext状態', { state: stateBeforeResume });
      if (stateBeforeResume !== 'running') {
        let attemptState: AudioContextState | 'interrupted' = stateBeforeResume;
        for (let attempt = 1; attempt <= previewPlatformPolicy.audioContextResumeRetryCount; attempt++) {
          try {
            await ctx.resume();
          } catch (err) {
            logWarn('AUDIO', `AudioContext再開に失敗（${attempt}回目）`, {
              state: attemptState,
              error: err instanceof Error ? err.message : String(err),
            });
          }

          attemptState = ctx.state as AudioContextState | 'interrupted';
          if (attemptState === 'running') {
            break;
          }
        }

        logInfo('AUDIO', 'AudioContext再開処理後の状態', {
          before: stateBeforeResume,
          after: ctx.state,
        });
      }

      if (shouldReinitializeAudioRoute(previewPlatformPolicy, isExportMode)) {
        try {
          if ((ctx.state as AudioContextState | 'interrupted') === 'running') {
            await ctx.suspend();
            await ctx.resume();
            logInfo('AUDIO', 'iOS Safari 音声経路を再初期化', { state: ctx.state });
          }
        } catch (err) {
          logWarn('AUDIO', 'iOS Safari 音声経路再初期化に失敗', {
            error: err instanceof Error ? err.message : String(err),
            state: ctx.state,
          });
        }
      }

      if (!shouldStopBeforeAudioInit) {
        stopAll();
      }
      resetBoundaryDiagnosticsState();

      const myLoopId = loopIdRef.current;
      logDebug('RENDER', 'ループID取得', { myLoopId });
      const exportSessionId = isExportMode ? createPreviewExportSessionId() : null;

      if (isExportMode) {
        activePreviewModeRef.current = 'export';
        safeSetPreviewPlaying(false);
        currentExportSessionIdRef.current = exportSessionId;
        setProcessing(true);
        setExportPreparationStep(1);
        clearExport();
      } else {
        activePreviewModeRef.current = 'preview';
        setProcessing(false);
        safeSetPreviewPlaying(true);
        setExportPreparationStep(null);
        isPlayingRef.current = false;
        pause();
      }

      endFinalizedRef.current = false;

      configureAudioRouting(isExportMode);

      Object.values(mediaElementsRef.current).forEach((el) => {
        if (el.tagName === 'VIDEO' || el.tagName === 'AUDIO') {
          const mediaEl = el as HTMLMediaElement;
          if (mediaEl.readyState === 0) {
            try {
              mediaEl.load();
            } catch {
              /* ignore */
            }
          }
        }
      });

      let preparedPreviewAudio: PreparedPreviewAudioNodesResult = {
        activeVideoId: null,
        audibleSourceCount: 0,
        requiresWebAudio: false,
      };
      let shouldBundlePreviewStart = false;
      let previewPlaybackAttempt = previewPlaybackAttemptRef.current;

      if (!isExportMode) {
        if (previewCacheEnabledFlag) {
          const usedExistingCache = await startPreviewCachePlayback(fromTime);
          if (usedExistingCache) {
            loop(false, myLoopId);
            return;
          }

          const builtPreviewCache = await buildPreviewCache(myLoopId);
          if (myLoopId !== loopIdRef.current) {
            return;
          }

          if (builtPreviewCache) {
            const startedPreviewCachePlayback = await startPreviewCachePlayback(fromTime);
            if (startedPreviewCachePlayback) {
              loop(false, myLoopId);
              return;
            }
          }

          activePreviewModeRef.current = 'preview';
          previewCachePlaybackActiveRefValue.current = false;
        }

        const blockingVideos = collectPlaybackBlockingVideos(mediaItemsRef.current, fromTime);
        if (blockingVideos.length > 0) {
          let playbackReady = false;
          setLoading(true);
          try {
            playbackReady = await ensureVideoMetadataReady(blockingVideos, fromTime);
          } finally {
            setLoading(false);
          }

          if (myLoopId !== loopIdRef.current) {
            return;
          }

          if (!playbackReady) {
            setError('動画の読み込みが完了していません。数秒待ってから再生してください。');
            safeSetPreviewPlaying(false);
            pause();
            return;
          }
        }

        previewPlaybackAttemptRef.current += 1;
        previewPlaybackAttempt = previewPlaybackAttemptRef.current;

        preparedPreviewAudio = preparePreviewAudioNodesForTime(fromTime);
        shouldBundlePreviewStart = shouldBundlePreviewStartForWebAudioMix(previewPlatformPolicy, {
          hasActiveVideo: preparedPreviewAudio.activeVideoId !== null,
          audibleSourceCount: preparedPreviewAudio.audibleSourceCount,
          requiresWebAudio: preparedPreviewAudio.requiresWebAudio,
        });

        preparePreviewAudioNodesForUpcomingVideos(fromTime);

        if (previewPlatformPolicy.muteNativeMediaWhenAudioRouted) {
          const allowExtendedFuturePrewarm = preparedPreviewAudio.activeVideoId === null;
          let nearestFutureVideoId: string | null = null;
          let prewarmCursor = 0;
          for (const item of mediaItemsRef.current) {
            const itemStart = prewarmCursor;
            const itemEnd = prewarmCursor + Math.max(0, item.duration);
            prewarmCursor = itemEnd;
            if (item.type !== 'video') continue;
            if (itemStart - fromTime > 0.0005) {
              nearestFutureVideoId = item.id;
              break;
            }
          }

          prewarmCursor = 0;
          for (const item of mediaItemsRef.current) {
            const itemStart = prewarmCursor;
            const itemEnd = prewarmCursor + Math.max(0, item.duration);
            prewarmCursor = itemEnd;
            if (item.type !== 'video') continue;
            if (itemEnd <= fromTime + 0.0005) continue;
            if (shouldBundlePreviewStart && item.id === preparedPreviewAudio.activeVideoId) {
              continue;
            }
            const shouldPrewarmVideo = shouldKeepInactiveVideoPrewarmed(previewPlatformPolicy, {
              hasAudioNode: !!sourceNodesRef.current[item.id],
              isExporting: false,
              isActivePlaying: true,
              timeSinceVideoEndSec: fromTime - itemEnd,
              timeUntilVideoStartSec: itemStart - fromTime,
              isNearestFutureVideo: item.id === nearestFutureVideoId,
              allowExtendedFuturePrewarm,
            });
            if (!shouldPrewarmVideo) {
              continue;
            }
            const el = mediaElementsRef.current[item.id] as HTMLVideoElement | undefined;
            if (el && sourceNodesRef.current[item.id]) {
              const gn = gainNodesRef.current[item.id];
              if (gn && audioCtxRef.current) {
                gn.gain.setValueAtTime(0, audioCtxRef.current.currentTime);
              }
              applyPreviewAudioOutputState(previewPlatformPolicy, el, {
                hasAudioNode: true,
                desiredVolume: 0,
                audibleSourceCount: 0,
                isExporting: false,
              });
              if (Math.abs(el.currentTime - (item.trimStart || 0)) > 0.05 && !el.seeking) {
                el.currentTime = item.trimStart || 0;
              }
              el.pause();
            }
          }
        }

        if (previewPlatformPolicy.muteNativeMediaWhenAudioRouted) {
          const ctxForHandler = audioCtxRef.current;
          if (ctxForHandler) {
            ctxForHandler.onstatechange = () => {
              if (isPlayingRef.current && (ctxForHandler.state as AudioContextState | 'interrupted') !== 'running') {
                ctxForHandler.resume().catch(() => {});
              }
            };
          }
        }

        isPlayingRef.current = true;
        play();
      }

      if (isExportMode) {
        safeSetPreviewPlaying(false);
        setCurrentTime(fromTime);
        currentTimeRef.current = fromTime;
        mediaItemsRef.current.forEach((item) => {
          if (item.type !== 'video') return;
          const videoEl = mediaElementsRef.current[item.id] as HTMLVideoElement | undefined;
          if (!videoEl) return;
          try {
            if (videoEl.readyState === 0 && !videoEl.error) {
              videoEl.load();
            }
            const targetTime = Number.isFinite(item.trimStart) ? Math.max(0, item.trimStart) : 0;
            if (Math.abs(videoEl.currentTime - targetTime) > 0.01) {
              videoEl.currentTime = targetTime;
            }
          } catch {
            /* ignore */
          }
        });

        const audioPreloadPromises: Promise<void>[] = [];

        const prepareAudioTrack = (track: AudioTrack | null, trackId: string): Promise<void> => {
          return new Promise((resolve) => {
            const element = mediaElementsRef.current[trackId] as HTMLAudioElement;
            if (!track || !element) {
              resolve();
              return;
            }

            const targetTime = track.startPoint;

            if (element.readyState < 2) {
              const handleCanPlay = () => {
                element.removeEventListener('canplay', handleCanPlay);
                if (targetTime > 0 && Math.abs(element.currentTime - targetTime) > 0.1) {
                  const handleSeeked = () => {
                    element.removeEventListener('seeked', handleSeeked);
                    logDebug('AUDIO', `${trackId}プリロード完了（シーク後）`, { targetTime, actualTime: element.currentTime });
                    resolve();
                  };
                  element.addEventListener('seeked', handleSeeked, { once: true });
                  element.currentTime = targetTime;
                } else {
                  logDebug('AUDIO', `${trackId}プリロード完了`, { targetTime });
                  resolve();
                }
              };
              element.addEventListener('canplay', handleCanPlay, { once: true });
              element.load();

              setTimeout(() => {
                element.removeEventListener('canplay', handleCanPlay);
                logWarn('AUDIO', `${trackId}プリロードタイムアウト`, { readyState: element.readyState });
                resolve();
              }, 5000);
            } else {
              if (targetTime > 0 && Math.abs(element.currentTime - targetTime) > 0.1) {
                const handleSeeked = () => {
                  element.removeEventListener('seeked', handleSeeked);
                  logDebug('AUDIO', `${trackId}シーク完了`, { targetTime, actualTime: element.currentTime });
                  resolve();
                };
                element.addEventListener('seeked', handleSeeked, { once: true });
                element.currentTime = targetTime;

                setTimeout(() => {
                  element.removeEventListener('seeked', handleSeeked);
                  resolve();
                }, 2000);
              } else {
                resolve();
              }
            }
          });
        };

        const currentBgm = bgmRef.current;
        const currentNarrations = narrationsRef.current;
        if (currentBgm) {
          audioPreloadPromises.push(prepareAudioTrack(currentBgm, 'bgm'));
        }
        currentNarrations.forEach((clip) => {
          const trackId = `narration:${clip.id}`;
          const element = mediaElementsRef.current[trackId] as HTMLAudioElement;
          if (!element) return;
          audioPreloadPromises.push(
            new Promise((resolve) => {
              const targetTime = Number.isFinite(clip.trimStart) ? Math.max(0, clip.trimStart) : 0;
              if (element.readyState < 2) {
                const handleCanPlay = () => {
                  element.removeEventListener('canplay', handleCanPlay);
                  if (Math.abs(element.currentTime - targetTime) > 0.1) {
                    const handleSeeked = () => {
                      element.removeEventListener('seeked', handleSeeked);
                      resolve();
                    };
                    element.addEventListener('seeked', handleSeeked, { once: true });
                    element.currentTime = targetTime;
                  } else {
                    resolve();
                  }
                };
                element.addEventListener('canplay', handleCanPlay, { once: true });
                element.load();
                setTimeout(() => {
                  element.removeEventListener('canplay', handleCanPlay);
                  resolve();
                }, 5000);
              } else if (Math.abs(element.currentTime - targetTime) > 0.1) {
                const handleSeeked = () => {
                  element.removeEventListener('seeked', handleSeeked);
                  resolve();
                };
                element.addEventListener('seeked', handleSeeked, { once: true });
                element.currentTime = targetTime;
                setTimeout(() => {
                  element.removeEventListener('seeked', handleSeeked);
                  resolve();
                }, 2000);
              } else {
                resolve();
              }
            }),
          );
        });

        if (audioPreloadPromises.length > 0) {
          logInfo('AUDIO', 'オーディオプリロード開始', {
            bgm: !!currentBgm,
            narrationCount: currentNarrations.length,
          });
          await Promise.all(audioPreloadPromises);
          logInfo('AUDIO', 'オーディオプリロード完了');
        }

        const firstItem = mediaItemsRef.current[0];
        if (firstItem?.type === 'video') {
          const firstVideo = mediaElementsRef.current[firstItem.id] as HTMLVideoElement | undefined;
          if (firstVideo) {
            const targetTime = firstItem.trimStart || 0;
            const initialWarmupTarget = Math.max(0, targetTime - 0.2);
            try {
              if (firstVideo.readyState === 0) {
                firstVideo.load();
              }
              if (Math.abs(firstVideo.currentTime - initialWarmupTarget) > 0.01) {
                firstVideo.currentTime = initialWarmupTarget;
              }
            } catch {
              // ignore
            }

            await new Promise<void>((resolve) => {
              let done = false;
              const finish = () => {
                if (done) return;
                done = true;
                clearTimeout(timeoutId);
                firstVideo.removeEventListener('loadeddata', onReady);
                firstVideo.removeEventListener('canplay', onReady);
                firstVideo.removeEventListener('seeked', onReady);
                resolve();
              };
              const onReady = () => {
                const drift = Math.abs(firstVideo.currentTime - targetTime);
                if (firstVideo.readyState >= 2 && !firstVideo.seeking && firstVideo.currentTime >= targetTime && drift <= 0.05) {
                  finish();
                  return;
                }
                if (!firstVideo.seeking && firstVideo.readyState >= 1 && firstVideo.paused) {
                  try {
                    firstVideo.muted = true;
                    firstVideo.defaultMuted = true;
                    void firstVideo.play().catch(() => undefined);
                  } catch {
                    // ignore
                  }
                }
              };
              const timeoutId = setTimeout(finish, 4000);
              firstVideo.addEventListener('loadeddata', onReady);
              firstVideo.addEventListener('canplay', onReady);
              firstVideo.addEventListener('seeked', onReady);
              onReady();
            });
          }
        }

        await new Promise((r) => setTimeout(r, 200));
        renderFrame(0, false, true);
        await new Promise((r) => setTimeout(r, 100));
      } else {
        setCurrentTime(fromTime);
        currentTimeRef.current = fromTime;

        const shouldPrimeActiveVideo = !shouldBundlePreviewStart;
        let activeVideoElForBundledStart: HTMLVideoElement | null = null;
        let activeVideoTargetTime: number | null = null;
        let activeItemIndex = -1;
        let t = 0;
        for (const [index, item] of mediaItemsRef.current.entries()) {
          if (fromTime >= t && fromTime < t + item.duration) {
            activeItemIndex = index;
            if (item.type === 'video') {
              const videoEl = mediaElementsRef.current[item.id] as HTMLVideoElement;
              if (videoEl) {
                const localTime = fromTime - t;
                const targetTime = (item.trimStart || 0) + localTime;
                videoEl.currentTime = targetTime;
                activeVideoIdRef.current = item.id;
                activeVideoElForBundledStart = videoEl;
                activeVideoTargetTime = targetTime;
              }
            }
            break;
          }
          t += item.duration;
        }

        const nextVideoItem = findNextVideoItem(mediaItemsRef.current, activeItemIndex);

        if (activeVideoElForBundledStart && activeVideoTargetTime !== null) {
          await waitForPreviewStartVideoReady(
            activeVideoElForBundledStart,
            activeVideoTargetTime,
            () =>
              myLoopId === loopIdRef.current
              && previewPlaybackAttempt === previewPlaybackAttemptRef.current
              && isPlayingRef.current
              && !isSeekingRef.current,
          );
          if (myLoopId !== loopIdRef.current) {
            return;
          }
        }
        const nextVideoElForPreflight = nextVideoItem?.type === 'video'
          ? mediaElementsRef.current[nextVideoItem.id] as HTMLVideoElement | undefined
          : undefined;
        const nextTrimStart = nextVideoItem?.trimStart || 0;
        const nextVideoReadyState = nextVideoElForPreflight?.readyState ?? null;
        const nextVideoDrift = nextVideoElForPreflight
          ? Math.abs(nextVideoElForPreflight.currentTime - nextTrimStart)
          : null;
        const isNextVideoReady = !nextVideoItem || (
          !!nextVideoElForPreflight
          && !!nextVideoElForPreflight.currentSrc
          && nextVideoElForPreflight.readyState >= MIN_VIDEO_READY_STATE_FOR_CURRENT_FRAME
          && !nextVideoElForPreflight.seeking
          && Math.abs(nextVideoElForPreflight.currentTime - nextTrimStart) <= PREVIEW_START_READY_SYNC_TOLERANCE_SEC
          && nextVideoElForPreflight.videoWidth > 0
          && nextVideoElForPreflight.videoHeight > 0
        );

        const activeTrimDrift = activeVideoElForBundledStart && activeVideoTargetTime !== null
          ? Math.abs(activeVideoElForBundledStart.currentTime - activeVideoTargetTime)
          : Infinity;
        const isPreflightReady = !!activeVideoElForBundledStart
          && activeVideoElForBundledStart.readyState >= 3
          && activeTrimDrift <= 0.05
          && isNextVideoReady;
        if (isPreflightReady) logInfo('RENDER', 'preview.preflight.ready', {
          globalTimeMs: Math.round(fromTime * 1000),
          totalDurationMs: Math.round(totalDurationRef.current * 1000),
          hasActiveVideo: !!activeVideoElForBundledStart,
          activeVideoReadyState: activeVideoElForBundledStart?.readyState ?? null,
          hasNextVideo: !!nextVideoItem,
          nextVideoReady: isNextVideoReady,
          nextVideoReadyState,
          nextVideoDrift,
          activeTrimDrift,
          preseekWaitMs: null,
          preseekTimedOutIds: [],
        });

        if (preparedPreviewAudio.requiresWebAudio) {
          primePreviewAudioOnlyTracksAtTime(fromTime);
        }
        if (activeVideoElForBundledStart) {
          const shouldAttemptPlay = () =>
            shouldAttemptDeferredPreviewPlay({
              isCurrentAttempt: previewPlaybackAttempt === previewPlaybackAttemptRef.current,
              isPlaying: isPlayingRef.current,
              isSeeking: isSeekingRef.current,
              mediaSeeking: activeVideoElForBundledStart.seeking,
              readyState: activeVideoElForBundledStart.readyState,
              minReadyState: shouldBundlePreviewStart ? 2 : 1,
            });

          if (shouldPrimeActiveVideo || shouldBundlePreviewStart) {
            requestVideoPlayWithRetry(activeVideoElForBundledStart, shouldAttemptPlay);
          }
        }

        const shouldPrimeAndroidPreviewAudioOnlyTracks =
          platformCapabilities.isAndroid
          && (bgmRef.current !== null || narrationsRef.current.length > 0);
        if (shouldPrimeAndroidPreviewAudioOnlyTracks) {
          // active video の開始要求とは分離し、audio-only track は失敗しても preview 全体を止めない。
          primePreviewAudioOnlyTracksAtTime(fromTime);
        }

        const protectedVideoIds = [
          activeVideoIdRef.current,
          nextVideoItem?.id ?? null,
          activeItemIndex > 0 ? mediaItemsRef.current[activeItemIndex - 1]?.id ?? null : null,
        ].filter((id): id is string => !!id);

        resetInactiveVideos({
          nextVideoId: nextVideoItem?.id ?? null,
          protectedVideoIds,
          isAndroidPreview:
            platformCapabilities.isAndroid
            && !platformCapabilities.isIosSafari
            && isPlayingRef.current
            && !isExportMode,
        });

        // 直前に requestVideoPlayWithRetry で active video の play() を要求済み。
        // ここで paused-preview として描画すると renderFrame 側が active video を pause し、
        // play -> pause -> loop で play 再要求の周期が発生して開始直後の引っかかりになる。
        renderFrame(fromTime, true, isExportMode);

        await new Promise((r) => setTimeout(r, 50));
      }

      if (myLoopId !== loopIdRef.current) {
        return;
      }

      if (shouldRetryAudioOnlyPrimeAtPreviewStart(previewPlatformPolicy, {
        isExporting: isExportMode,
        hasActiveVideo: preparedPreviewAudio.activeVideoId !== null,
        requiresWebAudio: preparedPreviewAudio.requiresWebAudio,
      })) {
        primePreviewAudioOnlyTracksAtTime(fromTime);
      }

      startTimeRef.current = getStandardPreviewNow() - fromTime * 1000;
      logInfo('RENDER', 'preview.start', {
        globalTimeMs: Math.round(fromTime * 1000),
        totalDurationMs: Math.round(totalDurationRef.current * 1000),
        isExportMode,
      });

      if (isExportMode && canvasRef.current && masterDestRef.current) {
        startWebCodecsExport(
          canvasRef,
          masterDestRef,
          (url, ext) => {
            if (currentExportSessionIdRef.current !== exportSessionId) {
              try {
                URL.revokeObjectURL(url);
              } catch {
                // ignore
              }
              return;
            }
            setExportUrl(url);
            setExportExt(ext as 'mp4' | 'webm');
            setProcessing(false);
            setLoading(false);
    safeSetPreviewPlaying(false);
            setExportPreparationStep(null);
            currentExportSessionIdRef.current = null;
            pause();
            stopAll();
          },
          (message) => {
            if (currentExportSessionIdRef.current !== exportSessionId) {
              return;
            }
            setProcessing(false);
            setLoading(false);
    safeSetPreviewPlaying(false);
            setExportPreparationStep(null);
            currentExportSessionIdRef.current = null;
            pause();
            stopAll();
            setError(message);
          },
          {
            mediaItems: mediaItemsRef.current,
            bgm: bgmRef.current,
            narrations: narrationsRef.current,
            totalDuration: totalDurationRef.current,
            getPlaybackTimeSec: () => currentTimeRef.current,
            onPreparationStepChange: setExportPreparationStep,
            onAudioPreRenderComplete: () => {
              startTimeRef.current = getStandardPreviewNow() - fromTime * 1000;
              loop(isExportMode, myLoopId);
            },
          },
        );
      } else {
        loop(isExportMode, myLoopId);
      }
    },
    [
      activeVideoIdRef,
      audioCtxRef,
      bgmRef,
      canvasRef,
      clearExport,
      configureAudioRouting,
      currentTimeRef,
      endFinalizedRef,
      ensureVideoMetadataReady,
      getAudioContext,
      gainNodesRef,
      isPlayingRef,
      isSeekingRef,
      logDebug,
      logInfo,
      logWarn,
      loop,
      loopIdRef,
      masterDestRef,
      mediaElementsRef,
      mediaItemsRef,
      narrationsRef,
      pause,
      platformCapabilities.isIosSafari,
      play,
      preparePreviewAudioNodesForTime,
      preparePreviewAudioNodesForUpcomingVideos,
      previewPlatformPolicy,
      previewPlaybackAttemptRef,
      primePreviewAudioOnlyTracksAtTime,
      renderFrame,
      resetInactiveVideos,
      setCurrentTime,
      setError,
      setExportExt,
      setExportPreparationStep,
      setExportUrl,
      setLoading,
      setProcessing,
      sourceNodesRef,
      startTimeRef,
      startWebCodecsExport,
      stopAll,
      totalDurationRef,
    ],
  );

  return {
    handleMediaElementLoaded,
    handleSeeked,
    handleVideoLoadedData,
    renderFrame,
    stopAll,
    loop,
    startEngine,
  };
}
