import { describe, expect, it } from 'vitest';

import type { Caption, CaptionSettings, MediaItem, NarrationClip } from '../types';
import type { AudioTrack } from '../types';
import {
  countVideoItems,
  createAndroidPreviewCacheKey,
  shouldUseAndroidPreviewCache,
} from '../flavors/standard/preview/androidPreviewCache';
import { getPreviewPlatformPolicy } from '../flavors/standard/preview/previewPlatform';

function createVideoItem(id: string): MediaItem {
  return {
    id,
    file: new File([''], `${id}.mp4`, { type: 'video/mp4' }),
    type: 'video',
    url: `blob:${id}`,
    volume: 1,
    isMuted: false,
    fadeIn: false,
    fadeOut: false,
    fadeInDuration: 1,
    fadeOutDuration: 1,
    duration: 2,
    originalDuration: 2,
    trimStart: 0,
    trimEnd: 2,
    scale: 1,
    positionX: 0,
    positionY: 0,
    isTransformOpen: false,
    isLocked: false,
  };
}

function createImageItem(id: string): MediaItem {
  return {
    ...createVideoItem(id),
    type: 'image',
    file: new File([''], `${id}.png`, { type: 'image/png' }),
    url: `blob:${id}`,
  };
}

describe('android preview cache helpers', () => {
  it('ENABLE_ANDROID_PREVIEW_CACHE=false のため常に false を返す', () => {
    // preview cache は Android 実機でのブラックアウト問題により無効化済み。
    // shouldUseAndroidPreviewCache は ENABLE_ANDROID_PREVIEW_CACHE=false により常に false を返す。
    expect(
      shouldUseAndroidPreviewCache({
        isAndroid: true,
        isIosSafari: false,
        isExportMode: false,
        mediaItems: [createVideoItem('v1'), createVideoItem('v2')],
      }),
    ).toBe(false);

    expect(
      shouldUseAndroidPreviewCache({
        isAndroid: true,
        isIosSafari: false,
        isExportMode: false,
        mediaItems: [createVideoItem('v1'), createImageItem('i1')],
      }),
    ).toBe(false);
  });

  it('timeline 変更で cache key が変わる', () => {
    const bgm: AudioTrack = {
      file: new File([''], 'bgm.mp3', { type: 'audio/mpeg' }),
      url: 'blob:bgm',
      startPoint: 0,
      delay: 0,
      volume: 1,
      fadeIn: false,
      fadeOut: false,
      fadeInDuration: 1,
      fadeOutDuration: 1,
      duration: 10,
      isAi: false,
    };
    const narrations: NarrationClip[] = [];
    const captions: Caption[] = [];
    const captionSettings: CaptionSettings = {
      enabled: true,
      fontSize: 'medium',
      fontStyle: 'gothic',
      fontColor: '#fff',
      strokeColor: '#000',
      strokeWidth: 2,
      position: 'bottom',
      blur: 0,
      bulkFadeIn: false,
      bulkFadeOut: false,
      bulkFadeInDuration: 1,
      bulkFadeOutDuration: 1,
    };

    const baseItems = [createVideoItem('v1'), createVideoItem('v2')];
    const changedItems = [
      createVideoItem('v1'),
      { ...createVideoItem('v2'), trimStart: 0.5 },
    ];

    const keyA = createAndroidPreviewCacheKey({
      mediaItems: baseItems,
      bgm,
      narrations,
      captions,
      captionSettings,
      canvasWidth: 1280,
      canvasHeight: 720,
      fps: 30,
    });
    const keyB = createAndroidPreviewCacheKey({
      mediaItems: changedItems,
      bgm,
      narrations,
      captions,
      captionSettings,
      canvasWidth: 1280,
      canvasHeight: 720,
      fps: 30,
    });

    expect(countVideoItems(baseItems)).toBe(2);
    expect(keyA).not.toBe(keyB);
  });

  it('Android standard preview policy は live fallback の sync threshold を厳しめにする', () => {
    const policy = getPreviewPlatformPolicy({
      isAndroid: true,
      isIosSafari: false,
      audioContextMayInterrupt: false,
    });

    expect(policy.previewSyncThresholdSec).toBe(0.08);
  });
});
