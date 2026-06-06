import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppFlavor } from '../app/resolveAppFlavor';
import type { ProjectPersistenceHealthSnapshot } from '../stores/projectPersistenceHealth';
import type { SaveFailureInfo } from '../stores/projectStore';
import SettingsModal from '../components/modals/SettingsModal';
import SaveLoadModal from '../components/modals/SaveLoadModal';

let autoSaveIntervalValue = 1;

const logStoreState = {
  entries: [],
  hasError: false,
  clearLogs: vi.fn(),
  clearErrorFlag: vi.fn(),
  exportLogs: vi.fn(() => '[]'),
};

const uiStoreState = {
  showToast: vi.fn(),
};

const offlineModeStoreState = {
  offlineMode: false,
  setOfflineMode: vi.fn(),
  hydrateOfflineMode: vi.fn(),
};

const updateStoreState = {
  needRefresh: false,
  offlineReady: false,
  registration: null,
  isCheckingForUpdate: false,
  isApplyingUpdate: false,
  pendingUpdateCheckAfterRegister: false,
  updateServiceWorker: vi.fn(),
  setNeedRefresh: vi.fn(),
  setOfflineReady: vi.fn(),
  setRegistration: vi.fn(),
  checkForUpdate: vi.fn(),
  queueUpdateCheckAfterRegister: vi.fn(),
  clearPendingUpdateCheck: vi.fn(),
  clearUpdateSignals: vi.fn(),
  setUpdateServiceWorker: vi.fn(),
};

const projectStoreState = {
  isSaving: false,
  isLoading: false,
  lastAutoSave: null as string | null,
  lastAutoSaveActivityAt: null as string | null,
  autoSaveRuntimeStatus: 'idle' as 'idle' | 'running' | 'saved' | 'skipped-nochange' | 'skipped-empty' | 'paused-processing' | 'failed',
  autoSaveRestartToken: 0,
  lastManualSave: null as string | null,
  lastSaveFailure: null as SaveFailureInfo | null,
  saveHealth: null as ProjectPersistenceHealthSnapshot | null,
  saveHealthError: null as string | null,
  saveProjectManual: vi.fn(),
  loadProjectFromSlot: vi.fn(),
  deleteAllSaves: vi.fn(),
  deleteAutoSaveOnly: vi.fn(),
  resetSaveDatabase: vi.fn(),
  refreshSaveInfo: vi.fn().mockResolvedValue(undefined),
  refreshSaveHealth: vi.fn().mockResolvedValue(undefined),
  requestAutoSaveRestart: vi.fn(),
  clearLastSaveFailure: vi.fn(),
  clearSaveHealthError: vi.fn(),
};

const mediaStoreState = {
  mediaItems: [] as Array<{ id: string; type: string; file: File }>,
  isClipsLocked: false,
  restoreFromSave: vi.fn(),
};

const audioStoreState = {
  bgm: null,
  isBgmLocked: false,
  narrations: [],
  isNarrationLocked: false,
  restoreFromSave: vi.fn(),
};

const captionStoreState = {
  captions: [] as Array<Record<string, unknown>>,
  settings: {} as Record<string, unknown>,
  isLocked: false,
  restoreFromSave: vi.fn(),
};

const saveLoadLogState = {
  info: vi.fn(),
  error: vi.fn(),
};

const saveRuntime = {
  configureProjectStore: vi.fn(),
  getPlatformCapabilities: vi.fn(() => ({
    userAgent: 'test-agent',
    platform: 'test-platform',
    maxTouchPoints: 0,
    isAndroid: false,
    isIOS: false,
    isSafari: false,
    isIosSafari: false,
    supportsShowSaveFilePicker: false,
    supportsShowOpenFilePicker: false,
    supportsTrackProcessor: false,
    supportsMp4MediaRecorder: false,
    audioContextMayInterrupt: false,
    supportedMediaRecorderProfile: null,
  })),
  saveBlobWithClientFileStrategy: vi.fn(),
  getPersistenceHealth: vi.fn().mockResolvedValue(null),
};

const defaultAppFlavor: AppFlavor = 'standard';

vi.mock('../stores', () => ({
  useLogStore: (selector: (state: typeof logStoreState) => unknown) => selector(logStoreState),
}));

vi.mock('../stores/uiStore', () => ({
  useUIStore: (selector: (state: typeof uiStoreState) => unknown) => selector(uiStoreState),
}));

vi.mock('../stores/offlineModeStore', () => ({
  useOfflineModeStore: (selector: (state: typeof offlineModeStoreState) => unknown) => selector(offlineModeStoreState),
}));

vi.mock('../stores/updateStore', () => ({
  useUpdateStore: (selector?: (state: typeof updateStoreState) => unknown) =>
    selector ? selector(updateStoreState) : updateStoreState,
}));

vi.mock('../stores/projectStore', () => {
  const store = Object.assign(
    () => projectStoreState,
    {
      getState: () => projectStoreState,
    },
  );

  return {
    useProjectStore: store,
    isStorageQuotaError: () => false,
    getProjectStoreErrorMessage: () => 'error',
  };
});

vi.mock('../stores/mediaStore', () => ({
  useMediaStore: (selector: (state: typeof mediaStoreState) => unknown) => selector(mediaStoreState),
}));

vi.mock('../stores/audioStore', () => ({
  useAudioStore: (selector: (state: typeof audioStoreState) => unknown) => selector(audioStoreState),
}));

vi.mock('../stores/captionStore', () => ({
  useCaptionStore: (selector: (state: typeof captionStoreState) => unknown) => selector(captionStoreState),
}));

vi.mock('../stores/logStore', () => {
  const store = Object.assign(
    () => saveLoadLogState,
    {
      getState: () => saveLoadLogState,
    },
  );

  return { useLogStore: store };
});

vi.mock('../hooks/useAutoSave', () => ({
  getAutoSaveInterval: vi.fn(() => autoSaveIntervalValue),
  setAutoSaveInterval: vi.fn(),
}));

vi.mock('../hooks/useDisableBodyScroll', () => ({
  useDisableBodyScroll: () => {},
}));

vi.mock('../utils/fileSave', () => ({
  saveBlobWithClientFileStrategy: vi.fn(),
}));

vi.mock('../utils/platform', () => ({
  getPlatformCapabilities: () => ({
    supportsShowSaveFilePicker: false,
    supportsShowOpenFilePicker: false,
  }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  projectStoreState.isSaving = false;
  projectStoreState.isLoading = false;
  projectStoreState.lastAutoSave = null;
  projectStoreState.lastAutoSaveActivityAt = null;
  projectStoreState.autoSaveRuntimeStatus = 'idle';
  projectStoreState.lastManualSave = null;
  projectStoreState.lastSaveFailure = null;
  projectStoreState.saveHealth = null;
  projectStoreState.saveHealthError = null;
  projectStoreState.requestAutoSaveRestart.mockReset();
  projectStoreState.resetSaveDatabase.mockReset();
  projectStoreState.clearLastSaveFailure.mockReset();
  projectStoreState.clearSaveHealthError.mockReset();
  projectStoreState.refreshSaveInfo.mockReset();
  projectStoreState.refreshSaveHealth.mockReset();
  projectStoreState.saveProjectManual.mockReset();
  saveRuntime.configureProjectStore.mockReset();
  saveRuntime.getPlatformCapabilities.mockClear();
  saveRuntime.saveBlobWithClientFileStrategy.mockReset();
  saveRuntime.getPersistenceHealth.mockReset();
  autoSaveIntervalValue = 1;
  mediaStoreState.mediaItems = [];
  captionStoreState.captions = [];
});

describe('modal history stability', () => {
  it('SettingsModal は親の再描画で history.back を呼ばない', () => {
    const backSpy = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    const { rerender, unmount } = render(<SettingsModal appFlavor={defaultAppFlavor} isOpen={true} onClose={() => {}} />);

    rerender(<SettingsModal appFlavor={defaultAppFlavor} isOpen={true} onClose={() => undefined} />);

    expect(backSpy).not.toHaveBeenCalled();

    unmount();
    backSpy.mockRestore();
  });

  it('SaveLoadModal は自動保存間隔変更後の親再描画で history.back を呼ばない', () => {
    const backSpy = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    const { rerender, unmount, getByRole } = render(
      <SaveLoadModal
        isOpen={true}
        onClose={() => {}}
        onToast={() => {}}
        appFlavor={defaultAppFlavor}
        saveRuntime={saveRuntime}
      />,
    );

    fireEvent.click(getByRole('button', { name: '1分' }));
    rerender(
      <SaveLoadModal
        isOpen={true}
        onClose={() => undefined}
        onToast={() => undefined}
        appFlavor={defaultAppFlavor}
        saveRuntime={saveRuntime}
      />,
    );

    expect(backSpy).not.toHaveBeenCalled();

    unmount();
    backSpy.mockRestore();
  });

  it('SaveLoadModal は保存失敗後に DB 初期化リトライ導線へ遷移できる', async () => {
    mediaStoreState.mediaItems = [
      {
        id: 'media-1',
        type: 'image',
        file: new File(['dummy'], 'dummy.png', { type: 'image/png' }),
      },
    ];
    projectStoreState.lastSaveFailure = {
      operationId: 'manual-save-test-00001',
      operation: 'manual',
      category: 'indexeddb-transaction',
      reason: 'AbortError: transaction aborted',
      occurredAt: '2026-03-17T00:00:00.000Z',
      recoveryAction: 'reset-database-and-retry',
      storageEstimate: null,
      persistenceMode: null,
      launchContext: null,
    };
    projectStoreState.saveProjectManual
      .mockRejectedValueOnce(new Error('AbortError: transaction aborted'))
      .mockResolvedValueOnce(undefined);
    projectStoreState.refreshSaveInfo.mockResolvedValue(undefined);
    projectStoreState.resetSaveDatabase.mockResolvedValue(undefined);

    const onClose = vi.fn();
    const onToast = vi.fn();
    const { findByText, getByRole } = render(
      <SaveLoadModal
        isOpen={true}
        onClose={onClose}
        onToast={onToast}
        appFlavor={defaultAppFlavor}
        saveRuntime={saveRuntime}
      />,
    );

    fireEvent.click(getByRole('button', { name: '手動保存' }));

    await findByText('保存DBの復旧');

    fireEvent.click(getByRole('button', { name: '初期化して保存' }));

    await vi.waitFor(() => {
      expect(projectStoreState.resetSaveDatabase).toHaveBeenCalledTimes(1);
      expect(projectStoreState.saveProjectManual).toHaveBeenCalledTimes(2);
      expect(onToast).toHaveBeenCalledWith('保存しました', 'success');
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it('SaveLoadModal は表示中に相対時刻表示を更新し、将来時刻は「たった今」に丸める', async () => {
    vi.useFakeTimers();
    autoSaveIntervalValue = 5;
    vi.setSystemTime(new Date('2026-03-24T12:00:00.000Z'));
    projectStoreState.lastAutoSave = '2026-03-24T11:59:10.000Z';
    projectStoreState.lastAutoSaveActivityAt = '2026-03-24T11:59:10.000Z';
    projectStoreState.lastManualSave = '2026-03-24T12:10:00.000Z';

    const { getAllByText } = render(
      <SaveLoadModal
        isOpen={true}
        onClose={() => {}}
        onToast={() => {}}
        appFlavor={defaultAppFlavor}
        saveRuntime={saveRuntime}
      />,
    );

    expect(getAllByText('たった今').length).toBeGreaterThanOrEqual(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(150_000);
    });

    expect(getAllByText('3分前').length).toBeGreaterThanOrEqual(1);
    expect(getAllByText('たった今').length).toBeGreaterThanOrEqual(1);

    vi.useRealTimers();
  });

  it('SaveLoadModal は自動保存の活動時刻と前回保存日時を分けて表示し、停止疑い時は再始動できる', () => {
    vi.useFakeTimers();
    autoSaveIntervalValue = 5;
    vi.setSystemTime(new Date('2026-03-24T12:00:00.000Z'));
    projectStoreState.lastAutoSave = '2026-03-24T11:50:00.000Z';
    projectStoreState.lastAutoSaveActivityAt = '2026-03-24T11:58:00.000Z';
    projectStoreState.autoSaveRuntimeStatus = 'skipped-nochange';

    const { getByText, rerender, getByRole } = render(
      <SaveLoadModal
        isOpen={true}
        onClose={() => {}}
        onToast={() => {}}
        appFlavor={defaultAppFlavor}
        saveRuntime={saveRuntime}
      />,
    );

    expect(getByText('2分前')).toBeTruthy();
    const expectedLastAutoSaveText = new Date(
      projectStoreState.lastAutoSave as string,
    ).toLocaleString('ja-JP', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    expect(
      getByText(
        new RegExp(
          `前回保存日時: ${expectedLastAutoSaveText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
        ),
      ),
    ).toBeTruthy();

    projectStoreState.lastAutoSaveActivityAt = '2026-03-24T11:54:00.000Z';

    rerender(
      <SaveLoadModal
        isOpen={true}
        onClose={() => {}}
        onToast={() => {}}
        appFlavor={defaultAppFlavor}
        saveRuntime={saveRuntime}
      />,
    );

    expect(getByText('要確認')).toBeTruthy();

    fireEvent.click(getByRole('button', { name: '自動保存を再始動' }));

    expect(projectStoreState.requestAutoSaveRestart).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('SaveLoadModal は apple-safari flavor で Safari 向け保存案内を表示する', () => {
    const { getByLabelText, getByText } = render(
      <SaveLoadModal
        isOpen={true}
        onClose={() => {}}
        onToast={() => {}}
        appFlavor="apple-safari"
        saveRuntime={saveRuntime}
      />,
    );

    fireEvent.click(getByLabelText('保存・素材の説明'));

    expect(getByText('Apple Safari 動作モード')).toBeTruthy();
    expect(getByText(/通常タブ、ホーム画面追加、プライベートブラウズ/)).toBeTruthy();
  });
});
