/**
 * @file iosSafariAudio.ts
 * @description iOS Safari 専用の preview audio ルーティング判定を集約する utility。
 * Android / PC の既存経路には触れず、Safari 限定の mixed audio 条件だけをここで扱う。
 */

export type IosSafariPreviewSourceType = 'video' | 'audio';

export interface IosSafariSingleMixedAudioInput {
  isIosSafari: boolean;
  isExporting: boolean;
  audibleSourceCount: number;
  sourceType?: IosSafariPreviewSourceType;
}

export interface IosSafariSingleMixedAudioDecision {
  shouldUseSingleMixedAudio: boolean;
  reason:
    | 'non-ios-safari'
    | 'export-route'
    | 'not-mixed-with-video'
    | 'single-audible-source'
    | 'video-plus-audio-mix';
}

/**
 * iOS Safari preview だけで、動画音声 + BGM/ナレーションの同時再生を
 * 単一の WebAudio mix に寄せるべきかを返す。
 */
export function resolveIosSafariSingleMixedAudio(
  input: IosSafariSingleMixedAudioInput,
): IosSafariSingleMixedAudioDecision {
  if (!input.isIosSafari) {
    return {
      shouldUseSingleMixedAudio: false,
      reason: 'non-ios-safari',
    };
  }

  if (input.isExporting) {
    return {
      shouldUseSingleMixedAudio: false,
      reason: 'export-route',
    };
  }

  if (input.audibleSourceCount <= 1) {
    return {
      shouldUseSingleMixedAudio: false,
      reason: 'single-audible-source',
    };
  }

  if (input.sourceType !== 'video') {
    return {
      shouldUseSingleMixedAudio: false,
      reason: 'not-mixed-with-video',
    };
  }

  return {
    shouldUseSingleMixedAudio: true,
    reason: 'video-plus-audio-mix',
  };
}
