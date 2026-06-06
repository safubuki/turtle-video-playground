import { useCallback, useEffect, type MutableRefObject } from 'react';

import type { AudioTrack, MediaElementsRef, MediaItem, NarrationClip } from '../../../types';
import type { LogCategory } from '../../../stores/logStore';
import { findActiveTimelineItem } from '../../../utils/playbackTimeline';
import {
  getPreviewAudioRoutingPlan,
  shouldAttemptDeferredPreviewPlay,
  type PreviewPlatformPolicy,
} from './previewPlatform';

type LogFn = (category: LogCategory, message: string, details?: Record<string, unknown>) => void;

interface PreparedPreviewAudioNodesResult {
  activeVideoId: string | null;
  audibleSourceCount: number;
  requiresWebAudio: boolean;
}

interface UsePreviewAudioSessionParams {
  mediaItemsRef: MutableRefObject<MediaItem[]>;
  bgmRef: MutableRefObject<AudioTrack | null>;
  narrationsRef: MutableRefObject<NarrationClip[]>;
  totalDurationRef: MutableRefObject<number>;
  currentTimeRef: MutableRefObject<number>;
  mediaElementsRef: MutableRefObject<MediaElementsRef>;
  audioCtxRef: MutableRefObject<AudioContext | null>;
  sourceNodesRef: MutableRefObject<Record<string, MediaElementAudioSourceNode>>;
  gainNodesRef: MutableRefObject<Record<string, GainNode>>;
  sourceElementsRef: MutableRefObject<Record<string, HTMLMediaElement>>;
  pendingAudioDetachTimersRef: MutableRefObject<Record<string, ReturnType<typeof setTimeout>>>;
  masterDestRef: MutableRefObject<MediaStreamAudioDestinationNode | null>;
  audioRoutingModeRef: MutableRefObject<'preview' | 'export'>;
  previewAudioRouteRefreshInFlightRef: MutableRefObject<Promise<void> | null>;
  lastIosSafariAudioLogRef: MutableRefObject<string>;
  requestPreviewAudioRouteRefreshRef: MutableRefObject<() => void>;
  primePreviewAudioOnlyTracksAtTimeRef: MutableRefObject<(playbackTime: number) => void>;
  previewPlaybackAttemptRef: MutableRefObject<number>;
  isPlayingRef: MutableRefObject<boolean>;
  isSeekingRef: MutableRefObject<boolean>;
  previewPlatformPolicy: PreviewPlatformPolicy;
  isIosSafari: boolean;
  bgm: AudioTrack | null;
  narrations: NarrationClip[];
  isProcessing: boolean;
  getAudioContext: () => AudioContext;
  logInfo: LogFn;
  logWarn: LogFn;
}

interface UsePreviewAudioSessionResult {
  detachAudioNode: (id: string) => void;
  ensureAudioNodeForElement: (id: string, mediaEl: HTMLMediaElement) => boolean;
  preparePreviewAudioNodesForTime: (time: number) => PreparedPreviewAudioNodesResult;
  preparePreviewAudioNodesForUpcomingVideos: (fromTime: number) => void;
  primePreviewAudioOnlyTracksAtTime: (playbackTime: number) => void;
  handleMediaRefAssign: (id: string, element: HTMLVideoElement | HTMLImageElement | HTMLAudioElement | null) => void;
}

const resetNativeMediaAudioState = (mediaEl: HTMLMediaElement) => {
  mediaEl.defaultMuted = false;
  mediaEl.muted = false;
  mediaEl.volume = 1;
};
// BGM / ナレーション UI は 250% まで指定できるため、standard preview の gain も同じ上限にそろえる。
const MAX_PREVIEW_AUDIO_GAIN = 2.5;

export function clampPreviewAudioGain(volume: number): number {
  return Math.max(0, Math.min(MAX_PREVIEW_AUDIO_GAIN, volume));
}

export function resolvePreviewAudioGain(params: {
  baseVolume: number;
  time: number;
  startTime: number;
  totalDuration: number;
  fadeIn?: boolean;
  fadeOut?: boolean;
  fadeInDuration?: number;
  fadeOutDuration?: number;
}): number {
  let gain = params.baseVolume;
  const playTime = params.time - params.startTime;

  if (playTime < 0) {
    return 0;
  }

  if (params.fadeIn) {
    const duration = params.fadeInDuration || 1;
    if (playTime < duration) {
      gain *= Math.max(0, playTime / duration);
    }
  }

  if (params.fadeOut) {
    const duration = params.fadeOutDuration || 1;
    const remaining = params.totalDuration - params.time;
    if (remaining < duration) {
      gain *= Math.max(0, remaining / duration);
    }
  }

  return clampPreviewAudioGain(gain);
}

export function resolvePreviewBgmGain(
  bgm: AudioTrack,
  time: number,
  totalDuration: number,
): number {
  const trackTime = time - bgm.delay + bgm.startPoint;
  if (time < bgm.delay || trackTime < 0 || trackTime > bgm.duration) {
    return 0;
  }

  return resolvePreviewAudioGain({
    baseVolume: bgm.volume,
    time,
    startTime: bgm.delay,
    totalDuration,
    fadeIn: bgm.fadeIn,
    fadeOut: bgm.fadeOut,
    fadeInDuration: bgm.fadeInDuration,
    fadeOutDuration: bgm.fadeOutDuration,
  });
}

export function usePreviewAudioSession({
  mediaItemsRef,
  bgmRef,
  narrationsRef,
  totalDurationRef,
  currentTimeRef,
  mediaElementsRef,
  audioCtxRef: _audioCtxRef,
  sourceNodesRef,
  gainNodesRef,
  sourceElementsRef,
  pendingAudioDetachTimersRef,
  masterDestRef,
  audioRoutingModeRef,
  previewAudioRouteRefreshInFlightRef,
  lastIosSafariAudioLogRef,
  requestPreviewAudioRouteRefreshRef,
  primePreviewAudioOnlyTracksAtTimeRef,
  previewPlaybackAttemptRef,
  isPlayingRef,
  isSeekingRef,
  previewPlatformPolicy,
  isIosSafari: _isIosSafari,
  bgm,
  narrations,
  isProcessing,
  getAudioContext,
  logInfo: _logInfo,
  logWarn,
}: UsePreviewAudioSessionParams): UsePreviewAudioSessionResult {
  const detachAudioNode = useCallback((id: string) => {
    if (sourceNodesRef.current[id]) {
      try {
        sourceNodesRef.current[id].disconnect();
      } catch {
        // ignore
      }
      delete sourceNodesRef.current[id];
    }
    if (gainNodesRef.current[id]) {
      try {
        gainNodesRef.current[id].disconnect();
      } catch {
        // ignore
      }
      delete gainNodesRef.current[id];
    }
    delete sourceElementsRef.current[id];
  }, [gainNodesRef, sourceElementsRef, sourceNodesRef]);

  const ensureAudioNodeForElement = useCallback((id: string, mediaEl: HTMLMediaElement): boolean => {
    const currentSourceEl = sourceElementsRef.current[id];
    const hasExistingAudioNode = !!sourceNodesRef.current[id] && !!gainNodesRef.current[id];

    if (hasExistingAudioNode && currentSourceEl === mediaEl) {
      return true;
    }

    if (hasExistingAudioNode && currentSourceEl && currentSourceEl !== mediaEl) {
      detachAudioNode(id);
    }

    try {
      const ctx = getAudioContext();
      if ((ctx.state as AudioContextState | 'interrupted') !== 'running') {
        ctx.resume().catch(() => {
          // ignore
        });
      }

      const source = ctx.createMediaElementSource(mediaEl);
      const gain = ctx.createGain();
      source.connect(gain);

      const initialTarget =
        audioRoutingModeRef.current === 'export' && masterDestRef.current
          ? masterDestRef.current
          : ctx.destination;
      gain.connect(initialTarget);
      gain.gain.setValueAtTime(1, ctx.currentTime);

      sourceNodesRef.current[id] = source;
      gainNodesRef.current[id] = gain;
      sourceElementsRef.current[id] = mediaEl;

      return true;
    } catch (error) {
      logWarn('AUDIO', 'preview audio node 作成失敗', {
        id,
        tagName: mediaEl.tagName,
        reason: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }, [audioRoutingModeRef, detachAudioNode, gainNodesRef, getAudioContext, logWarn, masterDestRef, sourceElementsRef, sourceNodesRef]);

  const requestPreviewAudioRouteRefresh = useCallback(() => {
    previewAudioRouteRefreshInFlightRef.current = null;
    lastIosSafariAudioLogRef.current = '';
  }, [lastIosSafariAudioLogRef, previewAudioRouteRefreshInFlightRef]);

  useEffect(() => {
    requestPreviewAudioRouteRefreshRef.current = requestPreviewAudioRouteRefresh;
  }, [requestPreviewAudioRouteRefresh, requestPreviewAudioRouteRefreshRef]);

  const preparePreviewAudioNodesForTime = useCallback((time: number): PreparedPreviewAudioNodesResult => {
    if (!previewPlatformPolicy.muteNativeMediaWhenAudioRouted) {
      return {
        activeVideoId: null,
        audibleSourceCount: 0,
        requiresWebAudio: false,
      };
    }

    const currentItems = mediaItemsRef.current;
    const currentBgm = bgmRef.current;
    const currentNarrations = narrationsRef.current;
    let activeVideoId: string | null = null;
    const candidates: Array<{
      id: string;
      desiredVolume: number;
      element: HTMLMediaElement;
      sourceType: 'video' | 'audio';
    }> = [];

    const active = findActiveTimelineItem(currentItems, time, totalDurationRef.current);
    if (active && active.index !== -1) {
      const activeItem = currentItems[active.index];
      if (activeItem?.type === 'video' && !activeItem.isMuted && activeItem.volume > 0) {
        activeVideoId = activeItem.id;
        const element = mediaElementsRef.current[activeItem.id] as HTMLVideoElement | undefined;
        if (element) {
          let volume = activeItem.volume;
          const fadeInDur = activeItem.fadeInDuration || 1.0;
          const fadeOutDur = activeItem.fadeOutDuration || 1.0;

          if (activeItem.fadeIn && active.localTime < fadeInDur) {
            volume *= active.localTime / fadeInDur;
          } else if (activeItem.fadeOut && active.localTime > activeItem.duration - fadeOutDur) {
            const remaining = activeItem.duration - active.localTime;
            volume *= remaining / fadeOutDur;
          }

          if (volume > 0) {
            candidates.push({
              id: activeItem.id,
              desiredVolume: volume,
              element,
              sourceType: 'video',
            });
          }
        }
      }
    }

    if (currentBgm && currentBgm.volume > 0 && time >= currentBgm.delay) {
      const element = mediaElementsRef.current.bgm as HTMLAudioElement | undefined;
      const trackTime = time - currentBgm.delay + currentBgm.startPoint;
      if (element && trackTime >= 0 && trackTime <= currentBgm.duration) {
        const volume = resolvePreviewBgmGain(currentBgm, time, totalDurationRef.current);
        if (volume > 0) {
          candidates.push({
            id: 'bgm',
            desiredVolume: volume,
            element,
            sourceType: 'audio',
          });
        }
      }
    }

    for (const clip of currentNarrations) {
      if (clip.isMuted || clip.volume <= 0) {
        continue;
      }

      const trackId = `narration:${clip.id}`;
      const element = mediaElementsRef.current[trackId] as HTMLAudioElement | undefined;
      if (!element) {
        continue;
      }

      const trimStart = Number.isFinite(clip.trimStart) ? Math.max(0, clip.trimStart) : 0;
      const trimEnd = Number.isFinite(clip.trimEnd)
        ? Math.max(trimStart, Math.min(clip.duration, clip.trimEnd))
        : clip.duration;
      const playableDuration = Math.max(0, trimEnd - trimStart);
      const clipTime = time - clip.startTime;

      if (clipTime >= 0 && clipTime <= playableDuration) {
        candidates.push({
          id: trackId,
          desiredVolume: clip.volume,
          element,
          sourceType: 'audio',
        });
      }
    }

    const routingPlan = getPreviewAudioRoutingPlan(previewPlatformPolicy, {
      isExporting: false,
      candidates: candidates.map((candidate) => ({
        id: candidate.id,
        hasAudioNode: !!sourceNodesRef.current[candidate.id],
        desiredVolume: candidate.desiredVolume,
        sourceType: candidate.sourceType,
      })),
    });

    routingPlan.forEach((decision, index) => {
      if (decision.outputMode !== 'webaudio' || decision.hasAudioNode) {
        return;
      }
      ensureAudioNodeForElement(decision.id, candidates[index].element);
    });

    return {
      activeVideoId,
      audibleSourceCount: candidates.length,
      requiresWebAudio: routingPlan.some((decision) => decision.outputMode === 'webaudio'),
    };
  }, [bgmRef, ensureAudioNodeForElement, mediaElementsRef, mediaItemsRef, narrationsRef, previewPlatformPolicy, sourceNodesRef, totalDurationRef]);

  const primePreviewMediaElementPlayback = useCallback((
    mediaEl: HTMLMediaElement,
    targetTime: number,
    seekThreshold = 0.1,
  ) => {
    const scheduledAttempt = previewPlaybackAttemptRef.current;
    const playWhenReady = () => {
      if (!shouldAttemptDeferredPreviewPlay({
        isCurrentAttempt: scheduledAttempt === previewPlaybackAttemptRef.current,
        isPlaying: isPlayingRef.current,
        isSeeking: isSeekingRef.current,
        mediaSeeking: mediaEl.seeking,
        readyState: mediaEl.readyState,
      })) {
        return;
      }
      if (mediaEl.paused) {
        mediaEl.play().catch(() => { });
      }
    };

    if (mediaEl.readyState === 0 && !mediaEl.error) {
      try {
        mediaEl.load();
      } catch {
        // ignore
      }
    }

    if (Math.abs(mediaEl.currentTime - targetTime) > seekThreshold) {
      mediaEl.currentTime = targetTime;
    }

    if (!mediaEl.seeking && mediaEl.readyState >= 2) {
      playWhenReady();
      return;
    }

    mediaEl.addEventListener('canplay', playWhenReady, { once: true });
    mediaEl.addEventListener('seeked', playWhenReady, { once: true });
  }, [isPlayingRef, isSeekingRef, previewPlaybackAttemptRef]);

  const primePreviewAudioOnlyTracksAtTime = useCallback((playbackTime: number) => {
    const currentBgm = bgmRef.current;
    if (currentBgm) {
      const bgmEl = mediaElementsRef.current.bgm as HTMLAudioElement | undefined;
      if (bgmEl) {
        const trackTime = Math.max(0, playbackTime - currentBgm.delay + currentBgm.startPoint);
        if (playbackTime >= currentBgm.delay && trackTime <= currentBgm.duration) {
          // BGM は preview start 直後でも active video を待たせないため、seek 許容幅を広めに取る。
          primePreviewMediaElementPlayback(bgmEl, trackTime, 0.3);
        }
      }
    }

    const currentNarrations = narrationsRef.current;
    for (const clip of currentNarrations) {
      if (clip.isMuted || clip.volume <= 0) {
        continue;
      }

      const trackId = `narration:${clip.id}`;
      const narEl = mediaElementsRef.current[trackId] as HTMLAudioElement | undefined;
      if (!narEl) {
        continue;
      }

      const trimStart = Number.isFinite(clip.trimStart) ? Math.max(0, clip.trimStart) : 0;
      const trimEnd = Number.isFinite(clip.trimEnd)
        ? Math.max(trimStart, Math.min(clip.duration, clip.trimEnd))
        : clip.duration;
      const playableDuration = Math.max(0, trimEnd - trimStart);
      const clipTime = playbackTime - clip.startTime;
      if (clipTime >= 0 && clipTime <= playableDuration) {
        const sourceTime = trimStart + clipTime;
        primePreviewMediaElementPlayback(narEl, sourceTime, 0.5);
      }
    }
  }, [bgmRef, mediaElementsRef, narrationsRef, primePreviewMediaElementPlayback, sourceNodesRef]);

  useEffect(() => {
    primePreviewAudioOnlyTracksAtTimeRef.current = primePreviewAudioOnlyTracksAtTime;
  }, [primePreviewAudioOnlyTracksAtTime, primePreviewAudioOnlyTracksAtTimeRef]);

  const preparePreviewAudioNodesForUpcomingVideos = useCallback((_fromTime: number) => {
    // standard runtime では Safari 向けの future-video probe を持たない。
  }, []);

  useEffect(() => {
    if (
      bgm
      && isPlayingRef.current
      && !isProcessing
      && previewPlatformPolicy.muteNativeMediaWhenAudioRouted
    ) {
      const bgmEl = mediaElementsRef.current.bgm as HTMLAudioElement | undefined;
      if (bgmEl && !sourceNodesRef.current.bgm) {
        ensureAudioNodeForElement('bgm', bgmEl);
      }
      preparePreviewAudioNodesForTime(currentTimeRef.current);
      preparePreviewAudioNodesForUpcomingVideos(currentTimeRef.current);
    }
  }, [bgm, currentTimeRef, ensureAudioNodeForElement, isPlayingRef, isProcessing, mediaElementsRef, preparePreviewAudioNodesForTime, preparePreviewAudioNodesForUpcomingVideos, previewPlatformPolicy, sourceNodesRef]);

  useEffect(() => {
    if (
      narrations.length > 0
      && isPlayingRef.current
      && !isProcessing
      && previewPlatformPolicy.muteNativeMediaWhenAudioRouted
    ) {
      preparePreviewAudioNodesForTime(currentTimeRef.current);
      preparePreviewAudioNodesForUpcomingVideos(currentTimeRef.current);
    }
  }, [currentTimeRef, isPlayingRef, isProcessing, narrations, preparePreviewAudioNodesForTime, preparePreviewAudioNodesForUpcomingVideos, previewPlatformPolicy]);

  const handleMediaRefAssign = useCallback((
    id: string,
    element: HTMLVideoElement | HTMLImageElement | HTMLAudioElement | null,
  ) => {
    if (element) {
      const pendingTimer = pendingAudioDetachTimersRef.current[id];
      if (pendingTimer) {
        clearTimeout(pendingTimer);
        delete pendingAudioDetachTimersRef.current[id];
      }

      mediaElementsRef.current[id] = element;

      if (element.tagName === 'VIDEO' || element.tagName === 'AUDIO') {
        const mediaEl = element as HTMLMediaElement;

        if (sourceElementsRef.current[id] && sourceElementsRef.current[id] !== mediaEl) {
          detachAudioNode(id);
        }

        if (
          element.tagName === 'AUDIO'
          && previewPlatformPolicy.muteNativeMediaWhenAudioRouted
          && !sourceNodesRef.current[id]
        ) {
          ensureAudioNodeForElement(id, mediaEl);
        }

        resetNativeMediaAudioState(mediaEl);
      }
      return;
    }

    delete mediaElementsRef.current[id];

    const timer = setTimeout(() => {
      delete pendingAudioDetachTimersRef.current[id];
      if (!mediaElementsRef.current[id]) {
        detachAudioNode(id);
      }
    }, 0);
    pendingAudioDetachTimersRef.current[id] = timer;
  }, [detachAudioNode, ensureAudioNodeForElement, mediaElementsRef, pendingAudioDetachTimersRef, previewPlatformPolicy, sourceElementsRef, sourceNodesRef]);

  return {
    detachAudioNode,
    ensureAudioNodeForElement,
    preparePreviewAudioNodesForTime,
    preparePreviewAudioNodesForUpcomingVideos,
    primePreviewAudioOnlyTracksAtTime,
    handleMediaRefAssign,
  };
}
