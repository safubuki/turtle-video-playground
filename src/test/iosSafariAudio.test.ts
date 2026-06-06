import { describe, expect, it } from 'vitest';
import { resolveIosSafariSingleMixedAudio } from '../utils/iosSafariAudio';

describe('resolveIosSafariSingleMixedAudio', () => {
  it('iOS Safari preview の動画+BGM を単一 WebAudio mix に切り替える', () => {
    expect(
      resolveIosSafariSingleMixedAudio({
        isIosSafari: true,
        isExporting: false,
        audibleSourceCount: 2,
        sourceType: 'video',
      }),
    ).toEqual({
      shouldUseSingleMixedAudio: true,
      reason: 'video-plus-audio-mix',
    });
  });

  it('非 iOS Safari / export / 単一音源は既存ルートを維持する', () => {
    expect(
      resolveIosSafariSingleMixedAudio({
        isIosSafari: false,
        isExporting: false,
        audibleSourceCount: 2,
        sourceType: 'video',
      }).shouldUseSingleMixedAudio,
    ).toBe(false);

    expect(
      resolveIosSafariSingleMixedAudio({
        isIosSafari: true,
        isExporting: true,
        audibleSourceCount: 2,
        sourceType: 'video',
      }).shouldUseSingleMixedAudio,
    ).toBe(false);

    expect(
      resolveIosSafariSingleMixedAudio({
        isIosSafari: true,
        isExporting: false,
        audibleSourceCount: 1,
        sourceType: 'video',
      }).shouldUseSingleMixedAudio,
    ).toBe(false);
  });
});
