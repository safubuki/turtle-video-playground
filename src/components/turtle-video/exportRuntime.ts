import type { UseExportReturn } from '../../hooks/useExport';

export interface ExportRuntime {
  useExport: () => UseExportReturn;
  getLaunchDiagnostics?: () => Record<string, unknown>;
}
