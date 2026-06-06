export type ProjectPersistenceMode = 'persistent' | 'best-effort' | 'unavailable';

export type ProjectLaunchContext = 'browser-tab' | 'standalone' | 'unknown';

export interface ProjectStorageEstimateDetails {
  usage: number;
  quota: number;
  usageRatio: number | null;
}

export interface ProjectPersistenceHealthSnapshot {
  checkedAt: string;
  persistenceMode: ProjectPersistenceMode;
  launchContext: ProjectLaunchContext;
  storageEstimate: ProjectStorageEstimateDetails | null;
  supportsStorageEstimate: boolean;
  supportsPersistApi: boolean;
  warnings: string[];
  summary: string;
}

export function toProjectStorageEstimateDetails(
  estimate: { usage: number; quota: number } | null,
): ProjectStorageEstimateDetails | null {
  if (!estimate) {
    return null;
  }

  const usage = Math.max(0, estimate.usage || 0);
  const quota = Math.max(0, estimate.quota || 0);
  return {
    usage,
    quota,
    usageRatio: quota > 0 ? usage / quota : null,
  };
}
