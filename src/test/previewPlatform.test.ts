import { describe, expect, it } from 'vitest';
import {
  getFutureVideoAudioProbeTimes,
  getPageHidePausePlan,
  getPreviewAudioOutputMode,
  getPreviewAudioRoutingPlan,
  getVisibilityRecoveryPlan,
  getPreviewPlatformPolicy,
  getPreviewVideoSyncThreshold,
  shouldAttemptDeferredPreviewPlay,
  shouldBlackoutVideoFadeTail,
  shouldAvoidPauseInactiveVideoInPreview,
  shouldBundlePreviewStartForWebAudioMix,
  shouldHoldFrameForImageToVideoExportTransition,
  shouldHoldVideoFrameAtClipEnd,
  shouldKeepInactiveVideoPrewarmed,
  shouldMuteNativeMediaElement,
  shouldPrimeFutureInactiveVideoInPreview,
  shouldRecoverAndroidPreviewVideoPlayback,
  shouldRecoverAudioOnlyAfterVideoBoundary,
  shouldRetryAudioOnlyPrimeAtPreviewStart,
  shouldReinitializeAudioRoute,
  shouldResumeAudioContextOnVisibilityReturn,
  shouldStopBeforePreviewAudioRouteInit,
  shouldStabilizeImageToVideoTransitionDuringExport,
  shouldUseCaptionBlurFallback,
} from '../utils/previewPlatform';
import { getAndroidPreviewRecoveryDecision } from '../flavors/standard/preview/previewPlatform';

describe('getPreviewPlatformPolicy', () => {
  it('iOS Safari では preview/export 向けの緩和値を返す', () => {
    const policy = getPreviewPlatformPolicy({
      isAndroid: false,
      isIosSafari: true,
      audioContextMayInterrupt: true,
    });

    expect(policy.previewSyncThresholdSec).toBe(1.0);
    expect(policy.exportSyncThresholdSec).toBe(1.2);
    expect(policy.needsCaptionBlurFallback).toBe(true);
    expect(policy.muteNativeMediaWhenAudioRouted).toBe(true);
    expect(policy.muteNativeMediaDuringExportWhenAudioRouted).toBe(true);
    expect(policy.reinitializeAudioRouteOnPlay).toBe(true);
    expect(policy.audioContextResumeRetryCount).toBe(2);
  });

  it('非 iOS Safari では既定値を返す', () => {
    const policy = getPreviewPlatformPolicy({
      isAndroid: false,
      isIosSafari: false,
      audioContextMayInterrupt: false,
    });

    expect(policy.previewSyncThresholdSec).toBe(0.5);
    expect(policy.exportSyncThresholdSec).toBe(0.5);
    expect(policy.needsCaptionBlurFallback).toBe(false);
    expect(policy.muteNativeMediaWhenAudioRouted).toBe(false);
    expect(policy.muteNativeMediaDuringExportWhenAudioRouted).toBe(false);
    expect(policy.reinitializeAudioRouteOnPlay).toBe(false);
    expect(policy.audioContextResumeRetryCount).toBe(2);
  });

  it('Android は export 中だけ native mute を有効にする', () => {
    const policy = getPreviewPlatformPolicy({
      isAndroid: true,
      isIosSafari: false,
      audioContextMayInterrupt: false,
    });

    expect(policy.muteNativeMediaWhenAudioRouted).toBe(false);
    expect(policy.muteNativeMediaDuringExportWhenAudioRouted).toBe(true);
  });
  it('iOS Safari の将来動画 warm-up は動画開始点だけを probe する', () => {
    expect(
      getFutureVideoAudioProbeTimes([
        { type: 'image', duration: 2 },
        { type: 'video', duration: 3 },
        { type: 'image', duration: 1 },
        { type: 'video', duration: 0.04 },
      ], 0),
    ).toEqual([2.05, 6.02]);

    expect(
      getFutureVideoAudioProbeTimes([
        { type: 'image', duration: 2 },
        { type: 'video', duration: 3 },
        { type: 'image', duration: 1 },
        { type: 'video', duration: 2 },
      ], 2.2),
    ).toEqual([6.05]);
  });

  it('iOS Safari preview の BGM 単独再生は WebAudio を維持する', () => {
    const iosPolicy = getPreviewPlatformPolicy({
      isAndroid: false,
      isIosSafari: true,
      audioContextMayInterrupt: true,
    });

    expect(
      getPreviewAudioRoutingPlan(iosPolicy, {
        isExporting: false,
        candidates: [
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
        id: 'bgm',
        hasAudioNode: false,
        desiredVolume: 1,
        audibleSourceCount: 1,
        outputMode: 'webaudio',
      },
    ]);
  });
  it('iOS Safari preview 縺ｧ inactive video 縺ｯ境界直後だけ prewarm を維持する', () => {
    const iosPolicy = getPreviewPlatformPolicy({
      isAndroid: false,
      isIosSafari: true,
      audioContextMayInterrupt: true,
    });
    expect(
      shouldKeepInactiveVideoPrewarmed(iosPolicy, {
        hasAudioNode: true,
        isExporting: false,
        isActivePlaying: true,
        timeSinceVideoEndSec: -0.1,
        timeUntilVideoStartSec: 0.1,
      }),
    ).toBe(true);

    expect(
      shouldKeepInactiveVideoPrewarmed(iosPolicy, {
        hasAudioNode: true,
        isExporting: false,
        isActivePlaying: true,
        timeSinceVideoEndSec: 0.1,
        timeUntilVideoStartSec: -2,
      }),
    ).toBe(true);

    expect(
      shouldKeepInactiveVideoPrewarmed(iosPolicy, {
        hasAudioNode: true,
        isExporting: false,
        isActivePlaying: true,
        timeSinceVideoEndSec: 0.4,
        timeUntilVideoStartSec: -2,
      }),
    ).toBe(false);
  });

  it('iOS Safari preview でも遠い将来動画までは prewarm し続けない', () => {
    const iosPolicy = getPreviewPlatformPolicy({
      isAndroid: false,
      isIosSafari: true,
      audioContextMayInterrupt: true,
    });

    expect(
      shouldKeepInactiveVideoPrewarmed(iosPolicy, {
        hasAudioNode: true,
        isExporting: false,
        isActivePlaying: true,
        timeSinceVideoEndSec: -3,
        timeUntilVideoStartSec: 1.5,
      }),
    ).toBe(false);
  });

  it('画像区間中は次の動画だけ距離に関わらず prewarm を維持できる', () => {
    const iosPolicy = getPreviewPlatformPolicy({
      isAndroid: false,
      isIosSafari: true,
      audioContextMayInterrupt: true,
    });

    expect(
      shouldKeepInactiveVideoPrewarmed(iosPolicy, {
        hasAudioNode: true,
        isExporting: false,
        isActivePlaying: true,
        timeSinceVideoEndSec: -3,
        timeUntilVideoStartSec: 1.5,
        isNearestFutureVideo: true,
        allowExtendedFuturePrewarm: true,
      }),
    ).toBe(true);

    expect(
      shouldKeepInactiveVideoPrewarmed(iosPolicy, {
        hasAudioNode: true,
        isExporting: false,
        isActivePlaying: true,
        timeSinceVideoEndSec: -6,
        timeUntilVideoStartSec: 3.5,
        isNearestFutureVideo: false,
        allowExtendedFuturePrewarm: true,
      }),
    ).toBe(false);
  });

  it('非 iOS や非再生中では inactive video を prewarm 維持しない', () => {
    const iosPolicy = getPreviewPlatformPolicy({
      isAndroid: false,
      isIosSafari: true,
      audioContextMayInterrupt: true,
    });
    const nonIosPolicy = getPreviewPlatformPolicy({
      isAndroid: false,
      isIosSafari: false,
      audioContextMayInterrupt: false,
    });

    expect(
      shouldKeepInactiveVideoPrewarmed(nonIosPolicy, {
        hasAudioNode: true,
        isExporting: false,
        isActivePlaying: true,
        timeSinceVideoEndSec: -0.1,
        timeUntilVideoStartSec: 0.1,
      }),
    ).toBe(false);

    expect(
      shouldKeepInactiveVideoPrewarmed(iosPolicy, {
        hasAudioNode: true,
        isExporting: false,
        isActivePlaying: false,
        timeSinceVideoEndSec: -0.1,
        timeUntilVideoStartSec: 0.1,
      }),
    ).toBe(false);
  });

  it('iOS Safari preview では AudioNode 済み inactive video の pause を避ける', () => {
    const iosPolicy = getPreviewPlatformPolicy({
      isAndroid: false,
      isIosSafari: true,
      audioContextMayInterrupt: true,
    });
    const nonIosPolicy = getPreviewPlatformPolicy({
      isAndroid: false,
      isIosSafari: false,
      audioContextMayInterrupt: false,
    });

    expect(
      shouldAvoidPauseInactiveVideoInPreview(iosPolicy, {
        hasAudioNode: true,
        isExporting: false,
        isActivePlaying: true,
      }),
    ).toBe(true);

    expect(
      shouldAvoidPauseInactiveVideoInPreview(iosPolicy, {
        hasAudioNode: true,
        isExporting: true,
        isActivePlaying: true,
      }),
    ).toBe(false);

    expect(
      shouldAvoidPauseInactiveVideoInPreview(iosPolicy, {
        hasAudioNode: false,
        isExporting: false,
        isActivePlaying: true,
      }),
    ).toBe(false);

    expect(
      shouldAvoidPauseInactiveVideoInPreview(nonIosPolicy, {
        hasAudioNode: true,
        isExporting: false,
        isActivePlaying: true,
      }),
    ).toBe(false);
  });

  it('iOS Safari preview では prewarm 対象の future video を silent prime する', () => {
    const iosPolicy = getPreviewPlatformPolicy({
      isAndroid: false,
      isIosSafari: true,
      audioContextMayInterrupt: true,
    });
    const nonIosPolicy = getPreviewPlatformPolicy({
      isAndroid: false,
      isIosSafari: false,
      audioContextMayInterrupt: false,
    });

    expect(
      shouldPrimeFutureInactiveVideoInPreview(iosPolicy, {
        hasAudioNode: true,
        isExporting: false,
        isActivePlaying: true,
        shouldKeepVideoPrewarmed: true,
        timeUntilVideoStartSec: 1.2,
      }),
    ).toBe(true);

    expect(
      shouldPrimeFutureInactiveVideoInPreview(iosPolicy, {
        hasAudioNode: true,
        isExporting: false,
        isActivePlaying: true,
        shouldKeepVideoPrewarmed: true,
        timeUntilVideoStartSec: -0.1,
      }),
    ).toBe(false);

    expect(
      shouldPrimeFutureInactiveVideoInPreview(iosPolicy, {
        hasAudioNode: true,
        isExporting: false,
        isActivePlaying: true,
        shouldKeepVideoPrewarmed: false,
        timeUntilVideoStartSec: 1.2,
      }),
    ).toBe(false);

    expect(
      shouldPrimeFutureInactiveVideoInPreview(nonIosPolicy, {
        hasAudioNode: true,
        isExporting: false,
        isActivePlaying: true,
        shouldKeepVideoPrewarmed: true,
        timeUntilVideoStartSec: 1.2,
      }),
    ).toBe(false);
  });

  it('iOS Safari preview の stop 復帰は audio 初期化前に stopAll する', () => {
    const iosPolicy = getPreviewPlatformPolicy({
      isAndroid: false,
      isIosSafari: true,
      audioContextMayInterrupt: true,
    });
    const nonIosPolicy = getPreviewPlatformPolicy({
      isAndroid: false,
      isIosSafari: false,
      audioContextMayInterrupt: false,
    });

    expect(
      shouldStopBeforePreviewAudioRouteInit(iosPolicy, {
        isExporting: false,
      }),
    ).toBe(true);

    expect(
      shouldStopBeforePreviewAudioRouteInit(iosPolicy, {
        isExporting: true,
      }),
    ).toBe(false);

    expect(
      shouldStopBeforePreviewAudioRouteInit(nonIosPolicy, {
        isExporting: false,
      }),
    ).toBe(false);
  });

  it('iOS Safari preview では video -> image 境界直後に audio-only を再 prime する', () => {
    const iosPolicy = getPreviewPlatformPolicy({
      isAndroid: false,
      isIosSafari: true,
      audioContextMayInterrupt: true,
    });
    const nonIosPolicy = getPreviewPlatformPolicy({
      isAndroid: false,
      isIosSafari: false,
      audioContextMayInterrupt: false,
    });

    expect(
      shouldRecoverAudioOnlyAfterVideoBoundary(iosPolicy, {
        hasAudioNode: true,
        isExporting: false,
        isActivePlaying: true,
        timeSinceVideoEndSec: 0.04,
      }),
    ).toBe(true);

    expect(
      shouldRecoverAudioOnlyAfterVideoBoundary(iosPolicy, {
        hasAudioNode: true,
        isExporting: false,
        isActivePlaying: true,
        timeSinceVideoEndSec: 0.2,
      }),
    ).toBe(false);

    expect(
      shouldRecoverAudioOnlyAfterVideoBoundary(iosPolicy, {
        hasAudioNode: false,
        isExporting: false,
        isActivePlaying: true,
        timeSinceVideoEndSec: 0.04,
      }),
    ).toBe(false);

    expect(
      shouldRecoverAudioOnlyAfterVideoBoundary(nonIosPolicy, {
        hasAudioNode: true,
        isExporting: false,
        isActivePlaying: true,
        timeSinceVideoEndSec: 0.04,
      }),
    ).toBe(false);
  });

  it('iOS Safari preview では静止画始まりの stop 復帰時に audio-only prime を再試行する', () => {
    const iosPolicy = getPreviewPlatformPolicy({
      isAndroid: false,
      isIosSafari: true,
      audioContextMayInterrupt: true,
    });
    const nonIosPolicy = getPreviewPlatformPolicy({
      isAndroid: false,
      isIosSafari: false,
      audioContextMayInterrupt: false,
    });

    expect(
      shouldRetryAudioOnlyPrimeAtPreviewStart(iosPolicy, {
        isExporting: false,
        hasActiveVideo: false,
        requiresWebAudio: true,
      }),
    ).toBe(true);

    expect(
      shouldRetryAudioOnlyPrimeAtPreviewStart(iosPolicy, {
        isExporting: false,
        hasActiveVideo: true,
        requiresWebAudio: true,
      }),
    ).toBe(false);

    expect(
      shouldRetryAudioOnlyPrimeAtPreviewStart(iosPolicy, {
        isExporting: true,
        hasActiveVideo: false,
        requiresWebAudio: true,
      }),
    ).toBe(false);

    expect(
      shouldRetryAudioOnlyPrimeAtPreviewStart(nonIosPolicy, {
        isExporting: false,
        hasActiveVideo: false,
        requiresWebAudio: true,
      }),
    ).toBe(false);
  });
});

describe('preview platform helpers', () => {
  const iosPolicy = getPreviewPlatformPolicy({
    isAndroid: false,
    isIosSafari: true,
    audioContextMayInterrupt: true,
  });

  it('export の再生失敗時は fallback しきい値を返す', () => {
    expect(
      getPreviewVideoSyncThreshold(iosPolicy, {
        isExporting: true,
        hasExportPlayFailure: true,
      }),
    ).toBe(0.35);
  });

  it('caption blur fallback の要否を返す', () => {
    expect(shouldUseCaptionBlurFallback(iosPolicy, 2)).toBe(true);
    expect(shouldUseCaptionBlurFallback(iosPolicy, 0)).toBe(false);
  });

  it('AudioNode があるときだけ native mute 判定を返す', () => {
    expect(shouldMuteNativeMediaElement(iosPolicy, { hasAudioNode: true, isExporting: false })).toBe(true);
    expect(shouldMuteNativeMediaElement(iosPolicy, { hasAudioNode: false, isExporting: false })).toBe(false);
  });

  it('Android は export 中だけ native mute 判定を返す', () => {
    const androidPolicy = getPreviewPlatformPolicy({
      isAndroid: true,
      isIosSafari: false,
      audioContextMayInterrupt: false,
    });

    expect(shouldMuteNativeMediaElement(androidPolicy, { hasAudioNode: true, isExporting: false })).toBe(false);
    expect(shouldMuteNativeMediaElement(androidPolicy, { hasAudioNode: true, isExporting: true })).toBe(true);
  });

  it('export の画像->動画境界だけ短時間の安定化モードに入る', () => {
    expect(
      shouldStabilizeImageToVideoTransitionDuringExport({
        isExporting: true,
        isAndroid: true,
        activeItemType: 'video',
        previousItemType: 'image',
        clipLocalTime: 0.08,
      }),
    ).toBe(true);

    expect(
      shouldStabilizeImageToVideoTransitionDuringExport({
        isExporting: true,
        isAndroid: false,
        activeItemType: 'video',
        previousItemType: 'image',
        clipLocalTime: 0.08,
      }),
    ).toBe(false);

    expect(
      shouldStabilizeImageToVideoTransitionDuringExport({
        isExporting: true,
        isAndroid: true,
        activeItemType: 'video',
        previousItemType: 'image',
        clipLocalTime: 0.18,
      }),
    ).toBe(false);

    expect(
      shouldStabilizeImageToVideoTransitionDuringExport({
        isExporting: true,
        isAndroid: true,
        activeItemType: 'video',
        previousItemType: 'video',
        clipLocalTime: 0.05,
      }),
    ).toBe(false);

    expect(
      shouldStabilizeImageToVideoTransitionDuringExport({
        isExporting: false,
        isAndroid: true,
        activeItemType: 'video',
        previousItemType: 'image',
        clipLocalTime: 0.05,
      }),
    ).toBe(false);
  });

  it('export の画像->動画境界で needsTimeCorrection 単独なら前フレーム保持を返す', () => {
    expect(
      shouldHoldFrameForImageToVideoExportTransition({
        isExporting: true,
        isAndroid: true,
        activeItemType: 'video',
        previousItemType: 'image',
        clipLocalTime: 0.05,
        videoReadyState: 2,
        isVideoSeeking: false,
        videoCurrentTime: 0,
        targetTime: 0.02,
      }),
    ).toBe(true);
  });

  it('export の画像->動画境界で videoReadyState 不足単独なら前フレーム保持を返す', () => {
    expect(
      shouldHoldFrameForImageToVideoExportTransition({
        isExporting: true,
        isAndroid: true,
        activeItemType: 'video',
        previousItemType: 'image',
        clipLocalTime: 0.05,
        videoReadyState: 1,
        isVideoSeeking: false,
        videoCurrentTime: 0.02,
        targetTime: 0.02,
      }),
    ).toBe(true);
  });

  it('export の画像->動画境界でも安定化済みなら前フレーム保持しない', () => {
    expect(
      shouldHoldFrameForImageToVideoExportTransition({
        isExporting: true,
        isAndroid: true,
        activeItemType: 'video',
        previousItemType: 'image',
        clipLocalTime: 0.05,
        videoReadyState: 2,
        isVideoSeeking: false,
        videoCurrentTime: 0.02,
        targetTime: 0.021,
      }),
    ).toBe(false);

    expect(
      shouldHoldFrameForImageToVideoExportTransition({
        isExporting: true,
        isAndroid: true,
        activeItemType: 'video',
        previousItemType: 'video',
        clipLocalTime: 0.05,
        videoReadyState: 2,
        isVideoSeeking: false,
        videoCurrentTime: 0.02,
        targetTime: 0.04,
      }),
    ).toBe(false);
  });

  it('export の画像->動画境界では syncToleranceSec を差し替えて保持境界を調整できる', () => {
    expect(
      shouldHoldFrameForImageToVideoExportTransition({
        isExporting: true,
        isAndroid: true,
        activeItemType: 'video',
        previousItemType: 'image',
        clipLocalTime: 0.05,
        videoReadyState: 2,
        isVideoSeeking: false,
        videoCurrentTime: 0.02,
        targetTime: 0.023,
        syncToleranceSec: 0.001,
      }),
    ).toBe(true);

    expect(
      shouldHoldFrameForImageToVideoExportTransition({
        isExporting: true,
        isAndroid: true,
        activeItemType: 'video',
        previousItemType: 'image',
        clipLocalTime: 0.05,
        videoReadyState: 2,
        isVideoSeeking: false,
        videoCurrentTime: 0.02,
        targetTime: 0.023,
        syncToleranceSec: 0.01,
      }),
    ).toBe(false);
  });

  it('export の画像->動画境界でも stabilizationWindowSec 外なら保持しない', () => {
    expect(
      shouldHoldFrameForImageToVideoExportTransition({
        isExporting: true,
        isAndroid: true,
        activeItemType: 'video',
        previousItemType: 'image',
        clipLocalTime: 0.08,
        stabilizationWindowSec: 0.05,
        videoReadyState: 1,
        isVideoSeeking: true,
        videoCurrentTime: 0,
        targetTime: 0.02,
      }),
    ).toBe(false);
  });

  it('export の画像->動画境界では seeking 単独でも前フレーム保持を返す', () => {
    expect(
      shouldHoldFrameForImageToVideoExportTransition({
        isExporting: true,
        isAndroid: true,
        activeItemType: 'video',
        previousItemType: 'image',
        clipLocalTime: 0.05,
        videoReadyState: 2,
        isVideoSeeking: true,
        videoCurrentTime: 0.02,
        targetTime: 0.02,
      }),
    ).toBe(true);

    expect(
      shouldHoldFrameForImageToVideoExportTransition({
        isExporting: true,
        isAndroid: false,
        activeItemType: 'video',
        previousItemType: 'image',
        clipLocalTime: 0.05,
        videoReadyState: 1,
        isVideoSeeking: true,
        videoCurrentTime: 0,
        targetTime: 0.02,
      }),
    ).toBe(false);
  });

  it('Android preview の active video が pause/seek/未準備なら復帰アクション判定を返す', () => {
    expect(
      shouldRecoverAndroidPreviewVideoPlayback({
        isAndroid: true,
        isExporting: false,
        isActivePlaying: true,
        isUserSeeking: false,
        videoPaused: true,
        videoSeeking: false,
        videoReadyState: 2,
      }),
    ).toBe(true);
    expect(
      shouldRecoverAndroidPreviewVideoPlayback({
        isAndroid: true,
        isExporting: false,
        isActivePlaying: true,
        isUserSeeking: false,
        videoPaused: false,
        videoSeeking: true,
        videoReadyState: 2,
      }),
    ).toBe(true);
    expect(
      shouldRecoverAndroidPreviewVideoPlayback({
        isAndroid: true,
        isExporting: false,
        isActivePlaying: true,
        isUserSeeking: false,
        videoPaused: false,
        videoSeeking: false,
        videoReadyState: 1,
      }),
    ).toBe(true);
  });

  it('Android 以外・export・ユーザーseek中は復帰アクション判定を抑止する', () => {
    expect(
      shouldRecoverAndroidPreviewVideoPlayback({
        isAndroid: false,
        isExporting: false,
        isActivePlaying: true,
        isUserSeeking: false,
        videoPaused: true,
        videoSeeking: false,
        videoReadyState: 2,
      }),
    ).toBe(false);
    expect(
      shouldRecoverAndroidPreviewVideoPlayback({
        isAndroid: true,
        isExporting: true,
        isActivePlaying: true,
        isUserSeeking: false,
        videoPaused: true,
        videoSeeking: false,
        videoReadyState: 2,
      }),
    ).toBe(false);
    expect(
      shouldRecoverAndroidPreviewVideoPlayback({
        isAndroid: true,
        isExporting: false,
        isActivePlaying: true,
        isUserSeeking: true,
        videoPaused: true,
        videoSeeking: false,
        videoReadyState: 2,
      }),
    ).toBe(false);
  });

  it('Android recovery decision helper は paused/dimension/大きいdrift を判定し、同期済み active video は hold しない', () => {
    expect(getAndroidPreviewRecoveryDecision({
      isAndroid: true, isIosSafari: false, isExporting: false, isActivePlaying: true, isUserSeeking: false,
      videoPaused: true, videoSeeking: false, videoReadyState: 4, videoWidth: 1920, videoHeight: 1080, videoCurrentTime: 1, targetTime: 1,
    }).reason).toBe('paused-during-playback');
    const seekingButSynced = getAndroidPreviewRecoveryDecision({
      isAndroid: true, isIosSafari: false, isExporting: false, isActivePlaying: true, isUserSeeking: false,
      videoPaused: false, videoSeeking: true, videoReadyState: 4, videoWidth: 1920, videoHeight: 1080, videoCurrentTime: 1, targetTime: 1,
    });
    expect(seekingButSynced.reason).toBeNull();
    expect(seekingButSynced.shouldHoldFrame).toBe(false);
    const lowReadyStateButSynced = getAndroidPreviewRecoveryDecision({
      isAndroid: true, isIosSafari: false, isExporting: false, isActivePlaying: true, isUserSeeking: false,
      videoPaused: false, videoSeeking: false, videoReadyState: 1, videoWidth: 1920, videoHeight: 1080, videoCurrentTime: 1, targetTime: 1,
    });
    expect(lowReadyStateButSynced.reason).toBeNull();
    expect(lowReadyStateButSynced.shouldHoldFrame).toBe(false);
    expect(getAndroidPreviewRecoveryDecision({
      isAndroid: true, isIosSafari: false, isExporting: false, isActivePlaying: true, isUserSeeking: false,
      videoPaused: false, videoSeeking: false, videoReadyState: 4, videoWidth: 0, videoHeight: 1080, videoCurrentTime: 1, targetTime: 1,
    }).reason).toBe('dimension-zero');
    const drift = getAndroidPreviewRecoveryDecision({
      isAndroid: true, isIosSafari: false, isExporting: false, isActivePlaying: true, isUserSeeking: false,
      videoPaused: false, videoSeeking: false, videoReadyState: 4, videoWidth: 1920, videoHeight: 1080, videoCurrentTime: 2, targetTime: 1,
    });
    expect(drift.reason).toBe('timeline-drift');
    expect(drift.shouldHoldFrame).toBe(true);
  });

  it('iOS Safari preview は単一動画だけ native 出力を維持し、動画+BGM では WebAudio mix に寄せる', () => {
    expect(
      getPreviewAudioOutputMode(iosPolicy, {
        hasAudioNode: false,
        isExporting: false,
        audibleSourceCount: 1,
        desiredVolume: 1,
        sourceType: 'video',
      }),
    ).toBe('native');
    expect(
      getPreviewAudioOutputMode(iosPolicy, {
        hasAudioNode: false,
        isExporting: false,
        audibleSourceCount: 2,
        desiredVolume: 1,
        sourceType: 'video',
      }),
    ).toBe('webaudio');
    expect(
      getPreviewAudioOutputMode(iosPolicy, {
        hasAudioNode: false,
        isExporting: false,
        audibleSourceCount: 1,
        desiredVolume: 0.5,
        sourceType: 'video',
      }),
    ).toBe('native');
    expect(
      getPreviewAudioOutputMode(iosPolicy, {
        hasAudioNode: false,
        isExporting: true,
        audibleSourceCount: 1,
        desiredVolume: 1,
        sourceType: 'video',
      }),
    ).toBe('webaudio');
    expect(
      getPreviewAudioOutputMode(iosPolicy, {
        hasAudioNode: true,
        isExporting: false,
        audibleSourceCount: 1,
        desiredVolume: 1,
        sourceType: 'video',
      }),
    ).toBe('webaudio');
    expect(
      getPreviewAudioOutputMode(iosPolicy, {
        hasAudioNode: false,
        isExporting: false,
        audibleSourceCount: 1,
        desiredVolume: 1,
        sourceType: 'audio',
      }),
    ).toBe('webaudio');
  });

  it('iOS Safari preview で混在区間を抜けて単独動画に戻っても AudioNode は webaudio を維持する', () => {
    // iOS Safari では createMediaElementSource() が1要素に対して1回しか呼べない。
    // detach 後に再接続できないため、常に webaudio を維持する。

    // 混在区間中: hasAudioNode=true, audibleSourceCount=2 → webaudio
    expect(
      getPreviewAudioOutputMode(iosPolicy, {
        hasAudioNode: true,
        isExporting: false,
        audibleSourceCount: 2,
        desiredVolume: 1,
        sourceType: 'video',
      }),
    ).toBe('webaudio');

    // 混在区間を抜けた: hasAudioNode=true, audibleSourceCount=1 → webaudio (iOS)
    expect(
      getPreviewAudioOutputMode(iosPolicy, {
        hasAudioNode: true,
        isExporting: false,
        audibleSourceCount: 1,
        desiredVolume: 1,
        sourceType: 'video',
      }),
    ).toBe('webaudio');

    // 可聴ソースなし: hasAudioNode=true, audibleSourceCount=0 → webaudio (iOS)
    expect(
      getPreviewAudioOutputMode(iosPolicy, {
        hasAudioNode: true,
        isExporting: false,
        audibleSourceCount: 0,
        desiredVolume: 0,
        sourceType: 'video',
      }),
    ).toBe('webaudio');

    // export 中は hasAudioNode=true で単独動画でも webaudio を維持
    expect(
      getPreviewAudioOutputMode(iosPolicy, {
        hasAudioNode: true,
        isExporting: true,
        audibleSourceCount: 1,
        desiredVolume: 1,
        sourceType: 'video',
      }),
    ).toBe('webaudio');

    // audio ソースタイプは hasAudioNode=true で単独でも webaudio を維持
    expect(
      getPreviewAudioOutputMode(iosPolicy, {
        hasAudioNode: true,
        isExporting: false,
        audibleSourceCount: 1,
        desiredVolume: 1,
        sourceType: 'audio',
      }),
    ).toBe('webaudio');
  });

  it('PC/Android preview では muteNativeMediaWhenAudioRouted=false のため常に webaudio を返す', () => {
    const pcPolicy = getPreviewPlatformPolicy({
      isIosSafari: false,
      isAndroid: false,
      audioContextMayInterrupt: false,
    });

    // PC/Android では muteNativeMediaWhenAudioRouted=false → early return で webaudio
    expect(
      getPreviewAudioOutputMode(pcPolicy, {
        hasAudioNode: true,
        isExporting: false,
        audibleSourceCount: 2,
        desiredVolume: 1,
        sourceType: 'video',
      }),
    ).toBe('webaudio');

    expect(
      getPreviewAudioOutputMode(pcPolicy, {
        hasAudioNode: true,
        isExporting: false,
        audibleSourceCount: 1,
        desiredVolume: 1,
        sourceType: 'video',
      }),
    ).toBe('webaudio');

    expect(
      getPreviewAudioOutputMode(pcPolicy, {
        hasAudioNode: true,
        isExporting: false,
        audibleSourceCount: 0,
        desiredVolume: 0,
        sourceType: 'video',
      }),
    ).toBe('webaudio');
  });

  it('iOS Safari preview の複数音源時、動画音声も含めて WebAudio mix に寄せる', () => {
    expect(
      getPreviewAudioRoutingPlan(iosPolicy, {
        isExporting: false,
        candidates: [
          {
            id: 'video:1',
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
        id: 'video:1',
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
  });

  it('iOS Safari で動画+BGM の複数音源時は audio-only を先に起動する', () => {
    expect(
      shouldBundlePreviewStartForWebAudioMix(iosPolicy, {
        hasActiveVideo: true,
        audibleSourceCount: 2,
        requiresWebAudio: true,
      }),
    ).toBe(true);
  });

  it('単一動画や非 iOS では bundled start を使わない', () => {
    expect(
      shouldBundlePreviewStartForWebAudioMix(iosPolicy, {
        hasActiveVideo: true,
        audibleSourceCount: 1,
        requiresWebAudio: true,
      }),
    ).toBe(false);

    const nonIosPolicy = getPreviewPlatformPolicy({
      isAndroid: false,
      isIosSafari: false,
      audioContextMayInterrupt: false,
    });

    expect(
      shouldBundlePreviewStartForWebAudioMix(nonIosPolicy, {
        hasActiveVideo: true,
        audibleSourceCount: 2,
        requiresWebAudio: true,
      }),
    ).toBe(false);
  });

  it('iOS Safari preview の単一音源は開始前判定でも native fallback を維持する', () => {
    expect(
      getPreviewAudioRoutingPlan(iosPolicy, {
        isExporting: false,
        candidates: [
          {
            id: 'video:1',
            hasAudioNode: false,
            desiredVolume: 1,
            sourceType: 'video',
          },
        ],
      }),
    ).toEqual([
      {
        id: 'video:1',
        hasAudioNode: false,
        desiredVolume: 1,
        audibleSourceCount: 1,
        outputMode: 'native',
      },
    ]);
  });

  it('可視復帰時の AudioContext resume 判定と再初期化判定を返す', () => {
    expect(shouldResumeAudioContextOnVisibilityReturn(iosPolicy, 'interrupted')).toBe(true);
    expect(shouldResumeAudioContextOnVisibilityReturn(iosPolicy, 'running')).toBe(false);
    expect(shouldReinitializeAudioRoute(iosPolicy, false)).toBe(true);
    expect(shouldReinitializeAudioRoute(iosPolicy, true)).toBe(false);
  });

  it('blur 先行や pageshow 復帰でも、実行中ならメディア再同期を維持する', () => {
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

    expect(
      getVisibilityRecoveryPlan({
        resumedFromHidden: false,
        needsResyncFromLifecycle: true,
        isPlaying: false,
        isProcessing: true,
      }),
    ).toEqual({
      shouldKeepRunning: true,
      shouldResyncMedia: true,
      shouldDelayAudioResume: false,
    });

    expect(
      getVisibilityRecoveryPlan({
        resumedFromHidden: true,
        needsResyncFromLifecycle: true,
        isPlaying: false,
        isProcessing: false,
      }),
    ).toEqual({
      shouldKeepRunning: false,
      shouldResyncMedia: false,
      shouldDelayAudioResume: false,
    });
  });

  it('pagehide では通常 preview だけ入力メディアを pause し、export 中は hidden 側へ委ねる', () => {
    expect(
      getPageHidePausePlan({
        isProcessing: false,
      }),
    ).toEqual({
      shouldPauseMediaElements: true,
    });

    expect(
      getPageHidePausePlan({
        isProcessing: true,
      }),
    ).toEqual({
      shouldPauseMediaElements: false,
    });
  });

  it('動画クリップ終端では非最終クリップでも最終フレーム保持を優先する', () => {
    expect(
      shouldHoldVideoFrameAtClipEnd({
        clipLocalTime: 1.96,
        clipDuration: 2,
        trimStart: 3,
        videoCurrentTime: 4.97,
        videoEnded: true,
      }),
    ).toBe(true);
  });

  it('PC/Android export の途中クリップ終端ではフレーム保持を抑止する', () => {
    expect(
      shouldHoldVideoFrameAtClipEnd({
        clipLocalTime: 1.96,
        clipDuration: 2,
        trimStart: 3,
        videoCurrentTime: 4.97,
        videoEnded: true,
        isExporting: true,
        isIosSafari: false,
        isLastTimelineItem: false,
        nextItemType: 'image',
        fps: 30,
      }),
    ).toBe(false);
  });

  it('PC/Android export の video -> video 境界では 1 フレーム近傍だけ保持を許可する', () => {
    expect(
      shouldHoldVideoFrameAtClipEnd({
        clipLocalTime: 1.98,
        clipDuration: 2,
        trimStart: 3,
        videoCurrentTime: 4.97,
        videoEnded: true,
        isExporting: true,
        isIosSafari: false,
        isLastTimelineItem: false,
        nextItemType: 'video',
        fps: 30,
      }),
    ).toBe(true);
  });

  it('PC/Android export の video -> video 境界では near-end 許容を半フレームまでに絞る', () => {
    expect(
      shouldHoldVideoFrameAtClipEnd({
        clipLocalTime: 1.98,
        clipDuration: 2,
        trimStart: 3,
        videoCurrentTime: 4.975,
        videoEnded: false,
        isExporting: true,
        isIosSafari: false,
        isLastTimelineItem: false,
        nextItemType: 'video',
        fps: 30,
      }),
    ).toBe(false);

    expect(
      shouldHoldVideoFrameAtClipEnd({
        clipLocalTime: 1.995,
        clipDuration: 2,
        trimStart: 3,
        videoCurrentTime: 4.99,
        videoEnded: false,
        isExporting: true,
        isIosSafari: false,
        isLastTimelineItem: false,
        nextItemType: 'video',
        fps: 30,
      }),
    ).toBe(true);
  });

  it('PC/Android export の video -> video 境界でも 1 フレームより前は保持しない', () => {
    expect(
      shouldHoldVideoFrameAtClipEnd({
        clipLocalTime: 1.9,
        clipDuration: 2,
        trimStart: 3,
        videoCurrentTime: 4.97,
        videoEnded: true,
        isExporting: true,
        isIosSafari: false,
        isLastTimelineItem: false,
        nextItemType: 'video',
        fps: 30,
      }),
    ).toBe(false);
  });

  it('PC/Android export でも最終クリップ終端では最終フレーム保持を維持する', () => {
    expect(
      shouldHoldVideoFrameAtClipEnd({
        clipLocalTime: 1.96,
        clipDuration: 2,
        trimStart: 3,
        videoCurrentTime: 4.97,
        videoEnded: true,
        isExporting: true,
        isIosSafari: false,
        isLastTimelineItem: true,
        nextItemType: null,
        fps: 30,
      }),
    ).toBe(true);
  });

  it('iOS export の途中クリップ終端では従来どおり最終フレーム保持を維持する', () => {
    expect(
      shouldHoldVideoFrameAtClipEnd({
        clipLocalTime: 1.96,
        clipDuration: 2,
        trimStart: 3,
        videoCurrentTime: 4.97,
        videoEnded: true,
        isExporting: true,
        isIosSafari: true,
        isLastTimelineItem: false,
        nextItemType: 'video',
        fps: 30,
      }),
    ).toBe(true);
  });

  it('クリップ終端前なら ended していない動画を通常再生のまま扱う', () => {
    expect(
      shouldHoldVideoFrameAtClipEnd({
        clipLocalTime: 1.2,
        clipDuration: 2,
        trimStart: 3,
        videoCurrentTime: 4.2,
        videoEnded: false,
      }),
    ).toBe(false);
  });

  it('フェード終端でほぼ黒になるはずの tail は保持より黒クリアを優先する', () => {
    expect(
      shouldBlackoutVideoFadeTail({
        clipLocalTime: 1.98,
        clipDuration: 2,
        fadeOut: true,
        fadeOutDuration: 1,
      }),
    ).toBe(true);
  });

  it('フェード終端の低アルファ帯（alpha < 閾値）では黒クリアを優先する', () => {
    // remaining=0.04s, fadeOutDuration=1s → alpha=0.04 (< 0.05 閾値) → 黒クリア
    expect(
      shouldBlackoutVideoFadeTail({
        clipLocalTime: 1.96,
        clipDuration: 2,
        fadeOut: true,
        fadeOutDuration: 1,
      }),
    ).toBe(true);
  });

  it('フェード終端の blackout window 境界外ではフレーム保持を許可する', () => {
    // remaining=0.06s, fadeOutDuration=1s → alpha=0.06 (> 0.05 閾値) → 保持許可
    expect(
      shouldBlackoutVideoFadeTail({
        clipLocalTime: 1.94,
        clipDuration: 2,
        fadeOut: true,
        fadeOutDuration: 1,
      }),
    ).toBe(false);
  });

  it('フェード中盤では従来どおりフレーム保持を許可する', () => {
    expect(
      shouldBlackoutVideoFadeTail({
        clipLocalTime: 1.6,
        clipDuration: 2,
        fadeOut: true,
        fadeOutDuration: 1,
      }),
    ).toBe(false);
  });

  it('長いフェードでも alphaDerivedWindow が maxBlackoutWindowSec で制限される', () => {
    // fadeOutDuration=20s → alphaDerivedWindowSec = 20 * 0.05 = 1.0s
    // maxBlackoutWindowSec = 0.5s で制限 → blackoutWindowSec = 0.5s
    // remaining=0.51s > 0.5s → false
    expect(
      shouldBlackoutVideoFadeTail({
        clipLocalTime: 19.49,
        clipDuration: 20,
        fadeOut: true,
        fadeOutDuration: 20,
      }),
    ).toBe(false);

    // remaining=0.49s <= 0.5s → true
    expect(
      shouldBlackoutVideoFadeTail({
        clipLocalTime: 19.51,
        clipDuration: 20,
        fadeOut: true,
        fadeOutDuration: 20,
      }),
    ).toBe(true);
  });

  it('フェードアウト未使用クリップでは黒クリアへ倒さない', () => {
    expect(
      shouldBlackoutVideoFadeTail({
        clipLocalTime: 1.99,
        clipDuration: 2,
        fadeOut: false,
        fadeOutDuration: 1,
      }),
    ).toBe(false);
  });

  it('preview の遅延 play は現行試行かつ seek 完了時だけ許可する', () => {
    expect(
      shouldAttemptDeferredPreviewPlay({
        isCurrentAttempt: true,
        isPlaying: true,
        isSeeking: false,
        mediaSeeking: false,
        readyState: 2,
      }),
    ).toBe(true);

    expect(
      shouldAttemptDeferredPreviewPlay({
        isCurrentAttempt: false,
        isPlaying: true,
        isSeeking: false,
        mediaSeeking: false,
        readyState: 2,
      }),
    ).toBe(false);

    expect(
      shouldAttemptDeferredPreviewPlay({
        isCurrentAttempt: true,
        isPlaying: true,
        isSeeking: true,
        mediaSeeking: false,
        readyState: 2,
      }),
    ).toBe(false);

    expect(
      shouldAttemptDeferredPreviewPlay({
        isCurrentAttempt: true,
        isPlaying: true,
        isSeeking: false,
        mediaSeeking: true,
        readyState: 2,
      }),
    ).toBe(false);
  });

});
