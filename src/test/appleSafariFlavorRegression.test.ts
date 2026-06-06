import { describe, expect, it } from 'vitest';

import type { MediaItem } from '../types';
import type { PlatformCapabilities } from '../utils/platform';
import { findActiveTimelineItem } from '../utils/playbackTimeline';
import {
  resolveWebCodecsAudioCaptureStrategy,
  shouldUseOfflineAudioPreRender,
} from '../hooks/export-strategies/exportStrategyResolver';
import {
  appleSafariPreviewRuntime,
  getAppleSafariPreviewPlatformCapabilities,
} from '../flavors/apple-safari/appleSafariPreviewRuntime';
import {
  getFutureVideoAudioProbeTimes,
  getIosSafariImageToVideoNativeKeepAliveVolume,
  getIosSafariImageToVideoPrebufferTarget,
  getPreviewAudioRoutingPlan,
  getVisibilityRecoveryPlan,
  shouldBundlePreviewStartForWebAudioMix,
  shouldGrantPreviewGestureCreditToFutureVideo,
  shouldPrimeFutureInactiveVideoInPreview,
  shouldRecoverAudioOnlyAfterVideoBoundary,
  shouldReinitializeAudioRoute,
  shouldResumeAudioContextOnVisibilityReturn,
} from '../flavors/apple-safari/preview/previewPlatform';
import {
  getAppleSafariExportPlatformCapabilities,
  resolveAppleSafariExportStrategyOrder,
} from '../flavors/apple-safari/appleSafariExportRuntime';

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

describe('apple-safari flavor regression', () => {
  it('apple-safari preview は video→image→video と BGM を future probe と single mix で保護する', () => {
    const previewCapabilities = getAppleSafariPreviewPlatformCapabilities(
      createCapabilities({
        isAndroid: true,
        isIOS: false,
        isSafari: false,
        isIosSafari: false,
        audioContextMayInterrupt: false,
      }),
    );
    const previewPolicy = appleSafariPreviewRuntime.getPreviewPlatformPolicy(previewCapabilities);
    const items = [
      createTimelineItem({ id: 'video-1', type: 'video', duration: 2 }),
      createTimelineItem({ id: 'image-gap', type: 'image', duration: 1 }),
      createTimelineItem({ id: 'video-2', type: 'video', duration: 2 }),
    ];
    const totalDuration = items.reduce((sum, item) => sum + item.duration, 0);

    expect(previewCapabilities.isIosSafari).toBe(true);

    const imageGap = findActiveTimelineItem(items, 2.25, totalDuration);
    expect(imageGap).toMatchObject({ id: 'image-gap', index: 1 });
    expect(imageGap?.localTime).toBeCloseTo(0.25);

    const secondVideo = findActiveTimelineItem(items, 3.25, totalDuration);
    expect(secondVideo).toMatchObject({ id: 'video-2', index: 2 });
    expect(secondVideo?.localTime).toBeCloseTo(0.25);

    expect(getFutureVideoAudioProbeTimes(items, 2.25)).toEqual([3.05]);

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
        outputMode: 'webaudio',
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
      shouldBundlePreviewStartForWebAudioMix(previewPolicy, {
        hasActiveVideo: true,
        audibleSourceCount: 2,
        requiresWebAudio: true,
      }),
    ).toBe(true);

    expect(
      shouldRecoverAudioOnlyAfterVideoBoundary(previewPolicy, {
        hasAudioNode: true,
        isExporting: false,
        isActivePlaying: true,
        timeSinceVideoEndSec: 0.04,
      }),
    ).toBe(true);
  });

  it('apple-safari preview は visibility hide/show 復帰時に seek と audio resume 方針を維持する', () => {
    const previewCapabilities = getAppleSafariPreviewPlatformCapabilities(createCapabilities());
    const previewPolicy = appleSafariPreviewRuntime.getPreviewPlatformPolicy(previewCapabilities);
    const items = [
      createTimelineItem({ id: 'video-1', type: 'video', duration: 2 }),
      createTimelineItem({ id: 'image-gap', type: 'image', duration: 1 }),
      createTimelineItem({ id: 'video-2', type: 'video', duration: 2 }),
    ];
    const totalDuration = items.reduce((sum, item) => sum + item.duration, 0);

    const restoredSeekTarget = findActiveTimelineItem(items, 3.4, totalDuration);
    expect(restoredSeekTarget).toMatchObject({ id: 'video-2', index: 2 });
    expect(restoredSeekTarget?.localTime).toBeCloseTo(0.4);

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
      shouldDelayAudioResume: true,
    });

    expect(shouldResumeAudioContextOnVisibilityReturn(previewPolicy, 'interrupted')).toBe(true);
    expect(shouldReinitializeAudioRoute(previewPolicy, false)).toBe(true);
  });

  it('apple-safari preview は silent prewarm を完全に廃止する (iOS Safari の映像 freeze 退行回避)', () => {
    const previewCapabilities = getAppleSafariPreviewPlatformCapabilities(createCapabilities());
    const previewPolicy = appleSafariPreviewRuntime.getPreviewPlatformPolicy(previewCapabilities);

    // iOS Safari は createMediaElementSource() 接続済みの video を gain=0 で silent
    // 再生すると、視覚フレームの decode を停止し「音は流れるのに 1 フレーム目で映像が
    // 固まる」退行を起こす。そのため future video の silent prewarm は全条件で
    // 無効化する。境界キックが active 化のタイミングで play() を担う。
    expect(
      shouldPrimeFutureInactiveVideoInPreview(previewPolicy, {
        hasAudioNode: true,
        isExporting: false,
        isActivePlaying: true,
        shouldKeepVideoPrewarmed: true,
        timeUntilVideoStartSec: 0.2,
      }),
    ).toBe(false);

    // 画像区間中の next video でも silent prewarm は行わない (同じ freeze リスクが
    // あるため)。境界キックが boundary で fresh play() を起動する。
    expect(
      shouldPrimeFutureInactiveVideoInPreview(previewPolicy, {
        hasAudioNode: true,
        isExporting: false,
        isActivePlaying: true,
        shouldKeepVideoPrewarmed: true,
        timeUntilVideoStartSec: 1.5,
      }),
    ).toBe(false);
  });

  it('apple-safari preview は画像区間中の次動画を silent play せず paused prebuffer する', () => {
    const previewCapabilities = getAppleSafariPreviewPlatformCapabilities(createCapabilities());
    const previewPolicy = appleSafariPreviewRuntime.getPreviewPlatformPolicy(previewCapabilities);

    expect(
      getIosSafariImageToVideoPrebufferTarget(previewPolicy, {
        isExporting: false,
        isActivePlaying: true,
        activeItemType: 'image',
        nextItemType: 'video',
        timeUntilVideoStartSec: 0.25,
        videoReadyState: 1,
        isVideoPaused: true,
        isVideoSeeking: false,
        currentTime: 0,
        trimStart: 0,
        clipDuration: 2,
      }),
    ).toBeCloseTo(0.001);

    expect(
      getIosSafariImageToVideoPrebufferTarget(previewPolicy, {
        isExporting: false,
        isActivePlaying: true,
        activeItemType: 'video',
        nextItemType: 'video',
        timeUntilVideoStartSec: 0.25,
        videoReadyState: 1,
        isVideoPaused: true,
        isVideoSeeking: false,
        currentTime: 0,
        trimStart: 0,
        clipDuration: 2,
      }),
    ).toBeNull();

    expect(
      getIosSafariImageToVideoPrebufferTarget(previewPolicy, {
        isExporting: false,
        isActivePlaying: true,
        activeItemType: 'image',
        nextItemType: 'video',
        timeUntilVideoStartSec: 0.25,
        videoReadyState: 2,
        isVideoPaused: true,
        isVideoSeeking: false,
        currentTime: 0,
        trimStart: 0,
        clipDuration: 2,
      }),
    ).toBeNull();
  });

  it('apple-safari preview は画像→動画直後だけ native video に微小 keep-alive 音量を残す', () => {
    const previewCapabilities = getAppleSafariPreviewPlatformCapabilities(createCapabilities());
    const previewPolicy = appleSafariPreviewRuntime.getPreviewPlatformPolicy(previewCapabilities);

    expect(
      getIosSafariImageToVideoNativeKeepAliveVolume(previewPolicy, {
        isExporting: false,
        isActivePlaying: true,
        activeItemType: 'video',
        previousItemType: 'image',
        desiredVolume: 1,
        clipLocalTime: 0.2,
      }),
    ).toBeCloseTo(0.001);

    expect(
      getIosSafariImageToVideoNativeKeepAliveVolume(previewPolicy, {
        isExporting: false,
        isActivePlaying: true,
        activeItemType: 'video',
        previousItemType: 'video',
        desiredVolume: 1,
        clipLocalTime: 0.2,
      }),
    ).toBe(0);

    expect(
      getIosSafariImageToVideoNativeKeepAliveVolume(previewPolicy, {
        isExporting: false,
        isActivePlaying: true,
        activeItemType: 'video',
        previousItemType: 'image',
        desiredVolume: 1,
        clipLocalTime: 1.5,
      }),
    ).toBe(0);

    // keep-alive の目的は映像 decode pipeline の維持であり、ユーザー音量とは独立。
    // mute 動画 (desiredVolume=0) でも画像 -> 動画直後の decode 抑止は起こるため、
    // 0.001 を当てて decode だけ起こす (native 0.001 は実質無音)。
    expect(
      getIosSafariImageToVideoNativeKeepAliveVolume(previewPolicy, {
        isExporting: false,
        isActivePlaying: true,
        activeItemType: 'video',
        previousItemType: 'image',
        desiredVolume: 0,
        clipLocalTime: 0.2,
      }),
    ).toBeCloseTo(0.001);

    // fade-in 先頭フレーム (desiredVolume=0) でも decode を立ち上げる。
    expect(
      getIosSafariImageToVideoNativeKeepAliveVolume(previewPolicy, {
        isExporting: false,
        isActivePlaying: true,
        activeItemType: 'video',
        previousItemType: 'image',
        desiredVolume: 0,
        clipLocalTime: 0,
      }),
    ).toBeCloseTo(0.001);
  });

  it('apple-safari preview は future video にだけ gesture credit を付与する (active/past/non-iOS は対象外)', () => {
    const previewCapabilities = getAppleSafariPreviewPlatformCapabilities(createCapabilities());
    const previewPolicy = appleSafariPreviewRuntime.getPreviewPlatformPolicy(previewCapabilities);

    // future video: gesture 内で一度も play() されないため credit を付与する。
    expect(
      shouldGrantPreviewGestureCreditToFutureVideo(previewPolicy, {
        isExporting: false,
        isFutureVideo: true,
      }),
    ).toBe(true);

    // active / past video は対象外 (active は別経路で play() 済み)。
    expect(
      shouldGrantPreviewGestureCreditToFutureVideo(previewPolicy, {
        isExporting: false,
        isFutureVideo: false,
      }),
    ).toBe(false);

    // export 経路では gesture credit pass を動かさない。
    expect(
      shouldGrantPreviewGestureCreditToFutureVideo(previewPolicy, {
        isExporting: true,
        isFutureVideo: true,
      }),
    ).toBe(false);

    // standard (非 iOS) policy では常に false。
    const standardPolicy = appleSafariPreviewRuntime.getPreviewPlatformPolicy({
      ...previewCapabilities,
      isIosSafari: false,
    });
    expect(
      shouldGrantPreviewGestureCreditToFutureVideo(standardPolicy, {
        isExporting: false,
        isFutureVideo: true,
      }),
    ).toBe(false);
  });

  it('apple-safari preview は BGM 無しの単独 video でも WebAudio 経路を強制し audio node 作成を促す', () => {
    const previewCapabilities = getAppleSafariPreviewPlatformCapabilities(createCapabilities());
    const previewPolicy = appleSafariPreviewRuntime.getPreviewPlatformPolicy(previewCapabilities);

    // BGM/narration なしの単一 video が active。audibleSourceCount=1 だが、
    // iOS Safari では AudioContext running 中に native audio が抑制されるため、
    // 常に WebAudio 経路を確立して audio node を作らせる必要がある。
    const routingPlan = getPreviewAudioRoutingPlan(previewPolicy, {
      isExporting: false,
      candidates: [
        {
          id: 'video-1',
          hasAudioNode: false,
          desiredVolume: 1,
          sourceType: 'video',
        },
      ],
    });

    expect(routingPlan).toEqual([
      {
        id: 'video-1',
        hasAudioNode: false,
        desiredVolume: 1,
        audibleSourceCount: 1,
        outputMode: 'webaudio',
      },
    ]);
  });

  it('apple-safari export は MediaRecorder 優先と pre-render fallback で音声保持経路を固定する', () => {
    const exportCapabilities = getAppleSafariExportPlatformCapabilities(createCapabilities());

    expect(resolveAppleSafariExportStrategyOrder({
      isIosSafari: exportCapabilities.isIosSafari,
      supportedMediaRecorderProfile: exportCapabilities.supportedMediaRecorderProfile,
    })).toEqual(['ios-safari-mediarecorder', 'webcodecs-mp4']);

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
});
