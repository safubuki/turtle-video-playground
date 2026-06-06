export type AppleSafariWebCodecsFallbackStatus =
  | 'webcodecs-available'
  | 'partial-webcodecs'
  | 'mediarecorder-required';

export interface AppleSafariWebCodecsSupportSnapshot {
  checkedAt: string;
  supportsVideoEncoder: boolean;
  supportsVideoDecoder: boolean;
  supportsAudioEncoder: boolean;
  fallbackStatus: AppleSafariWebCodecsFallbackStatus;
  notes: string[];
}

export function collectAppleSafariWebCodecsSupportSnapshot(): AppleSafariWebCodecsSupportSnapshot {
  const supportsVideoEncoder = typeof VideoEncoder !== 'undefined';
  const supportsVideoDecoder = typeof VideoDecoder !== 'undefined';
  const supportsAudioEncoder = typeof AudioEncoder !== 'undefined';
  const supportsExportFallback = supportsVideoEncoder && supportsAudioEncoder;
  const notes: string[] = [];

  if (!supportsVideoEncoder) {
    notes.push('VideoEncoder が未検出のため、WebCodecs MP4 fallback は使用できません。');
  }
  if (!supportsAudioEncoder) {
    notes.push('AudioEncoder が未検出のため、WebCodecs MP4 fallback は使用できません。');
  }
  if (!supportsVideoDecoder) {
    notes.push('VideoDecoder が未検出です。現在の export fallback 直接処理には必須ではありませんが、端末 capability として記録します。');
  }
  if (supportsExportFallback) {
    notes.push('WebCodecs MP4 fallback に必要な VideoEncoder / AudioEncoder を検出しました。');
  }

  return {
    checkedAt: new Date().toISOString(),
    supportsVideoEncoder,
    supportsVideoDecoder,
    supportsAudioEncoder,
    fallbackStatus: supportsExportFallback
      ? 'webcodecs-available'
      : (supportsVideoEncoder || supportsAudioEncoder || supportsVideoDecoder)
        ? 'partial-webcodecs'
        : 'mediarecorder-required',
    notes,
  };
}
