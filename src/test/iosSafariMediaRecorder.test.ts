import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runIosSafariMediaRecorderStrategy } from '../flavors/apple-safari/export/iosSafariMediaRecorder';

class FakeMediaStream {
  private readonly tracks: Array<{ kind: string }>;

  constructor(tracks: Array<{ kind: string }> = []) {
    this.tracks = tracks;
  }

  getTracks() {
    return this.tracks;
  }

  getVideoTracks() {
    return this.tracks.filter((track) => track.kind === 'video');
  }

  getAudioTracks() {
    return this.tracks.filter((track) => track.kind === 'audio');
  }
}

type FakeTrack = {
  kind: 'video' | 'audio';
  readyState: 'live' | 'ended';
  stop: ReturnType<typeof vi.fn>;
  clone?: () => FakeTrack;
  requestFrame?: ReturnType<typeof vi.fn>;
};

function createAudioContextDouble() {
  const oscillator = {
    frequency: { value: 0 },
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    disconnect: vi.fn(),
  };
  const gain = {
    gain: { value: 0.00001 },
    connect: vi.fn(),
    disconnect: vi.fn(),
  };

  return {
    createOscillator: vi.fn(() => oscillator),
    createGain: vi.fn(() => gain),
  } as unknown as AudioContext;
}

function createCanvasDouble(videoTrack: FakeTrack) {
  const stream = new FakeMediaStream([videoTrack]);

  return {
    canvas: {
      captureStream: vi.fn(() => stream),
    } as unknown as HTMLCanvasElement,
    stream,
  };
}

function createCallbacks() {
  return {
    onRecordingStop: vi.fn(),
    onRecordingError: vi.fn(),
  };
}

function createStateSetters() {
  return {
    setExportUrl: vi.fn(),
    setExportExt: vi.fn(),
  };
}

describe('runIosSafariMediaRecorderStrategy', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('MediaStream', FakeMediaStream as unknown as typeof MediaStream);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('MediaRecorder profile が無い場合は WebCodecs へフォールバックする', async () => {
    const videoTrack: FakeTrack = {
      kind: 'video',
      readyState: 'live',
      stop: vi.fn(),
    };
    const { canvas } = createCanvasDouble(videoTrack);

    const result = await runIosSafariMediaRecorderStrategy({
      canvas,
      masterDest: {
        stream: new FakeMediaStream([]),
      } as unknown as MediaStreamAudioDestinationNode,
      audioContext: createAudioContextDouble(),
      signal: new AbortController().signal,
      callbacks: createCallbacks(),
      state: createStateSetters(),
      refs: {
        recorderRef: { current: null },
      },
      exportConfig: {
        fps: 30,
        videoBitrate: 1_000_000,
      },
      supportedMediaRecorderProfile: null,
    });

    expect(result).toBe(false);
  });

  it('live な音声トラックが無い場合は canvas track を解放してフォールバックする', async () => {
    const videoTrack: FakeTrack = {
      kind: 'video',
      readyState: 'live',
      stop: vi.fn(),
    };
    const { canvas } = createCanvasDouble(videoTrack);
    const deadAudioTrack: FakeTrack = {
      kind: 'audio',
      readyState: 'ended',
      stop: vi.fn(),
      clone: () => deadAudioTrack,
    };

    const result = await runIosSafariMediaRecorderStrategy({
      canvas,
      masterDest: {
        stream: new FakeMediaStream([deadAudioTrack]),
      } as unknown as MediaStreamAudioDestinationNode,
      audioContext: createAudioContextDouble(),
      signal: new AbortController().signal,
      callbacks: createCallbacks(),
      state: createStateSetters(),
      refs: {
        recorderRef: { current: null },
      },
      exportConfig: {
        fps: 30,
        videoBitrate: 1_000_000,
      },
      supportedMediaRecorderProfile: {
        mimeType: 'video/mp4',
        extension: 'mp4',
      },
    });

    expect(result).toBe(false);
    expect(videoTrack.stop).toHaveBeenCalled();
  });

  it('成功時は MediaRecorder 経路で exportUrl/ext と callback を更新する', async () => {
    const videoTrack: FakeTrack = {
      kind: 'video',
      readyState: 'live',
      stop: vi.fn(),
      requestFrame: vi.fn(),
    };
    const recorderAudioTrack: FakeTrack = {
      kind: 'audio',
      readyState: 'live',
      stop: vi.fn(),
    };
    const sourceAudioTrack: FakeTrack = {
      kind: 'audio',
      readyState: 'live',
      stop: vi.fn(),
      clone: () => recorderAudioTrack,
    };
    const { canvas } = createCanvasDouble(videoTrack);
    const callbacks = createCallbacks();
    const state = createStateSetters();
    const recorderRef = { current: null as MediaRecorder | null };
    const onAudioPreRenderComplete = vi.fn();
    const createObjectUrlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:ios-export');

    class MockMediaRecorder {
      state: RecordingState = 'inactive';
      ondataavailable: ((event: BlobEvent) => void) | null = null;
      onerror: (() => void) | null = null;
      onstop: (() => void) | null = null;
      readonly start = vi.fn((timeslice?: number) => {
        this.state = 'recording';
        this.timeslice = timeslice;
        setTimeout(() => {
          this.ondataavailable?.({ data: new Blob(['ok']) } as BlobEvent);
          this.state = 'inactive';
          this.onstop?.();
        }, 0);
      });
      readonly pause = vi.fn(() => {
        this.state = 'paused';
      });
      readonly resume = vi.fn(() => {
        this.state = 'recording';
      });
      readonly requestData = vi.fn();
      readonly stop = vi.fn(() => {
        this.state = 'inactive';
        this.onstop?.();
      });
      timeslice?: number;

      constructor(
        readonly stream: MediaStream,
        readonly options?: MediaRecorderOptions,
      ) {}
    }

    vi.stubGlobal('MediaRecorder', MockMediaRecorder as unknown as typeof MediaRecorder);

    const promise = runIosSafariMediaRecorderStrategy({
      canvas,
      masterDest: {
        stream: new FakeMediaStream([sourceAudioTrack]),
      } as unknown as MediaStreamAudioDestinationNode,
      audioContext: createAudioContextDouble(),
      signal: new AbortController().signal,
      audioSources: {
        mediaItems: [],
        bgm: null,
        narrations: [],
        totalDuration: 1,
        onAudioPreRenderComplete,
      },
      callbacks,
      state,
      refs: {
        recorderRef,
      },
      exportConfig: {
        fps: 30,
        videoBitrate: 1_000_000,
      },
      supportedMediaRecorderProfile: {
        mimeType: 'video/mp4',
        extension: 'mp4',
      },
    });

    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe(true);
    expect(onAudioPreRenderComplete).toHaveBeenCalled();
    expect(state.setExportUrl).toHaveBeenCalledWith('blob:ios-export');
    expect(state.setExportExt).toHaveBeenCalledWith('mp4');
    expect(callbacks.onRecordingStop).toHaveBeenCalledWith(
      'blob:ios-export',
      'mp4',
      expect.objectContaining({
        source: 'media-recorder',
        signalAborted: false,
      }),
    );
    expect(videoTrack.requestFrame).toHaveBeenCalled();
  expect(videoTrack.stop).toHaveBeenCalled();
  expect(recorderAudioTrack.stop).toHaveBeenCalled();
  expect(recorderRef.current).toBeNull();
  expect(createObjectUrlSpy).toHaveBeenCalled();
  });

  it('pre-rendered 音声がある場合は live masterDest よりそちらを優先する', async () => {
    const videoTrack: FakeTrack = {
      kind: 'video',
      readyState: 'live',
      stop: vi.fn(),
      requestFrame: vi.fn(),
    };
    const preRenderedTrack: FakeTrack = {
      kind: 'audio',
      readyState: 'live',
      stop: vi.fn(),
    };
    const { canvas } = createCanvasDouble(videoTrack);
    const callbacks = createCallbacks();
    const state = createStateSetters();
    const recorderRef = { current: null as MediaRecorder | null };
    const onAudioPreRenderComplete = vi.fn();
    const preRenderedAudio = {
      stream: new FakeMediaStream([preRenderedTrack]) as unknown as MediaStream,
      startPlayback: vi.fn(),
      cleanup: vi.fn(),
    };
    const audioContext = createAudioContextDouble();
    const createObjectUrlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:ios-export-prerendered');

    class MockMediaRecorder {
      state: RecordingState = 'inactive';
      ondataavailable: ((event: BlobEvent) => void) | null = null;
      onerror: (() => void) | null = null;
      onstop: (() => void) | null = null;
      readonly start = vi.fn(() => {
        this.state = 'recording';
        setTimeout(() => {
          this.ondataavailable?.({ data: new Blob(['ok']) } as BlobEvent);
          this.state = 'inactive';
          this.onstop?.();
        }, 0);
      });
      readonly pause = vi.fn(() => {
        this.state = 'paused';
      });
      readonly resume = vi.fn(() => {
        this.state = 'recording';
      });
      readonly requestData = vi.fn();
      readonly stop = vi.fn(() => {
        this.state = 'inactive';
        this.onstop?.();
      });

      constructor(
        readonly stream: MediaStream,
        readonly options?: MediaRecorderOptions,
      ) {}
    }

    vi.stubGlobal('MediaRecorder', MockMediaRecorder as unknown as typeof MediaRecorder);

    const promise = runIosSafariMediaRecorderStrategy({
      canvas,
      masterDest: {
        stream: new FakeMediaStream([]),
      } as unknown as MediaStreamAudioDestinationNode,
      audioContext,
      signal: new AbortController().signal,
      audioSources: {
        mediaItems: [],
        bgm: null,
        narrations: [],
        totalDuration: 1,
        onAudioPreRenderComplete,
      },
      preRenderedAudio,
      callbacks,
      state,
      refs: {
        recorderRef,
      },
      exportConfig: {
        fps: 30,
        videoBitrate: 1_000_000,
      },
      supportedMediaRecorderProfile: {
        mimeType: 'video/mp4',
        extension: 'mp4',
      },
    });

    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe(true);
    expect(preRenderedAudio.startPlayback).toHaveBeenCalledTimes(1);
    expect(onAudioPreRenderComplete).toHaveBeenCalledTimes(1);
    expect(preRenderedAudio.startPlayback.mock.invocationCallOrder[0]).toBeLessThan(
      onAudioPreRenderComplete.mock.invocationCallOrder[0],
    );
    expect(preRenderedAudio.cleanup).toHaveBeenCalledTimes(1);
    expect(preRenderedTrack.stop).toHaveBeenCalled();
    expect(state.setExportUrl).toHaveBeenCalledWith('blob:ios-export-prerendered');
    expect(callbacks.onRecordingStop).toHaveBeenCalledWith(
      'blob:ios-export-prerendered',
      'mp4',
      expect.objectContaining({
        source: 'media-recorder',
        signalAborted: false,
      }),
    );
    expect(audioContext.createOscillator).not.toHaveBeenCalled();
    expect(createObjectUrlSpy).toHaveBeenCalled();
  });

  it('iOS Safari で onstop が発火せず state=inactive のままでも watchdog が chunks から blob を作って完了させる', async () => {
    // 実機 iOS Safari で観測される「recorder.stop() を呼んでも onstop が発火しない」
    // ケースの再現テスト。stop() は monkey-patch されており、呼び出すと同時に
    // watchdog (3 秒タイムアウト) が arm される。3 秒経っても onstop が来なかった
    // 場合は chunks から blob を組み立てて onRecordingStop を発火させ、UI が
    // 「保存ファイルを作成中」のまま固まらないことを保証する。
    const videoTrack: FakeTrack = {
      kind: 'video',
      readyState: 'live',
      stop: vi.fn(),
      requestFrame: vi.fn(),
    };
    const recorderAudioTrack: FakeTrack = {
      kind: 'audio',
      readyState: 'live',
      stop: vi.fn(),
    };
    const sourceAudioTrack: FakeTrack = {
      kind: 'audio',
      readyState: 'live',
      stop: vi.fn(),
      clone: () => recorderAudioTrack,
    };
    const { canvas } = createCanvasDouble(videoTrack);
    const callbacks = createCallbacks();
    const state = createStateSetters();
    const recorderRef = { current: null as MediaRecorder | null };
    const onAudioPreRenderComplete = vi.fn();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:ios-watchdog');

    class StuckMediaRecorder {
      state: RecordingState = 'inactive';
      ondataavailable: ((event: BlobEvent) => void) | null = null;
      onerror: (() => void) | null = null;
      onstop: (() => void) | null = null;
      readonly start = vi.fn((timeslice?: number) => {
        this.state = 'recording';
        this.timeslice = timeslice;
        // 250ms ごとに chunks を投入する (timeslice 動作の擬似再現)
        setTimeout(() => {
          this.ondataavailable?.({ data: new Blob(['frame1']) } as BlobEvent);
        }, 250);
      });
      readonly pause = vi.fn(() => {
        this.state = 'paused';
      });
      readonly resume = vi.fn(() => {
        this.state = 'recording';
      });
      readonly requestData = vi.fn(() => {
        // requestData() でも chunks に追加するが onstop は発火しない
        this.ondataavailable?.({ data: new Blob(['final']) } as BlobEvent);
      });
      // iOS Safari 退行の再現: stop() を呼んでも state は inactive になるが
      // onstop は発火しない。
      readonly stop = vi.fn(() => {
        this.state = 'inactive';
        // onstop?.() は意図的に呼ばない
      });
      timeslice?: number;

      constructor(
        readonly stream: MediaStream,
        readonly options?: MediaRecorderOptions,
      ) {}
    }

    vi.stubGlobal('MediaRecorder', StuckMediaRecorder as unknown as typeof MediaRecorder);

    const promise = runIosSafariMediaRecorderStrategy({
      canvas,
      masterDest: {
        stream: new FakeMediaStream([sourceAudioTrack]),
      } as unknown as MediaStreamAudioDestinationNode,
      audioContext: createAudioContextDouble(),
      signal: new AbortController().signal,
      audioSources: {
        mediaItems: [],
        bgm: null,
        narrations: [],
        totalDuration: 1,
        onAudioPreRenderComplete,
      },
      callbacks,
      state,
      refs: {
        recorderRef,
      },
      exportConfig: {
        fps: 30,
        videoBitrate: 1_000_000,
      },
      supportedMediaRecorderProfile: {
        mimeType: 'video/mp4',
        extension: 'mp4',
      },
    });

    // recorder.start() の setTimeout(250) で chunks を入れる
    await vi.advanceTimersByTimeAsync(250);
    // signal は abort されないので、natural-end ハンドラ相当: 外部から stop() を呼ぶ
    const recorder = recorderRef.current as unknown as StuckMediaRecorder;
    recorder.requestData(); // chunks 追加
    // recorder.stop() は monkey-patch されており、呼び出すと同時に watchdog が
    // arm される。state monitor の検出を待たずに直接 watchdog が起動する。
    recorder.stop();

    // watchdog timeout (3000ms) を経過させる
    await vi.advanceTimersByTimeAsync(3000);

    await promise;

    // watchdog が onRecordingStop を発火させた
    expect(state.setExportUrl).toHaveBeenCalledWith('blob:ios-watchdog');
    expect(state.setExportExt).toHaveBeenCalledWith('mp4');
    expect(callbacks.onRecordingStop).toHaveBeenCalledWith(
      'blob:ios-watchdog',
      'mp4',
      expect.objectContaining({
        source: 'media-recorder',
        signalAborted: false,
      }),
    );
    expect(callbacks.onRecordingError).not.toHaveBeenCalled();
  });

  it('iOS Safari で onstop が発火せず chunks も空のままなら watchdog が onRecordingError を発火して UI を救出する', async () => {
    // 最悪パターン: stop() を呼んでも onstop が発火せず chunks も空のままだと、
    // 何も発火しないと UI は「保存ファイルを作成中」のまま固まる。watchdog が
    // onRecordingError を発火して UI をエラー状態に戻すことを保証する。
    const videoTrack: FakeTrack = {
      kind: 'video',
      readyState: 'live',
      stop: vi.fn(),
      requestFrame: vi.fn(),
    };
    const recorderAudioTrack: FakeTrack = {
      kind: 'audio',
      readyState: 'live',
      stop: vi.fn(),
    };
    const sourceAudioTrack: FakeTrack = {
      kind: 'audio',
      readyState: 'live',
      stop: vi.fn(),
      clone: () => recorderAudioTrack,
    };
    const { canvas } = createCanvasDouble(videoTrack);
    const callbacks = createCallbacks();
    const state = createStateSetters();
    const recorderRef = { current: null as MediaRecorder | null };

    class EmptyStuckMediaRecorder {
      state: RecordingState = 'inactive';
      ondataavailable: ((event: BlobEvent) => void) | null = null;
      onerror: (() => void) | null = null;
      onstop: (() => void) | null = null;
      readonly start = vi.fn(() => {
        this.state = 'recording';
      });
      readonly pause = vi.fn();
      readonly resume = vi.fn();
      readonly requestData = vi.fn(); // chunks には何も入れない
      readonly stop = vi.fn(() => {
        this.state = 'inactive';
        // onstop?.() は呼ばない
      });
      timeslice?: number;

      constructor(
        readonly stream: MediaStream,
        readonly options?: MediaRecorderOptions,
      ) {}
    }

    vi.stubGlobal('MediaRecorder', EmptyStuckMediaRecorder as unknown as typeof MediaRecorder);

    const promise = runIosSafariMediaRecorderStrategy({
      canvas,
      masterDest: {
        stream: new FakeMediaStream([sourceAudioTrack]),
      } as unknown as MediaStreamAudioDestinationNode,
      audioContext: createAudioContextDouble(),
      signal: new AbortController().signal,
      audioSources: {
        mediaItems: [],
        bgm: null,
        narrations: [],
        totalDuration: 1,
        onAudioPreRenderComplete: vi.fn(),
      },
      callbacks,
      state,
      refs: {
        recorderRef,
      },
      exportConfig: {
        fps: 30,
        videoBitrate: 1_000_000,
      },
      supportedMediaRecorderProfile: {
        mimeType: 'video/mp4',
        extension: 'mp4',
      },
    });

    const recorder = recorderRef.current as unknown as EmptyStuckMediaRecorder;
    // monkey-patch された stop() が watchdog を arm する
    recorder.stop();

    await vi.advanceTimersByTimeAsync(3000);

    await promise;

    // chunks 空 → onRecordingStop は発火しない、onRecordingError が発火する
    expect(callbacks.onRecordingStop).not.toHaveBeenCalled();
    expect(callbacks.onRecordingError).toHaveBeenCalledWith(
      expect.stringContaining('iOS Safari'),
    );
  });
});
