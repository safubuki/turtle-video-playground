import { describe, expect, it } from 'vitest';

import type { PlatformCapabilities } from '../utils/platform';
import { getAppleSafariPreviewPlatformCapabilities } from '../flavors/apple-safari/appleSafariPreviewRuntime';
import { getStandardPreviewPlatformCapabilities } from '../flavors/standard/standardPreviewRuntime';

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

describe('preview runtime capabilities', () => {
  it('standard runtime normalizes away apple-safari specific preview flags', () => {
    const capabilities = createCapabilities({
      isAndroid: false,
      isIOS: true,
      isSafari: true,
      isIosSafari: true,
      audioContextMayInterrupt: true,
    });

    const normalized = getStandardPreviewPlatformCapabilities(capabilities);

    expect(normalized.isIosSafari).toBe(false);
    expect(normalized.audioContextMayInterrupt).toBe(false);
    expect(normalized.isIOS).toBe(true);
    expect(normalized.isSafari).toBe(true);
  });

  it('apple-safari runtime forces safari preview branch flags', () => {
    const capabilities = createCapabilities({
      isAndroid: true,
      isIOS: false,
      isSafari: false,
      isIosSafari: false,
      audioContextMayInterrupt: false,
    });

    const normalized = getAppleSafariPreviewPlatformCapabilities(capabilities);

    expect(normalized.isAndroid).toBe(false);
    expect(normalized.isIosSafari).toBe(true);
    expect(normalized.audioContextMayInterrupt).toBe(true);
    expect(normalized.supportsTrackProcessor).toBe(true);
  });
});