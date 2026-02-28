import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CaptionSettings } from '../../types';

const mocks = vi.hoisted(() => ({
  saveProject: vi.fn(),
  loadProject: vi.fn(),
  deleteProject: vi.fn(),
  deleteAllProjects: vi.fn(),
  getProjectsInfo: vi.fn(),
  fileToArrayBuffer: vi.fn(),
  blobUrlToArrayBuffer: vi.fn(),
  arrayBufferToFile: vi.fn(),
}));

vi.mock('../../utils/indexedDB', () => ({
  saveProject: mocks.saveProject,
  loadProject: mocks.loadProject,
  deleteProject: mocks.deleteProject,
  deleteAllProjects: mocks.deleteAllProjects,
  getProjectsInfo: mocks.getProjectsInfo,
  fileToArrayBuffer: mocks.fileToArrayBuffer,
  blobUrlToArrayBuffer: mocks.blobUrlToArrayBuffer,
  arrayBufferToFile: mocks.arrayBufferToFile,
}));

import { useProjectStore, isStorageQuotaError } from '../../stores/projectStore';

const defaultCaptionSettings: CaptionSettings = {
  enabled: true,
  fontSize: 'medium',
  fontStyle: 'gothic',
  fontColor: '#FFFFFF',
  strokeColor: '#000000',
  strokeWidth: 2,
  position: 'bottom',
  blur: 0,
  bulkFadeIn: false,
  bulkFadeOut: false,
  bulkFadeInDuration: 0.5,
  bulkFadeOutDuration: 0.5,
};

describe('projectStore save behavior', () => {
  beforeEach(() => {
    mocks.saveProject.mockReset();
    mocks.loadProject.mockReset();
    mocks.deleteProject.mockReset();
    mocks.deleteAllProjects.mockReset();
    mocks.getProjectsInfo.mockReset();
    mocks.fileToArrayBuffer.mockReset();
    mocks.blobUrlToArrayBuffer.mockReset();
    mocks.arrayBufferToFile.mockReset();

    mocks.getProjectsInfo.mockResolvedValue({ auto: null, manual: null });
    mocks.fileToArrayBuffer.mockResolvedValue(new ArrayBuffer(0));
    mocks.blobUrlToArrayBuffer.mockResolvedValue(new ArrayBuffer(0));
    mocks.arrayBufferToFile.mockImplementation((buffer: ArrayBuffer, fileName: string, fileType: string) =>
      new File([buffer], fileName, { type: fileType })
    );

    useProjectStore.setState({
      isSaving: false,
      isLoading: false,
      lastAutoSave: '2026-02-17T00:00:00.000Z',
      lastManualSave: null,
      autoSaveError: null,
    });
  });

  it('手動保存で容量不足の場合は失敗を返し、自動保存は勝手に削除しない', async () => {
    mocks.saveProject.mockRejectedValueOnce(
      new Error('プロジェクトの保存に失敗しました (QuotaExceededError: storage full)')
    );

    await expect(
      useProjectStore.getState().saveProjectManual(
        [],
        false,
        null,
        false,
        [],
        false,
        [],
        defaultCaptionSettings,
        false
      )
    ).rejects.toThrow('QuotaExceededError');

    expect(mocks.saveProject).toHaveBeenCalledTimes(1);
    expect(mocks.deleteProject).not.toHaveBeenCalled();
    expect(useProjectStore.getState().lastAutoSave).toBe('2026-02-17T00:00:00.000Z');
  });

  it('容量不足以外の手動保存失敗では再試行しない', async () => {
    mocks.saveProject.mockRejectedValueOnce(new Error('保存に失敗'));

    await expect(
      useProjectStore.getState().saveProjectManual(
        [],
        false,
        null,
        false,
        [],
        false,
        [],
        defaultCaptionSettings,
        false
      )
    ).rejects.toThrow('保存に失敗');

    expect(mocks.saveProject).toHaveBeenCalledTimes(1);
    expect(mocks.deleteProject).not.toHaveBeenCalled();
  });

  it('容量不足判定ヘルパーがクォータ超過を検知する', () => {
    expect(isStorageQuotaError(new Error('QuotaExceededError'))).toBe(true);
    expect(isStorageQuotaError(new Error('storage is full'))).toBe(true);
    expect(isStorageQuotaError(new Error('network error'))).toBe(false);
  });

  it('deleteAutoSaveOnlyはautoだけ削除しmanualは保持する', async () => {
    mocks.deleteProject.mockResolvedValue(undefined);

    useProjectStore.setState({
      lastAutoSave: '2026-02-17T00:00:00.000Z',
      lastManualSave: '2026-02-17T01:00:00.000Z',
    });

    await useProjectStore.getState().deleteAutoSaveOnly();

    expect(mocks.deleteProject).toHaveBeenCalledWith('auto');
    expect(useProjectStore.getState().lastAutoSave).toBeNull();
    expect(useProjectStore.getState().lastManualSave).toBe('2026-02-17T01:00:00.000Z');
  });
});
