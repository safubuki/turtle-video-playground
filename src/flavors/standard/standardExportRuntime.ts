import type { ExportRuntime } from '../../components/turtle-video/exportRuntime';
import { useExport } from './export/useExport';

export {
  getStandardExportPlatformCapabilities,
  resolveStandardExportStrategyOrder,
} from './export/useExport';

export const standardExportRuntime: ExportRuntime = {
  useExport,
};