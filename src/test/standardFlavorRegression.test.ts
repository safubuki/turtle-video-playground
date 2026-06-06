import { describe, expect, it, vi } from 'vitest';

import type { MediaItem } from '../types';
import type { PlatformCapabilities } from '../utils/platform';
import { findActiveTimelineItem } from '../utils/playbackTimeline';
import {
  resolveWebCodecsAudioCaptureStrategy,
  shouldUseOfflineAudioPreRender,
} from '../hooks/export-strategies/exportStrategyResolver';
import {
  getStandardExportPlatformCapabilities,
  resolveStandardExportStrategyOrder,
} from '../flavors/standard/standardExportRuntime';
import {
  getStandardPreviewPlatformCapabilities,
  standardPreviewRuntime,
} from '../flavors/standard/standardPreviewRuntime';
import {
  getFutureVideoAudioProbeTimes,
  getPreviewAudioRoutingPlan,
  getVisibilityRecoveryPlan,
  shouldReinitializeAudioRoute,
  shouldResumeAudioContextOnVisibilityReturn,
} from '../flavors/standard/preview/previewPlatform';
import { getStandardPreviewNow } from '../flavors/standard/preview/playbackClock';

function createCapabilities(
  overrides: Partial<PlatformCapabilities> = {},
): PlatformCapabilities {
  return {
    userAgent: 'test-agent',
    platform: 'test-platform',
    maxTouchPoints: 0,
    isAndroid: true,
    isIOS: true,
    isSafari: true,
    isIosSafari: true,
    supportsShowSaveFilePicker: false,
    supportsShowOpenFilePicker: false,
    supportsTrackProcessor: true,
    supportsMp4MediaRecorder: true,
    audioContextMayInterrupt: true,
    supportedMediaRecorderProfile: { mimeType: 'video/mp4', extension: 'mp4' },
    trackProcessorCtor: undefined,
    ...overrides,
  };
}

function createTimelineItem(overrides: Partial<MediaItem> = {}): MediaItem {
  const type = overrides.type ?? 'video';
  const duration = overrides.duration ?? (type === 'image' ? 1 : 2);
  const fileType = type === 'image' ? 'image/png' : 'video/mp4';

  return {
    id: overrides.id ?? `${type}-item`,
    file: overrides.file ?? new File([''], type === 'image' ? 'frame.png' : 'clip.mp4', { type: fileType }),
    type,
    url: overrides.url ?? `blob:${overrides.id ?? type}`,
    volume: overrides.volume ?? 1,
    isMuted: overrides.isMuted ?? false,
    fadeIn: overrides.fadeIn ?? false,
    fadeOut: overrides.fadeOut ?? false,
    fadeInDuration: overrides.fadeInDuration ?? 1,
    fadeOutDuration: overrides.fadeOutDuration ?? 1,
    duration,
    originalDuration: overrides.originalDuration ?? duration,
    trimStart: overrides.trimStart ?? 0,
    trimEnd: overrides.trimEnd ?? duration,
    scale: overrides.scale ?? 1,
    positionX: overrides.positionX ?? 0,
    positionY: overrides.positionY ?? 0,
    isTransformOpen: overrides.isTransformOpen ?? false,
    isLocked: overrides.isLocked ?? false,
    ...overrides,
  };
}

describe('standard flavor regression', () => {
  it('standard preview は image ギャップ後の 2 本目動画を Safari warm-up なしで扱う', () => {
    const previewCapabilities = getStandardPreviewPlatformCapabilities(
      createCapabilities({
        isAndroid: false,
        isIOS: true,
        isSafari: true,
        isIosSafari: true,
        audioContextMayInterrupt: true,
      }),
    );
    const previewPolicy = standardPreviewRuntime.getPreviewPlatformPolicy(previewCapabilities);
    const items = [
      createTimelineItem({ id: 'video-1', type: 'video', duration: 2 }),
      createTimelineItem({ id: 'image-gap', type: 'image', duration: 1 }),
      createTimelineItem({ id: 'video-2', type: 'video', duration: 2 }),
    ];
    const totalDuration = items.reduce((sum, item) => sum + item.duration, 0);

    expect(previewCapabilities.isIosSafari).toBe(false);

    const firstVideo = findActiveTimelineItem(items, 0.5, totalDuration);
    expect(firstVideo).toMatchObject({ id: 'video-1', index: 0 });
    expect(firstVideo?.localTime).toBeCloseTo(0.5);

    const imageGap = findActiveTimelineItem(items, 2.25, totalDuration);
    expect(imageGap).toMatchObject({ id: 'image-gap', index: 1 });
    expect(imageGap?.localTime).toBeCloseTo(0.25);

    const secondVideo = findActiveTimelineItem(items, 3.25, totalDuration);
    expect(secondVideo).toMatchObject({ id: 'video-2', index: 2 });
    expect(secondVideo?.localTime).toBeCloseTo(0.25);

    expect(getFutureVideoAudioProbeTimes(items, 2.25)).toEqual([]);

    expect(
      getPreviewAudioRoutingPlan(previewPolicy, {
        isExporting: false,
        candidates: [
          {
            id: 'video-2',
            hasAudioNode: false,
            desiredVolume: 1,
            sourceType: 'video',
          },
          {
            id: 'bgm',
            hasAudioNode: false,
            desiredVolume: 1,
            sourceType: 'audio',
          },
        ],
      }),
    ).toEqual([
      {
        id: 'video-2',
        hasAudioNode: false,
        desiredVolume: 1,
        audibleSourceCount: 2,
        outputMode: 'native',
      },
      {
        id: 'bgm',
        hasAudioNode: false,
        desiredVolume: 1,
        audibleSourceCount: 2,
        outputMode: 'webaudio',
      },
    ]);

    expect(
      getVisibilityRecoveryPlan({
        resumedFromHidden: true,
        needsResyncFromLifecycle: false,
        isPlaying: true,
        isProcessing: false,
      }),
    ).toEqual({
      shouldKeepRunning: true,
      shouldResyncMedia: true,
      shouldDelayAudioResume: false,
    });

    expect(shouldResumeAudioContextOnVisibilityReturn(previewPolicy, 'interrupted')).toBe(false);
    expect(shouldReinitializeAudioRoute(previewPolicy, false)).toBe(false);
  });

  it('standard export は WebCodecs 優先で live audio を維持する capture path を選ぶ', () => {
    const exportCapabilities = getStandardExportPlatformCapabilities(
      createCapabilities({
        isAndroid: false,
        isIOS: true,
        isSafari: true,
        isIosSafari: true,
        supportsTrackProcessor: true,
        supportsMp4MediaRecorder: true,
        audioContextMayInterrupt: true,
      }),
    );

    expect(resolveStandardExportStrategyOrder({
      isIosSafari: exportCapabilities.isIosSafari,
      supportedMediaRecorderProfile: exportCapabilities.supportedMediaRecorderProfile,
    })).toEqual(['webcodecs-mp4']);

    expect(
      shouldUseOfflineAudioPreRender({
        hasAudioSources: true,
        isIosSafari: exportCapabilities.isIosSafari,
      }),
    ).toBe(true);

    expect(
      resolveWebCodecsAudioCaptureStrategy({
        offlineAudioDone: false,
        isIosSafari: exportCapabilities.isIosSafari,
        hasLiveAudioTrack: true,
        canUseTrackProcessor: true,
      }),
    ).toBe('track-processor');

    expect(
      resolveWebCodecsAudioCaptureStrategy({
        offlineAudioDone: false,
        isIosSafari: exportCapabilities.isIosSafari,
        hasLiveAudioTrack: true,
        canUseTrackProcessor: false,
      }),
    ).toBe('script-processor');

    expect(
      resolveWebCodecsAudioCaptureStrategy({
        offlineAudioDone: true,
        isIosSafari: exportCapabilities.isIosSafari,
        hasLiveAudioTrack: true,
        canUseTrackProcessor: true,
      }),
    ).toBe('pre-rendered');
  });

  it('standard preview は loop と seek 復帰で同じ時刻基準を使う', () => {
    const originalPerformance = globalThis.performance;
    const dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_000);

    try {
      Object.defineProperty(globalThis, 'performance', {
        configurable: true,
        value: {
          now: vi.fn(() => 250),
        },
      });

      expect(getStandardPreviewNow()).toBe(250);
    } finally {
      dateNowSpy.mockRestore();
      Object.defineProperty(globalThis, 'performance', {
        configurable: true,
        value: originalPerformance,
      });
    }
  });

  it('standard preview clock は performance が無い環境で Date.now にフォールバックする', () => {
    const originalPerformance = globalThis.performance;
    const dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(777);

    try {
      Object.defineProperty(globalThis, 'performance', {
        configurable: true,
        value: undefined,
      });

      expect(getStandardPreviewNow()).toBe(777);
    } finally {
      dateNowSpy.mockRestore();
      Object.defineProperty(globalThis, 'performance', {
        configurable: true,
        value: originalPerformance,
      });
    }
  });
});
