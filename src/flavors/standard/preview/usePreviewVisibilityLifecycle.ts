import { useEffect, type MutableRefObject } from 'react';

import type { AudioTrack, MediaElementsRef, MediaItem, NarrationClip } from '../../../types';
import type { LogCategory } from '../../../stores/logStore';
import {
  getPageHidePausePlan,
  getVisibilityRecoveryPlan,
  shouldResumeAudioContextOnVisibilityReturn,
  type PreviewPlatformPolicy,
} from './previewPlatform';

type LogFn = (category: LogCategory, message: string, details?: Record<string, unknown>) => void;

interface UsePreviewVisibilityLifecycleParams {
  mediaElementsRef: MutableRefObject<MediaElementsRef>;
  mediaItemsRef: MutableRefObject<MediaItem[]>;
  bgmRef: MutableRefObject<AudioTrack | null>;
  narrationsRef: MutableRefObject<NarrationClip[]>;
  activeVideoIdRef: MutableRefObject<string | null>;
  currentTimeRef: MutableRefObject<number>;
  totalDurationRef: MutableRefObject<number>;
  hiddenStartedAtRef: MutableRefObject<number | null>;
  needsResyncAfterVisibilityRef: MutableRefObject<boolean>;
  startTimeRef: MutableRefObject<number>;
  audioResumeWaitFramesRef: MutableRefObject<number>;
  lastVisibilityRefreshAtRef: MutableRefObject<number>;
  isPlayingRef: MutableRefObject<boolean>;
  isSeekingRef?: MutableRefObject<boolean>;
  audioCtxRef: MutableRefObject<AudioContext | null>;
  isProcessing: boolean;
  previewPlatformPolicy: PreviewPlatformPolicy;
  cancelPendingSeekPlaybackPrepare: () => void;
  cancelPendingPausedSeekWait: () => void;
  renderFrame: (time: number, isActivePlaying: boolean, isExporting?: boolean) => void;
  renderPausedPreviewFrameAtTimeRef: MutableRefObject<(targetTime: number) => void>;
  pause: () => void;
  logInfo: LogFn;
  logWarn: LogFn;
}

export function usePreviewVisibilityLifecycle({
  mediaElementsRef,
  mediaItemsRef,
  bgmRef,
  narrationsRef,
  activeVideoIdRef,
  currentTimeRef,
  totalDurationRef,
  hiddenStartedAtRef,
  needsResyncAfterVisibilityRef,
  startTimeRef,
  audioResumeWaitFramesRef,
  lastVisibilityRefreshAtRef,
  isPlayingRef,
  isSeekingRef,
  audioCtxRef,
  isProcessing,
  previewPlatformPolicy,
  cancelPendingSeekPlaybackPrepare,
  cancelPendingPausedSeekWait,
  renderFrame,
  renderPausedPreviewFrameAtTimeRef,
  pause,
  logInfo,
  logWarn,
}: UsePreviewVisibilityLifecycleParams): void {
  useEffect(() => {
    const pauseAllMediaElements = () => {
      Object.values(mediaElementsRef.current).forEach((el) => {
        if (el && (el.tagName === 'VIDEO' || el.tagName === 'AUDIO')) {
          try {
            (el as HTMLMediaElement).pause();
          } catch {
            // ignore
          }
        }
      });
    };

    const resyncMediaElementsToCurrentTime = () => {
      const currentTime = currentTimeRef.current;
      let accumulatedTime = 0;
      let activeVideoId: string | null = null;

      for (const item of mediaItemsRef.current) {
        const element = mediaElementsRef.current[item.id];
        if (item.type === 'video' && element) {
          const videoElement = element as HTMLVideoElement;
          if (currentTime >= accumulatedTime && currentTime < accumulatedTime + item.duration) {
            const localTime = currentTime - accumulatedTime;
            const targetTime = (item.trimStart || 0) + localTime;
            if (
              !videoElement.seeking
              && videoElement.readyState >= 1
              && Math.abs(videoElement.currentTime - targetTime) > 0.03
            ) {
              try {
                videoElement.currentTime = targetTime;
              } catch {
                // ignore
              }
            }
            activeVideoId = item.id;
          } else if (!videoElement.paused) {
            try {
              videoElement.pause();
            } catch {
              // ignore
            }
          }
        }
        accumulatedTime += item.duration;
      }
      activeVideoIdRef.current = activeVideoId;

      const resyncAudioTrack = (track: AudioTrack | null, trackId: 'bgm') => {
        const element = mediaElementsRef.current[trackId] as HTMLAudioElement | undefined;
        if (!track || !element) return;

        const trackTime = currentTime - track.delay + track.startPoint;
        const inRange = trackTime >= 0 && trackTime <= track.duration;

        if (!inRange) {
          if (!element.paused) {
            try {
              element.pause();
            } catch {
              // ignore
            }
          }
          return;
        }

        const drift = Math.abs(element.currentTime - trackTime);
        if (drift > 0.08 && !element.seeking && element.readyState >= 1) {
          try {
            element.currentTime = trackTime;
          } catch {
            // ignore
          }
        }
      };

      const resyncNarrationClip = (clip: NarrationClip) => {
        const trackId = `narration:${clip.id}`;
        const element = mediaElementsRef.current[trackId] as HTMLAudioElement | undefined;
        if (!element) return;

        const trimStart = Number.isFinite(clip.trimStart) ? Math.max(0, clip.trimStart) : 0;
        const trimEnd = Number.isFinite(clip.trimEnd)
          ? Math.max(trimStart, Math.min(clip.duration, clip.trimEnd))
          : clip.duration;
        const playableDuration = Math.max(0, trimEnd - trimStart);
        const clipTime = currentTime - clip.startTime;
        const trackTime = trimStart + clipTime;
        const inRange = clipTime >= 0 && clipTime <= playableDuration;

        if (!inRange) {
          if (!element.paused) {
            try {
              element.pause();
            } catch {
              // ignore
            }
          }
          return;
        }

        const drift = Math.abs(element.currentTime - trackTime);
        if (drift > 0.08 && !element.seeking && element.readyState >= 1) {
          try {
            element.currentTime = trackTime;
          } catch {
            // ignore
          }
        }
      };

      resyncAudioTrack(bgmRef.current, 'bgm');
      narrationsRef.current.forEach((clip) => resyncNarrationClip(clip));
    };

    const restoreTimelineClockAfterHidden = (): boolean => {
      const hiddenAt = hiddenStartedAtRef.current;
      if (hiddenAt === null) return false;
      hiddenStartedAtRef.current = null;

      const hiddenDurationMs = Math.max(0, Date.now() - hiddenAt);
      if (hiddenDurationMs <= 0) return false;

      if (isPlayingRef.current || isProcessing) {
        startTimeRef.current += hiddenDurationMs;
      }
      return true;
    };

    const refreshAfterReturn = () => {
      if (document.visibilityState !== 'visible') return;

      const nowPerf = typeof performance !== 'undefined' ? performance.now() : Date.now();
      if (nowPerf - lastVisibilityRefreshAtRef.current < previewPlatformPolicy.visibilityRecoveryDebounceMs) {
        return;
      }
      lastVisibilityRefreshAtRef.current = nowPerf;

      const resumedFromHidden = restoreTimelineClockAfterHidden();

      const audioContext = audioCtxRef.current;
      if (audioContext) {
        const state = audioContext.state as AudioContextState | 'interrupted';
        if (shouldResumeAudioContextOnVisibilityReturn(previewPlatformPolicy, state)) {
          audioContext.resume()
            .then(() => {
              logInfo('AUDIO', '可視復帰時にAudioContextを再開', { from: state, to: audioContext.state });
            })
            .catch((error) => {
              logWarn('AUDIO', '可視復帰時のAudioContext再開に失敗（次のユーザー操作で再試行）', {
                state,
                error: error instanceof Error ? error.message : String(error),
              });
            });
        }
      }

      const recoveryPlan = getVisibilityRecoveryPlan({
        resumedFromHidden,
        needsResyncFromLifecycle: needsResyncAfterVisibilityRef.current,
        isPlaying: isPlayingRef.current,
        isProcessing,
      });

      if (recoveryPlan.shouldDelayAudioResume) {
        audioResumeWaitFramesRef.current = Math.max(audioResumeWaitFramesRef.current, 1);
      }

      const latestTime = Math.max(0, Math.min(currentTimeRef.current, totalDurationRef.current));

      if (isSeekingRef?.current) {
        // Android では seek 復帰の cleanup / redraw を handleSeekEnd 側へ一任し、
        // visibility 復帰は resync 要否だけ保持してセッションを横取りしない。
        needsResyncAfterVisibilityRef.current = recoveryPlan.shouldResyncMedia;
        return;
      }

      if (!recoveryPlan.shouldKeepRunning) {
        cancelPendingSeekPlaybackPrepare();
        cancelPendingPausedSeekWait();
        needsResyncAfterVisibilityRef.current = false;
      } else if (recoveryPlan.shouldResyncMedia) {
        resyncMediaElementsToCurrentTime();
        needsResyncAfterVisibilityRef.current = false;
      }

      requestAnimationFrame(() => {
        if (!recoveryPlan.shouldKeepRunning) {
          renderPausedPreviewFrameAtTimeRef.current(latestTime);
          return;
        }
        renderFrame(latestTime, recoveryPlan.shouldKeepRunning, isProcessing);
      });

      if (!recoveryPlan.shouldKeepRunning) {
        // readyState=1 (HAVE_METADATA) で load() を呼ぶと readyState が 0 へ戻り
        // currentTime もリセットされる。バックグラウンド復帰後に動画が固まる原因に
        // なるため、本当にデータを失った readyState=0 のときだけ再ロードする。
        Object.values(mediaElementsRef.current).forEach((el) => {
          if (el.tagName !== 'VIDEO' && el.tagName !== 'AUDIO') return;
          const mediaEl = el as HTMLMediaElement;
          if (mediaEl.readyState !== 0 || mediaEl.error) return;
          try {
            mediaEl.load();
          } catch {
            // ignore
          }
        });
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        hiddenStartedAtRef.current = Date.now();
        cancelPendingSeekPlaybackPrepare();
        cancelPendingPausedSeekWait();
        if (isPlayingRef.current || isProcessing) {
          needsResyncAfterVisibilityRef.current = true;
          pauseAllMediaElements();
          if (!isProcessing) {
            isPlayingRef.current = false;
            pause();
          }
        }
        return;
      }

      if (document.visibilityState === 'visible') {
        refreshAfterReturn();
      }
    };

    const handleWindowBlur = () => {
      if (hiddenStartedAtRef.current === null) {
        hiddenStartedAtRef.current = Date.now();
      }
      if (isPlayingRef.current || isProcessing) {
        needsResyncAfterVisibilityRef.current = true;
      }
      cancelPendingSeekPlaybackPrepare();
      cancelPendingPausedSeekWait();
    };

    const handleWindowFocus = () => {
      refreshAfterReturn();
    };

    const handlePageShow = () => {
      refreshAfterReturn();
    };

    const handlePageHide = () => {
      const { shouldPauseMediaElements } = getPageHidePausePlan({ isProcessing });
      if (hiddenStartedAtRef.current === null) {
        hiddenStartedAtRef.current = Date.now();
      }
      cancelPendingSeekPlaybackPrepare();
      cancelPendingPausedSeekWait();
      if (isPlayingRef.current || isProcessing) {
        needsResyncAfterVisibilityRef.current = true;
        if (shouldPauseMediaElements) {
          pauseAllMediaElements();
        }
        if (!isProcessing) {
          isPlayingRef.current = false;
          pause();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleWindowBlur);
    window.addEventListener('focus', handleWindowFocus);
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('pageshow', handlePageShow);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleWindowBlur);
      window.removeEventListener('focus', handleWindowFocus);
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('pageshow', handlePageShow);
    };
  }, [
    activeVideoIdRef,
    audioCtxRef,
    audioResumeWaitFramesRef,
    bgmRef,
    cancelPendingPausedSeekWait,
    cancelPendingSeekPlaybackPrepare,
    currentTimeRef,
    hiddenStartedAtRef,
    isPlayingRef,
    isSeekingRef,
    isProcessing,
    lastVisibilityRefreshAtRef,
    logInfo,
    logWarn,
    mediaElementsRef,
    mediaItemsRef,
    narrationsRef,
    needsResyncAfterVisibilityRef,
    pause,
    previewPlatformPolicy,
    renderFrame,
    renderPausedPreviewFrameAtTimeRef,
    startTimeRef,
    totalDurationRef,
  ]);
}
