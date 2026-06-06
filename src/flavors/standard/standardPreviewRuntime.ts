import type { PreviewRuntime } from '../../components/turtle-video/previewRuntime';
import { useInactiveVideoManager } from './preview/useInactiveVideoManager';
import { usePreviewAudioSession } from './preview/usePreviewAudioSession';
import { usePreviewEngine } from './preview/usePreviewEngine';
import { usePreviewSeekController } from './preview/usePreviewSeekController';
import { usePreviewVisibilityLifecycle } from './preview/usePreviewVisibilityLifecycle';
import { getPlatformCapabilities, type PlatformCapabilities } from '../../utils/platform';
import { getPreviewPlatformPolicy } from './preview/previewPlatform';

export function getStandardPreviewPlatformCapabilities(
  baseCapabilities: PlatformCapabilities = getPlatformCapabilities(),
): PlatformCapabilities {
  return {
    ...baseCapabilities,
    isIosSafari: false,
    audioContextMayInterrupt: false,
  };
}

export const standardPreviewRuntime: PreviewRuntime = {
  getPlatformCapabilities: getStandardPreviewPlatformCapabilities,
  getPreviewPlatformPolicy,
  useInactiveVideoManager,
  usePreviewAudioSession,
  usePreviewEngine,
  usePreviewSeekController,
  usePreviewVisibilityLifecycle,
};