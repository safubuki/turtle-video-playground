import { createDiagnosticId } from '../../../utils/diagnostics';

let activePreviewSessionId: string | null = null;

export function beginAppleSafariPreviewSession(prefix: 'preview' | 'export'): string {
  activePreviewSessionId = createDiagnosticId(`apple-safari-${prefix}`);
  return activePreviewSessionId;
}

export function getAppleSafariPreviewSessionId(): string | null {
  return activePreviewSessionId;
}

export function getAppleSafariPreviewDiagnosticDetails(details?: Record<string, unknown>): Record<string, unknown> {
  if (!activePreviewSessionId) {
    return details ?? {};
  }

  return {
    previewSessionId: activePreviewSessionId,
    ...(details ?? {}),
  };
}
