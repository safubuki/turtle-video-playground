import { createUseExport } from '../../../hooks/useExport';
import type {
  ExportStrategyId,
  ExportStrategyResolutionInput,
} from '../../../hooks/export-strategies/types';
import { getPlatformCapabilities, type PlatformCapabilities } from '../../../utils/platform';

export function getStandardExportPlatformCapabilities(
  baseCapabilities: PlatformCapabilities = getPlatformCapabilities(),
): PlatformCapabilities {
  return {
    ...baseCapabilities,
    isIosSafari: false,
    supportsMp4MediaRecorder: false,
    supportedMediaRecorderProfile: null,
    audioContextMayInterrupt: false,
  };
}

export function resolveStandardExportStrategyOrder(
  _input: ExportStrategyResolutionInput,
): ExportStrategyId[] {
  return ['webcodecs-mp4'];
}

export const useExport = createUseExport({
  getPlatformCapabilities: getStandardExportPlatformCapabilities,
  resolveExportStrategyOrder: resolveStandardExportStrategyOrder,
});