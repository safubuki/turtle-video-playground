import { useCallback, type MutableRefObject } from 'react';

import {
  FPS,
} from '../../constants';
import { createCaptionGlyphCanvas } from '../../utils/canvas';
import type {
  AudioTrack,
  Caption,
  CaptionSettings,
  MediaElementsRef,
  MediaItem,
  NarrationClip,
} from '../../types';
import type { ExportPreparationStep, UseExportReturn } from '../../hooks/useExport';
import type { LogCategory } from '../../stores/logStore';
import { useMediaStore } from '../../stores';
import type { PlatformCapabilities } from '../../utils/platform';
import { collectPlaybackBlockingVideos, findActiveTimelineItem } from '../../utils/playbackTimeline';
import {
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
  shouldRecoverAudioOnlyAfterVideoBoundary,
  shouldReinitializeAudioRoute,
  shouldRetryAudioOnlyPrimeAtPreviewStart,
  shouldStabilizeImageToVideoTransitionDuringExport,
  shouldStopBeforePreviewAudioRouteInit,
  shouldUseCaptionBlurFallback,
  shouldAvoidPauseInactiveVideoInPreview,
  type PreviewPlatformPolicy,
} from '../../utils/previewPlatform';

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
  previewCacheStatusRef?: MutableRefObject<'idle' | 'preparing' | 'ready' | 'failed'>;
  previewCacheEntryRef?: MutableRefObject<{
    url: string;
    duration: number;
    cacheKey: string;
    createdAt: number;
  } | null>;
  previewCacheVideoRef?: MutableRefObject<HTMLVideoElement | null>;
  previewCacheGenerationRef?: MutableRefObject<number>;
  previewCachePlaybackActiveRef?: MutableRefObject<boolean>;
  previewCacheHasBuiltOnceRef?: MutableRefObject<boolean>;
  setPreviewCacheStatus?: (status: 'idle' | 'preparing' | 'ready' | 'failed') => void;
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
  resetInactiveVideos: () => void;
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

const resetNativeMediaAudioState = (mediaEl: HTMLMediaElement) => {
  mediaEl.defaultMuted = false;
  mediaEl.muted = false;
  mediaEl.volume = 1;
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
  previewPlatformPolicy,
  platformCapabilities,
  setVideoDuration,
  setCurrentTime,
  setProcessing,
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
  logInfo,
  logWarn,
  logDebug,
}: UsePreviewEngineParams): UsePreviewEngineResult {
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

  const renderFrame = useCallback(
    (time: number, isActivePlaying = false, _isExporting = false) => {
      try {
        const canvas = canvasRef.current;
        if (!canvas) return false;
        const ctx = canvas.getContext('2d');
        if (!ctx) return false;
        let didUpdateCanvas = false;

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
        if (activeId && activeIndex !== -1) {
          const activeItem = currentItems[activeIndex];
          const activeFadeOutDur = activeItem.fadeOutDuration || 1.0;
          const shouldPreferBlackoutAtFadeTail = shouldBlackoutVideoFadeTail({
            clipLocalTime: localTime,
            clipDuration: activeItem.duration,
            fadeOut: activeItem.fadeOut,
            fadeOutDuration: activeFadeOutDur,
          });

          const isInFadeOutRegion =
            activeItem.type === 'video' &&
            activeItem.fadeOut &&
            localTime > activeItem.duration - activeFadeOutDur;

          if (activeItem.type === 'video' && shouldPreferBlackoutAtFadeTail) {
            shouldBlackoutFadeTail = true;
          }

          if (activeItem.type === 'video') {
            const activeEl = mediaElementsRef.current[activeId] as HTMLVideoElement | undefined;
            if (!activeEl) {
              if (!shouldPreferBlackoutAtFadeTail && !isInFadeOutRegion) {
                holdFrame = true;
              }
            } else {
              const targetTime = (activeItem.trimStart || 0) + localTime;
              const isLastTimelineItem = activeIndex === currentItems.length - 1;
              const isNearTimelineEnd =
                totalDurationRef.current > 0 &&
                time >= totalDurationRef.current - 0.05;
              const safeEndTime = (activeItem.trimStart || 0) + Math.max(0, activeItem.duration - 0.001);
              const shouldForceEndFrameAlign =
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
                previousItemType: activeIndex > 0 ? currentItems[activeIndex - 1]?.type ?? null : null,
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

              if (shouldForceEndFrameAlign && activeEl.readyState >= 1 && !activeEl.seeking) {
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
                  try { activeEl.load(); } catch (e) { /* ignore */ }
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
                trimStart: activeItem.trimStart || 0,
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

              const shouldHoldActiveVideoFrame = !hasFrame
                || needsCorrection
                || shouldHoldForVideoEnd
                || shouldHoldForImageToVideoTransition;

              if (shouldHoldActiveVideoFrame) {
                if (!shouldPreferBlackoutAtFadeTail && !isInFadeOutRegion) {
                  holdFrame = true;
                }
                logInfo('RENDER', shouldPreferBlackoutAtFadeTail ? 'フェード終端ブラックアウト優先' : 'フレーム保持発動', {
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
        const shouldClearCanvas = shouldForceStartClear
          || shouldBlackoutFadeTail
          || (!holdFrame && !shouldHoldAtTimelineEnd && !shouldGuardNearEnd && !shouldGuardAfterFinalize);

        if (shouldClearCanvas) {
          if (totalDurationRef.current > 0 && time >= totalDurationRef.current - 0.5) {
            logInfo('RENDER', '終端付近で黒クリア実行', {
              time: Math.round(time * 10000) / 10000,
              totalDuration: totalDurationRef.current,
              activeId: activeId ? activeId.substring(0, 8) : null,
              activeIndex,
              holdFrame,
              shouldHoldAtTimelineEnd,
              shouldGuardNearEnd,
              shouldGuardAfterFinalize,
              isActivePlaying,
              endFinalized: endFinalizedRef.current,
            });
          }
          ctx.globalAlpha = 1.0;
          ctx.fillStyle = '#000000';
          ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
          didUpdateCanvas = true;
        }

        if (isActivePlaying && activeIndex !== -1 && activeIndex + 1 < currentItems.length) {
          const activeItem = currentItems[activeIndex];
          const nextItem = currentItems[activeIndex + 1];
          if (nextItem.type === 'video') {
            const remainingTime = activeItem.duration - localTime;
            if (remainingTime < 3.0) {
              const nextElement = mediaElementsRef.current[nextItem.id] as HTMLVideoElement;
              if (nextElement) {
                if (nextElement.readyState === 0 && !nextElement.error) {
                  try { nextElement.load(); } catch (e) { /* ignore */ }
                }
                if (nextElement.paused || nextElement.readyState < 2) {
                  const nextStart = nextItem.trimStart || 0;
                  if (Math.abs(nextElement.currentTime - nextStart) > 0.1) {
                    nextElement.currentTime = nextStart;
                  }
                }
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
                  try { videoEl.load(); } catch (e) { /* ignore */ }
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

                if (
                  !isVideoSeeking &&
                  !shouldHoldVideoAtClipEnd &&
                  !hasExportPlayFailure &&
                  Math.abs(videoEl.currentTime - targetTime) > syncThreshold
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
              && shouldBlackoutFadeTail
              // フェード中のプレビュー再生では alpha で自然に減衰させる。
              // 黒クリア優先は停止時/保持時のみ有効化し、
              // 「フェードアウトが即座に黒へ落ちる」退行を防ぐ。
              && !isActivePlaying;

            if (isReady && !shouldSkipVideoDrawForFadeTail) {
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
                ctx.drawImage(element as CanvasImageSource, -elemW / 2, -elemH / 2, elemW, elemH);
                ctx.restore();
                ctx.globalAlpha = 1.0;
                didUpdateCanvas = true;
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
              const shouldKeepVideoPrewarmed = shouldKeepInactiveVideoPrewarmed(previewPlatformPolicy, {
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
              const shouldPrimeFutureVideo = shouldPrimeFutureInactiveVideoInPreview(previewPlatformPolicy, {
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
        if (currentCaptionSettings.enabled && currentCaptions.length > 0) {
          const activeCaptions = currentCaptions.filter(
            (c) => time >= c.startTime && time < c.endTime,
          );
          for (const activeCaption of activeCaptions) {
            // fontSize は 1080p export を基準にした絶対 px (medium = 7.41% of 1080)。
            // 解像度に応じて captionScale で按分するため、SNS 等で異なるサイズの画面で
            // 再生されても「フレームに対する文字の比率」は常に同じになる (WYSIWYG)。
            // 各段階 ~1.4 倍ずつ拡大する読みやすさ重視のサイズスケール。
            const fontSizeMap = { small: 56, medium: 80, large: 112, xlarge: 148 };
            const effectiveFontSizeKey = activeCaption.overrideFontSize ?? currentCaptionSettings.fontSize;
            const baseFontSize = fontSizeMap[effectiveFontSizeKey];

            // プレビューは 720p、エクスポートは 1080p で同じ canvas を使い回すため、
            // 1080p を基準にスケールしておくと「プレビューで見たまま export される (WYSIWYG)」になる。
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

        const processAudioTrack = (track: AudioTrack | null, trackId: 'bgm') => {
          const element = mediaElementsRef.current[trackId] as HTMLAudioElement;
          let gainNode = gainNodesRef.current[trackId];
          let hasAudioNode = !!sourceNodesRef.current[trackId];

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
                let vol = track.volume;
                const trackTime = time - track.delay + track.startPoint;
                const playDuration = time - track.delay;

                if (trackTime <= track.duration) {
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

                  const fadeInDur = track.fadeInDuration || 1.0;
                  const fadeOutDur = track.fadeOutDuration || 1.0;

                  if (track.fadeIn && playDuration < fadeInDur) {
                    vol *= playDuration / fadeInDur;
                  }
                  if (track.fadeOut && time > totalDurationRef.current - fadeOutDur) {
                    const remaining = totalDurationRef.current - time;
                    vol *= Math.max(0, remaining / fadeOutDur);
                  }

                  if (element.seeking || (!avoidPausePlay && holdAudioThisFrame)) {
                    vol = 0;
                  }

                  if (
                    !hasAudioNode &&
                    getPreviewAudioOutputMode(previewPlatformPolicy, {
                      hasAudioNode: false,
                      isExporting: _isExporting,
                      audibleSourceCount: vol > 0 ? activePreviewAudioSourceCount : 0,
                      desiredVolume: vol,
                      sourceType: 'audio',
                    }) === 'webaudio'
                  ) {
                    hasAudioNode = ensureAudioNodeForElement(trackId, element);
                    gainNode = gainNodesRef.current[trackId];
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
          let gainNode = gainNodesRef.current[trackId];
          let hasAudioNode = !!sourceNodesRef.current[trackId];

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

            let vol = clip.isMuted ? 0 : clip.volume;
            if (element.seeking || holdAudioThisFrame) {
              vol = 0;
            }

            if (
              !hasAudioNode &&
              getPreviewAudioOutputMode(previewPlatformPolicy, {
                hasAudioNode: false,
                isExporting: _isExporting,
                audibleSourceCount: vol > 0 ? activePreviewAudioSourceCount : 0,
                desiredVolume: vol,
                sourceType: 'audio',
              }) === 'webaudio'
            ) {
              hasAudioNode = ensureAudioNodeForElement(trackId, element);
              gainNode = gainNodesRef.current[trackId];
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
        currentNarrations.forEach((clip) => processNarrationClip(clip));

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
    logDebug('SYSTEM', 'stopAll呼び出し', { previousLoopId: loopIdRef.current, isPlayingRef: isPlayingRef.current });

    loopIdRef.current += 1;
    previewPlaybackAttemptRef.current += 1;
    isPlayingRef.current = false;
    audioResumeWaitFramesRef.current = 0;
    activeVideoIdRef.current = null;
    setLoading(false);

    isSeekingRef.current = false;
    wasPlayingBeforeSeekRef.current = false;
    seekingVideosRef.current.clear();
    pendingSeekRef.current = null;
    exportPlayFailedRef.current = {};
    exportFallbackSeekAtRef.current = {};

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

    Object.values(mediaElementsRef.current).forEach((el) => {
      if (el && (el.tagName === 'VIDEO' || el.tagName === 'AUDIO')) {
        try {
          const mediaEl = el as HTMLMediaElement;
          mediaEl.pause();
          resetNativeMediaAudioState(mediaEl);
        } catch (e) {
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
        } catch (e) {
          /* ignore */
        }
      });
    }

    const hasActiveRecorder = !!(recorderRef.current && recorderRef.current.state !== 'inactive');
    if (hasActiveRecorder) {
      recorderRef.current!.stop();
    } else {
      stopWebCodecsExport({ reason: 'user' });
    }
  }, [
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
    pendingSeekRef,
    pendingSeekTimeoutRef,
    previewPlaybackAttemptRef,
    recorderRef,
    reqIdRef,
    seekingVideosRef,
    setLoading,
    stopWebCodecsExport,
    wasPlayingBeforeSeekRef,
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
      } catch (e) {
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

      const now = Date.now();
      const elapsed = (now - startTimeRef.current) / 1000;
      const clampedElapsed = Math.min(elapsed, totalDurationRef.current);

      if (clampedElapsed >= totalDurationRef.current) {
        if (!isExportMode) {
          const endTime = totalDurationRef.current;
          const finalizeAtEnd = () => {
            if (myLoopId !== loopIdRef.current) return;
            endFinalizedRef.current = true;
            renderFrame(endTime, false, false);
            setCurrentTime(endTime);
            currentTimeRef.current = endTime;
            stopAll();
            pause();
            setTimeout(() => { endFinalizedRef.current = false; }, 300);
          };

          const lastItem = mediaItemsRef.current[mediaItemsRef.current.length - 1];
          if (lastItem?.type === 'video') {
            const videoEl = mediaElementsRef.current[lastItem.id] as HTMLVideoElement | undefined;
            if (videoEl) {
              if (videoEl.readyState === 0 && !videoEl.error) {
                try { videoEl.load(); } catch { /* ignore */ }
              }
              if (videoEl.readyState >= 1 && !videoEl.seeking) {
                const targetTime = (lastItem.trimStart || 0) + Math.max(0, lastItem.duration - 0.001);
                const endAlignThreshold = 0.0001;
                const drift = Math.abs(videoEl.currentTime - targetTime);
                const isAhead = videoEl.currentTime > targetTime + endAlignThreshold;
                if (drift > endAlignThreshold || isAhead) {
                  videoEl.currentTime = targetTime;
                }
              }
              if (videoEl.seeking || videoEl.readyState < 2) {
                let settled = false;
                let timeoutId: ReturnType<typeof setTimeout> | null = null;
                let maybeFinish: () => void = () => { };
                const onReady = () => {
                  maybeFinish();
                };
                const cleanup = () => {
                  videoEl.removeEventListener('seeked', onReady);
                  videoEl.removeEventListener('loadeddata', onReady);
                  videoEl.removeEventListener('canplay', onReady);
                  if (timeoutId) {
                    clearTimeout(timeoutId);
                    timeoutId = null;
                  }
                };
                const finish = () => {
                  if (settled) return;
                  settled = true;
                  cleanup();
                  finalizeAtEnd();
                };
                maybeFinish = () => {
                  if (settled) return;
                  if (myLoopId !== loopIdRef.current) {
                    settled = true;
                    cleanup();
                    return;
                  }
                  if (!videoEl.seeking && videoEl.readyState >= 2) {
                    finish();
                  }
                };
                videoEl.addEventListener('seeked', onReady);
                videoEl.addEventListener('loadeddata', onReady);
                videoEl.addEventListener('canplay', onReady);
                timeoutId = setTimeout(() => {
                  finish();
                }, 220);
                requestAnimationFrame(maybeFinish);
                return;
              }
            }
          }
          finalizeAtEnd();
          return;
        }
        // タイムライン終端に達したので completeWebCodecsExport を呼び正常完了させる。
        // （このブランチは export 専用。if (!isExportMode) が先に return しているため）
        // stopAll() を呼ぶと外部 recorderRef が null のため stopWebCodecsExport({ reason: 'user' }) が
        // 走り、blob 生成後の callback が誤ってキャンセル扱いで抑止されてしまう。
        completeWebCodecsExport();
        return;
      }
      setCurrentTime(clampedElapsed);
      currentTimeRef.current = clampedElapsed;
      renderFrame(clampedElapsed, true, isExportMode);
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
      completeWebCodecsExport,
      totalDurationRef,
    ],
  );

  const startEngine = useCallback(
    async (fromTime: number, isExportMode: boolean) => {
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

      const myLoopId = loopIdRef.current;
      logDebug('RENDER', 'ループID取得', { myLoopId });

      if (isExportMode) {
        setProcessing(true);
        setExportPreparationStep(1);
      } else {
        setProcessing(false);
        setExportPreparationStep(null);
        isPlayingRef.current = false;
        pause();
      }
      clearExport();

      endFinalizedRef.current = false;

      configureAudioRouting(isExportMode);

      Object.values(mediaElementsRef.current).forEach((el) => {
        if (el.tagName === 'VIDEO' || el.tagName === 'AUDIO') {
          const mediaEl = el as HTMLMediaElement;
          if (mediaEl.readyState === 0) {
            try {
              mediaEl.load();
            } catch (e) {
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
              el.currentTime = item.trimStart || 0;
              el.play().catch(() => {});
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
          } catch (e) {
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
            try {
              if (firstVideo.readyState === 0) {
                firstVideo.load();
              }
              if (Math.abs(firstVideo.currentTime - targetTime) > 0.01) {
                firstVideo.currentTime = targetTime;
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
                if (firstVideo.readyState >= 2 && !firstVideo.seeking && drift <= 0.05) {
                  finish();
                  return;
                }
                if (!firstVideo.seeking && firstVideo.readyState >= 1 && drift > 0.05) {
                  try {
                    firstVideo.currentTime = targetTime;
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
        let t = 0;
        for (const item of mediaItemsRef.current) {
          if (fromTime >= t && fromTime < t + item.duration) {
            if (item.type === 'video') {
              const videoEl = mediaElementsRef.current[item.id] as HTMLVideoElement;
              if (videoEl) {
                const localTime = fromTime - t;
                const targetTime = (item.trimStart || 0) + localTime;
                videoEl.currentTime = targetTime;
                activeVideoIdRef.current = item.id;
                activeVideoElForBundledStart = videoEl;
                if (shouldPrimeActiveVideo) {
                  videoEl.play().catch(() => { });
                }
              }
            }
            break;
          }
          t += item.duration;
        }

        if (preparedPreviewAudio.requiresWebAudio) {
          primePreviewAudioOnlyTracksAtTime(fromTime);
        }
        if (shouldBundlePreviewStart && activeVideoElForBundledStart) {
          if (activeVideoElForBundledStart.readyState >= 2 && !activeVideoElForBundledStart.seeking) {
            activeVideoElForBundledStart.play().catch(() => { });
          } else {
            const playWhenReady = () => {
              if (!shouldAttemptDeferredPreviewPlay({
                isCurrentAttempt: previewPlaybackAttempt === previewPlaybackAttemptRef.current,
                isPlaying: isPlayingRef.current,
                isSeeking: isSeekingRef.current,
                mediaSeeking: activeVideoElForBundledStart.seeking,
                readyState: activeVideoElForBundledStart.readyState,
                minReadyState: 2,
              })) {
                return;
              }
              if (activeVideoElForBundledStart.paused) {
                activeVideoElForBundledStart.play().catch(() => { });
              }
            };
            activeVideoElForBundledStart.addEventListener('canplay', playWhenReady, { once: true });
          }
        }

        resetInactiveVideos();

        const shouldRenderAsActivePreview =
          !isExportMode && previewPlatformPolicy.muteNativeMediaWhenAudioRouted;
        renderFrame(fromTime, shouldRenderAsActivePreview, isExportMode);

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

      startTimeRef.current = Date.now() - fromTime * 1000;

      if (isExportMode && canvasRef.current && masterDestRef.current) {
        startWebCodecsExport(
          canvasRef,
          masterDestRef,
          (url, ext) => {
            logInfo('RENDER', '[DIAG-UI] export complete callback received', {
              urlPresent: Boolean(url),
              ext,
            });
            setExportUrl(url);
            setExportExt(ext as 'mp4' | 'webm');
            setProcessing(false);
            setLoading(false);
            setExportPreparationStep(null);
            pause();
          },
          (message) => {
            setProcessing(false);
            setExportPreparationStep(null);
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
              startTimeRef.current = Date.now() - fromTime * 1000;
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
