import { useCallback, useEffect, type MutableRefObject } from 'react';

import type { AudioTrack, MediaElementsRef, MediaItem, NarrationClip } from '../../types';
import type { LogCategory } from '../../stores/logStore';
import { resolveIosSafariSingleMixedAudio } from '../../utils/iosSafariAudio';
import { findActiveTimelineItem } from '../../utils/playbackTimeline';
import {
  getFutureVideoAudioProbeTimes,
  getPreviewAudioRoutingPlan,
  shouldAttemptDeferredPreviewPlay,
  shouldReinitializeAudioRoute,
  type PreviewPlatformPolicy,
} from '../../utils/previewPlatform';

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

export function usePreviewAudioSession({
  mediaItemsRef,
  bgmRef,
  narrationsRef,
  totalDurationRef,
  currentTimeRef,
  mediaElementsRef,
  audioCtxRef,
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
  isIosSafari,
  bgm,
  narrations,
  isProcessing,
  getAudioContext,
  logInfo,
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
      const stateBeforeResume = ctx.state as AudioContextState | 'interrupted';
      if (stateBeforeResume !== 'running') {
        ctx.resume().catch((err) => {
          if (isIosSafari) {
            logWarn('AUDIO', 'iOS Safari AudioContext resume 失敗', {
              id,
              stateBeforeResume,
              error: err instanceof Error ? err.message : String(err),
            });
          }
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

      if (isIosSafari) {
        logInfo('AUDIO', 'iOS Safari MediaElementAudioSource を作成', {
          id,
          tagName: mediaEl.tagName,
          audioContextState: ctx.state,
          route: audioRoutingModeRef.current,
          gainValue: gain.gain.value,
        });
      }

      return true;
    } catch (error) {
      if (isIosSafari) {
        logWarn('AUDIO', 'iOS Safari MediaElementAudioSource 作成失敗', {
          id,
          tagName: mediaEl.tagName,
          reason: error instanceof Error ? error.message : String(error),
        });
      } else {
        console.warn(`Audio node creation failed for ${id}:`, error);
      }
      return false;
    }
  }, [audioRoutingModeRef, detachAudioNode, gainNodesRef, getAudioContext, isIosSafari, logInfo, logWarn, masterDestRef, sourceElementsRef, sourceNodesRef]);

  const refreshPreviewAudioRoute = useCallback(async () => {
    if (!shouldReinitializeAudioRoute(previewPlatformPolicy, false)) {
      return;
    }

    const ctx = audioCtxRef.current;
    if (!ctx) {
      return;
    }

    try {
      Object.keys(sourceNodesRef.current).forEach((nodeId) => {
        const el = mediaElementsRef.current[nodeId];
        if (el && (el.tagName === 'VIDEO' || el.tagName === 'AUDIO')) {
          (el as HTMLMediaElement).volume = 0;
        }
      });

      if ((ctx.state as AudioContextState | 'interrupted') !== 'running') {
        await ctx.resume();
      }

      if ((ctx.state as AudioContextState | 'interrupted') !== 'running') {
        await ctx.suspend();
        await ctx.resume();
      }

      const target = ctx.destination;
      Object.keys(gainNodesRef.current).forEach((nodeId) => {
        const gain = gainNodesRef.current[nodeId];
        try {
          gain.disconnect();
          gain.connect(target);
        } catch {
          // ignore
        }
      });

      logInfo('AUDIO', 'iOS Safari preview 音声ルートを再初期化', {
        state: ctx.state,
      });
    } catch (error) {
      logWarn('AUDIO', 'iOS Safari preview 音声ルート再初期化に失敗', {
        error: error instanceof Error ? error.message : String(error),
        state: ctx.state,
      });
    }
  }, [audioCtxRef, gainNodesRef, logInfo, logWarn, mediaElementsRef, previewPlatformPolicy, sourceNodesRef]);

  const requestPreviewAudioRouteRefresh = useCallback(() => {
    if (!shouldReinitializeAudioRoute(previewPlatformPolicy, false)) {
      return;
    }

    if (previewAudioRouteRefreshInFlightRef.current) {
      return;
    }

    const refreshPromise = refreshPreviewAudioRoute().finally(() => {
      if (previewAudioRouteRefreshInFlightRef.current === refreshPromise) {
        previewAudioRouteRefreshInFlightRef.current = null;
      }
    });
    previewAudioRouteRefreshInFlightRef.current = refreshPromise;
  }, [previewAudioRouteRefreshInFlightRef, previewPlatformPolicy, refreshPreviewAudioRoute]);

  useEffect(() => {
    requestPreviewAudioRouteRefreshRef.current = requestPreviewAudioRouteRefresh;
  }, [requestPreviewAudioRouteRefresh, requestPreviewAudioRouteRefreshRef]);

  const logIosSafariPreviewAudioRoute = useCallback((params: {
    time: number;
    candidates: Array<{ id: string; desiredVolume: number; sourceType: 'video' | 'audio' }>;
    routingPlan: Array<{ id: string; outputMode: string; audibleSourceCount: number }>;
  }) => {
    if (!isIosSafari) {
      return;
    }

    const hasAudibleVideo = params.candidates.some((candidate) => candidate.sourceType === 'video' && candidate.desiredVolume > 0);
    const hasAudibleAuxAudio = params.candidates.some((candidate) => candidate.sourceType === 'audio' && candidate.desiredVolume > 0);
    const mixDecision = resolveIosSafariSingleMixedAudio({
      isIosSafari: true,
      isExporting: false,
      audibleSourceCount: params.candidates.filter((candidate) => candidate.desiredVolume > 0).length,
      sourceType: hasAudibleVideo ? 'video' : 'audio',
    });

    const signature = JSON.stringify({
      timeBucket: Math.round(params.time * 10) / 10,
      mixDecision: mixDecision.reason,
      candidates: params.candidates.map((candidate) => ({
        id: candidate.id,
        sourceType: candidate.sourceType,
        desiredVolume: Math.round(candidate.desiredVolume * 100) / 100,
      })),
      routingPlan: params.routingPlan,
      audioContextState: audioCtxRef.current?.state ?? 'uninitialized',
      route: audioRoutingModeRef.current,
    });

    if (lastIosSafariAudioLogRef.current === signature) {
      return;
    }
    lastIosSafariAudioLogRef.current = signature;

    logInfo('AUDIO', 'iOS Safari preview mixed audio route', {
      safariDetected: isIosSafari,
      audioContextState: audioCtxRef.current?.state ?? 'uninitialized',
      route: audioRoutingModeRef.current,
      playbackTime: Math.round(params.time * 100) / 100,
      shouldUseSingleMixedAudio: mixDecision.shouldUseSingleMixedAudio,
      reason: mixDecision.reason,
      hasAudibleVideo,
      hasAudibleAuxAudio,
      gains: params.routingPlan.map((decision) => ({
        id: decision.id,
        outputMode: decision.outputMode,
        audibleSourceCount: decision.audibleSourceCount,
        gainValue: gainNodesRef.current[decision.id]
          ? Math.round(gainNodesRef.current[decision.id].gain.value * 100) / 100
          : null,
      })),
    });
  }, [audioCtxRef, audioRoutingModeRef, gainNodesRef, isIosSafari, lastIosSafariAudioLogRef, logInfo]);

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
      const playDuration = time - currentBgm.delay;
      if (element && trackTime >= 0 && trackTime <= currentBgm.duration) {
        let volume = currentBgm.volume;
        const fadeInDur = currentBgm.fadeInDuration || 1.0;
        const fadeOutDur = currentBgm.fadeOutDuration || 1.0;

        if (currentBgm.fadeIn && playDuration < fadeInDur) {
          volume *= playDuration / fadeInDur;
        }
        if (currentBgm.fadeOut && time > totalDurationRef.current - fadeOutDur) {
          const remaining = totalDurationRef.current - time;
          volume *= Math.max(0, remaining / fadeOutDur);
        }

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

    logIosSafariPreviewAudioRoute({
      time,
      candidates: candidates.map((candidate) => ({
        id: candidate.id,
        desiredVolume: candidate.desiredVolume,
        sourceType: candidate.sourceType,
      })),
      routingPlan: routingPlan.map((decision) => ({
        id: decision.id,
        outputMode: decision.outputMode,
        audibleSourceCount: decision.audibleSourceCount,
      })),
    });

    return {
      activeVideoId,
      audibleSourceCount: candidates.length,
      requiresWebAudio: routingPlan.some((decision) => decision.outputMode === 'webaudio'),
    };
  }, [bgmRef, ensureAudioNodeForElement, logIosSafariPreviewAudioRoute, mediaElementsRef, mediaItemsRef, narrationsRef, previewPlatformPolicy, sourceNodesRef, totalDurationRef]);

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
      if (bgmEl && sourceNodesRef.current.bgm) {
        const trackTime = Math.max(0, playbackTime - currentBgm.delay + currentBgm.startPoint);
        if (playbackTime >= currentBgm.delay && trackTime <= currentBgm.duration) {
          primePreviewMediaElementPlayback(bgmEl, trackTime);
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
      if (!narEl || !sourceNodesRef.current[trackId]) {
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

  const preparePreviewAudioNodesForUpcomingVideos = useCallback((fromTime: number) => {
    if (!previewPlatformPolicy.muteNativeMediaWhenAudioRouted) {
      return;
    }

    const probeTimes = getFutureVideoAudioProbeTimes(mediaItemsRef.current, fromTime);
    probeTimes.forEach((probeTime) => {
      preparePreviewAudioNodesForTime(probeTime);
    });
  }, [mediaItemsRef, preparePreviewAudioNodesForTime, previewPlatformPolicy]);

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