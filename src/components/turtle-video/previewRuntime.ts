import { useInactiveVideoManager } from './useInactiveVideoManager';
import { usePreviewAudioSession } from './usePreviewAudioSession';
import { usePreviewEngine } from './usePreviewEngine';
import { usePreviewSeekController } from './usePreviewSeekController';
import { usePreviewVisibilityLifecycle } from './usePreviewVisibilityLifecycle';
import type { PlatformCapabilities } from '../../utils/platform';
import { getPreviewPlatformPolicy } from '../../utils/previewPlatform';

export interface PreviewRuntime {
  getPlatformCapabilities: () => PlatformCapabilities;
  getPreviewPlatformPolicy: typeof getPreviewPlatformPolicy;
  useInactiveVideoManager: typeof useInactiveVideoManager;
  usePreviewAudioSession: typeof usePreviewAudioSession;
  usePreviewEngine: typeof usePreviewEngine;
  usePreviewSeekController: typeof usePreviewSeekController;
  usePreviewVisibilityLifecycle: typeof usePreviewVisibilityLifecycle;
}