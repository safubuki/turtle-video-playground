/**
 * @file useAutoSave.ts
 * @author Turtle Village
 * @description 自動保存機能を提供するカスタムフック。設定に応じた間隔で自動保存を実行する。
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { useMediaStore } from '../stores/mediaStore';
import { useAudioStore } from '../stores/audioStore';
import { useCaptionStore } from '../stores/captionStore';
import { useProjectStore } from '../stores/projectStore';
import { useUIStore } from '../stores/uiStore';
import { useLogStore } from '../stores/logStore';

/** 自動保存間隔の設定キー */
export const AUTO_SAVE_INTERVAL_KEY = 'turtle-video-auto-save-interval';
const AUTO_SAVE_INTERVAL_CHANGED_EVENT = 'turtle-video:auto-save-interval-changed';

/** 自動保存間隔オプション（分） */
export type AutoSaveIntervalOption = 0 | 1 | 2 | 5;

/** デフォルトの自動保存間隔（分） */
export const DEFAULT_AUTO_SAVE_INTERVAL: AutoSaveIntervalOption = 2;
const AUTO_SAVE_RETURN_CHECK_DELAY_MS = 80;

type AutoSaveRunResult = 'saved' | 'failed' | 'skipped-processing' | 'skipped-preview' | 'skipped-nochange' | 'skipped-empty';
type AutoSaveRunOptions = {
  force?: boolean;
};

function isAutoSaveIntervalOption(value: number): value is AutoSaveIntervalOption {
  return value === 0 || value === 1 || value === 2 || value === 5;
}

/**
 * localStorageから自動保存間隔を取得
 */
export function getAutoSaveInterval(): AutoSaveIntervalOption {
  try {
    const stored = localStorage.getItem(AUTO_SAVE_INTERVAL_KEY);
    if (stored !== null) {
      const value = parseInt(stored, 10);
      if (isAutoSaveIntervalOption(value)) {
        return value;
      }
    }
  } catch {
    // localStorageエラーは無視
  }
  return DEFAULT_AUTO_SAVE_INTERVAL;
}

/**
 * 自動保存間隔をlocalStorageに保存
 */
export function setAutoSaveInterval(interval: AutoSaveIntervalOption): void {
  try {
    localStorage.setItem(AUTO_SAVE_INTERVAL_KEY, String(interval));
  } catch {
    // localStorageエラーは無視
  } finally {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent<AutoSaveIntervalOption>(AUTO_SAVE_INTERVAL_CHANGED_EVENT, {
        detail: interval,
      }));
    }
  }
}

/**
 * 自動保存機能を提供するカスタムフック
 */
export function useAutoSave() {
  const intervalRef = useRef<number | null>(null);
  const autoSaveTimerKindRef = useRef<'timeout' | 'interval' | null>(null);
  const catchUpSaveTimeoutRef = useRef<number | null>(null);
  const lastSaveHashRef = useRef<string>('');
  const performAutoSaveRef = useRef<(options?: AutoSaveRunOptions) => Promise<AutoSaveRunResult>>(async () => 'skipped-empty');
  const isAutoSaveRunningRef = useRef(false);
  const lastAutoSaveActivityAtRef = useRef<number>(Date.now());
  const hasStartedAutoSaveTimerRef = useRef(false);
  const hasObservedAutoSaveActivityRef = useRef(false);
  const shouldRestartTimerOnReturnRef = useRef(false);
  const restartAutoSaveControllerRef = useRef<null | (() => void)>(null);
  const handledAutoSaveRestartTokenRef = useRef(0);
  const [autoSaveMinutes, setAutoSaveMinutes] = useState<AutoSaveIntervalOption>(getAutoSaveInterval);
  
  // ストアからデータを取得
  const mediaItems = useMediaStore((s) => s.mediaItems);
  const isClipsLocked = useMediaStore((s) => s.isClipsLocked);
  const bgm = useAudioStore((s) => s.bgm);
  const isBgmLocked = useAudioStore((s) => s.isBgmLocked);
  const narrations = useAudioStore((s) => s.narrations);
  const isNarrationLocked = useAudioStore((s) => s.isNarrationLocked);
  const captions = useCaptionStore((s) => s.captions);
  const captionSettings = useCaptionStore((s) => s.settings);
  const isCaptionsLocked = useCaptionStore((s) => s.isLocked);
  
  // エクスポート中かどうか
  const isProcessing = useUIStore((s) => s.isProcessing);
  const isPreviewPlaying = useUIStore((s) => s.isPreviewPlaying);
  
  const saveProjectAuto = useProjectStore((s) => s.saveProjectAuto);
  const lastAutoSave = useProjectStore((s) => s.lastAutoSave);
  const lastManualSave = useProjectStore((s) => s.lastManualSave);
  const updateAutoSaveRuntime = useProjectStore((s) => s.updateAutoSaveRuntime);
  const autoSaveRestartToken = useProjectStore((s) => s.autoSaveRestartToken);
  
  /**
   * 現在の状態のハッシュを計算（簡易的な変更検知用）
   */
  const computeHash = useCallback(() => {
    const parts = [
      mediaItems.length,
      mediaItems.map((m) => [
        m.id,
        m.type,
        m.file?.name ?? '',
        m.volume,
        m.isMuted,
        m.fadeIn,
        m.fadeOut,
        m.fadeInDuration,
        m.fadeOutDuration,
        m.duration,
        m.originalDuration,
        m.trimStart,
        m.trimEnd,
        m.scale,
        m.positionX,
        m.positionY,
        m.isTransformOpen,
        m.isLocked,
      ].join(':')).join(','),
      bgm ? [
        bgm.file?.name ?? '',
        bgm.url,
        bgm.blobUrl ?? '',
        bgm.startPoint,
        bgm.delay,
        bgm.volume,
        bgm.fadeIn,
        bgm.fadeOut,
        bgm.fadeInDuration,
        bgm.fadeOutDuration,
        bgm.duration,
        bgm.isAi,
      ].join(':') : 'none',
      narrations.length,
      narrations.map((n) => [
        n.id,
        n.sourceType,
        n.file?.name ?? '',
        n.url,
        n.blobUrl ?? '',
        n.startTime,
        n.volume,
        n.isMuted,
        n.duration,
        n.trimStart,
        n.trimEnd,
        n.isAiEditable,
        n.aiScript ?? '',
        n.aiVoice ?? '',
        n.aiVoiceStyle ?? '',
      ].join(':')).join(','),
      captions.length,
      captions.map((c) => [
        c.id,
        c.text,
        c.startTime,
        c.endTime,
        c.fadeIn,
        c.fadeOut,
        c.fadeInDuration,
        c.fadeOutDuration,
        c.overridePosition ?? '',
        c.overrideFontStyle ?? '',
        c.overrideFontSize ?? '',
        c.overrideFadeIn ?? '',
        c.overrideFadeOut ?? '',
        c.overrideFadeInDuration ?? '',
        c.overrideFadeOutDuration ?? '',
      ].join(':')).join(','),
      JSON.stringify(captionSettings),
      isClipsLocked,
      isBgmLocked,
      isNarrationLocked,
      isCaptionsLocked,
    ];
    return parts.join('|');
  }, [
    mediaItems,
    bgm,
    narrations,
    captions,
    captionSettings,
    isClipsLocked,
    isBgmLocked,
    isNarrationLocked,
    isCaptionsLocked,
  ]);
  
  /**
   * 自動保存を実行
   */
  const performAutoSave = useCallback(async (options?: AutoSaveRunOptions): Promise<AutoSaveRunResult> => {
    // エクスポート中は保存をスキップ（動画品質を保護）
    if (useUIStore.getState().isProcessing) {
      return 'skipped-processing';
    }
    if (useUIStore.getState().isPreviewPlaying) {
      useLogStore.getState().debug('SYSTEM', 'preview再生中のため自動保存を延期');
      return 'skipped-preview';
    }
    
    const currentHash = computeHash();
    
    // 強制保存でない場合のみ、変更がないときはスキップ
    if (!options?.force && currentHash === lastSaveHashRef.current) {
      return 'skipped-nochange';
    }
    
    // データがない場合はスキップ
    if (mediaItems.length === 0 && !bgm && narrations.length === 0 && captions.length === 0) {
      return 'skipped-empty';
    }
    
    const saved = await saveProjectAuto(
      mediaItems,
      isClipsLocked,
      bgm,
      isBgmLocked,
      narrations,
      isNarrationLocked,
      captions,
      captionSettings,
      isCaptionsLocked
    );

    if (!saved) {
      useLogStore.getState().warn('SYSTEM', '自動保存が失敗したため変更検知ハッシュは更新しません', {
        mediaCount: mediaItems.length,
        captionCount: captions.length,
      });
      return 'failed';
    }
    
    // 自動保存成功ログ（デバッグレベルで記録）
    useLogStore.getState().debug('SYSTEM', '自動保存を実行', {
      mediaCount: mediaItems.length,
      captionCount: captions.length,
    });
    
    lastSaveHashRef.current = currentHash;
    return 'saved';
  }, [
    computeHash,
    mediaItems,
    isClipsLocked,
    bgm,
    isBgmLocked,
    narrations,
    isNarrationLocked,
    captions,
    captionSettings,
    isCaptionsLocked,
    saveProjectAuto,
  ]);

  useEffect(() => {
    performAutoSaveRef.current = performAutoSave;
  }, [performAutoSave]);

  const runAutoSave = useCallback(async (options?: AutoSaveRunOptions) => {
    if (useProjectStore.getState().isSaving) return;
    if (isAutoSaveRunningRef.current) return;

    isAutoSaveRunningRef.current = true;
    useProjectStore.getState().updateAutoSaveRuntime({ status: 'running' });
    try {
      const result = await performAutoSaveRef.current(options);
      if (result !== 'skipped-processing' && result !== 'skipped-preview' && result !== 'failed') {
        const now = new Date();
        const activityAt = now.toISOString();
        hasObservedAutoSaveActivityRef.current = true;
        lastAutoSaveActivityAtRef.current = now.getTime();
        useProjectStore.getState().updateAutoSaveRuntime({
          status: result,
          activityAt,
        });
        return;
      }
      useProjectStore.getState().updateAutoSaveRuntime({
        status: (result === 'skipped-processing' || result === 'skipped-preview') ? 'paused-processing' : 'failed',
      });
    } finally {
      isAutoSaveRunningRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!lastAutoSave) return;
    if (hasObservedAutoSaveActivityRef.current) return;

    const savedAt = new Date(lastAutoSave).getTime();
    if (!Number.isFinite(savedAt)) return;

    lastAutoSaveActivityAtRef.current = savedAt;
    updateAutoSaveRuntime({
      status: 'saved',
      activityAt: lastAutoSave,
    });
  }, [lastAutoSave, updateAutoSaveRuntime]);

  useEffect(() => {
    if (!lastManualSave) return;
    // 手動保存直後は同一内容が保存済みなので、自動保存の差分ベースラインも更新する。
    lastSaveHashRef.current = computeHash();
    lastAutoSaveActivityAtRef.current = Date.now();
  }, [lastManualSave, computeHash]);

  // 保存間隔の更新を即時反映（同一タブ + 他タブ）
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleIntervalChanged = (event: Event) => {
      const next = (event as CustomEvent<AutoSaveIntervalOption>).detail;
      if (typeof next === 'number' && isAutoSaveIntervalOption(next)) {
        setAutoSaveMinutes(next);
        return;
      }
      setAutoSaveMinutes(getAutoSaveInterval());
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== AUTO_SAVE_INTERVAL_KEY) return;
      setAutoSaveMinutes(getAutoSaveInterval());
    };

    window.addEventListener(AUTO_SAVE_INTERVAL_CHANGED_EVENT, handleIntervalChanged as EventListener);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener(AUTO_SAVE_INTERVAL_CHANGED_EVENT, handleIntervalChanged as EventListener);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);
  
  // 自動保存タイマーの設定
  useEffect(() => {
    if (autoSaveMinutes === 0) {
      restartAutoSaveControllerRef.current = null;
      updateAutoSaveRuntime({ status: 'idle' });
      return;
    }

    // 初回起動時は少し遅延してから保存情報を更新
    const initTimeout = window.setTimeout(() => {
      if (!useUIStore.getState().isPreviewPlaying) {
        useProjectStore.getState().refreshSaveInfo();
      }
    }, 1000);

    const intervalMs = autoSaveMinutes * 60 * 1000;

    const clearScheduledCatchUpSave = () => {
      if (catchUpSaveTimeoutRef.current !== null) {
        clearTimeout(catchUpSaveTimeoutRef.current);
        catchUpSaveTimeoutRef.current = null;
      }
    };

    const clearAutoSaveTimer = () => {
      if (intervalRef.current !== null) {
        if (autoSaveTimerKindRef.current === 'timeout') {
          clearTimeout(intervalRef.current);
        } else if (autoSaveTimerKindRef.current === 'interval') {
          clearInterval(intervalRef.current);
        }
        intervalRef.current = null;
        autoSaveTimerKindRef.current = null;
      }
    };

    const startRecurringAutoSaveTimer = () => {
      clearAutoSaveTimer();
      intervalRef.current = window.setInterval(() => {
        void runAutoSave({ force: true });
      }, intervalMs);
      autoSaveTimerKindRef.current = 'interval';
    };

    const restartAutoSaveTimer = (preserveElapsedDelay: boolean) => {
      clearAutoSaveTimer();

      if (!preserveElapsedDelay) {
        startRecurringAutoSaveTimer();
        return;
      }

      const now = Date.now();
      const elapsed = now - lastAutoSaveActivityAtRef.current;
      const initialDelay = Math.max(intervalMs - elapsed, 0);

      if (initialDelay === 0) {
        // 復帰時点で既に期限超過なら、下流の catch-up 判定が直ちに保存できるよう
        // 通常 cadence のタイマーだけ先に再開しておく。
        startRecurringAutoSaveTimer();
        return;
      }

      intervalRef.current = window.setTimeout(() => {
        void runAutoSave({ force: true })
          .catch((error) => {
            useLogStore.getState().warn('SYSTEM', '非アクティブ復帰後の自動保存に失敗しました', {
              error: error instanceof Error ? error.message : String(error),
            });
          })
          .finally(() => {
            startRecurringAutoSaveTimer();
          });
      }, initialDelay);
      autoSaveTimerKindRef.current = 'timeout';
    };

    const triggerCatchUpSave = (forcePromptSave = false) => {
      clearScheduledCatchUpSave();
      // visibilitychange / focus / pageshow の発火順は環境依存なので、
      // 少し待ってから可視状態と手動保存状態を確定させる。
      catchUpSaveTimeoutRef.current = window.setTimeout(() => {
        catchUpSaveTimeoutRef.current = null;
        if (document.visibilityState === 'hidden') return;
        if (shouldRestartTimerOnReturnRef.current) {
          shouldRestartTimerOnReturnRef.current = false;
          restartAutoSaveTimer(true);
        }
        if (useProjectStore.getState().isSaving) return;
        if (forcePromptSave) {
          void runAutoSave({ force: true });
          return;
        }
        const elapsed = Date.now() - lastAutoSaveActivityAtRef.current;
        if (elapsed < intervalMs) return;
        void runAutoSave({ force: true });
      }, AUTO_SAVE_RETURN_CHECK_DELAY_MS);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        shouldRestartTimerOnReturnRef.current = true;
        clearScheduledCatchUpSave();
        return;
      }
      triggerCatchUpSave(false);
    };

    const handlePageHide = () => {
      shouldRestartTimerOnReturnRef.current = true;
      clearScheduledCatchUpSave();
    };

    restartAutoSaveControllerRef.current = () => {
      clearScheduledCatchUpSave();
      shouldRestartTimerOnReturnRef.current = false;
      restartAutoSaveTimer(false);
      void runAutoSave({ force: true });
    };
    
    // オフの場合はタイマーを設定しない
    // 自動保存タイマー開始
    if (!hasStartedAutoSaveTimerRef.current) {
      if (!lastAutoSave) {
        lastAutoSaveActivityAtRef.current = Date.now();
      }
      hasStartedAutoSaveTimerRef.current = true;
    }
    restartAutoSaveTimer(false);
    triggerCatchUpSave(false);

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);
    const handleFocus = () => {
      triggerCatchUpSave(false);
    };
    const handlePageShow = () => {
      triggerCatchUpSave(false);
    };
    window.addEventListener('focus', handleFocus);
    window.addEventListener('pageshow', handlePageShow);
    
    return () => {
      clearTimeout(initTimeout);
      clearAutoSaveTimer();
      clearScheduledCatchUpSave();
      restartAutoSaveControllerRef.current = null;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('pageshow', handlePageShow);
    };
  }, [autoSaveMinutes, lastAutoSave, runAutoSave]);
  
  useEffect(() => {
    if (autoSaveMinutes === 0) return;
    if (isProcessing || isPreviewPlaying) return;
    if (document.visibilityState === 'hidden') return;

    const intervalMs = autoSaveMinutes * 60 * 1000;
    const elapsed = Date.now() - lastAutoSaveActivityAtRef.current;
    if (elapsed < intervalMs) return;

    const timeoutId = window.setTimeout(() => {
      if (document.visibilityState === 'hidden') return;
      if (useProjectStore.getState().isSaving) return;
      void runAutoSave({ force: true });
    }, AUTO_SAVE_RETURN_CHECK_DELAY_MS);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [autoSaveMinutes, isPreviewPlaying, isProcessing, lastAutoSave, runAutoSave]);

  useEffect(() => {
    if (autoSaveRestartToken === handledAutoSaveRestartTokenRef.current) return;
    handledAutoSaveRestartTokenRef.current = autoSaveRestartToken;
    restartAutoSaveControllerRef.current?.();
  }, [autoSaveRestartToken]);

  /**
   * 自動保存間隔を更新
   */
  const updateAutoSaveInterval = useCallback((interval: AutoSaveIntervalOption) => {
    setAutoSaveInterval(interval);
    setAutoSaveMinutes(interval);
  }, []);
  
  return {
    performAutoSave: runAutoSave,
    autoSaveMinutes,
    updateAutoSaveInterval,
  };
}
