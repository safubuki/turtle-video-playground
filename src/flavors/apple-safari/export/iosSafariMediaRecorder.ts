import { useLogStore } from '../../../stores/logStore';
import type { IosSafariMediaRecorderStrategyContext } from '../../../hooks/export-strategies/types';
import {
  createMediaRecorderProbeResult,
  markMediaRecorderProbeFailure,
  markMediaRecorderProbeSuccess,
} from './mediaRecorderProbe';

type RequestFrameCapableTrack = MediaStreamTrack & {
  requestFrame?: () => void;
};

export async function runIosSafariMediaRecorderStrategy(
  context: IosSafariMediaRecorderStrategyContext,
): Promise<boolean> {
  const {
    canvas,
    masterDest,
    audioContext,
    signal,
    audioSources,
    preRenderedAudio,
    callbacks,
    state,
    refs,
    exportConfig,
    supportedMediaRecorderProfile,
  } = context;

  const log = useLogStore.getState();
  const exportSessionId = context.diagnostics?.exportSessionId;
  const profile = supportedMediaRecorderProfile;
  let probe = createMediaRecorderProbeResult(profile);
  if (!profile) {
    log.warn('RENDER', 'iOS Safari: MediaRecorder profile unavailable, fallback to WebCodecs', {
      exportSessionId,
      probe,
    });
    return false;
  }

  // [capture mode] iOS Safari MediaRecorder の映像取り込み。
  // captureStream(fps) の自動供給に「加えて」requestFrame を定期実行すると、
  // フレームが二重供給され、CFR ではない MediaRecorder では取り込みフレーム間隔が
  // 不揃いになる。これが「デコードは正常 (getVideoPlaybackQuality drop=0) なのに
  // 書き出し映像だけカクつく」原因 (実装パターン 13-13 / WebCodecs 経路で実証済)。
  // requestFrame が使える環境では captureStream(0) の手動モードにして自動供給を止め、
  // frame pump 単一供給へ統一する。静止画区間でも pump がフレームを供給するため
  // 尺ズレは起きない。requestFrame 非対応環境は従来どおり captureStream(fps) 自動供給。
  let canvasStream: MediaStream;
  let canvasVideoTrack: RequestFrameCapableTrack | undefined;
  let canvasCaptureMode: 'manual-requestFrame' | 'auto-fps';
  const manualCanvasStream = canvas.captureStream(0);
  const manualCanvasTrack = manualCanvasStream.getVideoTracks()[0] as RequestFrameCapableTrack | undefined;
  if (manualCanvasTrack && typeof manualCanvasTrack.requestFrame === 'function') {
    canvasStream = manualCanvasStream;
    canvasVideoTrack = manualCanvasTrack;
    canvasCaptureMode = 'manual-requestFrame';
  } else {
    manualCanvasStream.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch {
        // ignore
      }
    });
    canvasStream = canvas.captureStream(exportConfig.fps);
    canvasVideoTrack = canvasStream.getVideoTracks()[0] as RequestFrameCapableTrack | undefined;
    canvasCaptureMode = 'auto-fps';
  }
  const sourceAudioStream = preRenderedAudio?.stream ?? masterDest.stream;
  const sourceAudioTracks = sourceAudioStream.getAudioTracks();
  const liveAudioTracks = sourceAudioTracks.filter((track) => track.readyState === 'live');

  if (liveAudioTracks.length === 0) {
    log.warn('RENDER', 'iOS Safari: no live audio track for MediaRecorder, fallback to WebCodecs', {
      exportSessionId,
      probe,
      sourceTrackCount: sourceAudioTracks.length,
      sourceTrackStates: sourceAudioTracks.map((track) => track.readyState),
      hasPreRenderedAudio: !!preRenderedAudio,
    });
    canvasStream.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch {
        // ignore
      }
    });
    return false;
  }

  const recorderAudioTracks = preRenderedAudio
    ? liveAudioTracks
    : liveAudioTracks.map((track) => track.clone());

  let keepAliveOscillator: OscillatorNode | null = null;
  let keepAliveGain: GainNode | null = null;
  let framePumpTimer: ReturnType<typeof setInterval> | null = null;
  let abortStopTimer: ReturnType<typeof setTimeout> | null = null;

  const combined = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...recorderAudioTracks,
  ]);

  // manual モード (captureStream(0)) のときだけ pump を回す。auto-fps モードでは
  // 自動供給に任せ、ここで requestFrame を併用しない（二重供給回避）。
  if (
    canvasCaptureMode === 'manual-requestFrame'
    && canvasVideoTrack
    && typeof canvasVideoTrack.requestFrame === 'function'
  ) {
    const frameIntervalMs = Math.max(16, Math.round(1000 / exportConfig.fps));
    framePumpTimer = setInterval(() => {
      try {
        canvasVideoTrack.requestFrame?.();
      } catch {
        // ignore
      }
    }, frameIntervalMs);
  }

  if (!preRenderedAudio) {
    try {
      keepAliveOscillator = audioContext.createOscillator();
      keepAliveGain = audioContext.createGain();
      keepAliveOscillator.frequency.value = 440;
      keepAliveGain.gain.value = 0.00001;
      keepAliveOscillator.connect(keepAliveGain);
      keepAliveGain.connect(masterDest);
      keepAliveOscillator.start();
    } catch (err) {
      keepAliveOscillator = null;
      keepAliveGain = null;
      log.warn('RENDER', 'iOS Safari: failed to create keep-alive audio node', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const cleanupStreams = () => {
    canvasStream.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch {
        // ignore
      }
    });

    recorderAudioTracks.forEach((track) => {
      try {
        track.stop();
      } catch {
        // ignore
      }
    });

    if (framePumpTimer) {
      clearInterval(framePumpTimer);
      framePumpTimer = null;
    }

    if (abortStopTimer) {
      clearTimeout(abortStopTimer);
      abortStopTimer = null;
    }

    if (keepAliveOscillator) {
      try {
        keepAliveOscillator.stop();
      } catch {
        // ignore
      }
      try {
        keepAliveOscillator.disconnect();
      } catch {
        // ignore
      }
      keepAliveOscillator = null;
    }

    if (keepAliveGain) {
      try {
        keepAliveGain.disconnect();
      } catch {
        // ignore
      }
      keepAliveGain = null;
    }

    preRenderedAudio?.cleanup();
  };

  const recorderOptions: MediaRecorderOptions = {
    videoBitsPerSecond: exportConfig.videoBitrate,
    audioBitsPerSecond: 128000,
  };
  if (profile.mimeType) {
    recorderOptions.mimeType = profile.mimeType;
  }

  log.info('RENDER', 'iOS Safari: starting MediaRecorder export strategy', {
    exportSessionId,
    mimeType: profile.mimeType || '(default)',
    extension: profile.extension,
    sourceAudioTrackCount: sourceAudioTracks.length,
    sourceAudioTrackStates: sourceAudioTracks.map((track) => track.readyState),
    recorderAudioTrackCount: recorderAudioTracks.length,
    hasCanvasFramePump: !!framePumpTimer,
    canvasCaptureMode,
    hasPreRenderedAudio: !!preRenderedAudio,
  });

  let startedSuccessfully = false;

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const chunks: Blob[] = [];
    let recorder: MediaRecorder | null = null;
    let pausedByVisibility = false;
    let visibilityListenersAttached = false;
    let stopWatchdogTimer: ReturnType<typeof setTimeout> | null = null;
    let onstopFired = false;

    const finishResolve = () => {
      if (settled) return;
      settled = true;
      if (stopWatchdogTimer !== null) {
        clearTimeout(stopWatchdogTimer);
        stopWatchdogTimer = null;
      }
      resolve();
    };

    // 以前は finishReject 経由で Promise を reject していたが、await 側で
    // catch されておらず「保存ファイルを作成中」のまま UI が固まる退行の原因
    // になっていたため、エラー経路は callbacks.onRecordingError + finishResolve
    // に統一した。Promise reject は使わない。reject 参照は今後の defensive 用に
    // 残すが、現状の経路では呼び出さない。
    void reject;

    /**
     * iOS Safari の MediaRecorder は recorder.stop() を呼んでも onstop が
     * 発火しない / 大きく遅延するケースが実機で観測される。stop() を呼んでから
     * STOP_WATCHDOG_TIMEOUT_MS 経っても onstop が来なかった場合は、それまでに
     * 累積した chunks から手動で blob を作って onRecordingStop を発火させる。
     * 「保存ファイルを作成中」のまま固まってダウンロードボタンに切り替わらない
     * 退行を防ぐためのフェイルセーフ。
     */
    const STOP_WATCHDOG_TIMEOUT_MS = 3000;
    const armStopWatchdog = () => {
      if (stopWatchdogTimer !== null) return;
      log.info('RENDER', 'iOS Safari: arm stop watchdog', {
        exportSessionId,
        chunksAccumulated: chunks.length,
        recorderState: recorder?.state ?? 'unknown',
        timeoutMs: STOP_WATCHDOG_TIMEOUT_MS,
      });
      stopWatchdogTimer = setTimeout(() => {
        stopWatchdogTimer = null;
        if (onstopFired || settled) return;
        log.warn('RENDER', 'iOS Safari: MediaRecorder onstop did not fire in time, force-completing', {
          exportSessionId,
          probe,
          chunks: chunks.length,
          recorderState: recorder?.state ?? 'unknown',
        });
        // 手動で onstop と同じ後処理を実行する
        try {
          cleanup();
        } catch {
          /* ignore */
        }
        refs.recorderRef.current = null;
        if (chunks.length === 0) {
          // chunks が空なら成功失敗の判別不能。エラーコールバックで UI を救出する。
          callbacks.onRecordingError?.(
            'iOS Safari の動画書き出しが完了通知を返しませんでした。少し時間を置いてからやり直してください。',
          );
          finishResolve();
          return;
        }
        const blob = new Blob(chunks, { type: profile.mimeType || 'video/mp4' });
        const url = URL.createObjectURL(blob);
        state.setExportUrl(url);
        state.setExportExt(profile.extension);
        log.info('RENDER', 'iOS Safari: MediaRecorder export completed (watchdog path)', {
          exportSessionId,
          probe,
          chunks: chunks.length,
          blobSizeBytes: blob.size,
          extension: profile.extension,
        });
        callbacks.onRecordingStop(url, profile.extension, {
          source: 'media-recorder',
          blobSizeBytes: blob.size,
          signalAborted: signal.aborted,
        });
        finishResolve();
      }, STOP_WATCHDOG_TIMEOUT_MS);
    };

    const handleRecorderVisibilityChange = () => {
      if (!recorder || recorder.state === 'inactive' || typeof document === 'undefined') {
        return;
      }

      const isVisible = document.visibilityState === 'visible';
      if (!isVisible) {
        if (recorder.state === 'recording') {
          try {
            recorder.pause();
            pausedByVisibility = true;
            log.info('RENDER', 'iOS Safari: paused MediaRecorder while page hidden');
          } catch (err) {
            log.warn('RENDER', 'iOS Safari: failed to pause MediaRecorder while hidden', {
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
        return;
      }

      if (pausedByVisibility && recorder.state === 'paused') {
        try {
          recorder.resume();
          pausedByVisibility = false;
          log.info('RENDER', 'iOS Safari: resumed MediaRecorder after visibility return');
        } catch (err) {
          log.warn('RENDER', 'iOS Safari: failed to resume MediaRecorder after visibility return', {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      try {
        canvasVideoTrack?.requestFrame?.();
      } catch {
        // ignore
      }
    };

    const removeVisibilityListeners = () => {
      if (!visibilityListenersAttached || typeof document === 'undefined') {
        return;
      }
      document.removeEventListener('visibilitychange', handleRecorderVisibilityChange);
      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', handleRecorderVisibilityChange);
        window.removeEventListener('pageshow', handleRecorderVisibilityChange);
      }
      visibilityListenersAttached = false;
    };

    const addVisibilityListeners = () => {
      if (visibilityListenersAttached || typeof document === 'undefined') {
        return;
      }
      document.addEventListener('visibilitychange', handleRecorderVisibilityChange);
      if (typeof window !== 'undefined') {
        window.addEventListener('focus', handleRecorderVisibilityChange);
        window.addEventListener('pageshow', handleRecorderVisibilityChange);
      }
      visibilityListenersAttached = true;
    };

    const cleanup = () => {
      signal.removeEventListener('abort', onAbort);
      removeVisibilityListeners();
      cleanupStreams();
    };

    const onAbort = () => {
      if (!recorder || recorder.state === 'inactive') {
        return;
      }

      try {
        canvasVideoTrack?.requestFrame?.();
      } catch {
        // ignore
      }

      try {
        recorder.requestData();
      } catch {
        // ignore
      }

      if (!abortStopTimer) {
        abortStopTimer = setTimeout(() => {
          abortStopTimer = null;
          if (recorder && recorder.state !== 'inactive') {
            try {
              // monkey-patch された recorder.stop が armStopWatchdog を呼ぶ
              recorder.stop();
            } catch {
              // ignore
            }
          }
        }, 180);
      }
    };

    try {
      recorder = new MediaRecorder(combined, recorderOptions);
      probe = markMediaRecorderProbeSuccess(probe, 'constructor');
      probe = {
        ...probe,
        requestDataSupported: typeof recorder.requestData === 'function',
      };
      refs.recorderRef.current = recorder;
    } catch (err) {
      cleanup();
      refs.recorderRef.current = null;
      probe = markMediaRecorderProbeFailure(probe, 'constructor', err);
      log.warn('RENDER', 'iOS Safari: failed to construct MediaRecorder, fallback to WebCodecs', {
        exportSessionId,
        probe,
        error: err instanceof Error ? err.message : String(err),
      });
      finishResolve();
      return;
    }

    signal.addEventListener('abort', onAbort, { once: true });
    addVisibilityListeners();

    // recorder.stop() を monkey-patch して、誰が呼んでも必ず watchdog を arm する。
    // 外部 (preview engine の natural-end など) から stop() が呼ばれた場合でも
    // iOS Safari の onstop 不発に備えてフェイルセーフを起動できるようにする。
    const originalStop = recorder.stop.bind(recorder);
    recorder.stop = () => {
      log.info('RENDER', 'iOS Safari: recorder.stop invoked (any caller)', {
        exportSessionId,
        chunksAccumulated: chunks.length,
        recorderState: recorder?.state ?? 'unknown',
      });
      // stop() 呼び出しと同時に watchdog を arm。onstop が正常に発火すれば
      // watchdog の中で onstopFired=true を見て早期 return する。
      armStopWatchdog();
      try {
        originalStop();
      } catch (err) {
        log.warn('RENDER', 'iOS Safari: recorder.stop threw', {
          exportSessionId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    };

    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data && event.data.size > 0) {
        chunks.push(event.data);
      }
    };

    recorder.onerror = () => {
      // watchdog などで既に force-complete 済みの場合は、遅延発火した onerror で
      // onRecordingError を二重呼び出ししないよう抜ける。
      if (settled) return;
      // recorder.onerror も finishReject にしていたが、await 側に catch が無く
      // 「保存ファイルを作成中」固まりの原因になっていた。onRecordingError で
      // UI を救出してから finishResolve する。
      log.warn('RENDER', 'iOS Safari: MediaRecorder error event', {
        exportSessionId,
        probe,
        recorderState: recorder?.state ?? 'unknown',
      });
      if (stopWatchdogTimer !== null) {
        clearTimeout(stopWatchdogTimer);
        stopWatchdogTimer = null;
      }
      cleanup();
      callbacks.onRecordingError?.('iOS Safari の動画書き出し中にエラーが発生しました。');
      finishResolve();
    };

    recorder.onstop = () => {
      onstopFired = true;
      // watchdog が先に force-complete (settled=true) した後で、iOS Safari の
      // onstop が大きく遅延して発火するケースに備える。ガードが無いと blob と
      // URL.createObjectURL を二重生成して片方の objectURL がリークし、
      // onRecordingStop も二重呼び出しになる。settled 済みなら抜ける。
      if (settled) return;
      if (stopWatchdogTimer !== null) {
        clearTimeout(stopWatchdogTimer);
        stopWatchdogTimer = null;
      }
      cleanup();
      refs.recorderRef.current = null;

      if (chunks.length === 0) {
        // 以前は finishReject していたが、await 側で catch されないため
        // 「保存ファイルを作成中」のまま UI が固まる退行になっていた。
        // onRecordingError で UI を救出してから finishResolve でクリーンに抜ける。
        log.warn('RENDER', 'iOS Safari: MediaRecorder produced no output data (onstop chunks=0)', {
          exportSessionId,
          probe,
        });
        callbacks.onRecordingError?.(
          'iOS Safari の動画書き出しでデータが取得できませんでした。少し時間を置いてからやり直してください。',
        );
        finishResolve();
        return;
      }

      const blob = new Blob(chunks, { type: profile.mimeType || 'video/mp4' });
      const url = URL.createObjectURL(blob);
      state.setExportUrl(url);
      state.setExportExt(profile.extension);

      log.info('RENDER', 'iOS Safari: MediaRecorder export completed', {
        exportSessionId,
        probe,
        chunks: chunks.length,
        blobSizeBytes: blob.size,
        extension: profile.extension,
      });

      callbacks.onRecordingStop(url, profile.extension, {
        source: 'media-recorder',
        blobSizeBytes: blob.size,
        signalAborted: signal.aborted,
      });
      finishResolve();
    };

    try {
      recorder.start(250);
      probe = markMediaRecorderProbeSuccess(probe, 'start');
      try {
        canvasVideoTrack?.requestFrame?.();
      } catch {
        // ignore
      }
      preRenderedAudio?.startPlayback();
      startedSuccessfully = true;
      // recorder.stop() を monkey-patch しているため、誰が呼んでも armStopWatchdog
      // が確実に起動する。別途 state monitor は不要。
      log.info('RENDER', 'iOS Safari: MediaRecorder export ready', {
        exportSessionId,
        probe,
      });
      audioSources?.onAudioPreRenderComplete?.();
      handleRecorderVisibilityChange();
    } catch (err) {
      cleanup();
      refs.recorderRef.current = null;
      probe = markMediaRecorderProbeFailure(probe, 'start', err);
      log.warn('RENDER', 'iOS Safari: failed to start MediaRecorder, fallback to WebCodecs', {
        exportSessionId,
        probe,
        error: err instanceof Error ? err.message : String(err),
      });
      finishResolve();
    }
  });

  return startedSuccessfully;
}
