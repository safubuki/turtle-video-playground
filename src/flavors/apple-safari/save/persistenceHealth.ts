import type {
  ProjectLaunchContext,
  ProjectPersistenceHealthSnapshot,
  ProjectPersistenceMode,
} from '../../../stores/projectPersistenceHealth';
import { toProjectStorageEstimateDetails } from '../../../stores/projectPersistenceHealth';

type NavigatorWithStandalone = Navigator & {
  standalone?: boolean;
};

type StorageManagerLike = {
  estimate?: () => Promise<{ usage?: number; quota?: number }>;
  persist?: () => Promise<boolean>;
  persisted?: () => Promise<boolean>;
};

function getStorageManager(): StorageManagerLike | null {
  if (typeof navigator === 'undefined') {
    return null;
  }

  return (navigator.storage as StorageManagerLike | undefined) ?? null;
}

export function getAppleSafariLaunchContext(): ProjectLaunchContext {
  if (typeof window === 'undefined') {
    return 'unknown';
  }

  const nav = navigator as NavigatorWithStandalone;
  if (nav.standalone === true) {
    return 'standalone';
  }

  if (typeof window.matchMedia === 'function') {
    try {
      if (window.matchMedia('(display-mode: standalone)').matches) {
        return 'standalone';
      }
    } catch {
      // ignore matchMedia errors
    }
  }

  return 'browser-tab';
}

async function getPersistenceMode(storage: StorageManagerLike | null): Promise<ProjectPersistenceMode> {
  if (!storage) {
    return 'unavailable';
  }

  if (typeof storage.persisted === 'function') {
    try {
      const persisted = await storage.persisted();
      if (persisted) {
        return 'persistent';
      }
    } catch {
      // ignore persisted errors
    }
  }

  if (typeof storage.persist === 'function') {
    try {
      const persisted = await storage.persist();
      return persisted ? 'persistent' : 'best-effort';
    } catch {
      return 'best-effort';
    }
  }

  return 'best-effort';
}

async function getStorageEstimate(storage: StorageManagerLike | null): Promise<{ usage: number; quota: number } | null> {
  if (!storage || typeof storage.estimate !== 'function') {
    return null;
  }

  try {
    const estimate = await storage.estimate();
    return {
      usage: estimate.usage ?? 0,
      quota: estimate.quota ?? 0,
    };
  } catch {
    return null;
  }
}

function buildSummary(params: {
  persistenceMode: ProjectPersistenceMode;
  launchContext: ProjectLaunchContext;
}): string {
  const launchLabel = params.launchContext === 'standalone'
    ? 'ホーム画面追加'
    : params.launchContext === 'browser-tab'
      ? '通常タブ'
      : '不明';

  if (params.persistenceMode === 'persistent') {
    return `${launchLabel}起動で保存状態を確認しました。永続化要求は許可済みです。`;
  }

  if (params.persistenceMode === 'best-effort') {
    return `${launchLabel}起動で保存状態を確認しました。Safari は best-effort 保存として扱われます。`;
  }

  return `${launchLabel}起動で保存状態を確認しました。StorageManager の永続化情報は取得できませんでした。`;
}

export async function collectAppleSafariPersistenceHealth(): Promise<ProjectPersistenceHealthSnapshot> {
  const storage = getStorageManager();
  const launchContext = getAppleSafariLaunchContext();
  const persistenceMode = await getPersistenceMode(storage);
  const storageEstimate = toProjectStorageEstimateDetails(await getStorageEstimate(storage));
  const warnings: string[] = [];

  if (launchContext === 'standalone') {
    warnings.push('ホーム画面追加で起動した保存領域は、通常タブと別扱いになる場合があります。');
  }

  if (persistenceMode === 'best-effort') {
    warnings.push('Safari は best-effort 保存のため、OS やブラウザの判断で保存領域が整理される場合があります。');
  }

  if (persistenceMode === 'unavailable') {
    warnings.push('この環境では StorageManager の永続化情報を取得できません。');
  }

  return {
    checkedAt: new Date().toISOString(),
    persistenceMode,
    launchContext,
    storageEstimate,
    supportsStorageEstimate: !!storage && typeof storage.estimate === 'function',
    supportsPersistApi: !!storage && typeof storage.persist === 'function',
    warnings,
    summary: buildSummary({ persistenceMode, launchContext }),
  };
}
