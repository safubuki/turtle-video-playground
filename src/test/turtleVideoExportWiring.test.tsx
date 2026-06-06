import type { MutableRefObject } from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import TurtleVideo from '../components/TurtleVideo';
import type { ExportRuntime } from '../components/turtle-video/exportRuntime';
import type { PreviewRuntime } from '../components/turtle-video/previewRuntime';
import type { SaveRuntime } from '../components/turtle-video/saveRuntime';
import type { UseExportReturn } from '../hooks/useExport';
import type { PlatformCapabilities } from '../utils/platform';
import { getPreviewPlatformPolicy } from '../utils/previewPlatform';
import {
  useAudioStore,
  useCaptionStore,
  useLogStore,
  useMediaStore,
  useUIStore,
} from '../stores';

vi.mock('../components/common/Toast', () => ({ default: () => null }));
vi.mock('../components/common/ErrorMessage', () => ({ default: () => null }));
vi.mock('../components/media/MediaResourceLoader', () => ({ default: () => null }));
vi.mock('../components/Header', () => ({ default: () => null }));
vi.mock('../components/sections/ClipsSection', () => ({ default: () => null }));
vi.mock('../components/sections/BgmSection', () => ({ default: () => null }));
vi.mock('../components/sections/NarrationSection', () => ({ default: () => null }));
vi.mock('../components/sections/CaptionSection', () => ({ default: () => null }));
vi.mock('../components/sections/PreviewSection', () => ({ default: () => null }));
vi.mock('../components/modals/AiModal', () => ({ default: () => null }));
vi.mock('../components/modals/SettingsModal', () => ({
  default: () => null,
  getStoredApiKey: () => '',
}));
vi.mock('../components/modals/SaveLoadModal', () => ({ default: () => null }));
vi.mock('../components/modals/SectionHelpModal', () => ({ default: () => null }));

function createIosSafariCapabilities(): PlatformCapabilities {
  return {
    userAgent: 'test-ios-safari',
    platform: 'iPhone',
    maxTouchPoints: 5,
    isAndroid: false,
    isIOS: true,
    isSafari: true,
    isIosSafari: true,
    supportsShowSaveFilePicker: false,
    supportsShowOpenFilePicker: false,
    supportsTrackProcessor: false,
    supportsMp4MediaRecorder: true,
    audioContextMayInterrupt: true,
    supportedMediaRecorderProfile: { mimeType: 'video/mp4', extension: 'mp4' },
    trackProcessorCtor: undefined,
  };
}

function createExportHookResult(
  recorderRef: MutableRefObject<MediaRecorder | null>,
): UseExportReturn {
  return {
    isProcessing: false,
    setIsProcessing: vi.fn(),
    exportUrl: null,
    setExportUrl: vi.fn(),
    exportExt: null,
    setExportExt: vi.fn(),
    recorderRef,
    startExport: vi.fn(),
    completeExport: vi.fn(),
    stopExport: vi.fn(),
    clearExportUrl: vi.fn(),
  };
}

function createPreviewRuntime(
  capabilities: PlatformCapabilities,
  capturePreviewEngineParams: (params: unknown) => void,
): PreviewRuntime {
  return {
    getPlatformCapabilities: vi.fn(() => capabilities),
    getPreviewPlatformPolicy,
    useInactiveVideoManager: vi.fn(() => ({
      resetInactiveVideos: vi.fn(),
    })),
    usePreviewAudioSession: vi.fn(() => ({
      detachAudioNode: vi.fn(),
      ensureAudioNodeForElement: vi.fn(() => true),
      preparePreviewAudioNodesForTime: vi.fn(() => ({
        activeVideoId: null,
        audibleSourceCount: 0,
        requiresWebAudio: false,
      })),
      preparePreviewAudioNodesForUpcomingVideos: vi.fn(),
      primePreviewAudioOnlyTracksAtTime: vi.fn(),
      handleMediaRefAssign: vi.fn(),
    })),
    usePreviewEngine: vi.fn((params: unknown) => {
      capturePreviewEngineParams(params);
      return {
        handleMediaElementLoaded: vi.fn(),
        handleSeeked: vi.fn(),
        handleVideoLoadedData: vi.fn(),
        renderFrame: vi.fn(() => true),
        stopAll: vi.fn(),
        loop: vi.fn(),
        startEngine: vi.fn(() => Promise.resolve()),
      };
    }),
    usePreviewSeekController: vi.fn(() => ({
      handleSeekStart: vi.fn(),
      handleSeekChange: vi.fn(),
      handleSeekEnd: vi.fn(),
    })),
    usePreviewVisibilityLifecycle: vi.fn(),
  } as unknown as PreviewRuntime;
}

function resetStores() {
  useMediaStore.getState().clearAllMedia();
  useAudioStore.getState().clearAllAudio();
  useCaptionStore.getState().resetCaptions();
  useUIStore.getState().resetUI();
  useLogStore.getState().clearLogs();
}

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  resetStores();
  vi.restoreAllMocks();
});

describe('TurtleVideo export wiring', () => {
  it('passes the main export recorderRef to the preview engine for iOS Safari finalization', () => {
    const capabilities = createIosSafariCapabilities();
    const mainRecorderRef: MutableRefObject<MediaRecorder | null> = { current: null };
    const previewCacheRecorderRef: MutableRefObject<MediaRecorder | null> = { current: null };
    const mainExportHook = createExportHookResult(mainRecorderRef);
    const previewCacheExportHook = createExportHookResult(previewCacheRecorderRef);
    let exportHookCallCount = 0;
    const previewEngineParams: {
      current: { recorderRef?: MutableRefObject<MediaRecorder | null> } | null;
    } = { current: null };

    const exportRuntime: ExportRuntime = {
      useExport: vi.fn(() => {
        exportHookCallCount += 1;
        return exportHookCallCount % 2 === 1 ? mainExportHook : previewCacheExportHook;
      }),
    };
    const previewRuntime = createPreviewRuntime(capabilities, (params) => {
      previewEngineParams.current = params as { recorderRef?: MutableRefObject<MediaRecorder | null> };
    });
    const saveRuntime: SaveRuntime = {
      configureProjectStore: vi.fn(),
      getPlatformCapabilities: vi.fn(() => capabilities),
      getPersistenceHealth: vi.fn(() => Promise.resolve(null)),
      saveBlobWithClientFileStrategy: vi.fn(() => Promise.resolve({ strategy: 'anchor-download' as const })),
    };

    render(
      <TurtleVideo
        appFlavor="apple-safari"
        previewRuntime={previewRuntime}
        exportRuntime={exportRuntime}
        saveRuntime={saveRuntime}
      />,
    );

    expect(previewEngineParams.current?.recorderRef).toBe(mainRecorderRef);
    expect(previewEngineParams.current?.recorderRef).not.toBe(previewCacheRecorderRef);
  });
});
