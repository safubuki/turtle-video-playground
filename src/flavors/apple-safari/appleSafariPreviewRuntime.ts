import type { PreviewRuntime } from '../../components/turtle-video/previewRuntime';
import { useInactiveVideoManager } from './preview/useInactiveVideoManager';
import { usePreviewAudioSession } from './preview/usePreviewAudioSession';
import { usePreviewEngine } from './preview/usePreviewEngine';
import { usePreviewSeekController } from './preview/usePreviewSeekController';
import { usePreviewVisibilityLifecycle } from './preview/usePreviewVisibilityLifecycle';
import { getPlatformCapabilities, type PlatformCapabilities } from '../../utils/platform';
import { getPreviewPlatformPolicy } from './preview/previewPlatform';

export function getAppleSafariPreviewPlatformCapabilities(
  baseCapabilities: PlatformCapabilities = getPlatformCapabilities(),
): PlatformCapabilities {
  return {
    ...baseCapabilities,
    isAndroid: false,
    isIosSafari: true,
    audioContextMayInterrupt: true,
  };
}

export const appleSafariPreviewRuntime: PreviewRuntime = {
  getPlatformCapabilities: getAppleSafariPreviewPlatformCapabilities,
  getPreviewPlatformPolicy,
  useInactiveVideoManager,
  usePreviewAudioSession,
  usePreviewEngine,
  usePreviewSeekController,
  usePreviewVisibilityLifecycle,
};