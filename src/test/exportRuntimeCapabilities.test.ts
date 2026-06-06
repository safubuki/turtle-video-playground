import { describe, expect, it } from 'vitest';

import type { PlatformCapabilities } from '../utils/platform';
import { getAppleSafariExportPlatformCapabilities } from '../flavors/apple-safari/appleSafariExportRuntime';
import { getStandardExportPlatformCapabilities } from '../flavors/standard/standardExportRuntime';

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

describe('export runtime capabilities', () => {
  it('standard runtime normalizes away apple-safari specific export flags', () => {
    const capabilities = createCapabilities({
      isAndroid: false,
      isIOS: true,
      isSafari: true,
      isIosSafari: true,
      audioContextMayInterrupt: true,
    });

    const normalized = getStandardExportPlatformCapabilities(capabilities);

    expect(normalized.isIosSafari).toBe(false);
    expect(normalized.supportsMp4MediaRecorder).toBe(false);
    expect(normalized.supportedMediaRecorderProfile).toBeNull();
    expect(normalized.audioContextMayInterrupt).toBe(false);
    expect(normalized.supportsTrackProcessor).toBe(true);
  });

  it('apple-safari runtime forces safari export branch flags', () => {
    const capabilities = createCapabilities({
      isAndroid: true,
      isIOS: false,
      isSafari: false,
      isIosSafari: false,
      audioContextMayInterrupt: false,
    });

    const normalized = getAppleSafariExportPlatformCapabilities(capabilities);

    expect(normalized.isAndroid).toBe(false);
    expect(normalized.isIosSafari).toBe(true);
    expect(normalized.audioContextMayInterrupt).toBe(true);
    expect(normalized.supportedMediaRecorderProfile).toEqual({ mimeType: 'video/mp4', extension: 'mp4' });
  });
});