import type {
  AudioTrack,
  Caption,
  CaptionSettings,
  MediaItem,
  NarrationClip,
} from '../../../types';

export type PreviewCacheStatus = 'idle' | 'preparing' | 'ready' | 'failed';

export interface PreviewCacheEntry {
  url: string;
  duration: number;
  cacheKey: string;
  createdAt: number;
}

interface CreateAndroidPreviewCacheKeyInput {
  mediaItems: MediaItem[];
  bgm: AudioTrack | null;
  narrations: NarrationClip[];
  captions: Caption[];
  captionSettings: CaptionSettings;
  canvasWidth: number;
  canvasHeight: number;
  fps: number;
}

export function countVideoItems(mediaItems: MediaItem[]): number {
  return mediaItems.reduce((count, item) => count + (item.type === 'video' ? 1 : 0), 0);
}

// preview cache 方式は Android 実機で生成中・生成物ともにブラックアウトが発生したため
// 完全無効化する。従来の live preview 方式を使う。
const ENABLE_ANDROID_PREVIEW_CACHE = false;

export function shouldUseAndroidPreviewCache(input: {
  isAndroid: boolean;
  isIosSafari: boolean;
  isExportMode: boolean;
  mediaItems: MediaItem[];
}): boolean {
  if (!ENABLE_ANDROID_PREVIEW_CACHE) {
    return false;
  }
  return input.isAndroid
    && !input.isIosSafari
    && !input.isExportMode
    && countVideoItems(input.mediaItems) >= 2;
}

export function createAndroidPreviewCacheKey(
  input: CreateAndroidPreviewCacheKeyInput,
): string {
  return JSON.stringify({
    version: 1,
    canvas: {
      width: input.canvasWidth,
      height: input.canvasHeight,
      fps: input.fps,
    },
    mediaItems: input.mediaItems.map((item) => ({
      id: item.id,
      type: item.type,
      url: item.url,
      duration: item.duration,
      trimStart: item.trimStart,
      trimEnd: item.trimEnd,
      originalDuration: item.originalDuration,
      volume: item.volume,
      isMuted: item.isMuted,
      fadeIn: item.fadeIn,
      fadeOut: item.fadeOut,
      fadeInDuration: item.fadeInDuration,
      fadeOutDuration: item.fadeOutDuration,
      scale: item.scale,
      positionX: item.positionX,
      positionY: item.positionY,
      fileName: item.file?.name ?? null,
      fileType: item.file?.type ?? null,
      fileSize: item.file instanceof File ? item.file.size : null,
      lastModified: item.file instanceof File ? item.file.lastModified : null,
    })),
    bgm: input.bgm
      ? {
          url: input.bgm.url,
          startPoint: input.bgm.startPoint,
          delay: input.bgm.delay,
          volume: input.bgm.volume,
          fadeIn: input.bgm.fadeIn,
          fadeOut: input.bgm.fadeOut,
          fadeInDuration: input.bgm.fadeInDuration,
          fadeOutDuration: input.bgm.fadeOutDuration,
          duration: input.bgm.duration,
          fileName: input.bgm.file?.name ?? null,
        }
      : null,
    narrations: input.narrations.map((clip) => ({
      id: clip.id,
      url: clip.url,
      startTime: clip.startTime,
      volume: clip.volume,
      isMuted: clip.isMuted,
      trimStart: clip.trimStart,
      trimEnd: clip.trimEnd,
      duration: clip.duration,
      fileName: clip.file?.name ?? null,
      sourceType: clip.sourceType,
    })),
    captions: input.captions.map((caption) => ({
      id: caption.id,
      text: caption.text,
      startTime: caption.startTime,
      endTime: caption.endTime,
      fadeIn: caption.fadeIn,
      fadeOut: caption.fadeOut,
      fadeInDuration: caption.fadeInDuration,
      fadeOutDuration: caption.fadeOutDuration,
      overridePosition: caption.overridePosition ?? null,
      overrideFontStyle: caption.overrideFontStyle ?? null,
      overrideFontSize: caption.overrideFontSize ?? null,
      overrideFadeIn: caption.overrideFadeIn ?? null,
      overrideFadeOut: caption.overrideFadeOut ?? null,
      overrideFadeInDuration: caption.overrideFadeInDuration ?? null,
      overrideFadeOutDuration: caption.overrideFadeOutDuration ?? null,
    })),
    captionSettings: {
      enabled: input.captionSettings.enabled,
      fontSize: input.captionSettings.fontSize,
      fontStyle: input.captionSettings.fontStyle,
      fontColor: input.captionSettings.fontColor,
      strokeColor: input.captionSettings.strokeColor,
      strokeWidth: input.captionSettings.strokeWidth,
      position: input.captionSettings.position,
      blur: input.captionSettings.blur,
      bulkFadeIn: input.captionSettings.bulkFadeIn,
      bulkFadeOut: input.captionSettings.bulkFadeOut,
      bulkFadeInDuration: input.captionSettings.bulkFadeInDuration,
      bulkFadeOutDuration: input.captionSettings.bulkFadeOutDuration,
    },
  });
}
