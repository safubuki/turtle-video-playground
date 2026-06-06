import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUTO_SAVE_INTERVAL_KEY,
  useAutoSave,
} from '../hooks/useAutoSave';
import { useAudioStore } from '../stores/audioStore';
import { useCaptionStore } from '../stores/captionStore';
import { useMediaStore } from '../stores/mediaStore';
import { useProjectStore } from '../stores/projectStore';
import { useUIStore } from '../stores/uiStore';

const defaultCaptionSettings = {
  enabled: true,
  fontSize: 'medium' as const,
  fontStyle: 'gothic' as const,
  fontColor: '#FFFFFF',
  strokeColor: '#000000',
  strokeWidth: 2,
  position: 'bottom' as const,
  blur: 0,
  bulkFadeIn: false,
  bulkFadeOut: false,
  bulkFadeInDuration: 0.5,
  bulkFadeOutDuration: 0.5,
};

function setVisibilityState(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: state,
  });
}

describe('useAutoSave', () => {
  const originalMediaState = useMediaStore.getState();
  const originalAudioState = useAudioStore.getState();
  const originalCaptionState = useCaptionStore.getState();
  const originalProjectState = useProjectStore.getState();
  const originalUiState = useUIStore.getState();

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.setItem(AUTO_SAVE_INTERVAL_KEY, '1');
    setVisibilityState('visible');

    useMediaStore.setState({
      mediaItems: [],
      isClipsLocked: false,
    });
    useAudioStore.setState({
      bgm: null,
      narrations: [],
      isBgmLocked: false,
      isNarrationLocked: false,
    });
    useCaptionStore.setState({
      captions: [{
        id: 'caption-1',
        text: 'sample',
        startTime: 0,
        endTime: 1,
        fadeIn: false,
        fadeOut: false,
        fadeInDuration: 0.5,
        fadeOutDuration: 0.5,
      }],
      settings: defaultCaptionSettings,
      isLocked: false,
    });
    useUIStore.setState({
      isProcessing: false,
    });
  });

  afterEach(() => {
    cleanup();
    act(() => {
      useMediaStore.setState(originalMediaState, true);
      useAudioStore.setState(originalAudioState, true);
      useCaptionStore.setState(originalCaptionState, true);
      useProjectStore.setState(originalProjectState, true);
      useUIStore.setState(originalUiState, true);
    });
    localStorage.removeItem(AUTO_SAVE_INTERVAL_KEY);
    setVisibilityState('visible');
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('復帰イベントは可視状態が落ち着いてから追いつき保存を判定する', async () => {
    const refreshSaveInfo = vi.fn().mockResolvedValue(undefined);
    const saveProjectAuto = vi.fn().mockResolvedValue(true);
    act(() => {
      useProjectStore.setState({
        refreshSaveInfo,
        saveProjectAuto,
        isSaving: false,
        lastManualSave: null,
      });
    });

    renderHook(() => useAutoSave());
    await act(async () => {
      vi.advanceTimersByTime(100);
      await Promise.resolve();
    });
    saveProjectAuto.mockClear();

    const baseNow = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => baseNow + 3 * 60_000);

    setVisibilityState('hidden');
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });

    setVisibilityState('visible');
    await act(async () => {
      vi.advanceTimersByTime(100);
      await Promise.resolve();
    });

    expect(saveProjectAuto).toHaveBeenCalledTimes(1);
  });

  it('手動保存中は復帰時の自動保存を走らせず、手動保存直後の重複保存も防ぐ', async () => {
    const refreshSaveInfo = vi.fn().mockResolvedValue(undefined);
    const saveProjectAuto = vi.fn().mockResolvedValue(true);
    act(() => {
      useProjectStore.setState({
        refreshSaveInfo,
        saveProjectAuto,
        isSaving: false,
        lastManualSave: null,
      });
    });

    renderHook(() => useAutoSave());
    await act(async () => {
      vi.advanceTimersByTime(100);
      await Promise.resolve();
    });
    saveProjectAuto.mockClear();

    const baseNow = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => baseNow + 3 * 60_000);

    act(() => {
      useProjectStore.setState({ isSaving: true });
    });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await act(async () => {
      vi.advanceTimersByTime(100);
      await Promise.resolve();
    });

    expect(saveProjectAuto).not.toHaveBeenCalled();

    await act(async () => {
      useProjectStore.setState({
        isSaving: false,
        lastManualSave: '2026-03-17T00:00:00.000Z',
      });
      await Promise.resolve();
    });

    await act(async () => {
      vi.advanceTimersByTime(61_000);
      await Promise.resolve();
    });

    expect(saveProjectAuto).toHaveBeenCalledTimes(1);
  });

  it('エクスポート中に見送った自動保存は、処理終了後に即座に再開する', async () => {
    const refreshSaveInfo = vi.fn().mockResolvedValue(undefined);
    const saveProjectAuto = vi.fn().mockResolvedValue(true);
    act(() => {
      useProjectStore.setState({
        refreshSaveInfo,
        saveProjectAuto,
        isSaving: false,
        lastManualSave: null,
      });
      useUIStore.setState({ isProcessing: true });
    });

    renderHook(() => useAutoSave());

    await act(async () => {
      vi.advanceTimersByTime(61_000);
      await Promise.resolve();
    });

    expect(saveProjectAuto).not.toHaveBeenCalled();

    await act(async () => {
      useUIStore.setState({ isProcessing: false });
      await Promise.resolve();
    });

    await act(async () => {
      vi.advanceTimersByTime(100);
      await Promise.resolve();
    });

    expect(saveProjectAuto).toHaveBeenCalledTimes(1);
  });

  it('preview 再生中に見送った自動保存は、preview 停止後に期限超過していれば再開する', async () => {
    const refreshSaveInfo = vi.fn().mockResolvedValue(undefined);
    const saveProjectAuto = vi.fn().mockResolvedValue(true);
    act(() => {
      useProjectStore.setState({
        refreshSaveInfo,
        saveProjectAuto,
        isSaving: false,
        lastManualSave: null,
      });
      useUIStore.setState({ isPreviewPlaying: true });
    });

    renderHook(() => useAutoSave());

    await act(async () => {
      vi.advanceTimersByTime(61_000);
      await Promise.resolve();
    });

    expect(saveProjectAuto).not.toHaveBeenCalled();

    await act(async () => {
      useUIStore.setState({ isPreviewPlaying: false });
      await Promise.resolve();
    });

    await act(async () => {
      vi.advanceTimersByTime(100);
      await Promise.resolve();
    });

    expect(saveProjectAuto).toHaveBeenCalledTimes(1);
  });

  it('自動保存間隔を短くした時は、新しい間隔で overdue 判定して即時に追いつき保存する', async () => {
    const refreshSaveInfo = vi.fn().mockResolvedValue(undefined);
    const saveProjectAuto = vi.fn().mockResolvedValue(true);
    localStorage.setItem(AUTO_SAVE_INTERVAL_KEY, '5');
    act(() => {
      useProjectStore.setState({
        refreshSaveInfo,
        saveProjectAuto,
        isSaving: false,
        lastManualSave: null,
      });
    });

    const { result } = renderHook(() => useAutoSave());

    const baseNow = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => baseNow + 61_000);

    await act(async () => {
      result.current.updateAutoSaveInterval(1);
      await Promise.resolve();
    });

    await act(async () => {
      vi.advanceTimersByTime(100);
      await Promise.resolve();
    });

    expect(saveProjectAuto).toHaveBeenCalledTimes(1);
  });

  it('起動時に前回自動保存から期限超過している場合は速やかに catch-up 保存する', async () => {
    const refreshSaveInfo = vi.fn().mockResolvedValue(undefined);
    const saveProjectAuto = vi.fn().mockResolvedValue(true);
    vi.setSystemTime(new Date('2026-03-24T12:00:00.000Z'));
    act(() => {
      useProjectStore.setState({
        refreshSaveInfo,
        saveProjectAuto,
        isSaving: false,
        lastAutoSave: '2026-03-17T00:00:00.000Z',
        lastManualSave: null,
      });
    });

    renderHook(() => useAutoSave());

    await act(async () => {
      vi.advanceTimersByTime(100);
      await Promise.resolve();
    });

    expect(saveProjectAuto).toHaveBeenCalledTimes(1);
  });

  it('非アクティブから復帰した時は自動保存タイマーを再開する', async () => {
    const refreshSaveInfo = vi.fn().mockResolvedValue(undefined);
    const saveProjectAuto = vi.fn().mockResolvedValue(true);
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout');
    act(() => {
      useProjectStore.setState({
        refreshSaveInfo,
        saveProjectAuto,
        isSaving: false,
        lastManualSave: null,
      });
    });

    renderHook(() => useAutoSave());
    await act(async () => {
      vi.advanceTimersByTime(100);
      await Promise.resolve();
    });
    saveProjectAuto.mockClear();

    setVisibilityState('hidden');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    setVisibilityState('visible');
    vi.clearAllTimers();
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      vi.advanceTimersByTime(100);
      await Promise.resolve();
    });

    expect(setTimeoutSpy).toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(61_000);
      await Promise.resolve();
    });

    expect(saveProjectAuto).toHaveBeenCalledTimes(1);
  });

  it('短時間の非アクティブ復帰では残り時間を維持し、期限前の即時保存は行わない', async () => {
    const refreshSaveInfo = vi.fn().mockResolvedValue(undefined);
    const saveProjectAuto = vi.fn().mockResolvedValue(true);
    const setIntervalSpy = vi.spyOn(window, 'setInterval');
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout');
    act(() => {
      useProjectStore.setState({
        refreshSaveInfo,
        saveProjectAuto,
        isSaving: false,
        lastManualSave: null,
      });
    });

    renderHook(() => useAutoSave());

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(100);
      await Promise.resolve();
    });
    saveProjectAuto.mockClear();

    await act(async () => {
      vi.advanceTimersByTime(50_000);
      await Promise.resolve();
    });

    setVisibilityState('hidden');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    setVisibilityState('visible');
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      vi.advanceTimersByTime(100);
      await Promise.resolve();
    });

    expect(setTimeoutSpy).toHaveBeenCalled();
    expect(saveProjectAuto).not.toHaveBeenCalled();

    act(() => {
      useCaptionStore.setState({
        captions: [{
          id: 'caption-1',
          text: 'timeout-to-interval',
          startTime: 0,
          endTime: 1,
          fadeIn: false,
          fadeOut: false,
          fadeInDuration: 0.5,
          fadeOutDuration: 0.5,
        }],
      });
    });

    await act(async () => {
      vi.advanceTimersByTime(10_000);
      await Promise.resolve();
    });

    expect(saveProjectAuto).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(60_000);
      await Promise.resolve();
    });

    expect(saveProjectAuto).toHaveBeenCalledTimes(2);
  });

  it('復帰時点で既に保存期限を過ぎている場合は即 catch-up し、その後に通常 cadence へ戻る', async () => {
    const refreshSaveInfo = vi.fn().mockResolvedValue(undefined);
    const saveProjectAuto = vi.fn().mockResolvedValue(true);
    const setIntervalSpy = vi.spyOn(window, 'setInterval');
    act(() => {
      useProjectStore.setState({
        refreshSaveInfo,
        saveProjectAuto,
        isSaving: false,
        lastManualSave: null,
      });
    });

    renderHook(() => useAutoSave());

    setVisibilityState('hidden');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // aggressive background throttling / tab suspension で
    // 非アクティブ中に autosave timer が失われた状態を模擬する。
    vi.clearAllTimers();

    await act(async () => {
      vi.advanceTimersByTime(61_000);
      await Promise.resolve();
    });

    setVisibilityState('visible');
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      vi.advanceTimersByTime(100);
      await Promise.resolve();
    });

    expect(saveProjectAuto).toHaveBeenCalledTimes(1);
    expect(setIntervalSpy).toHaveBeenCalledTimes(2);

    act(() => {
      useCaptionStore.setState({
        captions: [{
          id: 'caption-1',
          text: 'after-return',
          startTime: 0,
          endTime: 1,
          fadeIn: false,
          fadeOut: false,
          fadeInDuration: 0.5,
          fadeOutDuration: 0.5,
        }],
      });
    });

    await act(async () => {
      vi.advanceTimersByTime(61_000);
      await Promise.resolve();
    });

    expect(saveProjectAuto).toHaveBeenCalledTimes(2);
  });


  it('自動保存失敗時は変更検知ハッシュを進めず、同じ内容でも次回再試行する', async () => {
    const refreshSaveInfo = vi.fn().mockResolvedValue(undefined);
    const saveProjectAuto = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    act(() => {
      useProjectStore.setState({
        refreshSaveInfo,
        saveProjectAuto,
        isSaving: false,
        lastManualSave: null,
      });
    });

    const { result } = renderHook(() => useAutoSave());

    await act(async () => {
      await result.current.performAutoSave();
    });

    await act(async () => {
      await result.current.performAutoSave();
    });

    expect(saveProjectAuto).toHaveBeenCalledTimes(2);
  });

  it('自動保存失敗時は復帰契機で overdue なら即時に再試行できる', async () => {
    const refreshSaveInfo = vi.fn().mockResolvedValue(undefined);
    const saveProjectAuto = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    act(() => {
      useProjectStore.setState({
        refreshSaveInfo,
        saveProjectAuto,
        isSaving: false,
        lastManualSave: null,
      });
    });

    renderHook(() => useAutoSave());

    await act(async () => {
      vi.advanceTimersByTime(61_000);
      await Promise.resolve();
    });

    expect(saveProjectAuto).toHaveBeenCalledTimes(1);

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      vi.advanceTimersByTime(100);
      await Promise.resolve();
    });

    expect(saveProjectAuto).toHaveBeenCalledTimes(2);
  });

  it('トリム後の位置・サイズ調整も自動保存の差分として検知する', async () => {
    const refreshSaveInfo = vi.fn().mockResolvedValue(undefined);
    const saveProjectAuto = vi.fn().mockResolvedValue(true);
    const mediaFile = new File(['video'], 'clip.mp4', { type: 'video/mp4' });

    act(() => {
      useProjectStore.setState({
        refreshSaveInfo,
        saveProjectAuto,
        isSaving: false,
        lastManualSave: null,
      });
      useMediaStore.setState({
        mediaItems: [{
          id: 'video-1',
          file: mediaFile,
          type: 'video',
          url: 'blob:video-1',
          volume: 1,
          isMuted: false,
          fadeIn: false,
          fadeOut: false,
          fadeInDuration: 0.5,
          fadeOutDuration: 0.5,
          duration: 5,
          originalDuration: 10,
          trimStart: 1,
          trimEnd: 6,
          scale: 1,
          positionX: 0,
          positionY: 0,
          isTransformOpen: false,
          isLocked: false,
        }],
        isClipsLocked: false,
      });
    });

    const { result } = renderHook(() => useAutoSave());

    await act(async () => {
      await result.current.performAutoSave();
    });

    expect(saveProjectAuto).toHaveBeenCalledTimes(1);

    act(() => {
      useMediaStore.getState().updateScale('video-1', 1.35);
      useMediaStore.getState().updatePosition('video-1', 'x', 120);
      useMediaStore.getState().updatePosition('video-1', 'y', -80);
    });

    await act(async () => {
      await result.current.performAutoSave();
    });

    expect(saveProjectAuto).toHaveBeenCalledTimes(2);
  });

  it('クリップセクションロックの変更も自動保存の差分として検知する', async () => {
    const refreshSaveInfo = vi.fn().mockResolvedValue(undefined);
    const saveProjectAuto = vi.fn().mockResolvedValue(true);
    const mediaFile = new File(['video'], 'clip.mp4', { type: 'video/mp4' });

    act(() => {
      useProjectStore.setState({
        refreshSaveInfo,
        saveProjectAuto,
        isSaving: false,
        lastManualSave: null,
      });
      useMediaStore.setState({
        mediaItems: [{
          id: 'video-1',
          file: mediaFile,
          type: 'video',
          url: 'blob:video-1',
          volume: 1,
          isMuted: false,
          fadeIn: false,
          fadeOut: false,
          fadeInDuration: 0.5,
          fadeOutDuration: 0.5,
          duration: 5,
          originalDuration: 10,
          trimStart: 0,
          trimEnd: 5,
          scale: 1,
          positionX: 0,
          positionY: 0,
          isTransformOpen: false,
          isLocked: false,
        }],
        isClipsLocked: false,
      });
    });

    const { result } = renderHook(() => useAutoSave());

    await act(async () => {
      await result.current.performAutoSave();
    });

    expect(saveProjectAuto).toHaveBeenCalledTimes(1);

    act(() => {
      useMediaStore.getState().toggleClipsLock();
    });

    await act(async () => {
      await result.current.performAutoSave();
    });

    expect(saveProjectAuto).toHaveBeenCalledTimes(2);
  });
});
