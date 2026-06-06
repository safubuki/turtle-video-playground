import { useCallback, useEffect, type ChangeEvent, type MutableRefObject } from 'react';

import { SEEK_THROTTLE_MS } from '../../../constants';
import type { MediaItem } from '../../../types';
import {
  shouldAttemptDeferredPreviewPlay,
  shouldBundlePreviewStartForWebAudioMix,
  shouldKeepInactiveVideoPrewarmed,
  type PreviewPlatformPolicy,
} from './previewPlatform';
import { getStandardPreviewNow } from './playbackClock';

interface PreparedPreviewAudioNodesResult {
  activeVideoId: string | null;
  audibleSourceCount: number;
  requiresWebAudio: boolean;
}

interface UsePreviewSeekControllerParams {
  mediaItemsRef: MutableRefObject<MediaItem[]>;
  mediaElementsRef: MutableRefObject<Record<string, HTMLVideoElement | HTMLImageElement | HTMLAudioElement>>;
  sourceNodesRef: MutableRefObject<Record<string, MediaElementAudioSourceNode>>;
  gainNodesRef: MutableRefObject<Record<string, GainNode>>;
  audioCtxRef: MutableRefObject<AudioContext | null>;
  totalDurationRef: MutableRefObject<number>;
  currentTimeRef: MutableRefObject<number>;
  activeVideoIdRef: MutableRefObject<string | null>;
  isPlayingRef: MutableRefObject<boolean>;
  isSeekingRef: MutableRefObject<boolean>;
  wasPlayingBeforeSeekRef: MutableRefObject<boolean>;
  seekingVideosRef: MutableRefObject<Set<string>>;
  startTimeRef: MutableRefObject<number>;
  reqIdRef: MutableRefObject<number | null>;
  loopIdRef: MutableRefObject<number>;
  playbackTimeoutRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  lastSeekTimeRef: MutableRefObject<number>;
  pendingSeekRef: MutableRefObject<number | null>;
  pendingSeekTimeoutRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  seekSettleGenerationRef: MutableRefObject<number>;
  previewPlaybackAttemptRef: MutableRefObject<number>;
  pendingPausedSeekWaitRef: MutableRefObject<{ cleanup: () => void } | null>;
  handleSeekEndCallbackRef: MutableRefObject<(() => void) | null>;
  renderPausedPreviewFrameAtTimeRef: MutableRefObject<(targetTime: number) => void>;
  cancelSeekPlaybackPrepareRef: MutableRefObject<(() => void) | null>;
  isSeekPlaybackPreparingRef: MutableRefObject<boolean>;
  endFinalizedRef: MutableRefObject<boolean>;
  previewPlatformPolicy: PreviewPlatformPolicy;
  setCurrentTime: (time: number) => void;
  attachGlobalSeekEndListeners: () => void;
  detachGlobalSeekEndListeners: () => void;
  cancelPendingSeekPlaybackPrepare: () => void;
  cancelPendingPausedSeekWait: () => void;
  renderFrame: (time: number, isActivePlaying?: boolean, isExporting?: boolean) => boolean | void;
  loop: (isExportMode: boolean, myLoopId: number) => void;
  resetInactiveVideos: () => void;
  preparePreviewAudioNodesForTime: (time: number) => PreparedPreviewAudioNodesResult;
  primePreviewAudioOnlyTracksAtTime: (playbackTime: number) => void;
}

interface UsePreviewSeekControllerResult {
  handleSeekStart: () => void;
  handleSeekChange: (event: ChangeEvent<HTMLInputElement>) => void;
  handleSeekEnd: () => void;
  syncVideoToTime: (time: number, options?: { force?: boolean }) => void;
}

export function usePreviewSeekController({
  mediaItemsRef,
  mediaElementsRef,
  sourceNodesRef,
  gainNodesRef,
  audioCtxRef,
  totalDurationRef,
  currentTimeRef,
  activeVideoIdRef,
  isPlayingRef,
  isSeekingRef,
  wasPlayingBeforeSeekRef,
  seekingVideosRef,
  startTimeRef,
  reqIdRef,
  loopIdRef,
  playbackTimeoutRef,
  lastSeekTimeRef,
  pendingSeekRef,
  pendingSeekTimeoutRef,
  seekSettleGenerationRef,
  previewPlaybackAttemptRef,
  pendingPausedSeekWaitRef,
  handleSeekEndCallbackRef,
  renderPausedPreviewFrameAtTimeRef,
  cancelSeekPlaybackPrepareRef,
  isSeekPlaybackPreparingRef,
  endFinalizedRef,
  previewPlatformPolicy,
  setCurrentTime,
  attachGlobalSeekEndListeners,
  detachGlobalSeekEndListeners,
  cancelPendingSeekPlaybackPrepare,
  cancelPendingPausedSeekWait,
  renderFrame,
  loop,
  resetInactiveVideos,
  preparePreviewAudioNodesForTime,
  primePreviewAudioOnlyTracksAtTime,
}: UsePreviewSeekControllerParams): UsePreviewSeekControllerResult {
  const requestVideoPlayWithRetry = useCallback((videoElement: HTMLVideoElement, retryIntervalMs = 160) => {
    const maxRetryCount = 4;
    const tryPlay = (attempt: number) => {
      if (!isPlayingRef.current || isSeekingRef.current || !videoElement.paused) return;
      if (videoElement.readyState === 0 && !videoElement.error) {
        try { videoElement.load(); } catch { /* ignore */ }
      }
      if (videoElement.readyState >= 2 && !videoElement.seeking) {
        videoElement.play().catch(() => {
          if (attempt < maxRetryCount) setTimeout(() => tryPlay(attempt + 1), retryIntervalMs);
        });
        return;
      }
      if (attempt < maxRetryCount) setTimeout(() => tryPlay(attempt + 1), retryIntervalMs);
    };
    tryPlay(1);
  }, [isPlayingRef, isSeekingRef]);

  const syncVideoToTime = useCallback((time: number, options?: { force?: boolean }) => {
    const force = options?.force ?? false;
    const seekThreshold = force ? 0.01 : 0.1;
    let accumulatedTime = 0;

    for (const item of mediaItemsRef.current) {
      if (time >= accumulatedTime && time < accumulatedTime + item.duration) {
        if (item.type === 'video') {
          const videoElement = mediaElementsRef.current[item.id] as HTMLVideoElement;
          if (videoElement) {
            if (videoElement.readyState === 0 && !videoElement.error) {
              try {
                videoElement.load();
              } catch {
                // ignore
              }
            }
            if (videoElement.readyState >= 1) {
              const localTime = time - accumulatedTime;
              const targetTime = (item.trimStart || 0) + localTime;
              const drift = Math.abs(videoElement.currentTime - targetTime);
              if (drift > seekThreshold && (force || !videoElement.seeking)) {
                videoElement.currentTime = targetTime;
              }
            }
          }
          activeVideoIdRef.current = item.id;
        } else {
          activeVideoIdRef.current = null;
        }
        return;
      }
      accumulatedTime += item.duration;
    }

    const items = mediaItemsRef.current;
    if (items.length > 0 && time >= totalDurationRef.current) {
      const lastItem = items[items.length - 1];
      if (lastItem.type === 'video') {
        const videoElement = mediaElementsRef.current[lastItem.id] as HTMLVideoElement;
        if (videoElement) {
          if (videoElement.readyState === 0 && !videoElement.error) {
            try {
              videoElement.load();
            } catch {
              // ignore
            }
          }
          if (videoElement.readyState >= 1) {
            const targetTime = (lastItem.trimStart || 0) + Math.max(0, lastItem.duration - 0.001);
            const drift = Math.abs(videoElement.currentTime - targetTime);
            const endAlignThreshold = 0.0001;
            const shouldForceEndAlign = force || time >= totalDurationRef.current - 0.05;
            if (shouldForceEndAlign) {
              const isAhead = videoElement.currentTime > targetTime + endAlignThreshold;
              if (!videoElement.seeking && (drift > endAlignThreshold || isAhead)) {
                videoElement.currentTime = targetTime;
              }
            } else if (drift > seekThreshold && (force || !videoElement.seeking)) {
              videoElement.currentTime = targetTime;
            }
          }
        }
        activeVideoIdRef.current = lastItem.id;
      } else {
        activeVideoIdRef.current = null;
      }
      return;
    }

    activeVideoIdRef.current = null;
  }, [activeVideoIdRef, mediaElementsRef, mediaItemsRef, totalDurationRef]);

  const renderPausedPreviewFrameAtTime = useCallback((targetTime: number) => {
    const clampedTime = Math.max(0, Math.min(targetTime, totalDurationRef.current));
    const drawSettledFrame = (timeToDraw: number) => {
      syncVideoToTime(timeToDraw, { force: true });
      renderFrame(timeToDraw, false);
    };

    let activeVideoElement: HTMLVideoElement | null = null;
    let accumulatedTime = 0;
    for (const item of mediaItemsRef.current) {
      if (clampedTime >= accumulatedTime && clampedTime < accumulatedTime + item.duration) {
        if (item.type === 'video') {
          const element = mediaElementsRef.current[item.id] as HTMLVideoElement | undefined;
          activeVideoElement = element ?? null;
        }
        break;
      }
      accumulatedTime += item.duration;
    }

    if (!activeVideoElement && mediaItemsRef.current.length > 0 && clampedTime >= totalDurationRef.current) {
      const lastItem = mediaItemsRef.current[mediaItemsRef.current.length - 1];
      if (lastItem.type === 'video') {
        const element = mediaElementsRef.current[lastItem.id] as HTMLVideoElement | undefined;
        activeVideoElement = element ?? null;
      }
    }

    cancelPendingPausedSeekWait();

    if (activeVideoElement?.readyState === 0 && !activeVideoElement.error) {
      try {
        activeVideoElement.load();
      } catch {
        // ignore
      }
    }

    syncVideoToTime(clampedTime, { force: true });

    if (activeVideoElement && (activeVideoElement.seeking || activeVideoElement.readyState < 2)) {
      const settleGeneration = seekSettleGenerationRef.current;
      const drawIfFresh = () => {
        if (settleGeneration !== seekSettleGenerationRef.current) return;
        const latestTime = Math.max(0, Math.min(currentTimeRef.current, totalDurationRef.current));
        drawSettledFrame(latestTime);
      };

      const cleanupWait = () => {
        activeVideoElement?.removeEventListener('seeked', onPrepared);
        activeVideoElement?.removeEventListener('loadeddata', onPrepared);
        activeVideoElement?.removeEventListener('canplay', onPrepared);
        if (pendingPausedSeekWaitRef.current?.cleanup === cleanupWait) {
          pendingPausedSeekWaitRef.current = null;
        }
        if (playbackTimeoutRef.current) {
          clearTimeout(playbackTimeoutRef.current);
          playbackTimeoutRef.current = null;
        }
      };

      const onPrepared = () => {
        if (activeVideoElement?.seeking) return;
        if ((activeVideoElement?.readyState ?? 0) < 2) return;
        cleanupWait();
        drawIfFresh();
      };

      pendingPausedSeekWaitRef.current = { cleanup: cleanupWait };
      activeVideoElement.addEventListener('seeked', onPrepared);
      activeVideoElement.addEventListener('loadeddata', onPrepared);
      activeVideoElement.addEventListener('canplay', onPrepared);
      playbackTimeoutRef.current = setTimeout(() => {
        cleanupWait();
        drawIfFresh();
      }, 500);
      onPrepared();
      return;
    }

    drawSettledFrame(clampedTime);
  }, [
    cancelPendingPausedSeekWait,
    currentTimeRef,
    mediaElementsRef,
    mediaItemsRef,
    pendingPausedSeekWaitRef,
    playbackTimeoutRef,
    renderFrame,
    seekSettleGenerationRef,
    syncVideoToTime,
    totalDurationRef,
  ]);

  const handleSeekStart = useCallback(() => {
    cancelPendingSeekPlaybackPrepare();
    cancelPendingPausedSeekWait();
    if (isSeekingRef.current) return;

    wasPlayingBeforeSeekRef.current = isPlayingRef.current;
    isSeekingRef.current = true;
    previewPlaybackAttemptRef.current += 1;
    attachGlobalSeekEndListeners();

    if (isPlayingRef.current) {
      isPlayingRef.current = false;
      if (reqIdRef.current) {
        cancelAnimationFrame(reqIdRef.current);
        reqIdRef.current = null;
      }
      if (playbackTimeoutRef.current) {
        clearTimeout(playbackTimeoutRef.current);
        playbackTimeoutRef.current = null;
      }
      Object.values(mediaElementsRef.current).forEach((element) => {
        if (element && (element.tagName === 'VIDEO' || element.tagName === 'AUDIO')) {
          try {
            (element as HTMLMediaElement).pause();
          } catch {
            // ignore
          }
        }
      });
    }
  }, [
    attachGlobalSeekEndListeners,
    cancelPendingPausedSeekWait,
    cancelPendingSeekPlaybackPrepare,
    isPlayingRef,
    isSeekingRef,
    mediaElementsRef,
    playbackTimeoutRef,
    previewPlaybackAttemptRef,
    reqIdRef,
    wasPlayingBeforeSeekRef,
  ]);

  const handleSeekChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(event.target.value);
    const now = getStandardPreviewNow();
    endFinalizedRef.current = false;

    if (!isSeekingRef.current) {
      setCurrentTime(time);
      currentTimeRef.current = time;

      if (isPlayingRef.current) {
        startTimeRef.current = now - time * 1000;
      }

      pendingSeekRef.current = null;
      if (pendingSeekTimeoutRef.current) {
        clearTimeout(pendingSeekTimeoutRef.current);
        pendingSeekTimeoutRef.current = null;
      }

      syncVideoToTime(time, { force: true });
      renderFrame(time, isPlayingRef.current && !isSeekPlaybackPreparingRef.current);
      return;
    }

    seekSettleGenerationRef.current += 1;
    cancelPendingSeekPlaybackPrepare();
    cancelPendingPausedSeekWait();

    setCurrentTime(time);
    currentTimeRef.current = time;

    const timeSinceLastSeek = now - lastSeekTimeRef.current;
    if (timeSinceLastSeek < SEEK_THROTTLE_MS) {
      pendingSeekRef.current = time;
      if (!pendingSeekTimeoutRef.current) {
        pendingSeekTimeoutRef.current = setTimeout(() => {
          pendingSeekTimeoutRef.current = null;
          if (pendingSeekRef.current !== null) {
            const pendingTime = pendingSeekRef.current;
            pendingSeekRef.current = null;
            lastSeekTimeRef.current = getStandardPreviewNow();
            syncVideoToTime(pendingTime);
            renderFrame(pendingTime, false);
          }
        }, SEEK_THROTTLE_MS - timeSinceLastSeek);
      }
      renderFrame(time, false);
      return;
    }

    lastSeekTimeRef.current = now;
    pendingSeekRef.current = null;
    if (pendingSeekTimeoutRef.current) {
      clearTimeout(pendingSeekTimeoutRef.current);
      pendingSeekTimeoutRef.current = null;
    }

    syncVideoToTime(time);
    renderFrame(time, false);
  }, [
    cancelPendingPausedSeekWait,
    cancelPendingSeekPlaybackPrepare,
    currentTimeRef,
    endFinalizedRef,
    isPlayingRef,
    isSeekPlaybackPreparingRef,
    isSeekingRef,
    lastSeekTimeRef,
    pendingSeekRef,
    pendingSeekTimeoutRef,
    renderFrame,
    seekSettleGenerationRef,
    setCurrentTime,
    startTimeRef,
    syncVideoToTime,
  ]);

  const handleSeekEnd = useCallback(() => {
    if (!isSeekingRef.current) {
      return;
    }

    cancelPendingSeekPlaybackPrepare();
    detachGlobalSeekEndListeners();
    if (pendingSeekTimeoutRef.current) {
      clearTimeout(pendingSeekTimeoutRef.current);
      pendingSeekTimeoutRef.current = null;
    }

    cancelPendingPausedSeekWait();
    seekingVideosRef.current.clear();

    let time = Math.max(0, Math.min(currentTimeRef.current, totalDurationRef.current));
    const wasPlaying = wasPlayingBeforeSeekRef.current;

    if (pendingSeekRef.current !== null) {
      const pendingTime = Math.max(0, Math.min(pendingSeekRef.current, totalDurationRef.current));
      pendingSeekRef.current = null;
      time = pendingTime;
      currentTimeRef.current = pendingTime;
      setCurrentTime(pendingTime);
      syncVideoToTime(pendingTime, { force: true });
    }

    isSeekingRef.current = false;
    wasPlayingBeforeSeekRef.current = false;

    const findActiveVideoAtTime = (targetTimelineTime: number): HTMLVideoElement | null => {
      let accumulatedTime = 0;
      for (const item of mediaItemsRef.current) {
        if (targetTimelineTime >= accumulatedTime && targetTimelineTime < accumulatedTime + item.duration) {
          if (item.type === 'video') {
            return (mediaElementsRef.current[item.id] as HTMLVideoElement | undefined) ?? null;
          }
          return null;
        }
        accumulatedTime += item.duration;
      }

      if (mediaItemsRef.current.length > 0 && targetTimelineTime >= totalDurationRef.current) {
        const lastItem = mediaItemsRef.current[mediaItemsRef.current.length - 1];
        if (lastItem.type === 'video') {
          return (mediaElementsRef.current[lastItem.id] as HTMLVideoElement | undefined) ?? null;
        }
      }
      return null;
    };

    if (wasPlaying) {
      isSeekPlaybackPreparingRef.current = true;
      const seekGeneration = seekSettleGenerationRef.current;

      const proceedWithPlayback = () => {
        if (seekGeneration !== seekSettleGenerationRef.current || isSeekingRef.current) {
          return;
        }

        const playbackTime = Math.max(0, Math.min(currentTimeRef.current, totalDurationRef.current));
        previewPlaybackAttemptRef.current += 1;
        const previewPlaybackAttempt = previewPlaybackAttemptRef.current;
        isSeekPlaybackPreparingRef.current = false;
        startTimeRef.current = getStandardPreviewNow() - playbackTime * 1000;
        isPlayingRef.current = true;

        const preparedPreviewAudio = preparePreviewAudioNodesForTime(playbackTime);
        const shouldBundlePreviewStart = shouldBundlePreviewStartForWebAudioMix(previewPlatformPolicy, {
          hasActiveVideo: preparedPreviewAudio.activeVideoId !== null,
          audibleSourceCount: preparedPreviewAudio.audibleSourceCount,
          requiresWebAudio: preparedPreviewAudio.requiresWebAudio,
        });
        const shouldPrimeActiveVideo = !shouldBundlePreviewStart;

        if (previewPlatformPolicy.muteNativeMediaWhenAudioRouted) {
          primePreviewAudioOnlyTracksAtTime(playbackTime);
        }

        let activeVideoElementForBundledStart: HTMLVideoElement | null = null;
        let accumulatedTime = 0;
        for (const item of mediaItemsRef.current) {
          if (playbackTime >= accumulatedTime && playbackTime < accumulatedTime + item.duration) {
            if (item.type === 'video') {
              const videoElement = mediaElementsRef.current[item.id] as HTMLVideoElement;
              if (videoElement) {
                const localTime = playbackTime - accumulatedTime;
                const targetTime = (item.trimStart || 0) + localTime;

                if (Math.abs(videoElement.currentTime - targetTime) > 0.05) {
                  videoElement.currentTime = targetTime;
                }
                activeVideoIdRef.current = item.id;
                activeVideoElementForBundledStart = videoElement;

                if (shouldPrimeActiveVideo) {
                  if (videoElement.readyState >= 2 && !videoElement.seeking) {
                    requestVideoPlayWithRetry(videoElement);
                  } else {
                    const playWhenReady = () => {
                      if (!shouldAttemptDeferredPreviewPlay({
                        isCurrentAttempt: previewPlaybackAttempt === previewPlaybackAttemptRef.current,
                        isPlaying: isPlayingRef.current,
                        isSeeking: isSeekingRef.current,
                        mediaSeeking: videoElement.seeking,
                        readyState: videoElement.readyState,
                      })) {
                        return;
                      }
                      if (videoElement.paused) {
                        requestVideoPlayWithRetry(videoElement);
                      }
                    };

                    videoElement.addEventListener('canplay', playWhenReady, { once: true });
                    if (playbackTimeoutRef.current) {
                      clearTimeout(playbackTimeoutRef.current);
                    }
                    playbackTimeoutRef.current = setTimeout(() => {
                      playbackTimeoutRef.current = null;
                      if (shouldAttemptDeferredPreviewPlay({
                        isCurrentAttempt: previewPlaybackAttempt === previewPlaybackAttemptRef.current,
                        isPlaying: isPlayingRef.current,
                        isSeeking: isSeekingRef.current,
                        mediaSeeking: videoElement.seeking,
                        readyState: videoElement.readyState,
                      }) && videoElement.paused) {
                        requestVideoPlayWithRetry(videoElement);
                      }
                    }, 1000);
                  }
                }
              }
            } else {
              activeVideoIdRef.current = null;
            }
            break;
          }
          accumulatedTime += item.duration;
        }

        if (shouldBundlePreviewStart && activeVideoElementForBundledStart) {
          if (activeVideoElementForBundledStart.readyState >= 2 && !activeVideoElementForBundledStart.seeking) {
            requestVideoPlayWithRetry(activeVideoElementForBundledStart);
          } else {
            const playWhenReady = () => {
              if (!shouldAttemptDeferredPreviewPlay({
                isCurrentAttempt: previewPlaybackAttempt === previewPlaybackAttemptRef.current,
                isPlaying: isPlayingRef.current,
                isSeeking: isSeekingRef.current,
                mediaSeeking: activeVideoElementForBundledStart.seeking,
                readyState: activeVideoElementForBundledStart.readyState,
                minReadyState: 2,
              })) {
                return;
              }
              if (activeVideoElementForBundledStart.paused) {
                requestVideoPlayWithRetry(activeVideoElementForBundledStart);
              }
            };
            activeVideoElementForBundledStart.addEventListener('canplay', playWhenReady, { once: true });
          }
        }

        resetInactiveVideos();

        if (previewPlatformPolicy.muteNativeMediaWhenAudioRouted) {
          const allowExtendedFuturePrewarm = preparedPreviewAudio.activeVideoId === null;
          let nearestFutureVideoId: string | null = null;
          let prewarmCursor = 0;
          for (const item of mediaItemsRef.current) {
            const itemStart = prewarmCursor;
            const itemEnd = prewarmCursor + Math.max(0, item.duration);
            prewarmCursor = itemEnd;
            if (item.type !== 'video') continue;
            if (itemStart - playbackTime > 0.0005) {
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
            if (itemEnd <= playbackTime + 0.0005) continue;
            if (shouldBundlePreviewStart && item.id === preparedPreviewAudio.activeVideoId) {
              continue;
            }

            const shouldPrewarmVideo = shouldKeepInactiveVideoPrewarmed(previewPlatformPolicy, {
              hasAudioNode: !!sourceNodesRef.current[item.id],
              isExporting: false,
              isActivePlaying: true,
              timeSinceVideoEndSec: playbackTime - itemEnd,
              timeUntilVideoStartSec: itemStart - playbackTime,
              isNearestFutureVideo: item.id === nearestFutureVideoId,
              allowExtendedFuturePrewarm,
            });
            if (!shouldPrewarmVideo) {
              continue;
            }

            const element = mediaElementsRef.current[item.id] as HTMLVideoElement | undefined;
            if (element && sourceNodesRef.current[item.id] && element.paused) {
              const gainNode = gainNodesRef.current[item.id];
              if (gainNode && audioCtxRef.current) {
                gainNode.gain.setValueAtTime(0, audioCtxRef.current.currentTime);
              }
              element.play().catch(() => {});
            }
          }
        }

        const currentLoopId = loopIdRef.current;
        reqIdRef.current = requestAnimationFrame(() => loop(false, currentLoopId));
      };

      syncVideoToTime(time, { force: true });
      const activeVideoElement = findActiveVideoAtTime(time);
      if (activeVideoElement) {
        const prepareStartedAt = Date.now();
        const minPrepareMs = 220;
        const maxPrepareMs = 900;
        let finished = false;
        let pollTimer: ReturnType<typeof setInterval> | null = null;
        let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
        let maybeResume: () => void = () => {};

        const onPrepared = () => {
          maybeResume();
        };

        const cleanupPrepareWait = () => {
          if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
          }
          if (fallbackTimer) {
            clearTimeout(fallbackTimer);
            fallbackTimer = null;
          }
          activeVideoElement.removeEventListener('seeked', onPrepared);
          activeVideoElement.removeEventListener('loadeddata', onPrepared);
          activeVideoElement.removeEventListener('canplay', onPrepared);
          activeVideoElement.removeEventListener('error', onPrepared);
          if (cancelSeekPlaybackPrepareRef.current === cleanupPrepareWait) {
            cancelSeekPlaybackPrepareRef.current = null;
          }
        };

        const finishPrepareWait = (shouldResume: boolean) => {
          if (finished) return;
          finished = true;
          cleanupPrepareWait();
          isSeekPlaybackPreparingRef.current = false;
          if (shouldResume) {
            proceedWithPlayback();
          }
        };

        maybeResume = () => {
          if (finished) return;
          if (seekGeneration !== seekSettleGenerationRef.current || isSeekingRef.current) {
            finishPrepareWait(false);
            return;
          }
          const elapsed = Date.now() - prepareStartedAt;
          const isReady = activeVideoElement.readyState >= 2 && !activeVideoElement.seeking;
          if (!isReady && elapsed < maxPrepareMs) return;
          if (elapsed < minPrepareMs) return;
          finishPrepareWait(true);
        };

        activeVideoElement.addEventListener('seeked', onPrepared);
        activeVideoElement.addEventListener('loadeddata', onPrepared);
        activeVideoElement.addEventListener('canplay', onPrepared);
        activeVideoElement.addEventListener('error', onPrepared);
        pollTimer = setInterval(maybeResume, 40);
        fallbackTimer = setTimeout(maybeResume, maxPrepareMs + 50);
        cancelSeekPlaybackPrepareRef.current = cleanupPrepareWait;
        maybeResume();
        return;
      }

      isSeekPlaybackPreparingRef.current = false;
      proceedWithPlayback();
      return;
    }

    isSeekPlaybackPreparingRef.current = false;
    const drawSettledFrame = (targetTime: number) => {
      syncVideoToTime(targetTime, { force: true });
      renderFrame(targetTime, false);
    };

    let activeVideoElement: HTMLVideoElement | null = null;
    let accumulatedTime = 0;
    for (const item of mediaItemsRef.current) {
      if (time >= accumulatedTime && time < accumulatedTime + item.duration) {
        if (item.type === 'video') {
          const element = mediaElementsRef.current[item.id] as HTMLVideoElement | undefined;
          activeVideoElement = element ?? null;
        }
        break;
      }
      accumulatedTime += item.duration;
    }

    if (!activeVideoElement && mediaItemsRef.current.length > 0 && time >= totalDurationRef.current) {
      const lastItem = mediaItemsRef.current[mediaItemsRef.current.length - 1];
      if (lastItem.type === 'video') {
        const element = mediaElementsRef.current[lastItem.id] as HTMLVideoElement | undefined;
        activeVideoElement = element ?? null;
      }
    }

    if (activeVideoElement && activeVideoElement.seeking) {
      const settleGeneration = seekSettleGenerationRef.current;
      const drawIfFresh = () => {
        if (settleGeneration !== seekSettleGenerationRef.current) return;
        const latestTime = Math.max(0, Math.min(currentTimeRef.current, totalDurationRef.current));
        drawSettledFrame(latestTime);
      };
      const onSeeked = () => {
        activeVideoElement?.removeEventListener('seeked', onSeeked);
        pendingPausedSeekWaitRef.current = null;
        if (playbackTimeoutRef.current) {
          clearTimeout(playbackTimeoutRef.current);
          playbackTimeoutRef.current = null;
        }
        drawIfFresh();
      };
      pendingPausedSeekWaitRef.current = {
        cleanup: () => {
          activeVideoElement?.removeEventListener('seeked', onSeeked);
        },
      };
      activeVideoElement.addEventListener('seeked', onSeeked, { once: true });
      playbackTimeoutRef.current = setTimeout(() => {
        activeVideoElement?.removeEventListener('seeked', onSeeked);
        pendingPausedSeekWaitRef.current = null;
        playbackTimeoutRef.current = null;
        drawIfFresh();
      }, 500);
      return;
    }

    drawSettledFrame(time);
  }, [
    activeVideoIdRef,
    audioCtxRef,
    cancelPendingPausedSeekWait,
    cancelPendingSeekPlaybackPrepare,
    currentTimeRef,
    detachGlobalSeekEndListeners,
    gainNodesRef,
    isPlayingRef,
    isSeekPlaybackPreparingRef,
    isSeekingRef,
    mediaElementsRef,
    mediaItemsRef,
    pendingPausedSeekWaitRef,
    pendingSeekRef,
    pendingSeekTimeoutRef,
    playbackTimeoutRef,
    preparePreviewAudioNodesForTime,
    previewPlatformPolicy,
    previewPlaybackAttemptRef,
    primePreviewAudioOnlyTracksAtTime,
    requestVideoPlayWithRetry,
    cancelSeekPlaybackPrepareRef,
    renderFrame,
    reqIdRef,
    loopIdRef,
    resetInactiveVideos,
    seekingVideosRef,
    seekSettleGenerationRef,
    setCurrentTime,
    sourceNodesRef,
    startTimeRef,
    syncVideoToTime,
    totalDurationRef,
    wasPlayingBeforeSeekRef,
    loop,
  ]);

  useEffect(() => {
    renderPausedPreviewFrameAtTimeRef.current = renderPausedPreviewFrameAtTime;
  }, [renderPausedPreviewFrameAtTime, renderPausedPreviewFrameAtTimeRef]);

  useEffect(() => {
    handleSeekEndCallbackRef.current = handleSeekEnd;
  }, [handleSeekEnd, handleSeekEndCallbackRef]);

  return {
    handleSeekStart,
    handleSeekChange,
    handleSeekEnd,
    syncVideoToTime,
  };
}
