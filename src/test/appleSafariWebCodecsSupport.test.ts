import { afterEach, describe, expect, it } from 'vitest';

import { collectAppleSafariWebCodecsSupportSnapshot } from '../flavors/apple-safari/export/webCodecsSupport';

const originalVideoEncoder = globalThis.VideoEncoder;
const originalVideoDecoder = globalThis.VideoDecoder;
const originalAudioEncoder = globalThis.AudioEncoder;

function setGlobalConstructor(name: 'VideoEncoder' | 'VideoDecoder' | 'AudioEncoder', value: unknown) {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value,
  });
}

afterEach(() => {
  setGlobalConstructor('VideoEncoder', originalVideoEncoder);
  setGlobalConstructor('VideoDecoder', originalVideoDecoder);
  setGlobalConstructor('AudioEncoder', originalAudioEncoder);
});

describe('apple safari WebCodecs support snapshot', () => {
  it('VideoEncoder と AudioEncoder がある場合は fallback 使用可能として記録する', () => {
    setGlobalConstructor('VideoEncoder', function VideoEncoderMock() {});
    setGlobalConstructor('VideoDecoder', function VideoDecoderMock() {});
    setGlobalConstructor('AudioEncoder', function AudioEncoderMock() {});

    const snapshot = collectAppleSafariWebCodecsSupportSnapshot();

    expect(snapshot).toMatchObject({
      supportsVideoEncoder: true,
      supportsVideoDecoder: true,
      supportsAudioEncoder: true,
      fallbackStatus: 'webcodecs-available',
    });
  });

  it('encoder が足りない場合は MediaRecorder 主経路が必要と分かる状態にする', () => {
    setGlobalConstructor('VideoEncoder', undefined);
    setGlobalConstructor('VideoDecoder', undefined);
    setGlobalConstructor('AudioEncoder', undefined);

    const snapshot = collectAppleSafariWebCodecsSupportSnapshot();

    expect(snapshot).toMatchObject({
      supportsVideoEncoder: false,
      supportsVideoDecoder: false,
      supportsAudioEncoder: false,
      fallbackStatus: 'mediarecorder-required',
    });
    expect(snapshot.notes).toContain('VideoEncoder が未検出のため、WebCodecs MP4 fallback は使用できません。');
  });
});
