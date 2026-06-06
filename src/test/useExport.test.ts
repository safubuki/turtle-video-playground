import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExportRecordingResult } from '../hooks/export-strategies/types';
import type { PlatformCapabilities } from '../utils/platform';

const { mockGetPlatformCapabilities, mockRunIosSafariMediaRecorderStrategy } = vi.hoisted(() => ({
  mockGetPlatformCapabilities: vi.fn(),
  mockRunIosSafariMediaRecorderStrategy: vi.fn(),
}));

vi.mock('../utils/platform', async () => {
  const actual = await vi.importActual<typeof import('../utils/platform')>('../utils/platform');
  return {
    ...actual,
    getPlatformCapabilities: mockGetPlatformCapabilities,
  };
});

vi.mock('../flavors/apple-safari/export/iosSafariMediaRecorder', () => ({
  runIosSafariMediaRecorderStrategy: mockRunIosSafariMediaRecorderStrategy,
}));

import { clampAudioTrackVolume } from '../hooks/useExport';
import { useExport as useAppleSafariExport } from '../flavors/apple-safari/export/useExport';
import { useExport as useStandardExport } from '../flavors/standard/export/useExport';

function createPlatformCapabilities(
  overrides: Partial<PlatformCapabilities> = {},
): PlatformCapabilities {
  return {
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
    trackProcessorCtor: undefined,
    ...overrides,
  };
}

function createStartExportArgs() {
  const audioContext = {
    sampleRate: 48000,
    state: 'running',
  } as AudioContext;
  const canvasRef = {
    current: {
      width: 1280,
      height: 720,
      captureStream: vi.fn(),
    } as unknown as HTMLCanvasElement,
  };
  const masterDestRef = {
    current: {
      context: audioContext,
      stream: {
        getAudioTracks: () => [],
      },
    } as unknown as MediaStreamAudioDestinationNode,
  };

  return {
    canvasRef,
    masterDestRef,
    onRecordingStop: vi.fn(),
    onRecordingError: vi.fn(),
  };
}

type RecordingStopCallback = (
  url: string,
  ext: string,
  result?: ExportRecordingResult,
) => void;

describe('useExport', () => {
  beforeEach(() => {
    mockGetPlatformCapabilities.mockReset();
    mockRunIosSafariMediaRecorderStrategy.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('初期化に必要な ref が無ければ即座にエラーを返す', async () => {
    const { result } = renderHook(() => useStandardExport());
    const onRecordingError = vi.fn();

    await act(async () => {
      await result.current.startExport(
        { current: null },
        { current: null },
        vi.fn(),
        onRecordingError,
      );
    });

    expect(onRecordingError).toHaveBeenCalledWith('エクスポートの初期化に失敗しました。');
    expect(result.current.isProcessing).toBe(false);
  });

  it('iOS 条件では iOS strategy を呼び出し、ハンドリング済みならそこで終了する', async () => {
    mockGetPlatformCapabilities.mockReturnValue(
      createPlatformCapabilities({
        isIOS: true,
        isSafari: true,
        isIosSafari: true,
        supportsMp4MediaRecorder: true,
        supportedMediaRecorderProfile: {
          mimeType: 'video/mp4',
          extension: 'mp4',
        },
      }),
    );
    mockRunIosSafariMediaRecorderStrategy.mockResolvedValue(true);

    const { result } = renderHook(() => useAppleSafariExport());
    const args = createStartExportArgs();

    await act(async () => {
      await result.current.startExport(
        args.canvasRef,
        args.masterDestRef,
        args.onRecordingStop,
        args.onRecordingError,
      );
    });

    expect(mockRunIosSafariMediaRecorderStrategy).toHaveBeenCalledTimes(1);
    expect(args.onRecordingError).not.toHaveBeenCalled();
    expect(result.current.isProcessing).toBe(false);
  });

  it('iOS strategy が false を返した場合は WebCodecs 側へフォールバックする', async () => {
    mockGetPlatformCapabilities.mockReturnValue(
      createPlatformCapabilities({
        isIOS: true,
        isSafari: true,
        isIosSafari: true,
        supportsMp4MediaRecorder: true,
        supportedMediaRecorderProfile: {
          mimeType: 'video/mp4',
          extension: 'mp4',
        },
      }),
    );
    mockRunIosSafariMediaRecorderStrategy.mockResolvedValue(false);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const { result } = renderHook(() => useAppleSafariExport());
    const args = createStartExportArgs();

    await act(async () => {
      await result.current.startExport(
        args.canvasRef,
        args.masterDestRef,
        args.onRecordingStop,
        args.onRecordingError,
      );
    });

    expect(mockRunIosSafariMediaRecorderStrategy).toHaveBeenCalledTimes(1);
    expect(args.onRecordingError).toHaveBeenCalledWith(
      expect.stringContaining('WebCodecsに対応していないブラウザです'),
    );
    expect(result.current.isProcessing).toBe(false);
  });

  it('stopExport は進行中セッションの AbortSignal を中断し、処理中状態を戻す', async () => {
    mockGetPlatformCapabilities.mockReturnValue(
      createPlatformCapabilities({
        isIOS: true,
        isSafari: true,
        isIosSafari: true,
        supportsMp4MediaRecorder: true,
        supportedMediaRecorderProfile: {
          mimeType: 'video/mp4',
          extension: 'mp4',
        },
      }),
    );

    let capturedSignal: AbortSignal | null = null;
    mockRunIosSafariMediaRecorderStrategy.mockImplementation(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise<boolean>((resolve) => {
          capturedSignal = signal;
          signal.addEventListener('abort', () => resolve(false), { once: true });
        }),
    );

    const { result } = renderHook(() => useAppleSafariExport());
    const args = createStartExportArgs();

    await act(async () => {
      result.current.startExport(
        args.canvasRef,
        args.masterDestRef,
        args.onRecordingStop,
        args.onRecordingError,
      );
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.isProcessing).toBe(true);
    });
    expect(capturedSignal).not.toBeNull();

    act(() => {
      result.current.stopExport();
    });

    const activeSignal = capturedSignal;
    if (!activeSignal) {
      throw new Error('AbortSignal was not captured');
    }
    expect((activeSignal as AbortSignal).aborted).toBe(true);
    expect(result.current.isProcessing).toBe(false);

    await waitFor(() => {
      expect(mockRunIosSafariMediaRecorderStrategy).toHaveBeenCalledTimes(1);
    });
    expect(args.onRecordingError).not.toHaveBeenCalled();
  });

  it('stopExport({ reason: "user" }) は明示キャンセルとして中断エラーを通知する', async () => {
    mockGetPlatformCapabilities.mockReturnValue(
      createPlatformCapabilities({
        isIOS: true,
        isSafari: true,
        isIosSafari: true,
        supportsMp4MediaRecorder: true,
        supportedMediaRecorderProfile: {
          mimeType: 'video/mp4',
          extension: 'mp4',
        },
      }),
    );

    mockRunIosSafariMediaRecorderStrategy.mockImplementation(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise<boolean>((resolve) => {
          signal.addEventListener('abort', () => resolve(false), { once: true });
        }),
    );

    const { result } = renderHook(() => useAppleSafariExport());
    const args = createStartExportArgs();

    await act(async () => {
      result.current.startExport(
        args.canvasRef,
        args.masterDestRef,
        args.onRecordingStop,
        args.onRecordingError,
      );
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.isProcessing).toBe(true);
    });

    act(() => {
      result.current.stopExport({ reason: 'user' });
    });

    await waitFor(() => {
      expect(args.onRecordingError).toHaveBeenCalledWith('エクスポートが中断されました');
    });
  });

  it.each(['superseded', 'unmount'] as const)(
    'stopExport({ reason: "%s" }) は system cleanup 扱いで中断エラーを通知しない',
    async (reason) => {
      mockGetPlatformCapabilities.mockReturnValue(
        createPlatformCapabilities({
          isIOS: true,
          isSafari: true,
          isIosSafari: true,
          supportsMp4MediaRecorder: true,
          supportedMediaRecorderProfile: {
            mimeType: 'video/mp4',
            extension: 'mp4',
          },
        }),
      );

      mockRunIosSafariMediaRecorderStrategy.mockImplementation(
        ({ signal }: { signal: AbortSignal }) =>
          new Promise<boolean>((resolve) => {
            signal.addEventListener('abort', () => resolve(false), { once: true });
          }),
      );

      const { result } = renderHook(() => useAppleSafariExport());
      const args = createStartExportArgs();

      await act(async () => {
        result.current.startExport(
          args.canvasRef,
          args.masterDestRef,
          args.onRecordingStop,
          args.onRecordingError,
        );
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(result.current.isProcessing).toBe(true);
      });

      act(() => {
        result.current.stopExport({ reason });
      });

      await waitFor(() => {
        expect(result.current.isProcessing).toBe(false);
      });
      expect(args.onRecordingError).not.toHaveBeenCalled();
    },
  );

  it('stopExport({ silent: true, reason: "user" }) は中断エラーを通知しない', async () => {
    mockGetPlatformCapabilities.mockReturnValue(
      createPlatformCapabilities({
        isIOS: true,
        isSafari: true,
        isIosSafari: true,
        supportsMp4MediaRecorder: true,
        supportedMediaRecorderProfile: {
          mimeType: 'video/mp4',
          extension: 'mp4',
        },
      }),
    );

    mockRunIosSafariMediaRecorderStrategy.mockImplementation(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise<boolean>((resolve) => {
          signal.addEventListener('abort', () => resolve(false), { once: true });
        }),
    );

    const { result } = renderHook(() => useAppleSafariExport());
    const args = createStartExportArgs();

    await act(async () => {
      result.current.startExport(
        args.canvasRef,
        args.masterDestRef,
        args.onRecordingStop,
        args.onRecordingError,
      );
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.isProcessing).toBe(true);
    });

    act(() => {
      result.current.stopExport({ silent: true, reason: 'user' });
    });

    await waitFor(() => {
      expect(result.current.isProcessing).toBe(false);
    });
    expect(args.onRecordingError).not.toHaveBeenCalled();
  });

  it('自然終端要求の後は stopExport({ reason: "user" }) でも abort しない', async () => {
    mockGetPlatformCapabilities.mockReturnValue(
      createPlatformCapabilities({
        isIOS: true,
        isSafari: true,
        isIosSafari: true,
        supportsMp4MediaRecorder: true,
        supportedMediaRecorderProfile: {
          mimeType: 'video/mp4',
          extension: 'mp4',
        },
      }),
    );

    let capturedSignal: AbortSignal | null = null;
    let resolveStrategy: ((handled: boolean) => void) | undefined;
    mockRunIosSafariMediaRecorderStrategy.mockImplementation(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise<boolean>((resolve) => {
          capturedSignal = signal;
          resolveStrategy = resolve;
        }),
    );

    const { result } = renderHook(() => useAppleSafariExport());
    const args = createStartExportArgs();

    await act(async () => {
      result.current.startExport(
        args.canvasRef,
        args.masterDestRef,
        args.onRecordingStop,
        args.onRecordingError,
      );
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.isProcessing).toBe(true);
    });

    act(() => {
      result.current.completeExport();
    });

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      result.current.stopExport({ reason: 'user' });
    });

    if (!capturedSignal) {
      throw new Error('AbortSignal was not captured');
    }
    if (!resolveStrategy) {
      throw new Error('Strategy resolver was not captured');
    }
    const signal = capturedSignal as AbortSignal;
    const strategyResolver: (handled: boolean) => void = resolveStrategy;
    expect(signal.aborted).toBe(false);
    expect(args.onRecordingError).not.toHaveBeenCalled();

    await act(async () => {
      strategyResolver(true);
      await Promise.resolve();
    });
    expect(args.onRecordingError).not.toHaveBeenCalled();
  });

  it('MediaRecorder 完了 callback 中の stopExport({ reason: "user" }) は完了済み扱いで abort しない', async () => {
    mockGetPlatformCapabilities.mockReturnValue(
      createPlatformCapabilities({
        isIOS: true,
        isSafari: true,
        isIosSafari: true,
        supportsMp4MediaRecorder: true,
        supportedMediaRecorderProfile: {
          mimeType: 'video/mp4',
          extension: 'mp4',
        },
      }),
    );

    let capturedSignal: AbortSignal | null = null;
    mockRunIosSafariMediaRecorderStrategy.mockImplementation(
      ({
        callbacks,
        signal,
      }: {
        callbacks: { onRecordingStop: (url: string, ext: string) => void };
        signal: AbortSignal;
      }) =>
        new Promise<boolean>((resolve) => {
          capturedSignal = signal;
          callbacks.onRecordingStop('blob:ios-complete', 'mp4');
          resolve(true);
        }),
    );

    const { result } = renderHook(() => useAppleSafariExport());
    const args = createStartExportArgs();
    args.onRecordingStop.mockImplementation(() => {
      result.current.stopExport({ reason: 'user' });
    });

    await act(async () => {
      await result.current.startExport(
        args.canvasRef,
        args.masterDestRef,
        args.onRecordingStop,
        args.onRecordingError,
        {
          mediaItems: [],
          bgm: null,
          narrations: [],
          totalDuration: 10,
          getPlaybackTimeSec: () => 10,
        },
      );
    });

    if (!capturedSignal) {
      throw new Error('AbortSignal was not captured');
    }
    expect((capturedSignal as AbortSignal).aborted).toBe(false);
    expect(args.onRecordingStop).toHaveBeenCalledWith('blob:ios-complete', 'mp4');
    expect(args.onRecordingError).not.toHaveBeenCalled();
    expect(result.current.isProcessing).toBe(false);
  });

  it('終端到達後の stale user cancel は有効な MediaRecorder URL を UI callback へ届ける', async () => {
    mockGetPlatformCapabilities.mockReturnValue(
      createPlatformCapabilities({
        isIOS: true,
        isSafari: true,
        isIosSafari: true,
        supportsMp4MediaRecorder: true,
        supportedMediaRecorderProfile: {
          mimeType: 'video/mp4',
          extension: 'mp4',
        },
      }),
    );

    let capturedCallbacks:
      | { onRecordingStop: (url: string, ext: string) => void }
      | null = null;
    let resolveStrategy: ((handled: boolean) => void) | undefined;
    mockRunIosSafariMediaRecorderStrategy.mockImplementation(
      ({
        callbacks,
      }: {
        callbacks: { onRecordingStop: (url: string, ext: string) => void };
      }) =>
        new Promise<boolean>((resolve) => {
          capturedCallbacks = callbacks;
          resolveStrategy = resolve;
        }),
    );

    const { result } = renderHook(() => useAppleSafariExport());
    const args = createStartExportArgs();

    await act(async () => {
      result.current.startExport(
        args.canvasRef,
        args.masterDestRef,
        args.onRecordingStop,
        args.onRecordingError,
        {
          mediaItems: [],
          bgm: null,
          narrations: [],
          totalDuration: 10,
          getPlaybackTimeSec: () => 10,
        },
      );
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.isProcessing).toBe(true);
    });

    act(() => {
      result.current.stopExport({ reason: 'user' });
    });

    if (!capturedCallbacks || !resolveStrategy) {
      throw new Error('MediaRecorder strategy was not captured');
    }
    const strategyCallbacks = capturedCallbacks as { onRecordingStop: (url: string, ext: string) => void };
    const strategyResolver = resolveStrategy as (handled: boolean) => void;

    await act(async () => {
      strategyCallbacks.onRecordingStop('blob:ios-after-natural-end', 'mp4');
      strategyResolver(true);
      await Promise.resolve();
    });

    expect(args.onRecordingStop).toHaveBeenCalledWith('blob:ios-after-natural-end', 'mp4');
    expect(args.onRecordingError).not.toHaveBeenCalled();
    expect(result.current.isProcessing).toBe(false);
  });

  it('iOS MediaRecorder の非 abort 完了は再生時刻が終端未満でも stale user cancel から復旧して通知する', async () => {
    mockGetPlatformCapabilities.mockReturnValue(
      createPlatformCapabilities({
        isIOS: true,
        isSafari: true,
        isIosSafari: true,
        supportsMp4MediaRecorder: true,
        supportedMediaRecorderProfile: {
          mimeType: 'video/mp4',
          extension: 'mp4',
        },
      }),
    );

    let capturedCallbacks: { onRecordingStop: RecordingStopCallback } | null = null;
    let resolveStrategy: ((handled: boolean) => void) | undefined;
    mockRunIosSafariMediaRecorderStrategy.mockImplementation(
      ({
        callbacks,
      }: {
        callbacks: { onRecordingStop: RecordingStopCallback };
      }) =>
        new Promise<boolean>((resolve) => {
          capturedCallbacks = callbacks;
          resolveStrategy = resolve;
        }),
    );

    const { result } = renderHook(() => useAppleSafariExport());
    const args = createStartExportArgs();

    await act(async () => {
      result.current.startExport(
        args.canvasRef,
        args.masterDestRef,
        args.onRecordingStop,
        args.onRecordingError,
        {
          mediaItems: [],
          bgm: null,
          narrations: [],
          totalDuration: 10,
          getPlaybackTimeSec: () => 5,
        },
      );
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.isProcessing).toBe(true);
    });

    act(() => {
      result.current.stopExport({ reason: 'user' });
    });

    if (!capturedCallbacks || !resolveStrategy) {
      throw new Error('MediaRecorder strategy was not captured');
    }
    const strategyCallbacks = capturedCallbacks as { onRecordingStop: RecordingStopCallback };
    const strategyResolver = resolveStrategy as (handled: boolean) => void;

    await act(async () => {
      strategyCallbacks.onRecordingStop('blob:ios-confirmed-complete', 'mp4', {
        source: 'media-recorder',
        blobSizeBytes: 1024,
        signalAborted: false,
      });
      strategyResolver(true);
      await Promise.resolve();
    });

    expect(args.onRecordingStop).toHaveBeenCalledWith('blob:ios-confirmed-complete', 'mp4');
    expect(args.onRecordingError).not.toHaveBeenCalled();
    expect(result.current.isProcessing).toBe(false);
  });

  it('iOS MediaRecorder の abort 後 callback は Blob があっても UI callback へ届けない', async () => {
    mockGetPlatformCapabilities.mockReturnValue(
      createPlatformCapabilities({
        isIOS: true,
        isSafari: true,
        isIosSafari: true,
        supportsMp4MediaRecorder: true,
        supportedMediaRecorderProfile: {
          mimeType: 'video/mp4',
          extension: 'mp4',
        },
      }),
    );

    let capturedCallbacks: { onRecordingStop: RecordingStopCallback } | null = null;
    let resolveStrategy: ((handled: boolean) => void) | undefined;
    mockRunIosSafariMediaRecorderStrategy.mockImplementation(
      ({
        callbacks,
      }: {
        callbacks: { onRecordingStop: RecordingStopCallback };
      }) =>
        new Promise<boolean>((resolve) => {
          capturedCallbacks = callbacks;
          resolveStrategy = resolve;
        }),
    );

    const { result } = renderHook(() => useAppleSafariExport());
    const args = createStartExportArgs();

    await act(async () => {
      result.current.startExport(
        args.canvasRef,
        args.masterDestRef,
        args.onRecordingStop,
        args.onRecordingError,
        {
          mediaItems: [],
          bgm: null,
          narrations: [],
          totalDuration: 10,
          getPlaybackTimeSec: () => 5,
        },
      );
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.isProcessing).toBe(true);
    });

    act(() => {
      result.current.stopExport({ reason: 'user' });
    });

    if (!capturedCallbacks || !resolveStrategy) {
      throw new Error('MediaRecorder strategy was not captured');
    }
    const strategyCallbacks = capturedCallbacks as { onRecordingStop: RecordingStopCallback };
    const strategyResolver = resolveStrategy as (handled: boolean) => void;

    await act(async () => {
      strategyCallbacks.onRecordingStop('blob:ios-aborted-partial', 'mp4', {
        source: 'media-recorder',
        blobSizeBytes: 1024,
        signalAborted: true,
      });
      strategyResolver(true);
      await Promise.resolve();
    });

    expect(args.onRecordingStop).not.toHaveBeenCalled();
    expect(result.current.isProcessing).toBe(false);
  });

  it('終端前の user cancel では MediaRecorder URL callback を抑止する', async () => {
    mockGetPlatformCapabilities.mockReturnValue(
      createPlatformCapabilities({
        isIOS: true,
        isSafari: true,
        isIosSafari: true,
        supportsMp4MediaRecorder: true,
        supportedMediaRecorderProfile: {
          mimeType: 'video/mp4',
          extension: 'mp4',
        },
      }),
    );

    let capturedCallbacks:
      | { onRecordingStop: (url: string, ext: string) => void }
      | null = null;
    let resolveStrategy: ((handled: boolean) => void) | undefined;
    mockRunIosSafariMediaRecorderStrategy.mockImplementation(
      ({
        callbacks,
      }: {
        callbacks: { onRecordingStop: (url: string, ext: string) => void };
      }) =>
        new Promise<boolean>((resolve) => {
          capturedCallbacks = callbacks;
          resolveStrategy = resolve;
        }),
    );

    const { result } = renderHook(() => useAppleSafariExport());
    const args = createStartExportArgs();

    await act(async () => {
      result.current.startExport(
        args.canvasRef,
        args.masterDestRef,
        args.onRecordingStop,
        args.onRecordingError,
        {
          mediaItems: [],
          bgm: null,
          narrations: [],
          totalDuration: 10,
          getPlaybackTimeSec: () => 5,
        },
      );
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.isProcessing).toBe(true);
    });

    act(() => {
      result.current.stopExport({ reason: 'user' });
    });

    if (!capturedCallbacks || !resolveStrategy) {
      throw new Error('MediaRecorder strategy was not captured');
    }
    const strategyCallbacks = capturedCallbacks as { onRecordingStop: (url: string, ext: string) => void };
    const strategyResolver = resolveStrategy as (handled: boolean) => void;

    await act(async () => {
      strategyCallbacks.onRecordingStop('blob:ios-cancelled-before-end', 'mp4');
      strategyResolver(true);
      await Promise.resolve();
    });

    expect(args.onRecordingStop).not.toHaveBeenCalled();
    expect(result.current.isProcessing).toBe(false);
  });

  it('clearExportUrl は保持中の Blob URL を解放して state を空にする', () => {
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL');
    const { result } = renderHook(() => useStandardExport());

    act(() => {
      result.current.setExportUrl('blob:test-export');
      result.current.setExportExt('mp4');
    });

    act(() => {
      result.current.clearExportUrl();
    });

    expect(revokeSpy).toHaveBeenCalledWith('blob:test-export');
    expect(result.current.exportUrl).toBeNull();
    expect(result.current.exportExt).toBeNull();
  });

  it('startExport 開始時に前回の Blob URL を解放してから state を空にする', async () => {
    mockGetPlatformCapabilities.mockReturnValue(createPlatformCapabilities());
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { result } = renderHook(() => useStandardExport());
    const args = createStartExportArgs();

    act(() => {
      result.current.setExportUrl('blob:previous-export');
      result.current.setExportExt('mp4');
    });

    await act(async () => {
      await result.current.startExport(
        args.canvasRef,
        args.masterDestRef,
        args.onRecordingStop,
        args.onRecordingError,
      );
    });

    expect(revokeSpy).toHaveBeenCalledWith('blob:previous-export');
    expect(result.current.exportUrl).toBeNull();
    expect(result.current.exportExt).toBeNull();
  });

  it('AudioTrack volume は export 前に 0..2.5 へ clamp する', () => {
    expect(clampAudioTrackVolume(-1)).toBe(0);
    expect(clampAudioTrackVolume(0)).toBe(0);
    expect(clampAudioTrackVolume(1.25)).toBe(1.25);
    expect(clampAudioTrackVolume(2.5)).toBe(2.5);
    expect(clampAudioTrackVolume(3)).toBe(2.5);
  });
});
