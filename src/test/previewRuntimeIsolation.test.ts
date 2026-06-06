import { describe, expect, it } from 'vitest';

import { useInactiveVideoManager as sharedUseInactiveVideoManager } from '../components/turtle-video/useInactiveVideoManager';
import { usePreviewAudioSession as sharedUsePreviewAudioSession } from '../components/turtle-video/usePreviewAudioSession';
import { usePreviewEngine as sharedUsePreviewEngine } from '../components/turtle-video/usePreviewEngine';
import { usePreviewSeekController as sharedUsePreviewSeekController } from '../components/turtle-video/usePreviewSeekController';
import { usePreviewVisibilityLifecycle as sharedUsePreviewVisibilityLifecycle } from '../components/turtle-video/usePreviewVisibilityLifecycle';
import type { PlatformCapabilities } from '../utils/platform';
import { getPreviewPlatformPolicy as sharedGetPreviewPlatformPolicy } from '../utils/previewPlatform';
import {
  appleSafariPreviewRuntime,
  getAppleSafariPreviewPlatformCapabilities,
} from '../flavors/apple-safari/appleSafariPreviewRuntime';
import {
  getFutureVideoAudioProbeTimes as getAppleSafariFutureVideoAudioProbeTimes,
  getVisibilityRecoveryPlan as getAppleSafariVisibilityRecoveryPlan,
  getPreviewAudioOutputMode as getAppleSafariPreviewAudioOutputMode,
  shouldResumeAudioContextOnVisibilityReturn as shouldAppleSafariResumeAudioContextOnVisibilityReturn,
  shouldReinitializeAudioRoute as shouldAppleSafariReinitializeAudioRoute,
} from '../flavors/apple-safari/preview/previewPlatform';
import {
  getStandardPreviewPlatformCapabilities,
  standardPreviewRuntime,
} from '../flavors/standard/standardPreviewRuntime';
import {
  getFutureVideoAudioProbeTimes as getStandardFutureVideoAudioProbeTimes,
  getVisibilityRecoveryPlan as getStandardVisibilityRecoveryPlan,
  getPreviewAudioOutputMode as getStandardPreviewAudioOutputMode,
  shouldResumeAudioContextOnVisibilityReturn as shouldStandardResumeAudioContextOnVisibilityReturn,
  shouldReinitializeAudioRoute as shouldStandardReinitializeAudioRoute,
} from '../flavors/standard/preview/previewPlatform';

const createCapabilities = (
  overrides: Partial<PlatformCapabilities> = {},
): PlatformCapabilities => ({
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
});

describe('preview runtime isolation', () => {
  it('active runtimes use flavor-owned preview hook modules', () => {
    expect(standardPreviewRuntime.useInactiveVideoManager).not.toBe(sharedUseInactiveVideoManager);
    expect(standardPreviewRuntime.usePreviewAudioSession).not.toBe(sharedUsePreviewAudioSession);
    expect(standardPreviewRuntime.usePreviewEngine).not.toBe(sharedUsePreviewEngine);
    expect(standardPreviewRuntime.usePreviewSeekController).not.toBe(sharedUsePreviewSeekController);
    expect(standardPreviewRuntime.usePreviewVisibilityLifecycle).not.toBe(sharedUsePreviewVisibilityLifecycle);

    expect(appleSafariPreviewRuntime.useInactiveVideoManager).not.toBe(sharedUseInactiveVideoManager);
    expect(appleSafariPreviewRuntime.usePreviewAudioSession).not.toBe(sharedUsePreviewAudioSession);
    expect(appleSafariPreviewRuntime.usePreviewEngine).not.toBe(sharedUsePreviewEngine);
    expect(appleSafariPreviewRuntime.usePreviewSeekController).not.toBe(sharedUsePreviewSeekController);
    expect(appleSafariPreviewRuntime.usePreviewVisibilityLifecycle).not.toBe(sharedUsePreviewVisibilityLifecycle);

    expect(standardPreviewRuntime.useInactiveVideoManager).not.toBe(appleSafariPreviewRuntime.useInactiveVideoManager);
    expect(standardPreviewRuntime.usePreviewAudioSession).not.toBe(appleSafariPreviewRuntime.usePreviewAudioSession);
    expect(standardPreviewRuntime.usePreviewEngine).not.toBe(appleSafariPreviewRuntime.usePreviewEngine);
    expect(standardPreviewRuntime.usePreviewSeekController).not.toBe(appleSafariPreviewRuntime.usePreviewSeekController);
    expect(standardPreviewRuntime.usePreviewVisibilityLifecycle).not.toBe(appleSafariPreviewRuntime.usePreviewVisibilityLifecycle);
  });

  it('active runtimes use flavor-owned preview policy factories', () => {
    expect(standardPreviewRuntime.getPreviewPlatformPolicy).not.toBe(sharedGetPreviewPlatformPolicy);
    expect(appleSafariPreviewRuntime.getPreviewPlatformPolicy).not.toBe(sharedGetPreviewPlatformPolicy);
    expect(standardPreviewRuntime.getPreviewPlatformPolicy).not.toBe(appleSafariPreviewRuntime.getPreviewPlatformPolicy);

    const baseCapabilities = createCapabilities({
      isAndroid: true,
      isIOS: true,
      isSafari: true,
      isIosSafari: true,
      audioContextMayInterrupt: true,
    });

    const standardPolicy = standardPreviewRuntime.getPreviewPlatformPolicy(
      getStandardPreviewPlatformCapabilities(baseCapabilities),
    );
    const appleSafariPolicy = appleSafariPreviewRuntime.getPreviewPlatformPolicy(
      getAppleSafariPreviewPlatformCapabilities(baseCapabilities),
    );

    expect(standardPolicy.muteNativeMediaWhenAudioRouted).toBe(false);
    expect(standardPolicy.needsCaptionBlurFallback).toBe(false);
    expect(standardPolicy.resumeAudioContextOnVisibilityReturn).toBe(false);
    expect(standardPolicy.audioContextResumeRetryCount).toBe(1);
    expect(appleSafariPolicy.muteNativeMediaWhenAudioRouted).toBe(true);
    expect(appleSafariPolicy.needsCaptionBlurFallback).toBe(true);
    expect(appleSafariPolicy.resumeAudioContextOnVisibilityReturn).toBe(true);
    expect(appleSafariPolicy.audioContextResumeRetryCount).toBe(2);

    expect(getStandardPreviewAudioOutputMode(standardPolicy, {
      hasAudioNode: false,
      isExporting: false,
      audibleSourceCount: 2,
      desiredVolume: 1,
      sourceType: 'video',
    })).toBe('native');
    expect(getAppleSafariPreviewAudioOutputMode(appleSafariPolicy, {
      hasAudioNode: false,
      isExporting: false,
      audibleSourceCount: 2,
      desiredVolume: 1,
      sourceType: 'video',
    })).toBe('webaudio');

    // iOS Safari 単独 video (BGM/narration なし) でも WebAudio 経路を強制する。
    // AudioContext running 状態で native 経路の audio が抑制される iOS Safari の
    // 挙動を回避し、「BGM 有無で audio が出たり出なかったり」する不安定さを防ぐ。
    expect(getStandardPreviewAudioOutputMode(standardPolicy, {
      hasAudioNode: false,
      isExporting: false,
      audibleSourceCount: 1,
      desiredVolume: 1,
      sourceType: 'video',
    })).toBe('native');
    expect(getAppleSafariPreviewAudioOutputMode(appleSafariPolicy, {
      hasAudioNode: false,
      isExporting: false,
      audibleSourceCount: 1,
      desiredVolume: 1,
      sourceType: 'video',
    })).toBe('webaudio');

    expect(getStandardFutureVideoAudioProbeTimes([
      { type: 'image', duration: 1 },
      { type: 'video', duration: 2 },
    ], 0)).toEqual([]);
    expect(getAppleSafariFutureVideoAudioProbeTimes([
      { type: 'image', duration: 1 },
      { type: 'video', duration: 2 },
    ], 0)).toEqual([1.05]);

    expect(shouldStandardReinitializeAudioRoute(standardPolicy, false)).toBe(false);
    expect(shouldAppleSafariReinitializeAudioRoute(appleSafariPolicy, false)).toBe(true);

    expect(shouldStandardResumeAudioContextOnVisibilityReturn(standardPolicy, 'interrupted')).toBe(false);
    expect(shouldAppleSafariResumeAudioContextOnVisibilityReturn(appleSafariPolicy, 'interrupted')).toBe(true);

    expect(getStandardVisibilityRecoveryPlan({
      resumedFromHidden: true,
      needsResyncFromLifecycle: false,
      isPlaying: true,
      isProcessing: false,
    }).shouldDelayAudioResume).toBe(false);
    expect(getAppleSafariVisibilityRecoveryPlan({
      resumedFromHidden: true,
      needsResyncFromLifecycle: false,
      isPlaying: true,
      isProcessing: false,
    }).shouldDelayAudioResume).toBe(true);
  });
});