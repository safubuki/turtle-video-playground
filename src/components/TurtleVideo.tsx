/**
 * @file TurtleVideo.tsx
 * @author Turtle Village
 * @description 動画編集アプリケーションのメインコンポーネント。タイムライン管理、再生制御、レンダリングループ、および各種セクションの統合を行う。
 */
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';

import type { AppFlavor } from '../app/resolveAppFlavor';
import type { MediaItem, AudioTrack, NarrationClip, NarrationScriptLength } from '../types';
import type { ExportRuntime } from './turtle-video/exportRuntime';
import type { SectionHelpKey } from '../constants/sectionHelp';
import type { PreviewRuntime } from './turtle-video/previewRuntime';
import type { SaveRuntime } from './turtle-video/saveRuntime';
import {
  VOICE_OPTIONS,
  GEMINI_API_BASE_URL,
  GEMINI_SCRIPT_MODEL,
  GEMINI_SCRIPT_FALLBACK_MODELS,
  GEMINI_TTS_MODEL,
  TTS_SAMPLE_RATE,
} from '../constants';
import { useCanvasStore } from '../stores/canvasStore';

import type { ExportPreparationStep } from '../hooks/useExport';
import { usePreventUnload } from '../hooks/usePreventUnload';
import { useProjectStore } from '../stores/projectStore';

// Utils
import { captureCanvasAsImage } from '../utils/canvas';
import { preserveOriginalFileName, resolveAiNarrationFileName } from '../utils/fileNames';
import { saveObjectUrlWithClientFileStrategy } from '../utils/fileSave';
import { openFilesWithPicker, shouldUseMediaOpenFilePicker } from '../utils/platform';

// Zustand Stores
import { useMediaStore, useAudioStore, useUIStore, useCaptionStore, useLogStore, createNarrationClip } from '../stores';
import { useOfflineModeStore } from '../stores/offlineModeStore';

// コンポーネント
import Toast from './common/Toast';
import ErrorMessage from './common/ErrorMessage';
import MediaResourceLoader from './media/MediaResourceLoader';
import Header from './Header';
import ClipsSection from './sections/ClipsSection';
import BgmSection from './sections/BgmSection';
import NarrationSection from './sections/NarrationSection';
import CaptionSection from './sections/CaptionSection';
import PreviewSection from './sections/PreviewSection';
import AiModal from './modals/AiModal';
import SettingsModal, { getStoredApiKey } from './modals/SettingsModal';
import SaveLoadModal from './modals/SaveLoadModal';
import SectionHelpModal from './modals/SectionHelpModal';
import {
  createAndroidPreviewCacheKey,
  shouldUseAndroidPreviewCache,
  type PreviewCacheEntry,
  type PreviewCacheStatus,
} from '../flavors/standard/preview/androidPreviewCache';

// API キー取得関数（localStorage優先、フォールバックで環境変数）
const getApiKey = (): string => {
  const storedKey = getStoredApiKey();
  if (storedKey) return storedKey;
  return import.meta.env.VITE_GEMINI_API_KEY || '';
};

const EXPORT_FINALIZING_EPSILON_SEC = 0.05;
const EXPORT_FINALIZING_TIMEOUT_WARNING = '保存ファイルの作成に時間がかかっています...';
const EXPORT_FINALIZING_TIMEOUT_ERROR = '保存ファイルの作成に時間がかかっています。ログを確認してください。';

interface TurtleVideoProps {
  appFlavor: AppFlavor;
  previewRuntime: PreviewRuntime;
  exportRuntime: ExportRuntime;
  saveRuntime: SaveRuntime;
}

const TurtleVideo: React.FC<TurtleVideoProps> = ({ appFlavor, previewRuntime, exportRuntime, saveRuntime }) => {
  // 離脱防止フックを使用
  usePreventUnload();

  // === Zustand Stores ===
  // Canvas Store (動的キャンバスサイズ)
  const canvasWidth = useCanvasStore((s) => s.width);
  const canvasHeight = useCanvasStore((s) => s.height);
  const resetCanvasSize = useCanvasStore((s) => s.resetCanvasSize);
  const applyCanvasFromSource = useCanvasStore((s) => s.applyFromSource);

  // Media Store
  const mediaItems = useMediaStore((s) => s.mediaItems);
  const totalDuration = useMediaStore((s) => s.totalDuration);
  const isClipsLocked = useMediaStore((s) => s.isClipsLocked);
  const addMediaItems = useMediaStore((s) => s.addMediaItems);
  const removeMediaItem = useMediaStore((s) => s.removeMediaItem);
  const moveMediaItem = useMediaStore((s) => s.moveMediaItem);
  const setVideoDuration = useMediaStore((s) => s.setVideoDuration);
  const updateVideoTrim = useMediaStore((s) => s.updateVideoTrim);
  const updateImageDuration = useMediaStore((s) => s.updateImageDuration);
  const updateScale = useMediaStore((s) => s.updateScale);
  const updatePosition = useMediaStore((s) => s.updatePosition);
  const resetTransform = useMediaStore((s) => s.resetTransform);
  const toggleTransformPanel = useMediaStore((s) => s.toggleTransformPanel);
  const updateVolume = useMediaStore((s) => s.updateVolume);
  const toggleMute = useMediaStore((s) => s.toggleMute);
  const toggleFadeIn = useMediaStore((s) => s.toggleFadeIn);
  const toggleFadeOut = useMediaStore((s) => s.toggleFadeOut);
  const updateFadeInDuration = useMediaStore((s) => s.updateFadeInDuration);
  const updateFadeOutDuration = useMediaStore((s) => s.updateFadeOutDuration);
  const toggleItemLock = useMediaStore((s) => s.toggleItemLock);
  const toggleClipsLock = useMediaStore((s) => s.toggleClipsLock);
  const clearAllMedia = useMediaStore((s) => s.clearAllMedia);

  // Audio Store
  const bgm = useAudioStore((s) => s.bgm);
  const isBgmLocked = useAudioStore((s) => s.isBgmLocked);

  const setBgm = useAudioStore((s) => s.setBgm);
  const updateBgmStartPoint = useAudioStore((s) => s.updateBgmStartPoint);
  const updateBgmDelay = useAudioStore((s) => s.updateBgmDelay);
  const updateBgmVolume = useAudioStore((s) => s.updateBgmVolume);
  const toggleBgmFadeIn = useAudioStore((s) => s.toggleBgmFadeIn);
  const toggleBgmFadeOut = useAudioStore((s) => s.toggleBgmFadeOut);
  const updateBgmFadeInDuration = useAudioStore((s) => s.updateBgmFadeInDuration);
  const updateBgmFadeOutDuration = useAudioStore((s) => s.updateBgmFadeOutDuration);
  const toggleBgmLock = useAudioStore((s) => s.toggleBgmLock);
  const removeBgm = useAudioStore((s) => s.removeBgm);

  const narrations = useAudioStore((s) => s.narrations);
  const isNarrationLocked = useAudioStore((s) => s.isNarrationLocked);
  const addNarration = useAudioStore((s) => s.addNarration);
  const updateNarrationStartTime = useAudioStore((s) => s.updateNarrationStartTime);
  const updateNarrationVolume = useAudioStore((s) => s.updateNarrationVolume);
  const toggleNarrationMute = useAudioStore((s) => s.toggleNarrationMute);
  const updateNarrationTrim = useAudioStore((s) => s.updateNarrationTrim);
  const updateNarrationMeta = useAudioStore((s) => s.updateNarrationMeta);
  const replaceNarrationAudio = useAudioStore((s) => s.replaceNarrationAudio);
  const moveNarration = useAudioStore((s) => s.moveNarration);
  const toggleNarrationLock = useAudioStore((s) => s.toggleNarrationLock);
  const removeNarration = useAudioStore((s) => s.removeNarration);
  const clearAllAudio = useAudioStore((s) => s.clearAllAudio);

  // UI Store
  const toastMessage = useUIStore((s) => s.toastMessage);
  const errorMsg = useUIStore((s) => s.errorMsg);
  const errorCount = useUIStore((s) => s.errorCount);
  const isPlaying = useUIStore((s) => s.isPlaying);
  const currentTime = useUIStore((s) => s.currentTime);
  const isProcessing = useUIStore((s) => s.isProcessing);
  const exportUrl = useUIStore((s) => s.exportUrl);
  const exportExt = useUIStore((s) => s.exportExt);
  const showAiModal = useUIStore((s) => s.showAiModal);
  const aiPrompt = useUIStore((s) => s.aiPrompt);
  const aiScript = useUIStore((s) => s.aiScript);
  const aiVoice = useUIStore((s) => s.aiVoice);
  const aiVoiceStyle = useUIStore((s) => s.aiVoiceStyle);
  const isAiLoading = useUIStore((s) => s.isAiLoading);

  const clearToast = useUIStore((s) => s.clearToast);
  const showToast = useUIStore((s) => s.showToast);
  const setError = useUIStore((s) => s.setError);
  const clearError = useUIStore((s) => s.clearError);
  const offlineMode = useOfflineModeStore((s) => s.offlineMode);
  const play = useUIStore((s) => s.play);
  const pause = useUIStore((s) => s.pause);
  const setCurrentTime = useUIStore((s) => s.setCurrentTime);
  const setProcessing = useUIStore((s) => s.setProcessing);
  const setLoading = useUIStore((s) => s.setLoading);
  const setPreviewPlaying = useUIStore((s) => s.setPreviewPlaying);

  const isLoading = useUIStore((s) => s.isLoading);
  const setExportUrl = useUIStore((s) => s.setExportUrl);
  const setExportExt = useUIStore((s) => s.setExportExt);
  const clearExport = useUIStore((s) => s.clearExport);
  const openAiModal = useUIStore((s) => s.openAiModal);
  const closeAiModal = useUIStore((s) => s.closeAiModal);
  const setAiPrompt = useUIStore((s) => s.setAiPrompt);
  const setAiScript = useUIStore((s) => s.setAiScript);
  const setAiVoice = useUIStore((s) => s.setAiVoice);
  const setAiVoiceStyle = useUIStore((s) => s.setAiVoiceStyle);
  const setAiLoading = useUIStore((s) => s.setAiLoading);
  const resetUI = useUIStore((s) => s.resetUI);

  // Caption Store
  const captions = useCaptionStore((s) => s.captions);
  const captionSettings = useCaptionStore((s) => s.settings);
  const isCaptionLocked = useCaptionStore((s) => s.isLocked);
  const addCaption = useCaptionStore((s) => s.addCaption);
  const updateCaption = useCaptionStore((s) => s.updateCaption);
  const removeCaption = useCaptionStore((s) => s.removeCaption);
  const moveCaption = useCaptionStore((s) => s.moveCaption);
  const setCaptionEnabled = useCaptionStore((s) => s.setEnabled);
  const setCaptionFontSize = useCaptionStore((s) => s.setFontSize);
  const setCaptionFontStyle = useCaptionStore((s) => s.setFontStyle);
  const setCaptionPosition = useCaptionStore((s) => s.setPosition);
  const setCaptionBlur = useCaptionStore((s) => s.setBlur);
  const setBulkFadeIn = useCaptionStore((s) => s.setBulkFadeIn);
  const setBulkFadeOut = useCaptionStore((s) => s.setBulkFadeOut);
  const setBulkFadeInDuration = useCaptionStore((s) => s.setBulkFadeInDuration);
  const setBulkFadeOutDuration = useCaptionStore((s) => s.setBulkFadeOutDuration);
  const toggleCaptionLock = useCaptionStore((s) => s.toggleLock);
  const resetCaptions = useCaptionStore((s) => s.resetCaptions);

  // Log Store
  const logInfo = useLogStore((s) => s.info);
  const logWarn = useLogStore((s) => s.warn);
  const logError = useLogStore((s) => s.error);
  const logDebug = useLogStore((s) => s.debug);
  const updateMemoryStats = useLogStore((s) => s.updateMemoryStats);

  // === Local State ===
  const [reloadKey, setReloadKey] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [showProjectManager, setShowProjectManager] = useState(false);
  const [editingNarrationId, setEditingNarrationId] = useState<string | null>(null);
  const [aiScriptLength, setAiScriptLength] = useState<NarrationScriptLength>('medium');
  const [activeHelpSection, setActiveHelpSection] = useState<SectionHelpKey | null>(null);
  const [exportPreparationStep, setExportPreparationStep] = useState<ExportPreparationStep | null>(null);
  const [previewCacheStatus, setPreviewCacheStatus] = useState<PreviewCacheStatus>('idle');
  const [previewLoadingLabel, setPreviewLoadingLabel] = useState<string | undefined>(undefined);

  // Ref
  const mediaItemsRef = useRef<MediaItem[]>([]);
  const bgmRef = useRef<AudioTrack | null>(null);
  const narrationsRef = useRef<NarrationClip[]>([]);
  const totalDurationRef = useRef(0);
  const currentTimeRef = useRef(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mediaElementsRef = useRef<Record<string, HTMLVideoElement | HTMLImageElement | HTMLAudioElement>>({});
  const audioCtxRef = useRef<AudioContext | null>(null);
  const previewCacheVideoRef = useRef<HTMLVideoElement | null>(null);
  const previewCacheEntryRef = useRef<PreviewCacheEntry | null>(null);
  const previewCacheStatusRef = useRef<PreviewCacheStatus>('idle');
  const previewCacheKeyRef = useRef<string | null>(null);
  const previewCacheGenerationRef = useRef(0);
  const previewCachePlaybackActiveRef = useRef(false);
  const previewCacheHasBuiltOnceRef = useRef(false);

  // Audio Nodes
  const sourceNodesRef = useRef<Record<string, MediaElementAudioSourceNode>>({});
  const gainNodesRef = useRef<Record<string, GainNode>>({});
  const sourceElementsRef = useRef<Record<string, HTMLMediaElement>>({});
  const pendingAudioDetachTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const masterDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const audioRoutingModeRef = useRef<'preview' | 'export'>('preview');
  const reqIdRef = useRef<number | null>(null);
  const startTimeRef = useRef(0);
  const hiddenStartedAtRef = useRef<number | null>(null);
  const needsResyncAfterVisibilityRef = useRef(false);
  const audioResumeWaitFramesRef = useRef(0);
  const lastVisibilityRefreshAtRef = useRef(0);
  const loopIdRef = useRef(0); // ループの世代を追跡
  const isPlayingRef = useRef(false); // 再生状態を即座に反映するRef
  const isSeekingRef = useRef(false); // シーク中フラグ
  const activeVideoIdRef = useRef<string | null>(null); // 現在再生中のビデオID
  const lastToggleTimeRef = useRef(0); // デバウンス用
  const videoRecoveryAttemptsRef = useRef<Record<string, number>>({}); // ビデオリカバリー試行時刻を追跡
  const exportPlayFailedRef = useRef<Record<string, boolean>>({}); // エクスポート中にplay()が失敗した動画を追跡
  const exportFallbackSeekAtRef = useRef<Record<string, number>>({}); // フォールバックシーク実行時刻を追跡
  const seekingVideosRef = useRef<Set<string>>(new Set()); // シーク中のビデオIDを追跡
  const lastSeekTimeRef = useRef(0); // 最後のシーク時刻（スロットリング用）
  const pendingSeekRef = useRef<number | null>(null); // 保留中のシーク位置
  const wasPlayingBeforeSeekRef = useRef(false); // シーク前の再生状態を保持
  const wasExportProcessingRef = useRef(isProcessing);
  const exportCompletedRef = useRef(false);
  const exportFinalizingUiRef = useRef(false);
  const exportFinalizeWarningShownRef = useRef(false);
  const pendingSeekTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null); // 保留中のシーク処理用タイマー


  const playbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null); // 再生開始待機用タイマー
  const seekSettleGenerationRef = useRef(0);
  const previewPlaybackAttemptRef = useRef(0);
  const pendingPausedSeekWaitRef = useRef<{ cleanup: () => void } | null>(null);
  const previewAudioRouteRefreshInFlightRef = useRef<Promise<void> | null>(null);
  const lastIosSafariAudioLogRef = useRef<string>('');
  const requestPreviewAudioRouteRefreshRef = useRef<() => void>(() => { });
  const detachGlobalSeekEndListenersRef = useRef<(() => void) | null>(null);
  const handleSeekEndCallbackRef = useRef<(() => void) | null>(null);
  const renderPausedPreviewFrameAtTimeRef = useRef<(targetTime: number) => void>(() => { });
  const primePreviewAudioOnlyTracksAtTimeRef = useRef<(playbackTime: number) => void>(() => { });
  const cancelSeekPlaybackPrepareRef = useRef<(() => void) | null>(null);
  const isSeekPlaybackPreparingRef = useRef(false);
  const endFinalizedRef = useRef(false); // 終端ファイナライズ済みフラグ（遅延renderFrame競合防止）

  const captionsRef = useRef(captions);
  const captionSettingsRef = useRef(captionSettings);

  // --- 生成済み export クリアヘルパー ---
  // 停止・再生・編集操作時に呼び出し、古いダウンロードボタンを消す。
  // isProcessing 中は何もしない（エクスポート中断は別ルートに任せる）。
  const clearGeneratedExport = useCallback((reason: string) => {
    if (isProcessing) return;
    if (!exportUrl) return;

    clearExport();
    exportCompletedRef.current = false;
    exportFinalizingUiRef.current = false;
    exportFinalizeWarningShownRef.current = false;
    setExportPreparationStep(null);

    logInfo('RENDER', '[DIAG-UI] generated export cleared', {
      reason,
      hadExportUrl: true,
    });
  }, [
    clearExport,
    exportUrl,
    isProcessing,
    logInfo,
    setExportPreparationStep,
  ]);

  const pausePreviewBeforeEdit = useCallback((reason: string) => {
    clearGeneratedExport(`edit:${reason}`);

    if (isProcessing || !isPlayingRef.current) return;

    pause();
    isPlayingRef.current = false;

    if (reqIdRef.current !== null) {
      cancelAnimationFrame(reqIdRef.current);
      reqIdRef.current = null;
    }

    logInfo('SYSTEM', 'preview paused before edit', { reason });
  }, [clearGeneratedExport, isProcessing, pause, logInfo]);

  const withPreviewPause = useCallback(<T extends unknown[]>(reason: string, fn: (...args: T) => void) => {
    return (...args: T) => {
      pausePreviewBeforeEdit(reason);
      fn(...args);
    };
  }, [pausePreviewBeforeEdit]);

  // 描画が遅延実行されても最新状態を参照できるようにする
  captionsRef.current = captions;
  captionSettingsRef.current = captionSettings;

  const platformCapabilities = useMemo(() => previewRuntime.getPlatformCapabilities(), [previewRuntime]);
  const previewPlatformPolicy = useMemo(
    () => previewRuntime.getPreviewPlatformPolicy(platformCapabilities),
    [platformCapabilities, previewRuntime]
  );
  const useAndroidPreviewCacheForPlayback = useMemo(
    () => shouldUseAndroidPreviewCache({
      isAndroid: platformCapabilities.isAndroid,
      isIosSafari: platformCapabilities.isIosSafari,
      isExportMode: false,
      mediaItems,
    }),
    [mediaItems, platformCapabilities.isAndroid, platformCapabilities.isIosSafari],
  );
  const previewCacheKey = useMemo(
    () => createAndroidPreviewCacheKey({
      mediaItems,
      bgm,
      narrations,
      captions,
      captionSettings,
      canvasWidth,
      canvasHeight,
      fps: 30,
    }),
    [bgm, captionSettings, captions, mediaItems, narrations, canvasWidth, canvasHeight],
  );
  const supportsShowSaveFilePicker = platformCapabilities.supportsShowSaveFilePicker;
  const supportsShowOpenFilePicker = platformCapabilities.supportsShowOpenFilePicker;
  const shouldUseMediaPicker = shouldUseMediaOpenFilePicker(platformCapabilities);
  const refreshSaveHealth = useProjectStore((s) => s.refreshSaveHealth);

  const mediaTimelineRanges = useMemo(() => {
    let timelineStart = 0;
    const ranges: Record<string, { start: number; end: number }> = {};
    for (const item of mediaItems) {
      const duration = Number.isFinite(item.duration) ? Math.max(0, item.duration) : 0;
      const start = timelineStart;
      const end = start + duration;
      ranges[item.id] = { start, end };
      timelineStart = end;
    }
    return ranges;
  }, [mediaItems]);

  // Hooks
  const {
    recorderRef,
    startExport: startWebCodecsExport,
    stopExport: stopWebCodecsExport,
    completeExport: completeWebCodecsExport,
  } = exportRuntime.useExport();
  const {
    startExport: startPreviewCacheExport,
    stopExport: stopPreviewCacheExport,
    completeExport: completePreviewCacheExport,
  } = exportRuntime.useExport();

  useEffect(() => {
    saveRuntime.configureProjectStore();
    void refreshSaveHealth(saveRuntime.getPersistenceHealth);
    const exportLaunchDiagnostics = exportRuntime.getLaunchDiagnostics?.();
    if (exportLaunchDiagnostics) {
      useLogStore.getState().info('SYSTEM', 'エクスポートランタイム診断を記録', exportLaunchDiagnostics);
    }
  }, [exportRuntime, refreshSaveHealth, saveRuntime]);

  useEffect(() => {
    if (!offlineMode || !showAiModal) return;
    setEditingNarrationId(null);
    closeAiModal();
  }, [offlineMode, showAiModal, closeAiModal]);

  // --- 動的キャンバスサイズ: 最初のビデオメディアの解像度に応じて
  // エクスポート用キャンバスサイズを更新する（1920×1080 上限、横向き固定）。
  useEffect(() => {
    const firstVideo = mediaItems.find((item) => item.type === 'video');
    if (!firstVideo) {
      resetCanvasSize();
      return;
    }
    if (firstVideo.sourceWidth && firstVideo.sourceHeight) {
      applyCanvasFromSource(firstVideo.sourceWidth, firstVideo.sourceHeight);
    }
  }, [mediaItems, resetCanvasSize, applyCanvasFromSource]);

  // --- メモリ監視（10秒ごと） ---
  useEffect(() => {
    // 初回実行
    updateMemoryStats();

    const intervalId = setInterval(() => {
      updateMemoryStats();
    }, 10000); // 10秒ごと

    return () => clearInterval(intervalId);
  }, [updateMemoryStats]);

  const cancelPendingPausedSeekWait = useCallback(() => {
    const pendingWait = pendingPausedSeekWaitRef.current;
    if (pendingWait) {
      pendingWait.cleanup();
      pendingPausedSeekWaitRef.current = null;
    }
    if (playbackTimeoutRef.current) {
      clearTimeout(playbackTimeoutRef.current);
      playbackTimeoutRef.current = null;
    }
  }, []);

  const cancelPendingSeekPlaybackPrepare = useCallback(() => {
    if (cancelSeekPlaybackPrepareRef.current) {
      cancelSeekPlaybackPrepareRef.current();
      cancelSeekPlaybackPrepareRef.current = null;
    }
    isSeekPlaybackPreparingRef.current = false;
  }, []);

  const detachGlobalSeekEndListeners = useCallback(() => {
    if (detachGlobalSeekEndListenersRef.current) {
      detachGlobalSeekEndListenersRef.current();
      detachGlobalSeekEndListenersRef.current = null;
    }
  }, []);

  const attachGlobalSeekEndListeners = useCallback(() => {
    if (detachGlobalSeekEndListenersRef.current || typeof window === 'undefined') {
      return;
    }

    const onSeekInteractionEnd = () => {
      if (!isSeekingRef.current) return;
      handleSeekEndCallbackRef.current?.();
    };

    window.addEventListener('pointerup', onSeekInteractionEnd);
    window.addEventListener('pointercancel', onSeekInteractionEnd);
    window.addEventListener('mouseup', onSeekInteractionEnd);
    window.addEventListener('touchend', onSeekInteractionEnd);
    window.addEventListener('touchcancel', onSeekInteractionEnd);
    window.addEventListener('blur', onSeekInteractionEnd);

    detachGlobalSeekEndListenersRef.current = () => {
      window.removeEventListener('pointerup', onSeekInteractionEnd);
      window.removeEventListener('pointercancel', onSeekInteractionEnd);
      window.removeEventListener('mouseup', onSeekInteractionEnd);
      window.removeEventListener('touchend', onSeekInteractionEnd);
      window.removeEventListener('touchcancel', onSeekInteractionEnd);
      window.removeEventListener('blur', onSeekInteractionEnd);
    };
  }, []);

  useEffect(() => {
    return () => {
      detachGlobalSeekEndListeners();
    };
  }, [detachGlobalSeekEndListeners]);

  useEffect(() => {
    return () => {
      cancelPendingSeekPlaybackPrepare();
    };
  }, [cancelPendingSeekPlaybackPrepare]);

  const clearExportUiState = useCallback(() => {
    setProcessing(false);
    setLoading(false);
    setExportPreparationStep(null);
  }, [setExportPreparationStep, setLoading, setProcessing]);

  const clearPreviewCacheEntry = useCallback((options?: { revokeUrl?: boolean }) => {
    const previousUrl = previewCacheEntryRef.current?.url ?? null;
    previewCacheEntryRef.current = null;
    previewCachePlaybackActiveRef.current = false;

    if (previewCacheVideoRef.current) {
      try {
        previewCacheVideoRef.current.pause();
        previewCacheVideoRef.current.removeAttribute('src');
        previewCacheVideoRef.current.load();
      } catch {
        /* ignore */
      }
    }

    if (!options?.revokeUrl || !previousUrl) {
      return;
    }

    try {
      URL.revokeObjectURL(previousUrl);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    previewCacheStatusRef.current = previewCacheStatus;
  }, [previewCacheStatus]);

  useEffect(() => {
    previewCacheKeyRef.current = previewCacheKey;
  }, [previewCacheKey]);

  useEffect(() => {
    const shouldKeepCache = useAndroidPreviewCacheForPlayback;
    const currentEntry = previewCacheEntryRef.current;
    const shouldInvalidate =
      !shouldKeepCache
      || (currentEntry !== null && currentEntry.cacheKey !== previewCacheKey);

    if (!shouldInvalidate) {
      return;
    }

    const wasPreparing = previewCacheStatusRef.current === 'preparing';
    const hadReadyCache = previewCacheStatusRef.current === 'ready' && currentEntry !== null;

    previewCacheGenerationRef.current += 1;
    previewCacheStatusRef.current = 'idle';
    setPreviewCacheStatus('idle');
    setPreviewLoadingLabel(undefined);
    clearPreviewCacheEntry({ revokeUrl: true });

    if (wasPreparing) {
      stopPreviewCacheExport({ silent: true, reason: 'superseded' });
    }

    if (hadReadyCache || wasPreparing) {
      logInfo('RENDER', 'preview.cache.invalidated', {
        reason: shouldKeepCache ? 'timeline-updated' : 'android-preview-cache-disabled',
        fallback: 'live-element-preview',
      });
    }
  }, [clearPreviewCacheEntry, logInfo, previewCacheKey, stopPreviewCacheExport, useAndroidPreviewCacheForPlayback]);

  useEffect(() => {
    return () => {
      clearPreviewCacheEntry({ revokeUrl: true });
    };
  }, [clearPreviewCacheEntry]);

  const handleExportCompleteUi = useCallback(() => {
    logInfo('RENDER', '[DIAG-UI] export complete callback received', {
      urlPresent: true,
      ext: exportExt,
    });
    exportCompletedRef.current = true;
    exportFinalizingUiRef.current = false;
    exportFinalizeWarningShownRef.current = false;
    logInfo('RENDER', '[DIAG-UI] export url committed to UI', {
      urlPresent: true,
      ext: exportExt,
    });
    clearExportUiState();
  }, [clearExportUiState, exportExt, logInfo]);

  useEffect(() => {
    const wasProcessing = wasExportProcessingRef.current;
    wasExportProcessingRef.current = isProcessing;

    if (exportUrl) {
      if (!exportCompletedRef.current) {
        handleExportCompleteUi();
      } else {
        exportFinalizingUiRef.current = false;
        exportFinalizeWarningShownRef.current = false;
        clearExportUiState();
      }
      return;
    }

    if (wasProcessing && !isProcessing) {
      exportFinalizingUiRef.current = false;
      exportFinalizeWarningShownRef.current = false;
      clearExportUiState();
    }
  }, [clearExportUiState, exportUrl, handleExportCompleteUi, isProcessing]);

  useEffect(() => {
    const isFinalizing =
      isProcessing
      && totalDuration > 0
      && currentTime >= totalDuration - EXPORT_FINALIZING_EPSILON_SEC
      && !exportUrl;
    exportFinalizingUiRef.current = isFinalizing;
    if (!isFinalizing) {
      exportFinalizeWarningShownRef.current = false;
    }
  }, [currentTime, exportUrl, isProcessing, totalDuration]);

  // --- Audio Context ---
  const getAudioContext = useCallback(() => {
    if (!audioCtxRef.current) {
      const AC = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      const ctx = new AC();
      audioCtxRef.current = ctx;
      masterDestRef.current = ctx.createMediaStreamDestination();
    }
    return audioCtxRef.current;
  }, []);

  const { resetInactiveVideos } = previewRuntime.useInactiveVideoManager({
    mediaItemsRef,
    mediaElementsRef,
    sourceNodesRef,
    activeVideoIdRef,
    previewPlatformPolicy,
  });

  const {
    detachAudioNode,
    ensureAudioNodeForElement,
    preparePreviewAudioNodesForTime,
    preparePreviewAudioNodesForUpcomingVideos,
    primePreviewAudioOnlyTracksAtTime,
    handleMediaRefAssign,
  } = previewRuntime.usePreviewAudioSession({
    mediaItemsRef,
    bgmRef,
    narrationsRef,
    totalDurationRef,
    currentTimeRef,
    mediaElementsRef,
    audioCtxRef,
    sourceNodesRef,
    gainNodesRef,
    sourceElementsRef,
    pendingAudioDetachTimersRef,
    masterDestRef,
    audioRoutingModeRef,
    previewAudioRouteRefreshInFlightRef,
    lastIosSafariAudioLogRef,
    requestPreviewAudioRouteRefreshRef,
    primePreviewAudioOnlyTracksAtTimeRef,
    previewPlaybackAttemptRef,
    isPlayingRef,
    isSeekingRef,
    previewPlatformPolicy,
    isIosSafari: platformCapabilities.isIosSafari,
    bgm,
    narrations,
    isProcessing,
    getAudioContext,
    logInfo,
    logWarn,
  });

  const {
    handleMediaElementLoaded,
    handleSeeked,
    handleVideoLoadedData,
    renderFrame,
    stopAll,
    loop,
    startEngine,
  } = previewRuntime.usePreviewEngine({
    captions,
    captionSettings,
    mediaItemsRef,
    bgmRef,
    narrationsRef,
    captionsRef,
    captionSettingsRef,
    totalDurationRef,
    currentTimeRef,
    canvasRef,
    mediaElementsRef,
    audioCtxRef,
    sourceNodesRef,
    gainNodesRef,
    masterDestRef,
    audioRoutingModeRef,
    reqIdRef,
    startTimeRef,
    audioResumeWaitFramesRef,
    recorderRef,
    loopIdRef,
    isPlayingRef,
    isSeekingRef,
    isSeekPlaybackPreparingRef,
    activeVideoIdRef,
    videoRecoveryAttemptsRef,
    exportPlayFailedRef,
    exportFallbackSeekAtRef,
    seekingVideosRef,
    pendingSeekRef,
    wasPlayingBeforeSeekRef,
    pendingSeekTimeoutRef,
    previewPlaybackAttemptRef,
    requestPreviewAudioRouteRefreshRef,
    primePreviewAudioOnlyTracksAtTimeRef,
    endFinalizedRef,
    previewCacheEnabled: useAndroidPreviewCacheForPlayback,
    previewCacheKeyRef,
    previewCacheStatusRef,
    previewCacheEntryRef,
    previewCacheVideoRef,
    previewCacheGenerationRef,
    previewCachePlaybackActiveRef,
    previewCacheHasBuiltOnceRef,
    setPreviewCacheStatus,
    setPreviewLoadingLabel,
    previewPlatformPolicy,
    platformCapabilities,
    setVideoDuration,
    setCurrentTime,
    setProcessing,
    setPreviewPlaying,
    setLoading,
    setExportPreparationStep,
    setExportUrl,
    setExportExt,
    clearExport,
    setError,
    play,
    pause,
    getAudioContext,
    cancelPendingPausedSeekWait,
    cancelPendingSeekPlaybackPrepare,
    detachGlobalSeekEndListeners,
    ensureAudioNodeForElement,
    detachAudioNode,
    preparePreviewAudioNodesForTime,
    preparePreviewAudioNodesForUpcomingVideos,
    primePreviewAudioOnlyTracksAtTime,
    resetInactiveVideos,
    startWebCodecsExport,
    stopWebCodecsExport,
    completeWebCodecsExport,
    startPreviewCacheExport,
    stopPreviewCacheExport,
    completePreviewCacheExport,
    logInfo,
    logWarn,
    logDebug,
  });

  // --- 状態同期: Zustandの状態をRefに同期 ---
  // 目的: renderFrame等の非同期処理で最新の状態を参照できるようにする
  useEffect(() => {
    mediaItemsRef.current = mediaItems;
    totalDurationRef.current = totalDuration;
  }, [mediaItems, totalDuration]);

  // --- 再描画トリガー: メディア構成変更時のキャンバス更新 ---
  // 目的: メディアの追加・削除・リロード時にプレビューを更新
  // 補足: 削除で空になった場合も最後のフレームを残さないよう必ず再描画する
  useEffect(() => {
    if (isPlaying || isProcessing) return;

    const hasMedia = mediaItems.length > 0;
    const targetTime = hasMedia
      ? Math.max(0, Math.min(currentTimeRef.current, totalDuration))
      : 0;

    if (Math.abs(currentTimeRef.current - targetTime) > 0.001) {
      currentTimeRef.current = targetTime;
      setCurrentTime(targetTime);
    }

    // メディアがある場合のみ少し待って描画（要素準備待ち）
    const timeoutId = setTimeout(() => {
      renderFrame(targetTime, false);
    }, hasMedia ? 100 : 0);

    return () => clearTimeout(timeoutId);
  }, [mediaItems.length, totalDuration, reloadKey, isPlaying, isProcessing, renderFrame, setCurrentTime]);

  // --- BGM状態の同期 ---
  // 目的: BGMトラックの最新状態をRefに保持
  useEffect(() => {
    bgmRef.current = bgm;
  }, [bgm]);

  // --- ナレーション状態の同期 ---
  // 目的: ナレーショントラックの最新状態をRefに保持
  useEffect(() => {
    narrationsRef.current = narrations;
  }, [narrations]);

  // --- コンポーネントアンマウント時のクリーンアップ ---
  // 目的: メモリリークを防止し、リソースを適切に解放
  useEffect(() => {
    return () => {
      // Cancel animation frame
      if (reqIdRef.current) {
        cancelAnimationFrame(reqIdRef.current);
        reqIdRef.current = null;
      }

      // Stop and close AudioContext
      if (audioCtxRef.current) {
        try {
          audioCtxRef.current.close();
        } catch (e) {
          console.error('Error closing AudioContext:', e);
        }
        audioCtxRef.current = null;
      }

      // Stop MediaRecorder
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        try {
          recorderRef.current.stop();
        } catch (e) {
          /* ignore */
        }
        recorderRef.current = null;
      }

      // Pause all media elements
      Object.values(mediaElementsRef.current).forEach((el) => {
        if (el && (el.tagName === 'VIDEO' || el.tagName === 'AUDIO')) {
          try {
            (el as HTMLMediaElement).pause();
          } catch (e) {
            /* ignore */
          }
        }
      });

      Object.values(pendingAudioDetachTimersRef.current).forEach((timer) => {
        clearTimeout(timer);
      });
      pendingAudioDetachTimersRef.current = {};
      sourceElementsRef.current = {};
    };
  }, []);

  previewRuntime.usePreviewVisibilityLifecycle({
    mediaElementsRef,
    mediaItemsRef,
    bgmRef,
    narrationsRef,
    activeVideoIdRef,
    currentTimeRef,
    totalDurationRef,
    hiddenStartedAtRef,
    needsResyncAfterVisibilityRef,
    startTimeRef,
    audioResumeWaitFramesRef,
    lastVisibilityRefreshAtRef,
    isPlayingRef,
    isSeekingRef,
    audioCtxRef,
    isProcessing,
    previewPlatformPolicy,
    cancelPendingSeekPlaybackPrepare,
    cancelPendingPausedSeekWait,
    renderFrame,
    renderPausedPreviewFrameAtTimeRef,
    pause,
    logInfo,
    logWarn,
  });

  // --- Gemini API Helpers ---
  const pcmToWav = useCallback((pcmData: ArrayBuffer, sampleRate: number): ArrayBuffer => {
    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
    const blockAlign = (numChannels * bitsPerSample) / 8;
    const dataSize = pcmData.byteLength;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    const writeString = (v: DataView, offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) {
        v.setUint8(offset + i, str.charCodeAt(i));
      }
    };

    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);
    writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);

    const pcmView = new Uint8Array(pcmData);
    const wavView = new Uint8Array(buffer, 44);
    wavView.set(pcmView);

    return buffer;
  }, []);

  const generateScript = useCallback(async () => {
    const trimmedPrompt = aiPrompt.trim();
    if (!trimmedPrompt) return;
    if (offlineMode) return;
    const apiKey = getApiKey();
    if (!apiKey) {
      setError('APIキーが設定されていません。右上の歯車アイコンから設定してください。');
      return;
    }
    setAiLoading(true);
    try {
      const modelsToTry = [GEMINI_SCRIPT_MODEL, ...GEMINI_SCRIPT_FALLBACK_MODELS]
        .filter((model, idx, arr) => arr.indexOf(model) === idx);
      const lengthTargetByMode: Record<NarrationScriptLength, string> = {
        short: '約5秒（20〜35文字）',
        medium: '約10秒（35〜60文字）',
        long: '約20秒（100〜140文字）',
      };
      const selectedLengthTarget = lengthTargetByMode[aiScriptLength];

      const systemInstruction = [
        'あなたは日本語の動画ナレーション原稿を作るプロです。',
        '出力は読み上げる本文のみ、1段落、1つだけ返してください。',
        '挨拶・見出し・箇条書き・注釈・引用符・絵文字は禁止です。',
        'テーマに沿って、短尺動画で使える自然な口語文にしてください。',
        '選択された長さ（短め=約5秒 / 中くらい=約10秒 / 長め=約20秒）を優先してください。',
        `文字数は${selectedLengthTarget}を目安にし、聞き取りやすい短文中心にしてください。`,
      ].join('\n');

      const userPrompt = [
        `テーマ: ${trimmedPrompt}`,
        '用途: 短い動画のナレーション',
        `希望する長さ: ${selectedLengthTarget}`,
        '出力: ナレーション本文のみ',
      ].join('\n');

      type ScriptPart = { text?: string };
      type ScriptCandidate = { content?: { parts?: ScriptPart[] } };
      type ScriptResponse = { candidates?: ScriptCandidate[] };

      const normalizeNarrationScript = (rawText: string): string => {
        const withoutFence = rawText
          .replace(/```[\s\S]*?```/g, (block) => block.replace(/```[a-zA-Z]*\n?/g, '').replace(/```/g, ''));
        const flattened = withoutFence
          .replace(/\r?\n+/g, ' ')
          .replace(/^(原稿案|ナレーション|台本)\s*[:：]\s*/i, '')
          .replace(/\s{2,}/g, ' ')
          .trim();
        return flattened.replace(/^[「『"']+|[」』"']+$/g, '').trim();
      };

      let lastErrorMessage = 'スクリプトの生成に失敗しました';
      for (let i = 0; i < modelsToTry.length; i++) {
        const model = modelsToTry[i];
        const hasNextModel = i < modelsToTry.length - 1;

        const response = await fetch(`${GEMINI_API_BASE_URL}/${model}:generateContent`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          referrerPolicy: 'no-referrer',
          body: JSON.stringify({
            systemInstruction: {
              parts: [{ text: systemInstruction }],
            },
            contents: [
              {
                parts: [{ text: userPrompt }],
              },
            ],
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({} as { error?: { message?: string } }));
          const errorMessage = errorData.error?.message || `HTTP ${response.status}: ${response.statusText}`;
          lastErrorMessage = errorMessage;
          const isModelUnavailable = /no longer available|not found|404|model.+(available|found)/i.test(errorMessage);
          if (hasNextModel && isModelUnavailable) {
            console.warn('Script model unavailable. Retrying with fallback model.', { model, errorMessage });
            continue;
          }
          throw new Error(errorMessage);
        }

        const data = (await response.json()) as ScriptResponse;
        const rawText = (data.candidates ?? [])
          .flatMap((candidate) => candidate.content?.parts ?? [])
          .map((part) => (typeof part.text === 'string' ? part.text : ''))
          .join('\n')
          .trim();
        const script = normalizeNarrationScript(rawText);

        if (script) {
          setAiScript(script);
          if (model !== GEMINI_SCRIPT_MODEL) {
            showToast('スクリプト生成モデルを自動切替して生成しました。');
          }
          return;
        }

        lastErrorMessage = 'スクリプトの生成結果が空です';
        if (hasNextModel) {
          console.warn('Script text was empty. Retrying with fallback model.', { model });
          continue;
        }
      }

      throw new Error(lastErrorMessage);
    } catch (e) {
      console.error('Script generation error:', e);
      if (e instanceof TypeError && e.message.includes('fetch')) {
        // ネットワーク系エラーは下の共通ハンドリングへフォールスルー
      } else if (e instanceof Error) {
        // Quota/Limitエラーの判定
        const lowerMsg = e.message.toLowerCase();
        if (lowerMsg.includes('quota') || lowerMsg.includes('limit') || lowerMsg.includes('429')) {
          setError('スクリプト生成のリミットに達しました。しばらく待ってから再試行してください。');
        } else {
          setError(`スクリプト生成エラー: ${e.message}`);
        }
      } else {
        setError('スクリプト生成に失敗しました');
      }
    } finally {
      setAiLoading(false);
    }
  }, [aiPrompt, aiScriptLength, offlineMode, setAiLoading, setAiScript, setError, showToast]);

  const generateSpeech = useCallback(async () => {
    if (!aiScript) return;
    if (offlineMode) return;
    const apiKey = getApiKey();
    if (!apiKey) {
      setError('APIキーが設定されていません。右上の歯車アイコンから設定してください。');
      return;
    }
    setAiLoading(true);
    try {
      const transcript = aiScript.trim();
      const styleText = aiVoiceStyle.trim();
      const normalizedStyleText = styleText
        // 先頭/末尾に括弧が入力されていても二重括弧にならないように整形
        .replace(/^[\s()（）]+/, '')
        .replace(/[\s()（）]+$/, '');
      const styleDirectiveText = normalizedStyleText ? `（${normalizedStyleText}）` : '';
      const styledText = `${styleDirectiveText}${transcript}`;
      const styledPrompt = normalizedStyleText
        ? [
            'Generate Japanese TTS audio.',
            'The leading parenthesized style directive is NOT part of narration and must never be spoken.',
            'Speak only the narration body that follows the directive.',
            'Do not add extra words.',
            `Input: ${styledText}`,
          ].join('\n')
        : `Say the following Japanese text:\n${transcript}`;
      const plainPrompt = `Say the following Japanese text:\n${transcript}`;
      const strictPrompt = `TTS the following text exactly as written. Do not add any extra words.\n${transcript}`;

      const requestTts = (text: string) =>
        fetch(`${GEMINI_API_BASE_URL}/${GEMINI_TTS_MODEL}:generateContent`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          referrerPolicy: 'no-referrer',
          body: JSON.stringify({
            contents: [{ parts: [{ text }] }],
            generationConfig: {
              responseModalities: ['AUDIO'],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName: aiVoice },
                },
              },
            },
          }),
        });

      const readTtsErrorMessage = async (res: Response): Promise<string> => {
        const errorData = await res.json().catch(() => ({} as { error?: { message?: string } }));
        return errorData.error?.message || `HTTP ${res.status}: ${res.statusText}`;
      };

      type TtsInlineData = { data?: string; mimeType?: string };
      type TtsPart = { text?: string; inlineData?: TtsInlineData; inline_data?: TtsInlineData };
      type TtsCandidate = { finishReason?: string; content?: { parts?: TtsPart[] } };
      type TtsResponse = { candidates?: TtsCandidate[]; promptFeedback?: { blockReason?: string } };
      type TtsAttempt = {
        label: 'style' | 'plain' | 'strict';
        prompt: string;
        usedStyle: boolean;
      };

      const parseTtsResponse = (data: TtsResponse) => {
        const candidates = Array.isArray(data.candidates) ? data.candidates : [];
        const parts = candidates.flatMap((candidate) => (Array.isArray(candidate.content?.parts) ? candidate.content.parts : []));
        const inlineData = parts
          .map((part) => part.inlineData ?? part.inline_data)
          .find((candidateInlineData): candidateInlineData is TtsInlineData & { data: string } =>
            typeof candidateInlineData?.data === 'string' && candidateInlineData.data.length > 0
          );
        const hasTextPart = parts.some((part) => typeof part.text === 'string' && part.text.trim().length > 0);
        const finishReason = candidates.map((candidate) => candidate.finishReason).find((reason) => !!reason);
        return {
          inlineData,
          hasTextPart,
          finishReason,
          blockReason: data.promptFeedback?.blockReason,
          partsCount: parts.length,
        };
      };

      const attempts: TtsAttempt[] = styleText
        ? [
            { label: 'style', prompt: styledPrompt, usedStyle: true },
            { label: 'plain', prompt: plainPrompt, usedStyle: false },
          ]
        : [
            { label: 'plain', prompt: plainPrompt, usedStyle: false },
            { label: 'strict', prompt: strictPrompt, usedStyle: false },
          ];

      let resolvedInlineData: (TtsInlineData & { data: string }) | null = null;
      let resolvedAttempt: TtsAttempt | null = null;
      let lastFinishReason: string | undefined;
      let lastBlockReason: string | undefined;
      let lastHttpError: string | undefined;

      for (let i = 0; i < attempts.length; i++) {
        const attempt = attempts[i];
        const hasNext = i < attempts.length - 1;
        const response = await requestTts(attempt.prompt);

        if (!response.ok) {
          const errorMessage = await readTtsErrorMessage(response);
          lastHttpError = errorMessage;
          const retryableHttpError = /model tried to generate text|only be used for tts|response modalities/i.test(errorMessage);
          if (hasNext && retryableHttpError) {
            console.warn('TTS attempt failed and will retry with fallback prompt/model.', {
              label: attempt.label,
              errorMessage,
            });
            continue;
          }
          throw new Error(errorMessage);
        }

        const data = (await response.json()) as TtsResponse;
        const parsed = parseTtsResponse(data);
        if (parsed.inlineData) {
          resolvedInlineData = parsed.inlineData;
          resolvedAttempt = attempt;
          lastFinishReason = parsed.finishReason;
          lastBlockReason = parsed.blockReason;
          break;
        }

        lastFinishReason = parsed.finishReason;
        lastBlockReason = parsed.blockReason;
        if (hasNext) {
          console.warn('TTS attempt returned no inline audio data. Retrying with fallback.', {
            label: attempt.label,
            finishReason: parsed.finishReason,
            blockReason: parsed.blockReason,
            hasTextPart: parsed.hasTextPart,
            partsCount: parsed.partsCount,
          });
          continue;
        }
      }

      if (!resolvedInlineData) {
        if (lastHttpError) {
          throw new Error(lastHttpError);
        }
        if (lastBlockReason) {
          throw new Error(`音声生成がブロックされました: ${lastBlockReason}`);
        }
        const reasonSuffix = lastFinishReason ? ` (${lastFinishReason})` : '';
        throw new Error(`音声データを取得できませんでした${reasonSuffix}`);
      }

      if (styleText && resolvedAttempt && !resolvedAttempt.usedStyle) {
        showToast('声の調子指定は適用できなかったため、通常の読み上げで生成しました。', 5000);
      }

      const binaryString = window.atob(resolvedInlineData.data);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const normalizedMimeType = resolvedInlineData.mimeType?.toLowerCase() || '';
      const payloadIsWav = normalizedMimeType.includes('audio/wav') || normalizedMimeType.includes('audio/x-wav');
      const wavBuffer = payloadIsWav ? bytes.buffer : pcmToWav(bytes.buffer, TTS_SAMPLE_RATE);
      const wavBlob = new Blob([wavBuffer], { type: 'audio/wav' });
      const blobUrl = URL.createObjectURL(wavBlob);

      const audio = new Audio(blobUrl);
      audio.onloadedmetadata = () => {
        const voiceLabel = VOICE_OPTIONS.find((v) => v.id === aiVoice)?.label || 'AI音声';
        const currentNarrationName = editingNarrationId
          ? narrations.find((item) => item.id === editingNarrationId)?.file.name
          : null;
        const narrationFile = new File(
          [wavBlob],
          resolveAiNarrationFileName({
            currentName: currentNarrationName,
            voiceLabel,
          }),
          { type: 'audio/wav' },
        );
        const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
        if (editingNarrationId) {
          replaceNarrationAudio(editingNarrationId, {
            file: narrationFile,
            url: blobUrl,
            blobUrl,
            duration,
            sourceType: 'ai',
            isAiEditable: true,
            aiScript,
            aiVoice,
            aiVoiceStyle,
          });
          updateNarrationMeta(editingNarrationId, {
            aiScript,
            aiVoice,
            aiVoiceStyle,
          });
          setEditingNarrationId(null);
        } else {
          addNarration(
            createNarrationClip({
              file: narrationFile,
              url: blobUrl,
              blobUrl,
              duration,
              startTime: currentTimeRef.current,
              sourceType: 'ai',
              aiScript,
              aiVoice,
              aiVoiceStyle,
            })
          );
        }
        closeAiModal();
        clearError();
      };
      audio.onerror = () => {
        URL.revokeObjectURL(blobUrl);
        setError('生成された音声の読み込みに失敗しました');
        setAiLoading(false);
      };
    } catch (e) {
      console.error('Speech generation error:', e);
      if (e instanceof TypeError && e.message.includes('fetch')) {
        setError('ネットワークエラー: インターネット接続を確認してください');
      } else if (e instanceof Error) {
        // Quota/Limitエラーの判定
        const lowerMsg = e.message.toLowerCase();
        if (lowerMsg.includes('quota') || lowerMsg.includes('limit') || lowerMsg.includes('429')) {
          setError('音声生成のリミットに達しました。しばらく待ってから再試行してください。');
        } else {
          setError(`音声生成エラー: ${e.message}`);
        }
      } else {
        setError('音声生成に失敗しました');
      }
    } finally {
      setAiLoading(false);
    }
  }, [
    aiScript,
    aiVoice,
    aiVoiceStyle,
    editingNarrationId,
    pcmToWav,
    replaceNarrationAudio,
    updateNarrationMeta,
    addNarration,
    closeAiModal,
    clearError,
    showToast,
    setError,
    setAiLoading,
    narrations,
    offlineMode,
  ]);

  // --- アップロード処理 ---
  const processUploadedMediaFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    pausePreviewBeforeEdit('add-media');
    const ctx = getAudioContext();
    if ((ctx.state as AudioContextState | 'interrupted') !== 'running') {
      ctx.resume().catch(console.error);
    }
    clearExport();
    await addMediaItems(files);
    files.forEach(file => {
      logInfo('MEDIA', `メディア追加: ${file.name}`, {
        type: file.type.startsWith('video/') ? 'video' : 'image',
        fileName: file.name,
        fileSize: file.size,
      });
    });
  }, [pausePreviewBeforeEdit, getAudioContext, clearExport, addMediaItems, logInfo]);

  const handleMediaUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      try {
        const files = Array.from(e.target.files || []);
        e.target.value = '';
        await processUploadedMediaFiles(files);
      } catch (err) {
        setError('メディアの読み込みエラー');
        logError('MEDIA', 'メディア読み込みエラー', { error: String(err) });
      }
    },
    [processUploadedMediaFiles, setError, logError]
  );

  const handleOpenMediaPicker = useCallback(async () => {
    if (!supportsShowOpenFilePicker) return;

    try {
      const files = await openFilesWithPicker({
        multiple: true,
        types: [
          {
            description: '動画・画像',
            accept: {
              'video/*': ['.mp4', '.mov', '.m4v', '.webm'],
              'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.heic', '.heif'],
            },
          },
        ],
      });
      await processUploadedMediaFiles(files);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }
      setError('メディアの読み込みエラー');
      logError('MEDIA', 'メディアピッカー起動エラー', { error: String(err) });
    }
  }, [supportsShowOpenFilePicker, processUploadedMediaFiles, setError, logError]);

  // --- 動画トリミング更新ハンドラ ---
  // 目的: トリミングスライダー操作時に動画のカット位置を変更
  // 注意: 対象動画のみシークし、他の動画には影響しない
  const handleUpdateVideoTrim = useCallback(
    (id: string, type: 'start' | 'end', value: string) => {
      let val = parseFloat(value);
      if (isNaN(val)) val = 0;

      pausePreviewBeforeEdit('update-video-trim');

      // ストアを更新
      updateVideoTrim(id, type, val);

      // 対象動画の再生位置をトリミング位置に合わせる
      const item = mediaItems.find((v) => v.id === id);
      if (item) {
        const el = mediaElementsRef.current[id] as HTMLVideoElement;
        if (el && el.tagName === 'VIDEO' && !el.seeking) {
          const newStart = type === 'start' ? Math.max(0, Math.min(val, item.trimEnd - 0.1)) : item.trimStart;
          const newEnd = type === 'end' ? Math.min(item.originalDuration, Math.max(val, item.trimStart + 0.1)) : item.trimEnd;
          const seekTime = type === 'start' ? newStart : Math.max(newStart, newEnd - 0.1);
          if (Number.isFinite(seekTime)) {
            el.currentTime = Math.max(0, Math.min(item.originalDuration, seekTime));
          }
        }
      }
    },
    [pausePreviewBeforeEdit, updateVideoTrim, mediaItems]
  );

  // --- 画像表示時間更新ハンドラ ---
  // 目的: 画像クリップの表示時間を変更
  const handleUpdateImageDuration = useCallback((id: string, newDuration: string) => {
    let val = parseFloat(newDuration);
    if (isNaN(val) || val < 0.5) val = 0.5;
    pausePreviewBeforeEdit('update-image-duration');
    updateImageDuration(id, val);
  }, [pausePreviewBeforeEdit, updateImageDuration]);

  // --- スケール更新ハンドラ ---
  // 目的: メディアの拡大率を変更
  const handleUpdateMediaScale = useCallback((id: string, value: string | number) => {
    let val = typeof value === 'number' ? value : parseFloat(value);
    if (isNaN(val)) val = 1.0;
    pausePreviewBeforeEdit('update-media-scale');
    updateScale(id, val);
  }, [pausePreviewBeforeEdit, updateScale]);

  // --- 位置更新ハンドラ ---
  // 目的: メディアの表示位置（X/Y座標）を変更
  const handleUpdateMediaPosition = useCallback((id: string, axis: 'x' | 'y', value: string) => {
    let val = parseFloat(value);
    if (isNaN(val)) val = 0;
    pausePreviewBeforeEdit('update-media-position');
    updatePosition(id, axis, val);
  }, [pausePreviewBeforeEdit, updatePosition]);

  // --- 設定リセットハンドラ ---
  // 目的: スケールまたは位置を初期値にリセット
  const handleResetMediaSetting = useCallback((id: string, type: 'scale' | 'x' | 'y') => {
    pausePreviewBeforeEdit('reset-media-transform');
    resetTransform(id, type);
  }, [pausePreviewBeforeEdit, resetTransform]);

  // --- メディア順序変更ハンドラ ---
  // 目的: クリップの再生順序を上下に移動
  const handleMoveMedia = useCallback(
    (idx: number, dir: 'up' | 'down') => {
      pausePreviewBeforeEdit('move-media');
      moveMediaItem(idx, dir);
    },
    [pausePreviewBeforeEdit, moveMediaItem]
  );

  // --- メディア削除ハンドラ ---
  // 目的: クリップを削除し、関連するオーディオノードを解放
  const handleRemoveMedia = useCallback((id: string) => {
    pausePreviewBeforeEdit('remove-media');
    const pendingTimer = pendingAudioDetachTimersRef.current[id];
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      delete pendingAudioDetachTimersRef.current[id];
    }

    // オーディオノードを解放
    if (sourceNodesRef.current[id]) {
      try {
        sourceNodesRef.current[id].disconnect();
      } catch (e) {
        /* ignore */
      }
      delete sourceNodesRef.current[id];
    }
    if (gainNodesRef.current[id]) {
      try {
        gainNodesRef.current[id].disconnect();
      } catch (e) {
        /* ignore */
      }
      delete gainNodesRef.current[id];
    }
    delete sourceElementsRef.current[id];

    removeMediaItem(id);
    delete mediaElementsRef.current[id];
  }, [pausePreviewBeforeEdit, removeMediaItem]);

  // --- トランスフォームパネル開閉ハンドラ ---
  // 目的: スケール・位置設定UIの表示/非表示を切り替え
  const handleToggleTransformPanel = useCallback((id: string) => {
    toggleTransformPanel(id);
  }, [toggleTransformPanel]);

  // ==========================================================
  // オーディオトラック（BGM・ナレーション）ハンドラ
  // ==========================================================

  // --- BGMアップロードハンドラ ---
  // 目的: BGMファイルを読み込みストアに設定
  const handleBgmUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    pausePreviewBeforeEdit('add-bgm');
    clearExport();
    const url = URL.createObjectURL(file);
    const audio = new Audio(url);
    let settled = false;
    // メタデータ読み込みがハングしたときに blob URL を残さないためのタイムアウト保険
    const timeoutId = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      audio.onloadedmetadata = null;
      audio.onerror = null;
      URL.revokeObjectURL(url);
      showToast('BGM の読み込みに失敗しました');
    }, 15000);
    audio.onloadedmetadata = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
      setBgm({
        file,
        url,
        startPoint: 0,
        delay: 0,
        volume: 1.0,
        fadeIn: false,
        fadeOut: false,
        fadeInDuration: 2.0,
        fadeOutDuration: 2.0,
        duration,
        isAi: false,
      });
    };
    audio.onerror = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      URL.revokeObjectURL(url);
      showToast('BGM の読み込みに失敗しました');
    };
  }, [pausePreviewBeforeEdit, setBgm, clearExport, showToast]);

  // --- ナレーションアップロードハンドラ ---
  // 目的: ナレーションファイルを読み込みストアに設定
  const handleNarrationUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    e.target.value = '';
    pausePreviewBeforeEdit('add-narration');
    clearExport();

    const startTimeAtUpload = currentTimeRef.current;
    const loadNarrationMeta = (file: File): Promise<{ file: File; url: string; duration: number }> =>
      new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const audio = new Audio(url);
        let settled = false;
        // メタデータ読み込みハング時に blob URL を残さないためのタイムアウト保険
        const timeoutId = window.setTimeout(() => {
          if (settled) return;
          settled = true;
          audio.onloadedmetadata = null;
          audio.onerror = null;
          URL.revokeObjectURL(url);
          reject(new Error(`音声メタデータ読み込みタイムアウト: ${file.name}`));
        }, 15000);

        audio.onloadedmetadata = () => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timeoutId);
          const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
          resolve({ file, url, duration });
        };

        audio.onerror = () => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timeoutId);
          URL.revokeObjectURL(url);
          reject(new Error(`音声メタデータ読み込み失敗: ${file.name}`));
        };
      });

    void (async () => {
      let failedCount = 0;

      for (const file of files) {
        try {
          const { url, duration } = await loadNarrationMeta(file);
          addNarration(
            createNarrationClip({
              file,
              url,
              duration,
              startTime: startTimeAtUpload,
              sourceType: 'file',
            })
          );
        } catch {
          failedCount += 1;
        }
      }

      if (failedCount > 0) {
        showToast(`ナレーション${failedCount}件の読み込みに失敗しました`);
      }
    })();
  }, [pausePreviewBeforeEdit, addNarration, clearExport, showToast]);

  // --- BGM/ナレーション開始位置更新ハンドラ ---
  // 目的: オーディオトラックの再生開始位置（ファイル内の位置）を変更
  const handleUpdateBgmStart = useCallback((val: string) => {
    const numVal = parseFloat(val);
    if (isNaN(numVal)) return;
    pausePreviewBeforeEdit('update-bgm-start-point');
    updateBgmStartPoint(numVal);
  }, [pausePreviewBeforeEdit, updateBgmStartPoint]);

  // --- BGM/ナレーション遅延更新ハンドラ ---
  // 目的: オーディオトラックの開始遅延（動画開始からの秒数）を変更
  const handleUpdateBgmDelay = useCallback((val: string) => {
    const numVal = parseFloat(val);
    if (isNaN(numVal)) return;
    pausePreviewBeforeEdit('update-bgm-delay');
    updateBgmDelay(numVal);
  }, [pausePreviewBeforeEdit, updateBgmDelay]);

  // --- BGM/ナレーション音量更新ハンドラ ---
  // 目的: オーディオトラックの音量を変更
  const handleUpdateBgmVolume = useCallback((val: string) => {
    const numVal = parseFloat(val);
    if (isNaN(numVal)) return;
    pausePreviewBeforeEdit('update-bgm-volume');
    updateBgmVolume(numVal);
  }, [pausePreviewBeforeEdit, updateBgmVolume]);

  const handleUpdateNarrationStart = useCallback((id: string, val: string) => {
    const numVal = parseFloat(val);
    if (isNaN(numVal)) return;
    pausePreviewBeforeEdit('update-narration-start-time');
    updateNarrationStartTime(id, numVal);
  }, [pausePreviewBeforeEdit, updateNarrationStartTime]);

  const handleSetNarrationStartToCurrent = useCallback((id: string) => {
    pausePreviewBeforeEdit('set-narration-start-to-current');
    updateNarrationStartTime(id, currentTimeRef.current);
  }, [pausePreviewBeforeEdit, updateNarrationStartTime]);

  const handleUpdateNarrationVolume = useCallback((id: string, val: string) => {
    const numVal = parseFloat(val);
    if (isNaN(numVal)) return;
    pausePreviewBeforeEdit('update-narration-volume');
    updateNarrationVolume(id, numVal);
  }, [pausePreviewBeforeEdit, updateNarrationVolume]);

  const handleToggleNarrationMute = useCallback((id: string) => {
    pausePreviewBeforeEdit('toggle-narration-mute');
    toggleNarrationMute(id);
  }, [pausePreviewBeforeEdit, toggleNarrationMute]);

  const handleUpdateNarrationTrimStart = useCallback((id: string, val: string) => {
    const numVal = parseFloat(val);
    if (isNaN(numVal)) return;
    pausePreviewBeforeEdit('update-narration-trim-start');
    updateNarrationTrim(id, 'start', numVal);
  }, [pausePreviewBeforeEdit, updateNarrationTrim]);

  const handleUpdateNarrationTrimEnd = useCallback((id: string, val: string) => {
    const numVal = parseFloat(val);
    if (isNaN(numVal)) return;
    pausePreviewBeforeEdit('update-narration-trim-end');
    updateNarrationTrim(id, 'end', numVal);
  }, [pausePreviewBeforeEdit, updateNarrationTrim]);

  const handleSaveNarration = useCallback(async (id: string) => {
    const clip = narrations.find((item) => item.id === id);
    if (!clip) return;

    const sourceUrl = clip.blobUrl || clip.url;
    if (!sourceUrl) {
      showToast('保存できる音声が見つかりませんでした');
      return;
    }

    const rawName = clip.file instanceof File ? clip.file.name : clip.file.name;
    const filename = preserveOriginalFileName(rawName, 'narration.wav');

    const inferredMimeType = clip.file instanceof File && clip.file.type
      ? clip.file.type
      : 'audio/wav';
    try {
      const result = await saveObjectUrlWithClientFileStrategy({
        sourceUrl,
        descriptor: {
          filename,
          mimeType: inferredMimeType,
          description: '音声ファイル',
        },
        supportsShowSaveFilePicker,
      });

      if (result.strategy === 'file-picker') {
        window.alert('音声の保存が完了しました。');
        showToast('音声の保存が完了しました');
        return;
      }

      window.alert('音声の保存を開始しました。完了はブラウザの通知をご確認ください。');
      showToast('音声の保存を開始しました。完了はブラウザの通知をご確認ください。', 5000);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        showToast('音声の保存をキャンセルしました');
        return;
      }
      setError('音声の保存に失敗しました');
    }
  }, [narrations, setError, showToast, supportsShowSaveFilePicker]);

  const handleCloseAiModal = useCallback(() => {
    setEditingNarrationId(null);
    closeAiModal();
  }, [closeAiModal]);

  const pausePreviewBeforeHeaderModal = useCallback(() => {
    pausePreviewBeforeEdit('open-header-modal');
  }, [pausePreviewBeforeEdit]);

  const handleAddAiNarration = useCallback(() => {
    if (offlineMode) return;
    pausePreviewBeforeEdit('add-ai-narration');
    setEditingNarrationId(null);
    setAiScript('');
    setAiPrompt('');
    setAiScriptLength('medium');
    openAiModal();
  }, [offlineMode, openAiModal, pausePreviewBeforeEdit, setAiPrompt, setAiScript]);

  const handleEditAiNarration = useCallback((id: string) => {
    if (offlineMode) return;
    const target = narrations.find((clip) => clip.id === id);
    if (!target || !target.isAiEditable) return;
    const currentScript = target.aiScript ?? '';
    const inferredLength: NarrationScriptLength =
      currentScript.length <= 70 ? 'short' : currentScript.length <= 120 ? 'medium' : 'long';
    pausePreviewBeforeEdit('edit-ai-narration');
    setEditingNarrationId(id);
    setAiPrompt('');
    setAiScript(currentScript);
    setAiScriptLength(inferredLength);
    setAiVoice(target.aiVoice ?? 'Aoede');
    setAiVoiceStyle(target.aiVoiceStyle ?? '');
    openAiModal();
  }, [narrations, offlineMode, openAiModal, pausePreviewBeforeEdit, setAiPrompt, setAiScript, setAiVoice, setAiVoiceStyle]);

  const handleOpenSettingsModal = useCallback(() => {
    pausePreviewBeforeHeaderModal();
    setShowSettings(true);
  }, [pausePreviewBeforeHeaderModal]);

  const handleOpenProjectManagerModal = useCallback(() => {
    pausePreviewBeforeHeaderModal();
    setShowProjectManager(true);
  }, [pausePreviewBeforeHeaderModal]);

  const handleOpenAppHelpModal = useCallback(() => {
    pausePreviewBeforeHeaderModal();
    setActiveHelpSection('app');
  }, [pausePreviewBeforeHeaderModal]);

  // --- 全クリア処理 ---
  // 目的: 全てのメディア・オーディオ・キャプションを削除し初期状態に戻す
  const handleClearAll = useCallback(() => {
    if (mediaItems.length === 0 && !bgm && narrations.length === 0) return;

    // 確認ダイアログを表示
    const confirmed = window.confirm('すべてのメディア、BGM、ナレーションをクリアします。よろしいですか？');
    if (!confirmed) return;

    stopAll();
    pause();
    setProcessing(false);
    Object.values(sourceNodesRef.current).forEach((n) => {
      try {
        n.disconnect();
      } catch (e) {
        /* ignore */
      }
    });
    Object.values(gainNodesRef.current).forEach((n) => {
      try {
        n.disconnect();
      } catch (e) {
        /* ignore */
      }
    });
    sourceNodesRef.current = {};
    gainNodesRef.current = {};
    sourceElementsRef.current = {};
    Object.values(pendingAudioDetachTimersRef.current).forEach((timer) => clearTimeout(timer));
    pendingAudioDetachTimersRef.current = {};

    mediaItemsRef.current = [];
    mediaElementsRef.current = {};
    bgmRef.current = null;
    narrationsRef.current = [];

    // Zustand stores clear
    clearAllMedia();
    clearAllAudio();
    resetCaptions();
    resetUI();
    setReloadKey(0);

    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      }
    }
  }, [mediaItems, bgm, narrations, stopAll, clearAllMedia, clearAllAudio, resetCaptions, resetUI]);

  const {
    handleSeekStart: handleLiveSeekStart,
    handleSeekChange: handleLiveSeekChange,
    handleSeekEnd: handleLiveSeekEnd,
  } = previewRuntime.usePreviewSeekController({
    mediaItemsRef,
    mediaElementsRef,
    sourceNodesRef,
    gainNodesRef,
    audioCtxRef,
    totalDurationRef,
    currentTimeRef,
    activeVideoIdRef,
    isPlayingRef,
    isSeekingRef,
    wasPlayingBeforeSeekRef,
    seekingVideosRef,
    startTimeRef,
    reqIdRef,
    loopIdRef,
    playbackTimeoutRef,
    lastSeekTimeRef,
    pendingSeekRef,
    pendingSeekTimeoutRef,
    seekSettleGenerationRef,
    previewPlaybackAttemptRef,
    pendingPausedSeekWaitRef,
    handleSeekEndCallbackRef,
    renderPausedPreviewFrameAtTimeRef,
    cancelSeekPlaybackPrepareRef,
    isSeekPlaybackPreparingRef,
    endFinalizedRef,
    previewPlatformPolicy,
    setCurrentTime,
    attachGlobalSeekEndListeners,
    detachGlobalSeekEndListeners,
    cancelPendingSeekPlaybackPrepare,
    cancelPendingPausedSeekWait,
    renderFrame,
    loop,
    resetInactiveVideos,
    preparePreviewAudioNodesForTime,
    primePreviewAudioOnlyTracksAtTime,
  });

  const shouldHandleSeekWithPreviewCache = useCallback(() => {
    return previewCacheStatusRef.current === 'ready'
      && useAndroidPreviewCacheForPlayback
      && !!previewCacheEntryRef.current
      && !!previewCacheVideoRef.current;
  }, [useAndroidPreviewCacheForPlayback]);

  const handleSeekStart = useCallback(() => {
    if (!shouldHandleSeekWithPreviewCache()) {
      handleLiveSeekStart();
      // iOS Safari: シーク操作で再生を止め、自動再開せず手動で再開する仕様にする。
      // handleLiveSeekStart() は再生中だった場合に wasPlayingBeforeSeekRef を立てつつ
      // メディアを pause する。
      if (platformCapabilities.isIosSafari) {
        if (wasPlayingBeforeSeekRef.current) {
          // UI の再生状態も一時停止へ揃える（再生/一時停止ボタンを「再生(▶)」表示にする）。
          pause();
        }
        // controller の自動再開分岐 (handleSeekEnd 内 wasPlaying 判定) を無効化する。
        // これにより slider 由来の seek end も、window グローバル seek end リスナー
        // (handleSeekEndCallbackRef 経由で controller の handleSeekEnd を直接呼ぶ) も、
        // どちらの経路でも再開せず一時停止フレーム描画へ落ちる。
        wasPlayingBeforeSeekRef.current = false;
      }
      return;
    }

    const previewCacheVideo = previewCacheVideoRef.current;
    if (!previewCacheVideo) {
      handleLiveSeekStart();
      return;
    }

    wasPlayingBeforeSeekRef.current = isPlayingRef.current;
    isSeekingRef.current = true;
    previewCachePlaybackActiveRef.current = false;

    if (reqIdRef.current !== null) {
      cancelAnimationFrame(reqIdRef.current);
      reqIdRef.current = null;
    }

    try {
      previewCacheVideo.pause();
    } catch {
      /* ignore */
    }
  }, [handleLiveSeekStart, isPlayingRef, pause, platformCapabilities.isIosSafari, shouldHandleSeekWithPreviewCache, wasPlayingBeforeSeekRef]);

  const handleSeekChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    if (!shouldHandleSeekWithPreviewCache()) {
      handleLiveSeekChange(event);
      return;
    }

    const previewCacheVideo = previewCacheVideoRef.current;
    if (!previewCacheVideo) {
      handleLiveSeekChange(event);
      return;
    }

    const time = Math.max(0, Math.min(parseFloat(event.target.value), totalDurationRef.current));
    currentTimeRef.current = time;
    setCurrentTime(time);

    try {
      if (Math.abs(previewCacheVideo.currentTime - time) > 0.01) {
        previewCacheVideo.currentTime = time;
      }
    } catch {
      /* ignore */
    }

    renderFrame(time, false);
  }, [handleLiveSeekChange, renderFrame, setCurrentTime, shouldHandleSeekWithPreviewCache, totalDurationRef]);

  const handleSeekEnd = useCallback(() => {
    if (!shouldHandleSeekWithPreviewCache()) {
      handleLiveSeekEnd();
      return;
    }

    const previewCacheVideo = previewCacheVideoRef.current;
    if (!previewCacheVideo) {
      handleLiveSeekEnd();
      return;
    }

    const targetTime = Math.max(0, Math.min(currentTimeRef.current, totalDurationRef.current));
    isSeekingRef.current = false;

    try {
      if (Math.abs(previewCacheVideo.currentTime - targetTime) > 0.01) {
        previewCacheVideo.currentTime = targetTime;
      }
    } catch {
      /* ignore */
    }

    if (wasPlayingBeforeSeekRef.current) {
      wasPlayingBeforeSeekRef.current = false;
      previewCachePlaybackActiveRef.current = true;
      startTimeRef.current = performance.now() - targetTime * 1000;
      isPlayingRef.current = true;
      void previewCacheVideo.play().then(() => {
        loop(false, loopIdRef.current);
      }).catch(() => {
        previewCachePlaybackActiveRef.current = false;
        renderFrame(targetTime, false);
      });
      return;
    }

    wasPlayingBeforeSeekRef.current = false;
    previewCachePlaybackActiveRef.current = false;
    renderFrame(targetTime, false);
  }, [handleLiveSeekEnd, isPlayingRef, loop, renderFrame, shouldHandleSeekWithPreviewCache, totalDurationRef]);

  // --- 再生/一時停止トグル ---
  // 目的: 再生中なら停止、停止中なら再生を開始
  // 注意: 200msのデバウンスで連続クリックを防止
  const togglePlay = useCallback(() => {
    // デバウンス: 200ms以内の連続クリックを無視
    const now = Date.now();
    if (now - lastToggleTimeRef.current < 200) {
      return;
    }
    lastToggleTimeRef.current = now;

    // 再生/一時停止どちら側でも、生成済み export は古い成果物として破棄する
    clearGeneratedExport('play-toggle');

    if (isPlaying) {
      stopAll();
      pause();
    } else {
      let startT = currentTime;
      if (startT >= totalDuration - 0.1 || startT < 0) startT = 0;
      startEngine(startT, false);
    }
  }, [clearGeneratedExport, isPlaying, currentTime, totalDuration, stopAll, pause, startEngine]);

  // --- 停止ハンドラ ---
  // 目的: 再生を停止し、時刻を0にリセット（リソースのリロードは行わない）
  // 改善: 以前はhandleReloadResourcesを呼んでいたが、DOM破棄により動画切り替え時にクラッシュするため
  //       安全な停止・巻き戻し処理に変更
  const handleStop = useCallback(() => {
    // export 中の停止は「プレビューを 0 秒へ戻す」ではなく、中断要求と UI 復旧を優先する。
    // 実際の停止/cleanup は export 側の abort 経路でも継続されるため、ここでは state を先に戻して表示を止める。
    if (isProcessing) {
      // 停止ボタン押下は user cancel 扱いだが、download 導線を消したいだけなので追加エラーは出さず状態だけ静かに復旧する。
      stopWebCodecsExport({ silent: true, reason: 'user' });
      clearExportUiState();
      return;
    }

    // 停止ボタン押下で生成済み export を古い成果物として破棄し、ダウンロードボタンを消す。
    clearGeneratedExport('stop-button');

    stopAll();
    pause();
    seekSettleGenerationRef.current += 1;
    cancelPendingSeekPlaybackPrepare();
    cancelPendingPausedSeekWait();
    detachGlobalSeekEndListeners();
    isSeekingRef.current = false;
    wasPlayingBeforeSeekRef.current = false;
    setExportPreparationStep(null);
    setCurrentTime(0);
    currentTimeRef.current = 0;
    endFinalizedRef.current = false;

    if (previewCacheStatusRef.current === 'ready' && previewCacheVideoRef.current) {
      try {
        previewCacheVideoRef.current.pause();
        previewCacheVideoRef.current.currentTime = 0;
      } catch {
        /* ignore */
      }
    }

    // [TV] 全メディアを安全に巻き戻し (DOM要素を維持したままリセット)
    // 各ビデオをtrimStart位置にリセット（0ではなく実際の開始位置へ）
    for (const item of mediaItemsRef.current) {
      const el = mediaElementsRef.current[item.id];
      if (el && el.tagName === 'VIDEO') {
        try {
          const videoEl = el as HTMLVideoElement;
          videoEl.pause();
          videoEl.currentTime = item.trimStart || 0;
        } catch (e) {
          /* ignore */
        }
      }
    }
    // BGM/ナレーションは0に戻す
    const audioTrackIds = [
      'bgm',
      ...narrationsRef.current.map((clip) => `narration:${clip.id}`),
    ];
    audioTrackIds.forEach((trackId) => {
      const el = mediaElementsRef.current[trackId];
      if (el && (el.tagName === 'AUDIO')) {
        try {
          const audioEl = el as HTMLAudioElement;
          audioEl.pause();
          audioEl.currentTime = 0;
        } catch (e) {
          /* ignore */
        }
      }
    });

    // 0秒時点を描画
    // 少し遅延させて確実にシーク反映させる
    renderPausedPreviewFrameAtTimeRef.current(0);
  }, [
    clearGeneratedExport,
    isProcessing,
    stopAll,
    stopWebCodecsExport,
    pause,
    setProcessing,
    setPreviewPlaying,
    setLoading,
    setExportPreparationStep,
    setCurrentTime,
    cancelPendingPausedSeekWait,
    cancelPendingSeekPlaybackPrepare,
    detachGlobalSeekEndListeners,
    previewCacheVideoRef,
  ]);

  // --- エクスポート開始ハンドラ ---
  // 目的: 動画ファイルとして書き出しを開始
  const handleExport = useCallback(() => {
    exportCompletedRef.current = false;
    exportFinalizingUiRef.current = false;
    exportFinalizeWarningShownRef.current = false;
    startEngine(0, true);
  }, [startEngine]);

  const handleExportFinalizeTimeout = useCallback(() => {
    if (!isProcessing || exportUrl || exportCompletedRef.current) return;
    if (exportFinalizeWarningShownRef.current) return;
    exportFinalizeWarningShownRef.current = true;
    logWarn('RENDER', 'export finalize is taking longer than expected', {
      exportFinalizing: exportFinalizingUiRef.current,
      warning: EXPORT_FINALIZING_TIMEOUT_WARNING,
    });
    setError(EXPORT_FINALIZING_TIMEOUT_ERROR);
  }, [
    exportUrl,
    isProcessing,
    logWarn,
    setError,
  ]);

  // --- ダウンロードハンドラ ---
  // 目的: ダウンロード完了時にユーザーへ通知する
  const handleDownload = useCallback(async () => {
    if (!exportUrl) return;

    const ext = exportExt || 'mp4';
    const filename = `turtle_video_${Date.now()}.${ext}`;
    const mimeType = ext === 'webm' ? 'video/webm' : 'video/mp4';
    const fileDescription = ext === 'webm' ? 'WebM 動画' : 'MP4 動画';
    try {
      const result = await saveObjectUrlWithClientFileStrategy({
        sourceUrl: exportUrl,
        descriptor: {
          filename,
          mimeType,
          description: fileDescription,
        },
        supportsShowSaveFilePicker,
      });

      if (result.strategy === 'file-picker') {
        window.alert('ダウンロードが完了しました。');
        showToast('ダウンロードが完了しました');
        return;
      }

      showToast('ダウンロードを開始しました。完了はブラウザの通知をご確認ください。', 5000);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        showToast('ダウンロードをキャンセルしました');
        return;
      }
      setError('ダウンロードに失敗しました');
    }
  }, [exportUrl, exportExt, setError, showToast, supportsShowSaveFilePicker]);

  // --- 時刻フォーマットヘルパー ---
  // 目的: 秒数を「分:秒」形式の文字列に変換
  const formatTime = useCallback((s: number): string => {
    if (!s || isNaN(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  }, []);

  // --- キャプチャハンドラ ---
  // 目的: プレビューの現在のフレームをPNG画像として保存
  // 再生中の場合は一時停止してからキャプチャする
  const handleCapture = useCallback(async () => {
    // メディアがない場合は何もしない
    if (mediaItems.length === 0) return;
    // エクスポート中はキャプチャ不可
    if (isProcessing) return;

    // 再生中の場合は一時停止
    const wasPlaying = isPlayingRef.current;
    if (wasPlaying) {
      stopAll();
      pause();
    }

    // Canvasからキャプチャ
    const canvas = canvasRef.current;
    if (!canvas) {
      showToast('キャプチャに失敗しました');
      return;
    }

    const timestamp = formatTime(currentTimeRef.current).replace(':', 'm') + 's';
    const filename = `turtle_capture_${timestamp}_${Date.now()}`;
    const success = await captureCanvasAsImage(canvas, filename);

    if (success) {
      showToast('キャプチャを保存しました');
    } else {
      showToast('キャプチャに失敗しました');
    }
  }, [mediaItems.length, isProcessing, stopAll, pause, showToast, formatTime]);

  const openSectionHelp = useCallback((section: SectionHelpKey) => {
    setActiveHelpSection(section);
  }, []);

  const closeSectionHelp = useCallback(() => {
    setActiveHelpSection(null);
  }, []);

  const hiddenPreviewCacheStyle = useMemo<React.CSSProperties>(() => ({
    position: 'fixed',
    top: 0,
    left: 0,
    width: `${canvasWidth}px`,
    height: `${canvasHeight}px`,
    opacity: 0.001,
    pointerEvents: 'none',
    zIndex: -100,
    visibility: 'visible',
  }), [canvasWidth, canvasHeight]);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans pb-24 select-none relative">
      <Toast message={toastMessage} onClose={clearToast} />

      {/* 隠しリソースローダー */}
      <MediaResourceLoader
        key={reloadKey}
        mediaItems={mediaItems}
        bgm={bgm}
        narrations={narrations}
        onElementLoaded={handleMediaElementLoaded}
        onRefAssign={handleMediaRefAssign}
        onSeeked={handleSeeked}
        onVideoLoadedData={handleVideoLoadedData}
      />
      <video
        ref={previewCacheVideoRef}
        playsInline
        preload="auto"
        crossOrigin="anonymous"
        style={hiddenPreviewCacheStyle}
      />

      {/* AI Modal */}
      <AiModal
        isOpen={showAiModal}
        onClose={handleCloseAiModal}
        aiPrompt={aiPrompt}
        aiScript={aiScript}
        aiScriptLength={aiScriptLength}
        aiVoice={aiVoice}
        aiVoiceStyle={aiVoiceStyle}
        isAiLoading={isAiLoading}
        voiceOptions={VOICE_OPTIONS}
        onPromptChange={setAiPrompt}
        onScriptChange={setAiScript}
        onScriptLengthChange={setAiScriptLength}
        onVoiceChange={setAiVoice}
        onVoiceStyleChange={setAiVoiceStyle}
        onGenerateScript={generateScript}
        onGenerateSpeech={generateSpeech}
      />

      {/* Settings Modal */}
      <SettingsModal
        appFlavor={appFlavor}
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
      />

      {/* SaveLoad Modal */}
      <SaveLoadModal
        isOpen={showProjectManager}
        onClose={() => setShowProjectManager(false)}
        onBeforeLoadProject={() => pausePreviewBeforeEdit('load-project')}
        appFlavor={appFlavor}
        onToast={(msg, type) => {
          if (type === 'error') {
            setError(msg);
          } else {
            showToast(msg);
          }
        }}
        saveRuntime={saveRuntime}
      />

      {/* Section Help Modal */}
      <SectionHelpModal
        appFlavor={appFlavor}
        supportsShowSaveFilePicker={supportsShowSaveFilePicker}
        isOpen={activeHelpSection !== null}
        section={activeHelpSection}
        onClose={closeSectionHelp}
      />

      {/* Header */}
      <Header
        onOpenSettings={handleOpenSettingsModal}
        onOpenProjectManager={handleOpenProjectManagerModal}
        onOpenAppHelp={handleOpenAppHelpModal}
      />

      <div className="max-w-md md:max-w-3xl lg:max-w-6xl mx-auto p-4 lg:p-6">
        <ErrorMessage message={errorMsg} count={errorCount} onClose={clearError} />

        <div className="mt-4 lg:grid lg:grid-cols-[1fr_585px] lg:gap-8">
          {/* 左カラム: 編集コントロール（モバイルでは通常の縦並び） */}
          <div className="space-y-6">
            {/* 1. CLIPS */}
            <ClipsSection
              mediaItems={mediaItems}
              mediaTimelineRanges={mediaTimelineRanges}
              isClipsLocked={isClipsLocked}
              mediaElements={mediaElementsRef.current as Record<string, HTMLVideoElement | HTMLImageElement>}
              onToggleClipsLock={withPreviewPause('toggle-clips-lock', toggleClipsLock)}
              onMediaUpload={handleMediaUpload}
              onOpenMediaPicker={handleOpenMediaPicker}
              supportsShowOpenFilePicker={shouldUseMediaPicker}
              onMoveMedia={handleMoveMedia}
              onRemoveMedia={handleRemoveMedia}
              onToggleMediaLock={withPreviewPause('toggle-media-lock', toggleItemLock)}
              onToggleTransformPanel={withPreviewPause('toggle-transform-panel', handleToggleTransformPanel)}
              onUpdateVideoTrim={handleUpdateVideoTrim}
              onUpdateImageDuration={handleUpdateImageDuration}
              onUpdateMediaScale={handleUpdateMediaScale}
              onUpdateMediaPosition={handleUpdateMediaPosition}
              onResetMediaSetting={handleResetMediaSetting}
              onUpdateMediaVolume={withPreviewPause('update-media-volume', updateVolume)}
              onToggleMediaMute={withPreviewPause('toggle-media-mute', toggleMute)}
              onToggleMediaFadeIn={withPreviewPause('toggle-media-fade-in', toggleFadeIn)}
              onToggleMediaFadeOut={withPreviewPause('toggle-media-fade-out', toggleFadeOut)}
              onUpdateFadeInDuration={withPreviewPause('update-media-fade-in-duration', updateFadeInDuration)}
              onUpdateFadeOutDuration={withPreviewPause('update-media-fade-out-duration', updateFadeOutDuration)}
              onOpenHelp={() => openSectionHelp('clips')}
            />

            {/* 2. BGM SETTINGS */}
            <BgmSection
              bgm={bgm}
              isBgmLocked={isBgmLocked}
              totalDuration={totalDuration}
              onToggleBgmLock={withPreviewPause('toggle-bgm-lock', toggleBgmLock)}
              onBgmUpload={handleBgmUpload}
              onRemoveBgm={withPreviewPause('remove-bgm', removeBgm)}
              onUpdateStartPoint={handleUpdateBgmStart}
              onUpdateDelay={handleUpdateBgmDelay}
              onUpdateVolume={handleUpdateBgmVolume}
              onToggleFadeIn={withPreviewPause('toggle-bgm-fade-in', toggleBgmFadeIn)}
              onToggleFadeOut={withPreviewPause('toggle-bgm-fade-out', toggleBgmFadeOut)}
              onUpdateFadeInDuration={withPreviewPause('update-bgm-fade-in-duration', updateBgmFadeInDuration)}
              onUpdateFadeOutDuration={withPreviewPause('update-bgm-fade-out-duration', updateBgmFadeOutDuration)}
              formatTime={formatTime}
              onOpenHelp={() => openSectionHelp('bgm')}
            />

            {/* 3. NARRATION SETTINGS */}
            <NarrationSection
              narrations={narrations}
              offlineMode={offlineMode}
              isNarrationLocked={isNarrationLocked}
              totalDuration={totalDuration}
              currentTime={currentTime}
              onToggleNarrationLock={withPreviewPause('toggle-narration-lock', toggleNarrationLock)}
              onAddAiNarration={handleAddAiNarration}
              onEditAiNarration={handleEditAiNarration}
              onNarrationUpload={handleNarrationUpload}
              onRemoveNarration={withPreviewPause('remove-narration', removeNarration)}
              onMoveNarration={withPreviewPause('move-narration', moveNarration)}
              onSaveNarration={handleSaveNarration}
              onUpdateStartTime={handleUpdateNarrationStart}
              onSetStartTimeToCurrent={handleSetNarrationStartToCurrent}
              onUpdateVolume={handleUpdateNarrationVolume}
              onToggleMute={handleToggleNarrationMute}
              onUpdateTrimStart={handleUpdateNarrationTrimStart}
              onUpdateTrimEnd={handleUpdateNarrationTrimEnd}
              formatTime={formatTime}
              onOpenHelp={() => openSectionHelp('narration')}
            />

            {/* 4. CAPTIONS */}
            <CaptionSection
              captions={captions}
              settings={captionSettings}
              isLocked={isCaptionLocked}
              totalDuration={totalDuration}
              currentTime={currentTime}
              onToggleLock={withPreviewPause('toggle-caption-lock', toggleCaptionLock)}
              onAddCaption={withPreviewPause('add-caption', addCaption)}
              onUpdateCaption={withPreviewPause('update-caption', updateCaption)}
              onRemoveCaption={withPreviewPause('remove-caption', removeCaption)}
              onMoveCaption={withPreviewPause('move-caption', moveCaption)}
              onSetEnabled={withPreviewPause('set-caption-enabled', setCaptionEnabled)}
              onSetFontSize={withPreviewPause('set-caption-font-size', setCaptionFontSize)}
              onSetFontStyle={withPreviewPause('set-caption-font-style', setCaptionFontStyle)}
              onSetPosition={withPreviewPause('set-caption-position', setCaptionPosition)}
              onSetBlur={withPreviewPause('set-caption-blur', setCaptionBlur)}
              onSetBulkFadeIn={withPreviewPause('set-caption-bulk-fade-in', setBulkFadeIn)}
              onSetBulkFadeOut={withPreviewPause('set-caption-bulk-fade-out', setBulkFadeOut)}
              onSetBulkFadeInDuration={withPreviewPause('set-caption-bulk-fade-in-duration', setBulkFadeInDuration)}
              onSetBulkFadeOutDuration={withPreviewPause('set-caption-bulk-fade-out-duration', setBulkFadeOutDuration)}
              onOpenHelp={() => openSectionHelp('caption')}
            />

          </div>

          {/* 右カラム: プレビュー（モバイルでは下部に表示、PCではスティッキーサイドバー） */}
          <div className="mt-6 lg:mt-0">
            <div className="lg:sticky lg:top-20">
              {/* 5. PREVIEW */}
              <PreviewSection
                appFlavor={appFlavor}
                supportsShowSaveFilePicker={supportsShowSaveFilePicker}
                mediaItems={mediaItems}
                bgm={bgm}
                narrations={narrations}
                canvasRef={canvasRef}
                currentTime={currentTime}
                totalDuration={totalDuration}
                isPlaying={isPlaying}
                isProcessing={isProcessing}
                isLoading={isLoading}
                loadingLabel={previewLoadingLabel}
                exportPreparationStep={exportPreparationStep}
                exportUrl={exportUrl}
                exportExt={exportExt}
                onSeekChange={handleSeekChange}
                onSeekStart={handleSeekStart}
                onSeekEnd={handleSeekEnd}
                onTogglePlay={togglePlay}
                onStop={handleStop}
                onExport={handleExport}
                onDownload={handleDownload}
                onClearAll={handleClearAll}
                onCapture={handleCapture}
                onExportFinalizeTimeout={handleExportFinalizeTimeout}
                onOpenHelp={() => openSectionHelp('preview')}
                formatTime={formatTime}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TurtleVideo;
