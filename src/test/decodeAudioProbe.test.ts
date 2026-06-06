import { describe, expect, it, vi } from 'vitest';

import { probeDecodeAudioData } from '../hooks/export-strategies/decodeAudioProbe';

describe('decodeAudioData probe', () => {
  it('decode 成功時に probe result と AudioBuffer を返す', async () => {
    const audioBuffer = {
      duration: 1.25,
      numberOfChannels: 2,
      sampleRate: 48000,
    } as AudioBuffer;
    const audioContext = {
      decodeAudioData: vi.fn().mockResolvedValue(audioBuffer),
    } as unknown as BaseAudioContext;

    const result = await probeDecodeAudioData({
      audioContext,
      arrayBuffer: new ArrayBuffer(8),
      fileName: 'bgm.m4a',
      mimeType: 'audio/mp4',
      extension: 'm4a',
    });

    expect(result.audioBuffer).toBe(audioBuffer);
    expect(result.result).toMatchObject({
      status: 'success',
      fileName: 'bgm.m4a',
      mimeType: 'audio/mp4',
      extension: 'm4a',
      bufferBytes: 8,
      durationSec: 1.25,
      numberOfChannels: 2,
      sampleRate: 48000,
      errorName: null,
      errorMessage: null,
    });
  });

  it('decode 失敗時にエラー情報を probe result に残す', async () => {
    const audioContext = {
      decodeAudioData: vi.fn().mockRejectedValue(new DOMException('Decoding failed', 'EncodingError')),
    } as unknown as BaseAudioContext;

    const result = await probeDecodeAudioData({
      audioContext,
      arrayBuffer: new ArrayBuffer(4),
      fileName: 'clip.mp4',
      mimeType: 'video/mp4',
      extension: 'mp4',
    });

    expect(result.audioBuffer).toBeNull();
    expect(result.result).toMatchObject({
      status: 'failure',
      fileName: 'clip.mp4',
      mimeType: 'video/mp4',
      extension: 'mp4',
      bufferBytes: 4,
      durationSec: null,
      numberOfChannels: null,
      sampleRate: null,
      errorName: 'EncodingError',
      errorMessage: 'Decoding failed',
    });
  });
});
