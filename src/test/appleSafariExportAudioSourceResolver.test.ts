import { describe, expect, it } from 'vitest';

import { resolveAppleSafariExportAudioSource } from '../flavors/apple-safari/export/audioSourceResolver';

describe('apple safari export audio source resolver', () => {
  it('動画コンテナは media-element 経路を選ぶ', () => {
    expect(
      resolveAppleSafariExportAudioSource({
        fileName: 'clip.mp4',
        mimeType: 'video/mp4',
      }),
    ).toEqual({
      strategy: 'media-element',
      reason: 'video-container-audio',
      mimeType: 'video/mp4',
      extension: 'mp4',
    });
  });

  it('音声ファイルは decode-audio-data 経路を選ぶ', () => {
    expect(
      resolveAppleSafariExportAudioSource({
        fileName: 'bgm.m4a',
        mimeType: 'audio/mp4',
      }),
    ).toEqual({
      strategy: 'decode-audio-data',
      reason: 'direct-audio-file',
      mimeType: 'audio/mp4',
      extension: 'm4a',
    });
  });

  it('不明な拡張子は安全側で media-element に寄せる', () => {
    expect(
      resolveAppleSafariExportAudioSource({
        fileName: 'mystery.bin',
        mimeType: null,
      }),
    ).toEqual({
      strategy: 'media-element',
      reason: 'unknown-content-type',
      mimeType: null,
      extension: 'bin',
    });
  });
});