import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AudioTrack, CaptionSettings, MediaItem, NarrationClip } from '../../types';
import type { ProjectPersistenceHealthSnapshot } from '../../stores/projectPersistenceHealth';

const mocks = vi.hoisted(() => ({
  saveProject: vi.fn(),
  loadProject: vi.fn(),
  deleteProject: vi.fn(),
  deleteAllProjects: vi.fn(),
  resetProjectDatabase: vi.fn(),
  getProjectsInfo: vi.fn(),
  getStorageEstimate: vi.fn(),
  fileToArrayBuffer: vi.fn(),
  blobUrlToArrayBuffer: vi.fn(),
  arrayBufferToFile: vi.fn(),
}));

vi.mock('../../utils/indexedDB', () => ({
  saveProject: mocks.saveProject,
  loadProject: mocks.loadProject,
  deleteProject: mocks.deleteProject,
  deleteAllProjects: mocks.deleteAllProjects,
  resetProjectDatabase: mocks.resetProjectDatabase,
  getProjectsInfo: mocks.getProjectsInfo,
  getStorageEstimate: mocks.getStorageEstimate,
  fileToArrayBuffer: mocks.fileToArrayBuffer,
  blobUrlToArrayBuffer: mocks.blobUrlToArrayBuffer,
  arrayBufferToFile: mocks.arrayBufferToFile,
}));

import { useProjectStore, isStorageQuotaError } from '../../stores/projectStore';
import {
  createIndexedDbProjectPersistenceAdapter,
  setProjectPersistenceAdapter,
  type ProjectData,
  type ProjectPersistenceAdapter,
} from '../../stores/projectPersistence';
import { appleSafariSaveRuntime } from '../../flavors/apple-safari/appleSafariSaveRuntime';
import { standardSaveRuntime } from '../../flavors/standard/standardSaveRuntime';

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

function createCaption(id = 'caption-1') {
  return {
    id,
    text: 'sample',
    startTime: 0,
    endTime: 1,
    fadeIn: false,
    fadeOut: false,
    fadeInDuration: 0.5,
    fadeOutDuration: 0.5,
  };
}

function createMediaItem(fileName: string, type: 'video' | 'image' = 'video'): MediaItem {
  const fileType = type === 'video' ? 'video/mp4' : 'image/png';
  return {
    id: `${type}-${fileName}`,
    file: new File(['dummy'], fileName, { type: fileType }),
    fileData: undefined,
    type,
    url: `blob:${fileName}`,
    volume: 1,
    isMuted: false,
    fadeIn: false,
    fadeOut: false,
    fadeInDuration: 1,
    fadeOutDuration: 1,
    duration: type === 'image' ? 5 : 10,
    originalDuration: type === 'image' ? 5 : 10,
    trimStart: 0,
    trimEnd: type === 'image' ? 5 : 10,
    scale: 1,
    positionX: 0,
    positionY: 0,
    isTransformOpen: false,
    isLocked: false,
  };
}

function createAudioTrack(fileName = 'bgm.mp3', overrides: Partial<AudioTrack> = {}): AudioTrack {
  return {
    file: overrides.file ?? new File(['bgm'], fileName, { type: 'audio/mpeg' }),
    url: overrides.url ?? `blob:${fileName}`,
    blobUrl: overrides.blobUrl,
    startPoint: overrides.startPoint ?? 0,
    delay: overrides.delay ?? 0,
    volume: overrides.volume ?? 1,
    fadeIn: overrides.fadeIn ?? false,
    fadeOut: overrides.fadeOut ?? false,
    fadeInDuration: overrides.fadeInDuration ?? 0.5,
    fadeOutDuration: overrides.fadeOutDuration ?? 0.5,
    duration: overrides.duration ?? 12,
    isAi: overrides.isAi ?? false,
  };
}

function createNarrationClip(id: string, overrides: Partial<NarrationClip> = {}): NarrationClip {
  const duration = overrides.duration ?? 4;
  return {
    id,
    sourceType: overrides.sourceType ?? 'file',
    file: overrides.file ?? new File(['narration'], `${id}.wav`, { type: 'audio/wav' }),
    url: overrides.url ?? `blob:${id}`,
    blobUrl: overrides.blobUrl,
    startTime: overrides.startTime ?? 0,
    volume: overrides.volume ?? 1,
    isMuted: overrides.isMuted ?? false,
    trimStart: overrides.trimStart ?? 0,
    trimEnd: overrides.trimEnd ?? duration,
    duration,
    isAiEditable: overrides.isAiEditable ?? false,
    aiScript: overrides.aiScript,
    aiVoice: overrides.aiVoice,
    aiVoiceStyle: overrides.aiVoiceStyle,
  };
}

describe('projectStore save behavior', () => {
  beforeEach(() => {
    setProjectPersistenceAdapter(createIndexedDbProjectPersistenceAdapter());

    mocks.saveProject.mockReset();
    mocks.loadProject.mockReset();
    mocks.deleteProject.mockReset();
    mocks.deleteAllProjects.mockReset();
    mocks.resetProjectDatabase.mockReset();
    mocks.getProjectsInfo.mockReset();
    mocks.getStorageEstimate.mockReset();
    mocks.fileToArrayBuffer.mockReset();
    mocks.blobUrlToArrayBuffer.mockReset();
    mocks.arrayBufferToFile.mockReset();

    mocks.getProjectsInfo.mockResolvedValue({ auto: null, manual: null });
    mocks.getStorageEstimate.mockResolvedValue(null);
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
      lastSaveFailure: null,
      saveHealth: null,
      saveHealthError: null,
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
    expect(useProjectStore.getState().lastSaveFailure?.category).toBe('storage-quota');
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

  it('generic な IndexedDB 失敗でも auto save がある間は削除リカバリを提案する', async () => {
    mocks.saveProject.mockRejectedValueOnce(
      new Error('プロジェクトの保存に失敗しました (AbortError: transaction aborted)')
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
    ).rejects.toThrow('AbortError');

    expect(useProjectStore.getState().lastSaveFailure?.recoveryAction).toBe('delete-auto-and-retry');
  });

  it('メディアの File 読み込み失敗時は url フォールバックで保存を継続する', async () => {
    const mediaItems = [createMediaItem('clip-1.mp4', 'video')];

    mocks.fileToArrayBuffer.mockRejectedValueOnce(new Error('ファイルの読み込みに失敗しました'));
    mocks.blobUrlToArrayBuffer.mockResolvedValueOnce(new ArrayBuffer(8));

    await expect(
      useProjectStore.getState().saveProjectManual(
        mediaItems,
        false,
        null,
        false,
        [],
        false,
        [],
        defaultCaptionSettings,
        false
      )
    ).resolves.toBeUndefined();

    expect(mocks.blobUrlToArrayBuffer).toHaveBeenCalledWith(mediaItems[0].url);
    expect(mocks.saveProject).toHaveBeenCalledTimes(1);
    expect(useProjectStore.getState().lastSaveFailure).toBeNull();
  });

  it('旧データ互換で fileData がなければ File 読み込みを優先する', async () => {
    const mediaItems = [createMediaItem('file-first.mp4', 'video')];
    const fileData = new ArrayBuffer(12);
    mocks.fileToArrayBuffer.mockResolvedValueOnce(fileData);

    await expect(
      useProjectStore.getState().saveProjectManual(
        mediaItems,
        false,
        null,
        false,
        [],
        false,
        [],
        defaultCaptionSettings,
        false
      )
    ).resolves.toBeUndefined();

    expect(mocks.fileToArrayBuffer).toHaveBeenCalledWith(mediaItems[0].file);
    expect(mocks.blobUrlToArrayBuffer).not.toHaveBeenCalled();
    const savedProjectData = mocks.saveProject.mock.calls[0][0] as ProjectData;
    expect(savedProjectData.mediaItems[0].fileData).toBe(fileData);
  });

  it('メディアに fileData があれば File/url 再読み込みなしで保存する', async () => {
    const fileData = new TextEncoder().encode('stable-media').buffer as ArrayBuffer;
    const mediaItems = [{
      ...createMediaItem('stable.mp4', 'video'),
      fileData,
    }];

    mocks.fileToArrayBuffer.mockRejectedValue(new Error('should not read file'));
    mocks.blobUrlToArrayBuffer.mockRejectedValue(new Error('should not read url'));

    await expect(
      useProjectStore.getState().saveProjectManual(
        mediaItems,
        false,
        null,
        false,
        [],
        false,
        [],
        defaultCaptionSettings,
        false
      )
    ).resolves.toBeUndefined();

    expect(mocks.fileToArrayBuffer).not.toHaveBeenCalled();
    expect(mocks.blobUrlToArrayBuffer).not.toHaveBeenCalled();
    expect(mocks.saveProject).toHaveBeenCalledTimes(1);
    const savedProjectData = mocks.saveProject.mock.calls[0][0] as ProjectData;
    expect(savedProjectData.mediaItems[0].fileData).toBe(fileData);
  });

  it('素材名付きの読み込み失敗を保持して inspect-media を提案する', async () => {
    const mediaItems = [createMediaItem('broken.mp4', 'video')];

    mocks.fileToArrayBuffer.mockRejectedValueOnce(new Error('ファイルの読み込みに失敗しました'));
    mocks.blobUrlToArrayBuffer.mockRejectedValueOnce(new Error('Failed to fetch'));

    await expect(
      useProjectStore.getState().saveProjectManual(
        mediaItems,
        false,
        null,
        false,
        [],
        false,
        [],
        defaultCaptionSettings,
        false
      )
    ).rejects.toThrow('メディア「broken.mp4」');

    expect(mocks.saveProject).not.toHaveBeenCalled();
    expect(useProjectStore.getState().lastSaveFailure?.recoveryAction).toBe('inspect-media');
    expect(useProjectStore.getState().lastSaveFailure?.category).toBe('media-serialization');
    expect(useProjectStore.getState().lastSaveFailure?.reason).toContain('broken.mp4');
  });

  it('保存と読込の往復でメディアの元ファイル名を維持する', async () => {
    const mediaItems = [createMediaItem('original-name.mp4', 'video')];
    mocks.saveProject.mockResolvedValue(undefined);

    await useProjectStore.getState().saveProjectManual(
      mediaItems,
      false,
      null,
      false,
      [],
      false,
      [],
      defaultCaptionSettings,
      false
    );

    expect(mocks.saveProject).toHaveBeenCalledTimes(1);
    const savedProjectData = mocks.saveProject.mock.calls[0][0] as { mediaItems: Array<{ fileName: string; fileData: ArrayBuffer }> };
    expect(savedProjectData.mediaItems[0].fileName).toBe('original-name.mp4');

    mocks.loadProject.mockResolvedValue(savedProjectData);

    const loaded = await useProjectStore.getState().loadProjectFromSlot('manual');

    if (!loaded) {
      throw new Error('loaded project was null');
    }
    expect(loaded.mediaItems[0].file.name).toBe('original-name.mp4');
    expect(loaded.mediaItems[0].fileData).toBe(savedProjectData.mediaItems[0].fileData);
  });

  it('resetSaveDatabase は保存情報と失敗状態を初期化する', async () => {
    mocks.resetProjectDatabase.mockResolvedValue(undefined);

    useProjectStore.setState({
      lastAutoSave: '2026-02-17T00:00:00.000Z',
      lastManualSave: '2026-02-17T01:00:00.000Z',
      autoSaveError: '保存失敗',
      lastSaveFailure: {
        operationId: 'manual-save-test-00001',
        operation: 'manual',
        category: 'indexeddb-transaction',
        reason: 'AbortError',
        occurredAt: '2026-03-17T00:00:00.000Z',
        recoveryAction: 'reset-database-and-retry',
        storageEstimate: null,
        persistenceMode: null,
        launchContext: null,
      },
    });

    await useProjectStore.getState().resetSaveDatabase();

    expect(mocks.resetProjectDatabase).toHaveBeenCalledTimes(1);
    expect(useProjectStore.getState().lastAutoSave).toBeNull();
    expect(useProjectStore.getState().lastManualSave).toBeNull();
    expect(useProjectStore.getState().autoSaveError).toBeNull();
    expect(useProjectStore.getState().lastSaveFailure).toBeNull();
  });

  it('注入した persistence adapter を通して保存処理を実行できる', async () => {
    const customSaveProject = vi.fn().mockResolvedValue(undefined);
    const customPersistence: ProjectPersistenceAdapter = {
      saveProject: customSaveProject,
      loadProject: vi.fn().mockResolvedValue(null),
      deleteProject: vi.fn().mockResolvedValue(undefined),
      deleteAllProjects: vi.fn().mockResolvedValue(undefined),
      resetProjectDatabase: vi.fn().mockResolvedValue(undefined),
      getProjectsInfo: vi.fn().mockResolvedValue({ auto: null, manual: null }),
      getStorageEstimate: vi.fn().mockResolvedValue(null),
      fileToArrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
      blobUrlToArrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
      arrayBufferToFile: vi.fn().mockImplementation((buffer: ArrayBuffer, fileName: string, fileType: string) =>
        new File([buffer], fileName, { type: fileType })
      ),
    };

    setProjectPersistenceAdapter(customPersistence);

    await useProjectStore.getState().saveProjectManual(
      [createMediaItem('adapter-check.mp4')],
      false,
      null,
      false,
      [],
      false,
      [],
      defaultCaptionSettings,
      false,
    );

    expect(customSaveProject).toHaveBeenCalledTimes(1);
    expect(mocks.saveProject).not.toHaveBeenCalled();
  });

  it('refreshSaveHealth は loader の結果を保存する', async () => {
    const health: ProjectPersistenceHealthSnapshot = {
      checkedAt: '2026-04-14T00:00:00.000Z',
      persistenceMode: 'best-effort',
      launchContext: 'browser-tab',
      storageEstimate: {
        usage: 128,
        quota: 1024,
        usageRatio: 0.125,
      },
      supportsStorageEstimate: true,
      supportsPersistApi: true,
      warnings: ['Safari は best-effort 保存です。'],
      summary: '通常タブ起動で保存状態を確認しました。Safari は best-effort 保存として扱われます。',
    };

    await useProjectStore.getState().refreshSaveHealth(async () => health);

    expect(useProjectStore.getState().saveHealth).toEqual(health);
    expect(useProjectStore.getState().saveHealthError).toBeNull();
  });

  it('refreshSaveHealth は loader 失敗時にエラーを保持する', async () => {
    await useProjectStore.getState().refreshSaveHealth(async () => {
      throw new Error('health check failed');
    });

    expect(useProjectStore.getState().saveHealth).toBeNull();
    expect(useProjectStore.getState().saveHealthError).toContain('health check failed');
  });

  it('保存失敗に save health 文脈と operationId を残す', async () => {
    const health: ProjectPersistenceHealthSnapshot = {
      checkedAt: '2026-04-14T00:00:00.000Z',
      persistenceMode: 'best-effort',
      launchContext: 'browser-tab',
      storageEstimate: {
        usage: 256,
        quota: 1024,
        usageRatio: 0.25,
      },
      supportsStorageEstimate: true,
      supportsPersistApi: true,
      warnings: [],
      summary: '通常タブ起動で保存状態を確認しました。Safari は best-effort 保存として扱われます。',
    };
    useProjectStore.setState({ saveHealth: health });
    mocks.saveProject.mockRejectedValueOnce(new Error('保存に失敗しました'));

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
        false,
      ),
    ).rejects.toThrow('保存に失敗しました');

    expect(useProjectStore.getState().lastSaveFailure).toMatchObject({
      operation: 'manual',
      category: 'unknown',
      persistenceMode: 'best-effort',
      launchContext: 'browser-tab',
    });
    expect(useProjectStore.getState().lastSaveFailure?.operationId).toMatch(/^manual-save-/);
  });

  it('standard save -> apple-safari load でも shared project schema を維持する', async () => {
    const mediaItems = [
      createMediaItem('standard-video.mp4', 'video'),
      createMediaItem('still.png', 'image'),
    ];
    const bgm = createAudioTrack('bgm.mp3', {
      delay: 1.25,
      volume: 0.65,
      fadeIn: true,
      fadeOut: true,
      fadeInDuration: 1.5,
      fadeOutDuration: 2,
      duration: 42,
    });
    const narrations = [
      createNarrationClip('narration-compat', {
        sourceType: 'ai',
        startTime: 2.5,
        volume: 0.8,
        trimStart: 0.25,
        trimEnd: 3.75,
        duration: 4,
        isAiEditable: true,
        aiScript: 'こんにちは、タートルビデオです。',
        aiVoice: 'Aoede',
        aiVoiceStyle: 'calm',
      }),
    ];
    const captions = [{
      ...createCaption('caption-compat'),
      text: '互換テスト',
      startTime: 0.5,
      endTime: 3.5,
      overridePosition: 'center' as const,
      overrideFontStyle: 'mincho' as const,
      overrideFontSize: 'large' as const,
      overrideFadeIn: 'on' as const,
      overrideFadeOut: 'off' as const,
    }];
    const captionSettings = {
      ...defaultCaptionSettings,
      position: 'center' as const,
      blur: 2,
      bulkFadeIn: true,
      bulkFadeOut: true,
      bulkFadeInDuration: 1,
      bulkFadeOutDuration: 2,
    };

    standardSaveRuntime.configureProjectStore();
    mocks.saveProject.mockResolvedValueOnce(undefined);

    await useProjectStore.getState().saveProjectManual(
      mediaItems,
      true,
      bgm,
      true,
      narrations,
      true,
      captions,
      captionSettings,
      true,
    );

    const lastSaveCall = mocks.saveProject.mock.calls[mocks.saveProject.mock.calls.length - 1];
    const savedProjectData = lastSaveCall?.[0] as ProjectData;
    expect(savedProjectData.mediaItems).toHaveLength(2);
    expect(savedProjectData.narrations[0].aiScript).toBe('こんにちは、タートルビデオです。');
    expect(savedProjectData.captions[0].overrideFontStyle).toBe('mincho');
    expect(savedProjectData.captionSettings.position).toBe('center');

    mocks.loadProject.mockResolvedValueOnce(savedProjectData);
    appleSafariSaveRuntime.configureProjectStore();

    const loaded = await useProjectStore.getState().loadProjectFromSlot('manual');

    if (!loaded) {
      throw new Error('loaded project was null');
    }

    expect(loaded.mediaItems.map((item) => item.file.name)).toEqual(['standard-video.mp4', 'still.png']);
    expect(loaded.isClipsLocked).toBe(true);
    expect(loaded.bgm?.file.name).toBe('bgm.mp3');
    expect(loaded.bgm?.delay).toBeCloseTo(1.25);
    expect(loaded.bgm?.volume).toBeCloseTo(0.65);
    expect(loaded.isBgmLocked).toBe(true);
    expect(loaded.narrations).toHaveLength(1);
    expect(loaded.narrations[0].sourceType).toBe('ai');
    expect(loaded.narrations[0].isAiEditable).toBe(true);
    expect(loaded.narrations[0].aiVoice).toBe('Aoede');
    expect(loaded.narrations[0].trimStart).toBeCloseTo(0.25);
    expect(loaded.narrations[0].trimEnd).toBeCloseTo(3.75);
    expect(loaded.isNarrationLocked).toBe(true);
    expect(loaded.captionSettings.position).toBe('center');
    expect(loaded.captionSettings.blur).toBe(2);
    expect(loaded.isCaptionsLocked).toBe(true);
    expect(loaded.captions[0].overridePosition).toBe('center');
    expect(loaded.captions[0].overrideFontStyle).toBe('mincho');
    expect(loaded.captions[0].overrideFadeIn).toBe('on');
  });

  it('legacy narration フィールドも runtime 切替後に narration clip へ復元できる', async () => {
    const legacyProjectData: ProjectData = {
      slot: 'manual',
      savedAt: '2026-04-12T00:00:00.000Z',
      version: '1.0.0',
      mediaItems: [],
      isClipsLocked: false,
      bgm: null,
      isBgmLocked: false,
      narrations: [],
      narration: {
        fileName: 'legacy-narration.wav',
        fileType: 'audio/wav',
        fileData: new ArrayBuffer(8),
        startPoint: 0,
        delay: 1.5,
        volume: 0.75,
        fadeIn: false,
        fadeOut: false,
        fadeInDuration: 0.5,
        fadeOutDuration: 0.5,
        duration: 5,
        isAi: true,
      },
      isNarrationLocked: false,
      captions: [],
      captionSettings: defaultCaptionSettings,
      isCaptionsLocked: false,
    };

    mocks.loadProject.mockResolvedValueOnce(legacyProjectData);
    appleSafariSaveRuntime.configureProjectStore();

    const loaded = await useProjectStore.getState().loadProjectFromSlot('manual');

    if (!loaded) {
      throw new Error('loaded project was null');
    }

    expect(loaded.narrations).toHaveLength(1);
    expect(loaded.narrations[0].sourceType).toBe('ai');
    expect(loaded.narrations[0].startTime).toBeCloseTo(1.5);
    expect(loaded.narrations[0].trimStart).toBe(0);
    expect(loaded.narrations[0].trimEnd).toBe(5);
    expect(loaded.narrations[0].duration).toBe(5);
    expect(loaded.narrations[0].isAiEditable).toBe(true);
  });

  it('自動保存が進行中でも手動保存は直列化され、復帰直後の競合で失敗しない', async () => {
    const captions = [createCaption()];
    let resolveAutoSave: (() => void) = () => {
      throw new Error('auto save resolver is not ready');
    };

    mocks.saveProject.mockImplementation((data: { slot: 'auto' | 'manual' }) => {
      if (data.slot === 'auto') {
        return new Promise<void>((resolve) => {
          resolveAutoSave = resolve;
        });
      }
      return Promise.resolve();
    });

    const autoSavePromise = useProjectStore.getState().saveProjectAuto(
      [],
      false,
      null,
      false,
      [],
      false,
      captions,
      defaultCaptionSettings,
      false,
    );

    await vi.waitFor(() => {
      expect(mocks.saveProject).toHaveBeenCalledTimes(1);
    });

    const manualSavePromise = useProjectStore.getState().saveProjectManual(
      [],
      false,
      null,
      false,
      [],
      false,
      captions,
      defaultCaptionSettings,
      false,
    );

    expect(mocks.saveProject.mock.calls[0][0].slot).toBe('auto');

    resolveAutoSave();

    await autoSavePromise;
    await manualSavePromise;

    expect(mocks.saveProject).toHaveBeenCalledTimes(2);
    expect(mocks.saveProject.mock.calls[1][0].slot).toBe('manual');
    expect(useProjectStore.getState().lastManualSave).not.toBeNull();
  });
});
