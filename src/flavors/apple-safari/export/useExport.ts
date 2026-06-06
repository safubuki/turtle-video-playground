import { createUseExport } from '../../../hooks/useExport';
import type {
  ExportStrategyId,
  ExportStrategyResolutionInput,
} from '../../../hooks/export-strategies/types';
import { getPlatformCapabilities, type PlatformCapabilities } from '../../../utils/platform';
import { resolveAppleSafariExportAudioSource } from './audioSourceResolver';
import { runIosSafariMediaRecorderStrategy } from './iosSafariMediaRecorder';

export function getAppleSafariExportPlatformCapabilities(
  baseCapabilities: PlatformCapabilities = getPlatformCapabilities(),
): PlatformCapabilities {
  return {
    ...baseCapabilities,
    isAndroid: false,
    isIosSafari: true,
    audioContextMayInterrupt: true,
  };
}

export function resolveAppleSafariExportStrategyOrder(
  input: ExportStrategyResolutionInput,
): ExportStrategyId[] {
  if (input.isIosSafari && input.supportedMediaRecorderProfile) {
    return ['ios-safari-mediarecorder', 'webcodecs-mp4'];
  }

  return ['webcodecs-mp4'];
}

export const useExport = createUseExport({
  getPlatformCapabilities: getAppleSafariExportPlatformCapabilities,
  resolveExportStrategyOrder: resolveAppleSafariExportStrategyOrder,
  resolveExportAudioSource: resolveAppleSafariExportAudioSource,
  runMediaRecorderStrategy: runIosSafariMediaRecorderStrategy,
});