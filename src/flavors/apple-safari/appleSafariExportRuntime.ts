import type { ExportRuntime } from '../../components/turtle-video/exportRuntime';
import { collectAppleSafariWebCodecsSupportSnapshot } from './export/webCodecsSupport';
import { useExport } from './export/useExport';

export {
  getAppleSafariExportPlatformCapabilities,
  resolveAppleSafariExportStrategyOrder,
} from './export/useExport';
export { collectAppleSafariWebCodecsSupportSnapshot } from './export/webCodecsSupport';

export const appleSafariExportRuntime: ExportRuntime = {
  useExport,
  getLaunchDiagnostics: () => ({
    runtime: 'apple-safari-export',
    webCodecsSupport: collectAppleSafariWebCodecsSupportSnapshot(),
  }),
};
