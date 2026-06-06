/**
 * @file useExport.ts
 * @author Turtle Village
 * @description WebCodecs APIとmp4-muxerを使用して、編集内容をMP4ファイルとして書き出すためのカスタムフック。
 */
import { useState, useRef, useCallback } from 'react';
import { FPS, computeExportVideoBitrate } from '../constants';
import { useCanvasStore } from '../stores/canvasStore';
import * as Mp4Muxer from 'mp4-muxer';
import type { AudioTrack, NarrationClip } from '../types';
import { useLogStore } from '../stores/logStore';
import type { PlatformCapabilities } from '../utils/platform';
import {
  getExportFrameTiming,
  resolveExportCanvasFrameBurstCount,
  resolveExportDuration,
} from '../utils/exportTimeline';
import { inspectMp4Durations } from '../utils/mp4Duration';
import {
  shouldUseOfflineAudioPreRender,
  resolveWebCodecsAudioCaptureStrategy,
} from './export-strategies/exportStrategyResolver';
import { probeDecodeAudioData } from './export-strategies/decodeAudioProbe';
import { createDiagnosticId } from '../utils/diagnostics';
import type {
  ExportAudioSources,
  ExportPreparationStep,
  ExportRecordingResult,
  ExportSessionDiagnostics,
  MediaRecorderExportStrategyRunner,
  PreRenderedRecorderAudioSource,
  ResolveExportAudioSource,
  ResolveExportStrategyOrder,
} from './export-strategies/types';

export type {
  ExportAudioSources,
  ExportAudioSourceResolution,
  ExportPreparationStep,
  ExportRecordingResult,
  ExportSessionDiagnostics,
  MediaRecorderExportStrategyRunner,
  PreRenderedRecorderAudioSource,
  ResolveExportAudioSource,
  ResolveExportStrategyOrder,
} from './export-strategies/types';
export {
  EXPORT_PREPARATION_STEP_LABELS,
  EXPORT_PREPARATION_TOTAL_STEPS,
} from './export-strategies/types';

function durationUsToSampleCount(durationUs: number, sampleRate: number): number {
  return Math.max(0, Math.round((durationUs / 1e6) * sampleRate));
}

// 現行 pipeline の動画 timescale(57600) と audio sampleRate(48000) では 1ms 未満の丸め差は吸収できる一方、
// 1ms を超える audio / video / container の尺差は Teams 投稿後の速度異常再発リスクが高いため、
// export 完了前に明示的に検出する。
const DURATION_DIFF_THRESHOLD_US = 1000;
const AUDIO_TRACK_MIN_VOLUME = 0;
const AUDIO_TRACK_MAX_VOLUME = 2.5;

export function clampAudioTrackVolume(volume: number): number {
  return Math.max(AUDIO_TRACK_MIN_VOLUME, Math.min(AUDIO_TRACK_MAX_VOLUME, volume));
}

export function getAudioDecodeCacheKey(file: File): string {
  return [
    file.name,
    file.size,
    file.lastModified,
    file.type,
  ].join(':');
}

function calculateFinalAudioSampleCount(
  sampleRate: number,
  timestampUs: number,
  numberOfFrames: number,
  exportDurationUs?: number,
): number {
  const currentSampleCount = durationUsToSampleCount(timestampUs, sampleRate) + numberOfFrames;
  if (typeof exportDurationUs !== 'number' || !Number.isFinite(exportDurationUs)) {
    return currentSampleCount;
  }

  const targetSampleCount = durationUsToSampleCount(exportDurationUs, sampleRate);
  return Math.min(currentSampleCount, targetSampleCount);
}

async function probeExportBlobUrl(url: string): Promise<{
  duration: number;
  videoWidth: number;
  videoHeight: number;
}> {
  const timeoutMs = 10000;
  const video = document.createElement('video');
  video.preload = 'metadata';
  video.src = url;

  try {
    return await new Promise((resolve, reject) => {
      const cleanup = () => {
        window.clearTimeout(timeoutId);
        video.onloadedmetadata = null;
        video.onerror = null;
        video.removeAttribute('src');
        video.load();
      };
      const timeoutId = window.setTimeout(() => {
        cleanup();
        reject(new Error('生成動画のmetadata読み込みがタイムアウトしました'));
      }, timeoutMs);

      video.onloadedmetadata = () => {
        const metadata = {
          duration: video.duration,
          videoWidth: video.videoWidth,
          videoHeight: video.videoHeight,
        };
        cleanup();
        resolve(metadata);
      };
      video.onerror = () => {
        cleanup();
        reject(new Error('生成動画のmetadata読み込みに失敗しました'));
      };
    });
  } catch (error) {
    try {
      video.removeAttribute('src');
      video.load();
    } catch {
      // ignore
    }
    throw error;
  }
}

/**
 * useExport - 動画書き出しロジックを提供するフック
 * WebCodecs API + mp4-muxer を使用した標準MP4（非断片化）エクスポート機能
 */
export interface UseExportReturn {
  // State
  isProcessing: boolean;
  setIsProcessing: React.Dispatch<React.SetStateAction<boolean>>;
  exportUrl: string | null;
  setExportUrl: React.Dispatch<React.SetStateAction<string | null>>;
  exportExt: string | null;
  setExportExt: React.Dispatch<React.SetStateAction<string | null>>;

  // Refs
  // MediaRecorderは使用しないため削除し、代わりに停止用フラグ等を管理するRefなどを内部で持つが、
  // 外部インターフェースとしては startExport/cancel 等があればよい。
  // 互換性のため、recorderRef は一旦削除せず null を返すか、あるいは型定義を変更する。
  // ここではAPI互換性を保つため残すが、実体は使用しない。
  recorderRef: React.MutableRefObject<MediaRecorder | null>;

  // Methods
  startExport: (
    canvasRef: React.MutableRefObject<HTMLCanvasElement | null>,
    masterDestRef: React.MutableRefObject<MediaStreamAudioDestinationNode | null>,
    onRecordingStop: (url: string, ext: string) => void,
    onRecordingError?: (message: string) => void,
    audioSources?: ExportAudioSources  // iOS Safari: OfflineAudioContext用音声ソース
  ) => void;
  completeExport: () => void; // 正常終了要求（abortせずにflush/finalizeへ進める）
  stopExport: (options?: { silent?: boolean; reason?: ExportStopReason }) => void; // 明示的な停止メソッドを追加
  clearExportUrl: () => void;
}

export type ExportCancelReason = 'none' | 'user' | 'superseded' | 'unmount' | 'error';
export type ExportStopReason = Exclude<ExportCancelReason, 'none' | 'error'>;
type ExportPhase = 'idle' | 'preparing' | 'rendering' | 'finalizing' | 'completed' | 'failed' | 'cancelled';

export interface UseExportRuntimeConfig {
  getPlatformCapabilities: () => PlatformCapabilities;
  resolveExportStrategyOrder: ResolveExportStrategyOrder;
  resolveExportAudioSource?: ResolveExportAudioSource;
  runMediaRecorderStrategy?: MediaRecorderExportStrategyRunner;
}

/**
 * iOS Safari フォールバック: <video> 要素を使って動画ファイルから音声をリアルタイム抽出する。
 * iOS Safari の decodeAudioData はビデオコンテナ(.mov/.mp4)のデコードに対応していないため、
 * <video> 要素で再生し MediaElementAudioSourceNode → ScriptProcessorNode 経由で
 * PCM データを直接キャプチャする。
 *
 * 制約: リアルタイム再生のため、動画の長さと同程度の時間がかかる。
 */
async function extractAudioViaVideoElement(
  file: File,
  url: string,
  duration: number,
  mainCtx: AudioContext,
  signal: AbortSignal,
  diagnostics?: ExportSessionDiagnostics,
): Promise<AudioBuffer | null> {
  const log = useLogStore.getState();
  const toDetails = (details?: Record<string, unknown>) => ({
    exportSessionId: diagnostics?.exportSessionId,
    ...(details ?? {}),
  });

  log.info('RENDER', '[EXTRACT] 動画音声のリアルタイム抽出を開始', toDetails({
    fileName: file.name,
    duration: Math.round(duration * 100) / 100,
    estimatedTimeSec: Math.ceil(duration + 2),
    audioContextState: mainCtx.state,
    sampleRate: mainCtx.sampleRate,
  }));

  return new Promise<AudioBuffer | null>((resolve) => {
    let resolved = false;
    const safeResolve = (result: AudioBuffer | null) => {
      if (resolved) return;
      resolved = true;
      signal.removeEventListener('abort', onAbort);
      clearTimeout(timeoutId);
      cleanup();
      resolve(result);
    };

    const video = document.createElement('video');
    video.playsInline = true;
    video.preload = 'auto';
    video.setAttribute('playsinline', ''); // iOS Safari 互換
    video.setAttribute('webkit-playsinline', '');

    let sourceNode: MediaElementAudioSourceNode | null = null;
    let processor: ScriptProcessorNode | null = null;
    let silentSinkGain: GainNode | null = null;
    let blobUrl: string | null = null;
    const collectedL: Float32Array[] = [];
    const collectedR: Float32Array[] = [];
    let totalFrames = 0;

    const cleanup = () => {
      if (processor) {
        processor.onaudioprocess = null;
        try { processor.disconnect(); } catch { /* ignore */ }
      }
      if (sourceNode) {
        try { sourceNode.disconnect(); } catch { /* ignore */ }
      }
      if (silentSinkGain) {
        try { silentSinkGain.disconnect(); } catch { /* ignore */ }
      }
      video.pause();
      video.removeAttribute('src');
      video.load();
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
        blobUrl = null;
      }
    };

    const onAbort = () => {
      log.info('RENDER', '[EXTRACT] 中断シグナルで音声抽出終了');
      safeResolve(null);
    };
    signal.addEventListener('abort', onAbort, { once: true });

    // タイムアウト（duration + 5秒のマージン、最低10秒）
    const timeoutMs = Math.max(10000, (duration + 5) * 1000);
    const timeoutId = setTimeout(() => {
      log.warn('RENDER', '[EXTRACT] タイムアウトで音声キャプチャ終了', toDetails({
        timeoutMs,
        totalFrames,
        capturedDuration: Math.round(totalFrames / mainCtx.sampleRate * 100) / 100,
      }));
      buildAndResolve();
    }, timeoutMs);

    const buildAndResolve = () => {
      if (totalFrames === 0) {
        log.warn('RENDER', '[EXTRACT] 音声キャプチャデータなし（0 frames）');
        safeResolve(null);
        return;
      }

      try {
        const audioBuffer = mainCtx.createBuffer(2, totalFrames, mainCtx.sampleRate);
        let offset = 0;
        const ch0Data = audioBuffer.getChannelData(0);
        const ch1Data = audioBuffer.getChannelData(1);
        for (let i = 0; i < collectedL.length; i++) {
          ch0Data.set(collectedL[i], offset);
          ch1Data.set(collectedR[i], offset);
          offset += collectedL[i].length;
        }

        // 振幅チェック
        let maxAmp = 0;
        let nonZero = 0;
        for (let i = 0; i < ch0Data.length; i += 100) {
          const a = Math.abs(ch0Data[i]);
          if (a > 1e-10) nonZero++;
          if (a > maxAmp) maxAmp = a;
        }

        log.info('RENDER', '[EXTRACT] 音声抽出完了', toDetails({
          totalFrames,
          durationSec: Math.round(totalFrames / mainCtx.sampleRate * 100) / 100,
          maxAmplitude: Math.round(maxAmp * 10000) / 10000,
          nonZeroSamples: nonZero,
          chunks: collectedL.length,
        }));

        if (maxAmp < 1e-8) {
          log.warn('RENDER', '[EXTRACT] ⚠️ 抽出音声がほぼ無音です');
          safeResolve(null);
          return;
        }
        safeResolve(audioBuffer);
      } catch (err) {
        log.error('RENDER', '[EXTRACT] AudioBuffer構築失敗', {
          error: err instanceof Error ? err.message : String(err),
        });
        safeResolve(null);
      }
    };

    try {
      // Web Audio ノードの構築
      sourceNode = mainCtx.createMediaElementSource(video);
      processor = mainCtx.createScriptProcessor(4096, 2, 2);
      silentSinkGain = mainCtx.createGain();

      sourceNode.connect(processor);
      // ScriptProcessor は実デスティネーションにつながっていないと
      // onaudioprocess が発火しない環境があるため、無音 gain 経由で destination へつなぐ。
      processor.connect(silentSinkGain);
      silentSinkGain.gain.setValueAtTime(0, mainCtx.currentTime);
      silentSinkGain.connect(mainCtx.destination);

      log.info('RENDER', '[EXTRACT] Web Audio パイプライン構築完了');

      let capturedChunks = 0;
      processor.onaudioprocess = (e: AudioProcessingEvent) => {
        if (resolved || signal.aborted) return;

        const inputL = e.inputBuffer.getChannelData(0);
        const inputR = e.inputBuffer.numberOfChannels >= 2
          ? e.inputBuffer.getChannelData(1) : inputL;
        collectedL.push(new Float32Array(inputL));
        collectedR.push(new Float32Array(inputR));
        totalFrames += inputL.length;
        capturedChunks++;

        // 初回キャプチャとその後のログ
        if (capturedChunks === 1) {
          // 初回データの振幅チェック
          let firstMaxAmp = 0;
          for (let i = 0; i < inputL.length; i += 10) {
            const a = Math.abs(inputL[i]);
            if (a > firstMaxAmp) firstMaxAmp = a;
          }
          log.info('RENDER', '[EXTRACT] ScriptProcessor 初回データ受信', {
            bufferSize: inputL.length,
            channels: e.inputBuffer.numberOfChannels,
            firstMaxAmplitude: Math.round(firstMaxAmp * 10000) / 10000,
          });
        }

        // 出力に極小値（iOS Safari の最適化防止）
        for (let ch = 0; ch < e.outputBuffer.numberOfChannels; ch++) {
          const out = e.outputBuffer.getChannelData(ch);
          for (let i = 0; i < out.length; i++) out[i] = 1e-10;
        }
      };

      // Video イベント
      video.onended = () => {
        log.info('RENDER', '[EXTRACT] video.onended 発火', toDetails({
          capturedChunks,
          totalFrames,
          capturedDuration: Math.round(totalFrames / mainCtx.sampleRate * 100) / 100,
        }));
        // ほんの少し待ってからバッファを構築（最後の onaudioprocess が確実に処理されるため）
        setTimeout(() => buildAndResolve(), 100);
      };

      video.onerror = () => {
        log.error('RENDER', '[EXTRACT] video error', {
          code: video.error?.code,
          message: video.error?.message,
        });
        safeResolve(null);
      };

      // ファイルを読み込んで再生
      if (file instanceof File) {
        blobUrl = URL.createObjectURL(file);
        video.src = blobUrl;
      } else {
        video.src = url;
      }

      video.play().then(() => {
        log.info('RENDER', '[EXTRACT] video.play() 成功', {
          videoDuration: video.duration,
          readyState: video.readyState,
        });
      }).catch((err) => {
        log.error('RENDER', '[EXTRACT] video.play() 失敗', {
          error: err instanceof Error ? err.message : String(err),
          errorName: err instanceof Error ? err.name : 'unknown',
        });
        safeResolve(null);
      });

    } catch (err) {
      log.error('RENDER', '[EXTRACT] 初期化エラー', {
        error: err instanceof Error ? err.message : String(err),
      });
      safeResolve(null);
    }
  });
}

/**
 * OfflineAudioContext を使用して全音声をオフラインでミックスダウンする。
 * iOS Safari のリアルタイム音声キャプチャ問題（MediaStreamAudioDestinationNode / ScriptProcessorNode
 * 経由でデータがドロップされる）を完全に回避する。
 */
async function offlineRenderAudio(
  sources: ExportAudioSources,
  mainCtx: AudioContext,
  sampleRate: number,
  signal: AbortSignal,
  options?: {
    diagnostics?: ExportSessionDiagnostics;
    resolveExportAudioSource?: ResolveExportAudioSource;
    isIosSafari?: boolean;
    audioDecodeCache?: Map<string, Promise<AudioBuffer | null>>;
  },
): Promise<AudioBuffer | null> {
  const { mediaItems, bgm, narrations, totalDuration } = sources;
  if (totalDuration <= 0) return null;
  sources.onPreparationStepChange?.(3);

  const log = useLogStore.getState();
  const numberOfChannels = 2;
  // 音声は動画タイムライン長と厳密一致させる（余剰サンプルでAV長がズレるのを防止）
  const length = Math.max(1, Math.round(totalDuration * sampleRate));

  log.info('RENDER', 'OfflineAudioContext 音声プリレンダリング開始', {
    exportSessionId: options?.diagnostics?.exportSessionId,
    totalDuration: Math.round(totalDuration * 100) / 100,
    sampleRate,
    estimatedSizeMB: Math.round((length * numberOfChannels * 4) / 1024 / 1024 * 10) / 10,
  });

  const offlineCtx = new OfflineAudioContext(numberOfChannels, length, sampleRate);

  // Helper: ファイルから音声をデコード
  // メインAudioContextを使用して decodeAudioData を呼ぶ。
  // iOS Safari では decodeAudioData がビデオコンテナ(.mov/.mp4)のデコードに
  // 失敗するため、その場合は <video> 要素経由のリアルタイム抽出にフォールバックする。
  async function decodeAudio(file: File | { name: string }, url: string, mediaDuration?: number): Promise<AudioBuffer | null> {
    const fileName = file instanceof File ? file.name : (file as { name: string }).name;
    const cacheKey = file instanceof File ? getAudioDecodeCacheKey(file) : null;
    const decodePromise = (async (): Promise<AudioBuffer | null> => {
      const resolvedSource = options?.resolveExportAudioSource?.({
        fileName,
        mimeType: file instanceof File ? file.type : null,
      });

      if (resolvedSource) {
        log.info('RENDER', '[DIAG-AUDIO-SOURCE] 音声ソース分類', {
          exportSessionId: options?.diagnostics?.exportSessionId,
          fileName,
          strategy: resolvedSource.strategy,
          reason: resolvedSource.reason,
          mimeType: resolvedSource.mimeType,
          extension: resolvedSource.extension,
        });
      }

      if (resolvedSource?.strategy === 'media-element' && file instanceof File && typeof mediaDuration === 'number') {
        log.info('RENDER', '[DIAG-DECODE] media element 抽出を優先', {
          exportSessionId: options?.diagnostics?.exportSessionId,
          fileName,
          reason: resolvedSource.reason,
        });
        return await extractAudioViaVideoElement(
          file,
          url,
          mediaDuration,
          mainCtx,
          signal,
          options?.diagnostics,
        );
      }

      try {
        let arrayBuffer: ArrayBuffer;
        if (file instanceof File) {
          arrayBuffer = await file.arrayBuffer();
          log.info('RENDER', `[DIAG-DECODE] File.arrayBuffer 取得成功`, {
            fileName,
            arrayBufferSize: arrayBuffer.byteLength,
            arrayBufferSizeKB: Math.round(arrayBuffer.byteLength / 1024),
          });
        } else {
          const response = await fetch(url);
          if (!response.ok) {
            log.warn('RENDER', `[DIAG-DECODE] fetch 失敗`, {
              fileName,
              status: response.status,
              statusText: response.statusText,
            });
            return null;
          }
          arrayBuffer = await response.arrayBuffer();
          log.info('RENDER', `[DIAG-DECODE] fetch + arrayBuffer 取得成功`, {
            fileName,
            arrayBufferSize: arrayBuffer.byteLength,
            arrayBufferSizeKB: Math.round(arrayBuffer.byteLength / 1024),
          });
        }

        if (arrayBuffer.byteLength === 0) {
          log.warn('RENDER', `[DIAG-DECODE] ArrayBuffer が空です`, { fileName });
          return null;
        }

        // decodeAudioData は渡されたバッファを detach するため、probe 側でコピーを渡す。
        log.info('RENDER', `[DIAG-DECODE] decodeAudioData probe 開始`, {
          exportSessionId: options?.diagnostics?.exportSessionId,
          fileName,
          usingContext: (mainCtx as { constructor?: { name?: string } }).constructor?.name || 'unknown',
          contextState: (mainCtx as AudioContext).state || 'N/A',
          bufferSize: arrayBuffer.byteLength,
        });
        const decodeProbe = await probeDecodeAudioData({
          audioContext: mainCtx,
          arrayBuffer,
          fileName,
          mimeType: file instanceof File ? file.type || null : null,
          extension: resolvedSource?.extension ?? null,
        });

        if (decodeProbe.audioBuffer) {
          log.info('RENDER', `[DIAG-DECODE] 音声デコード成功`, {
            exportSessionId: options?.diagnostics?.exportSessionId,
            ...decodeProbe.result,
            duration: Math.round(decodeProbe.audioBuffer.duration * 100) / 100,
            channels: decodeProbe.audioBuffer.numberOfChannels,
          });
          return decodeProbe.audioBuffer;
        }

        log.warn('RENDER', `[DIAG-DECODE] decodeAudioData probe 失敗`, {
          exportSessionId: options?.diagnostics?.exportSessionId,
          ...decodeProbe.result,
        });
      } catch (e) {
        log.warn('RENDER', `[DIAG-DECODE] decodeAudioData 失敗`, {
          fileName,
          error: e instanceof Error ? e.message : String(e),
          errorName: e instanceof Error ? e.name : 'unknown',
        });
      }

      // iOS Safari: ビデオコンテナ(.mov/.mp4)の decodeAudioData が
      // "EncodingError: Decoding failed" で失敗する場合、
      // <video> 要素経由でリアルタイム音声抽出を試みる
      if (file instanceof File) {
        const isVideoFile = file.type.startsWith('video/') ||
          /\.(mov|mp4|m4v|webm)$/i.test(fileName);
        if (isVideoFile && !signal.aborted) {
          log.info('RENDER', '[DIAG-DECODE] ビデオファイルのため <video> 経由のリアルタイム抽出にフォールバック', {
            exportSessionId: options?.diagnostics?.exportSessionId,
            fileName,
            fileType: file.type,
            mediaDuration: mediaDuration || 'unknown',
          });
          return await extractAudioViaVideoElement(
            file,
            url,
            mediaDuration || 30,
            mainCtx,
            signal,
            options?.diagnostics,
          );
        }
      }

      return null;
    })();

    if (!cacheKey || !options?.audioDecodeCache) {
      return decodePromise;
    }

    const cachedPromise = options.audioDecodeCache.get(cacheKey);
    if (cachedPromise) {
      log.info('RENDER', '[DIAG-DECODE] 既存 decode 結果を再利用', {
        exportSessionId: options?.diagnostics?.exportSessionId,
        fileName,
      });
      return await cachedPromise;
    }

    options.audioDecodeCache.set(cacheKey, decodePromise);
    return await decodePromise;
  }

  let scheduledSources = 0;

  // 1. ビデオクリップの音声
  let timelinePosition = 0;
  for (const item of mediaItems) {
    if (signal.aborted) return null;

    if (item.type === 'video' && !item.isMuted && item.volume > 0) {
      const audioBuffer = await decodeAudio(item.file, item.url, item.duration);
      if (audioBuffer) {
        const source = offlineCtx.createBufferSource();
        source.buffer = audioBuffer;
        const gain = offlineCtx.createGain();
        source.connect(gain);
        gain.connect(offlineCtx.destination);

        const vol = item.volume;
        const clipStart = timelinePosition;
        const clipEnd = clipStart + item.duration;

        // フェード時間のクランプ（重なった場合に按分）
        let fadeInDur = item.fadeIn ? (item.fadeInDuration || 1.0) : 0;
        let fadeOutDur = item.fadeOut ? (item.fadeOutDuration || 1.0) : 0;
        if (fadeInDur + fadeOutDur > item.duration) {
          const ratio = item.duration / (fadeInDur + fadeOutDur);
          fadeInDur *= ratio;
          fadeOutDur *= ratio;
        }

        // ゲインエンベロープ設定
        gain.gain.setValueAtTime(0, 0);
        if (fadeInDur > 0) {
          gain.gain.setValueAtTime(0, clipStart);
          gain.gain.linearRampToValueAtTime(vol, clipStart + fadeInDur);
        } else {
          gain.gain.setValueAtTime(vol, clipStart);
        }
        if (fadeOutDur > 0) {
          gain.gain.setValueAtTime(vol, clipEnd - fadeOutDur);
          gain.gain.linearRampToValueAtTime(0, clipEnd);
        }

        source.start(clipStart, item.trimStart, item.duration);
        scheduledSources++;

        // [DIAG-SCHED] クリップスケジュール詳細
        log.info('RENDER', `[DIAG-SCHED] クリップ音声スケジュール`, {
          fileName: item.file instanceof File ? item.file.name : '(not File)',
          clipStart: Math.round(clipStart * 100) / 100,
          clipEnd: Math.round(clipEnd * 100) / 100,
          trimStart: item.trimStart,
          duration: Math.round(item.duration * 100) / 100,
          volume: vol,
          bufferDuration: Math.round(audioBuffer.duration * 100) / 100,
          bufferSampleRate: audioBuffer.sampleRate,
          scheduledSources,
        });
      }
    } else {
      // [DIAG-SCHED] スキップ理由もログ
      log.info('RENDER', `[DIAG-SCHED] クリップスキップ`, {
        type: item.type,
        isMuted: item.isMuted,
        volume: item.volume,
        timelinePosition: Math.round(timelinePosition * 100) / 100,
      });
    }
    timelinePosition += item.duration;
  }

  // Helper: BGM/ナレーションのスケジューリング
  async function scheduleAudioTrack(track: AudioTrack, label: string): Promise<void> {
    if (signal.aborted) return;
    const audioBuffer = await decodeAudio(track.file, track.url, track.duration);
    if (!audioBuffer) return;

    const source = offlineCtx.createBufferSource();
    source.buffer = audioBuffer;
    const gain = offlineCtx.createGain();
    source.connect(gain);
    gain.connect(offlineCtx.destination);

    const vol = clampAudioTrackVolume(track.volume);
    const trackStart = Math.max(0, track.delay);
    const sourceOffset = track.startPoint;
    const availableDuration = track.duration - track.startPoint;
    const availableTimeline = totalDuration - trackStart;
    const playDuration = Math.min(availableDuration, availableTimeline);
    if (playDuration <= 0) return;

    const fadeInDur = track.fadeIn ? (track.fadeInDuration || 1.0) : 0;
    const fadeOutDur = track.fadeOut ? (track.fadeOutDuration || 1.0) : 0;

    // ゲインエンベロープ
    gain.gain.setValueAtTime(0, 0);
    if (fadeInDur > 0) {
      gain.gain.setValueAtTime(0, trackStart);
      gain.gain.linearRampToValueAtTime(vol, trackStart + fadeInDur);
    } else {
      gain.gain.setValueAtTime(vol, trackStart);
    }
    if (fadeOutDur > 0) {
      // BGM/ナレーションのフェードアウトはプロジェクト終端からの相対位置
      const fadeOutStart = Math.max(trackStart + fadeInDur, totalDuration - fadeOutDur);
      gain.gain.setValueAtTime(vol, fadeOutStart);
      gain.gain.linearRampToValueAtTime(0, totalDuration);
    }

    source.start(trackStart, sourceOffset, playDuration);
    scheduledSources++;
    log.info('RENDER', `${label}音声スケジュール完了`, {
      start: trackStart, offset: sourceOffset, duration: Math.round(playDuration * 10) / 10,
    });
  }

  // 2. BGM
  sources.onPreparationStepChange?.(4);
  if (bgm) {
    await scheduleAudioTrack(bgm, 'BGM');
  }
  // 3. Narrations
  async function scheduleNarrationClip(clip: NarrationClip): Promise<void> {
    if (signal.aborted) return;
    if (!clip.url || clip.duration <= 0) return;
    if (clip.isMuted || clip.volume <= 0) return;

    const audioBuffer = await decodeAudio(clip.file, clip.url, clip.duration);
    if (!audioBuffer) return;

    const source = offlineCtx.createBufferSource();
    source.buffer = audioBuffer;
    const gain = offlineCtx.createGain();
    source.connect(gain);
    gain.connect(offlineCtx.destination);

    const clipStart = Math.max(0, clip.startTime);
    const trimStart = Number.isFinite(clip.trimStart) ? Math.max(0, clip.trimStart) : 0;
    const trimEnd = Number.isFinite(clip.trimEnd)
      ? Math.max(trimStart, Math.min(clip.duration, clip.trimEnd))
      : clip.duration;
    const trimmedDuration = Math.max(0, trimEnd - trimStart);
    const playDuration = Math.min(trimmedDuration, totalDuration - clipStart);
    if (playDuration <= 0) return;

    gain.gain.setValueAtTime(Math.max(0, Math.min(2.5, clip.volume)), clipStart);
    source.start(clipStart, trimStart, playDuration);
    scheduledSources++;
  }

  const orderedNarrations = narrations
    .map((clip, index) => ({ clip, index }))
    .sort((a, b) => {
      if (a.clip.startTime === b.clip.startTime) return a.index - b.index;
      return a.clip.startTime - b.clip.startTime;
    });

  sources.onPreparationStepChange?.(5);
  for (const entry of orderedNarrations) {
    await scheduleNarrationClip(entry.clip);
  }

  if (signal.aborted) return null;

  sources.onPreparationStepChange?.(6);
  log.info('RENDER', 'OfflineAudioContext レンダリング実行', { scheduledSources });

  try {
    sources.onPreparationStepChange?.(7);
    const renderedBuffer = await offlineCtx.startRendering();

    // 診断: レンダリング結果の振幅チェック（iOS Safari でデコード失敗時にゼロバッファになる）
    let maxAmplitude = 0;
    let nonZeroSamples = 0;
    for (let ch = 0; ch < renderedBuffer.numberOfChannels; ch++) {
      const data = renderedBuffer.getChannelData(ch);
      for (let i = 0; i < data.length; i += 100) { // 100サンプル毎にチェック（パフォーマンス考慮）
        const abs = Math.abs(data[i]);
        if (abs > 1e-10) nonZeroSamples++;
        if (abs > maxAmplitude) maxAmplitude = abs;
      }
    }

    log.info('RENDER', 'OfflineAudioContext レンダリング完了', {
      duration: Math.round(renderedBuffer.duration * 100) / 100,
      length: renderedBuffer.length,
      channels: renderedBuffer.numberOfChannels,
      maxAmplitude: Math.round(maxAmplitude * 10000) / 10000,
      nonZeroSamples,
    });

    if (maxAmplitude < 1e-8) {
      log.warn('RENDER', '⚠️ レンダリング結果がほぼ無音です。音声デコードまたはミキシングに問題がある可能性があります');
    }

    return renderedBuffer;
  } catch (e) {
    log.error('RENDER', 'OfflineAudioContext レンダリング失敗', {
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

/**
 * プリレンダリング済み AudioBuffer を AudioEncoder にチャンク分割して供給する。
 * f32-planar 形式を使用（AudioBuffer のネイティブ形式であり、
 * iOS Safari の AudioEncoder との互換性が高い）。
 */
interface FeedPreRenderedAudioResult {
  encodedChunks: number;
  encodedSamples: number;
  sourceSamplesUsed: number;
  trimmedSamples: number;
}

interface FinalizeAudioForExportResult {
  paddedChunks: number;
  paddedSamples: number;
  finalSampleCount: number;
}

function feedPreRenderedAudio(
  renderedAudio: AudioBuffer,
  audioEncoder: AudioEncoder,
  signal: AbortSignal,
  exportDurationUs?: number,
): FeedPreRenderedAudioResult {
  const log = useLogStore.getState();
  const chunkSize = 4096;
  let audioOffset = 0;
  const targetSamples = (typeof exportDurationUs === 'number' && Number.isFinite(exportDurationUs))
    ? durationUsToSampleCount(exportDurationUs, renderedAudio.sampleRate)
    : renderedAudio.length;
  const totalSamples = Math.min(renderedAudio.length, targetSamples);
  let audioTimestamp = 0;
  let encodedChunks = 0;
  const ch0 = renderedAudio.getChannelData(0);
  const ch1 = renderedAudio.numberOfChannels >= 2
    ? renderedAudio.getChannelData(1) : ch0;

  // 診断: 入力データの振幅チェック
  let inputMaxAmp = 0;
  for (let i = 0; i < ch0.length; i += 1000) {
    const a = Math.abs(ch0[i]);
    if (a > inputMaxAmp) inputMaxAmp = a;
    if (ch1 !== ch0) {
      const b = Math.abs(ch1[i]);
      if (b > inputMaxAmp) inputMaxAmp = b;
    }
  }
  log.info('RENDER', 'feedPreRenderedAudio 入力診断', {
    totalSamples,
    targetSamples,
    sourceSamples: renderedAudio.length,
    inputMaxAmplitude: Math.round(inputMaxAmp * 10000) / 10000,
    sampleRate: renderedAudio.sampleRate,
    channels: renderedAudio.numberOfChannels,
  });

  while (audioOffset < totalSamples && !signal.aborted) {
    const framesToProcess = Math.min(chunkSize, totalSamples - audioOffset);

    // f32-planar 形式: [ch0全サンプル, ch1全サンプル] の順に配置
    // AudioBuffer.getChannelData() が返すプレーナー形式をそのまま活用
    const planarData = new Float32Array(framesToProcess * 2);
    planarData.set(ch0.subarray(audioOffset, audioOffset + framesToProcess), 0);
    planarData.set(ch1.subarray(audioOffset, audioOffset + framesToProcess), framesToProcess);

    if (audioEncoder.state === 'configured') {
      try {
        const audioData = new AudioData({
          format: 'f32-planar' as AudioSampleFormat,
          sampleRate: renderedAudio.sampleRate,
          numberOfFrames: framesToProcess,
          numberOfChannels: 2,
          timestamp: audioTimestamp,
          data: planarData,
        });
        audioEncoder.encode(audioData);
        audioData.close();
        encodedChunks++;
      } catch (e) {
        // 初回エラーのみログ
        if (encodedChunks === 0) {
          log.error('RENDER', 'AudioData/Encode 失敗', {
            error: e instanceof Error ? e.message : String(e),
            format: 'f32-planar',
            framesToProcess,
            timestamp: audioTimestamp,
          });
        }
      }
    }

    audioOffset += framesToProcess;
    audioTimestamp += Math.round((framesToProcess / renderedAudio.sampleRate) * 1e6);
  }

  log.info('RENDER', 'プリレンダリング音声エンコード完了', {
    totalChunks: Math.ceil(totalSamples / chunkSize),
    encodedChunks,
    totalSamples,
    sourceSamplesUsed: totalSamples,
    trimmedSamples: Math.max(0, renderedAudio.length - totalSamples),
    format: 'f32-planar',
    encodeQueueSize: audioEncoder.encodeQueueSize,
  });

  return {
    encodedChunks,
    encodedSamples: totalSamples,
    sourceSamplesUsed: totalSamples,
    trimmedSamples: Math.max(0, renderedAudio.length - totalSamples),
  };
}

function finalizeAudioForExport(
  audioEncoder: AudioEncoder,
  sampleRate: number,
  signal: AbortSignal,
  currentSampleCount: number,
  exportDurationUs?: number,
): FinalizeAudioForExportResult {
  const log = useLogStore.getState();
  const chunkSize = 4096;
  const targetSampleCount = (typeof exportDurationUs === 'number' && Number.isFinite(exportDurationUs))
    ? durationUsToSampleCount(exportDurationUs, sampleRate)
    : currentSampleCount;
  const paddedSamples = Math.max(0, targetSampleCount - currentSampleCount);
  let paddedChunks = 0;
  let offset = 0;

  while (offset < paddedSamples && !signal.aborted && audioEncoder.state === 'configured') {
    const framesToProcess = Math.min(chunkSize, paddedSamples - offset);
    const planarData = new Float32Array(framesToProcess * 2);
    const timestampSamples = currentSampleCount + offset;
    const timestampUs = Math.round((timestampSamples / sampleRate) * 1e6);
    const audioData = new AudioData({
      format: 'f32-planar' as AudioSampleFormat,
      sampleRate,
      numberOfFrames: framesToProcess,
      numberOfChannels: 2,
      timestamp: timestampUs,
      data: planarData,
    });
    audioEncoder.encode(audioData);
    audioData.close();
    paddedChunks++;
    offset += framesToProcess;
  }

  log.info('RENDER', 'finalizeAudioForExport 完了', {
    currentSampleCount,
    targetSampleCount,
    paddedSamples,
    paddedChunks,
    sampleRate,
    encodeQueueSize: audioEncoder.encodeQueueSize,
  });

  return {
    paddedChunks,
    paddedSamples,
    finalSampleCount: targetSampleCount,
  };
}

function createPreRenderedRecorderAudioSource(
  renderedAudio: AudioBuffer,
  audioContext: AudioContext,
): PreRenderedRecorderAudioSource {
  const log = useLogStore.getState();
  const source = audioContext.createBufferSource();
  const outputGain = audioContext.createGain();
  const streamDest = audioContext.createMediaStreamDestination();
  let keepAliveOscillator: OscillatorNode | null = null;
  let keepAliveGain: GainNode | null = null;
  let started = false;
  let cleaned = false;

  source.buffer = renderedAudio;
  outputGain.gain.setValueAtTime(1, audioContext.currentTime);
  source.connect(outputGain);
  outputGain.connect(streamDest);

  try {
    keepAliveOscillator = audioContext.createOscillator();
    keepAliveGain = audioContext.createGain();
    keepAliveOscillator.frequency.value = 440;
    keepAliveGain.gain.setValueAtTime(0.00001, audioContext.currentTime);
    keepAliveOscillator.connect(keepAliveGain);
    keepAliveGain.connect(streamDest);
    keepAliveOscillator.start();
  } catch (err) {
    keepAliveOscillator = null;
    keepAliveGain = null;
    log.warn('RENDER', 'プリレンダ音声の keep-alive 作成に失敗', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    try {
      source.stop();
    } catch {
      // ignore
    }
    try {
      source.disconnect();
    } catch {
      // ignore
    }
    try {
      outputGain.disconnect();
    } catch {
      // ignore
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
    streamDest.stream.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch {
        // ignore
      }
    });
  };

  return {
    stream: streamDest.stream,
    startPlayback: () => {
      if (started) return;
      started = true;
      if ((audioContext.state as AudioContextState | 'interrupted') !== 'running') {
        audioContext.resume().catch(() => { });
      }
      source.start();
      log.info('RENDER', 'プリレンダ音声ストリームの再生を開始', {
        duration: Math.round(renderedAudio.duration * 100) / 100,
        sampleRate: renderedAudio.sampleRate,
      });
    },
    cleanup,
  };
}

export function createUseExport(config: UseExportRuntimeConfig) {
  return function useExport(): UseExportReturn {
    const [isProcessing, setIsProcessing] = useState(false);
    const [exportUrl, setExportUrl] = useState<string | null>(null);
    const [exportExt, setExportExt] = useState<string | null>(null);

    // 内部状態管理用
    const abortControllerRef = useRef<AbortController | null>(null);
    const videoReaderRef = useRef<ReadableStreamDefaultReader<VideoFrame> | null>(null);
    const audioReaderRef = useRef<ReadableStreamDefaultReader<AudioData> | null>(null);
    const completionRequestedRef = useRef(false);
    const silentAbortRef = useRef(false);
    const finalizeRequestedRef = useRef(false);
    const exportFinalizingRef = useRef(false);
    const exportSessionIdRef = useRef<string | null>(null);
    const exportCancelReasonRef = useRef<ExportCancelReason>('none');
    const exportCompletedRef = useRef(false);
    const exportPhaseRef = useRef<ExportPhase>('idle');

    // 互換性維持のためのダミーRef（実際には使用しない）
    const recorderRef = useRef<MediaRecorder | null>(null);
    const updatePreparationStep = useCallback(
      (audioSources: ExportAudioSources | undefined, step: ExportPreparationStep) => {
        audioSources?.onPreparationStepChange?.(step);
      },
      []
    );

  // エクスポート停止処理
  const stopExport = useCallback((options?: { silent?: boolean; reason?: ExportStopReason }) => {
    // reason 未指定の stopExport は preview/export cleanup 側からの system stop とみなす。
    const cancelReason = options?.reason ?? 'superseded';
    const currentPhase = exportPhaseRef.current;
    // natural end -> reader cancel -> finalize までの間は ref 更新の瞬間差があるため、
    // phase だけでなく completion/finalize 系 ref も合わせて見て「成功へ向かう終端処理中」を判定する。
    const isNaturalFinalizeInFlight =
      completionRequestedRef.current
      || finalizeRequestedRef.current
      || exportFinalizingRef.current
      || currentPhase === 'finalizing';
    if (currentPhase === 'completed') {
      return;
    }
    if (cancelReason === 'user' && isNaturalFinalizeInFlight) {
      useLogStore.getState().info('RENDER', '[EXPORT-FSM] transition', {
        exportSessionId: exportSessionIdRef.current,
        from: currentPhase,
        to: currentPhase,
        reason: 'cancel requested',
        cancelReason: exportCancelReasonRef.current,
        hasExportUrl: Boolean(exportUrl),
      });
      return;
    }
    useLogStore.getState().info(
      'RENDER',
      cancelReason === 'user' ? 'エクスポートを停止' : 'エクスポートを中断',
      { cancelReason },
    );
    const previousPhase = exportPhaseRef.current;
    completionRequestedRef.current = false;
    finalizeRequestedRef.current = false;
    exportFinalizingRef.current = false;
    exportCancelReasonRef.current = cancelReason;
    exportPhaseRef.current = 'cancelled';
    useLogStore.getState().info('RENDER', '[EXPORT-FSM] transition', {
      exportSessionId: exportSessionIdRef.current,
      from: previousPhase,
      to: 'cancelled',
      reason: 'cancel requested',
      cancelReason,
      hasExportUrl: Boolean(exportUrl),
    });
    silentAbortRef.current = options?.silent === true;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    // Readerを強制キャンセルして待機状態を解除
    if (videoReaderRef.current) {
      videoReaderRef.current.cancel().catch(() => { });
      videoReaderRef.current = null;
    }
    if (audioReaderRef.current) {
      audioReaderRef.current.cancel().catch(() => { });
      audioReaderRef.current = null;
    }
    setIsProcessing(false);
  }, [exportUrl]);

  // 正常終了要求（abortではなく、読み取りループを自然終了させる）
  const completeExport = useCallback(() => {
    useLogStore.getState().info('RENDER', 'エクスポートの正常終了を要求');
    const previousPhase = exportPhaseRef.current;
    completionRequestedRef.current = true;
    finalizeRequestedRef.current = true;
    exportFinalizingRef.current = true;
    exportCancelReasonRef.current = 'none';
    exportPhaseRef.current = 'finalizing';
    useLogStore.getState().info('RENDER', '[EXPORT-FSM] transition', {
      exportSessionId: exportSessionIdRef.current,
      from: previousPhase,
      to: 'finalizing',
      reason: 'natural end reached',
      cancelReason: 'none',
      hasExportUrl: Boolean(exportUrl),
    });
    if (videoReaderRef.current) {
      videoReaderRef.current.cancel().catch(() => { });
      videoReaderRef.current = null;
    }
    if (audioReaderRef.current) {
      audioReaderRef.current.cancel().catch(() => { });
      audioReaderRef.current = null;
    }
  }, [exportUrl]);

  // エクスポート開始
  const startExport = useCallback(
    async (
      canvasRef: React.MutableRefObject<HTMLCanvasElement | null>,
      masterDestRef: React.MutableRefObject<MediaStreamAudioDestinationNode | null>,
      onRecordingStop: (url: string, ext: string) => void,
      onRecordingError?: (message: string) => void,
      audioSources?: ExportAudioSources
    ) => {
      const exportSessionId = createDiagnosticId('export');
      exportSessionIdRef.current = exportSessionId;
      const log = useLogStore.getState();
      const logInfo = (message: string, details?: Record<string, unknown>) => {
        log.info('RENDER', message, { exportSessionId, ...(details ?? {}) });
      };
      const logWarn = (message: string, details?: Record<string, unknown>) => {
        log.warn('RENDER', message, { exportSessionId, ...(details ?? {}) });
      };
      const logError = (message: string, details?: Record<string, unknown>) => {
        log.error('RENDER', message, { exportSessionId, ...(details ?? {}) });
      };

      if (!canvasRef.current || !masterDestRef.current) {
        onRecordingError?.('エクスポートの初期化に失敗しました。');
        return;
      }

      logInfo('エクスポートを開始', {
        previewWidth: canvasRef.current.width,
        previewHeight: canvasRef.current.height,
        fps: FPS,
      });
      exportPhaseRef.current = 'preparing';
      logInfo('[EXPORT-FSM] transition', {
        from: 'idle',
        to: 'preparing',
        reason: 'export start',
        cancelReason: 'none',
        hasExportUrl: Boolean(exportUrl),
      });
      setIsProcessing(true);
      setExportUrl((previousUrl) => {
        if (previousUrl) {
          URL.revokeObjectURL(previousUrl);
        }
        return null;
      });
      setExportExt(null);
      completionRequestedRef.current = false;
      finalizeRequestedRef.current = false;
      exportFinalizingRef.current = false;
      exportCancelReasonRef.current = 'none';
      exportCompletedRef.current = false;
      silentAbortRef.current = false;
      updatePreparationStep(audioSources, 1);
      logInfo('[EXPORT-FSM] transition', {
        from: 'preparing',
        to: 'preparing',
        reason: 'audio prepared',
        cancelReason: exportCancelReasonRef.current,
        hasExportUrl: Boolean(exportUrl),
      });
      const audioDecodeCache = new Map<string, Promise<AudioBuffer | null>>();
      let hasNotifiedRecordingStop = false;
      const notifyRecordingStop = (url: string, ext: string, result?: ExportRecordingResult) => {
        if (hasNotifiedRecordingStop) return false;
        const hasPositiveBlob =
          typeof result?.blobSizeBytes === 'number'
            ? result.blobSizeBytes > 0
            : true;
        const hasDownloadableResult = Boolean(url && ext && hasPositiveBlob);
        const isConfirmedMediaRecorderCompletion =
          hasDownloadableResult
          && result?.source === 'media-recorder'
          && result.signalAborted === false;
        if (!hasDownloadableResult) {
          logWarn('[EXPORT-FSM] transition', {
            exportSessionId,
            from: exportPhaseRef.current,
            to: exportPhaseRef.current,
            reason: 'callback suppressed - result is not downloadable',
            cancelReason: exportCancelReasonRef.current,
            hasExportUrl: Boolean(exportUrl),
            hasDownloadableResult,
            recordingResult: result ?? null,
          });
          return false;
        }
        if (exportCancelReasonRef.current === 'user') {
          const playbackTimeSec = audioSources?.getPlaybackTimeSec?.();
          const isAtNaturalEnd =
            hasDownloadableResult
            && typeof playbackTimeSec === 'number'
            && Number.isFinite(playbackTimeSec)
            && Number.isFinite(audioSources?.totalDuration)
            && (audioSources?.totalDuration ?? 0) > 0
            && playbackTimeSec >= (audioSources?.totalDuration ?? 0) - 0.1;

          if (!isAtNaturalEnd && !isConfirmedMediaRecorderCompletion) {
            logWarn('[EXPORT-FSM] transition', {
              exportSessionId,
              from: exportPhaseRef.current,
              to: exportPhaseRef.current,
              reason: 'callback suppressed',
              cancelReason: exportCancelReasonRef.current,
              hasExportUrl: Boolean(exportUrl),
              hasDownloadableResult,
              recordingResult: result ?? null,
            });
            return false;
          }

          logWarn('[EXPORT-FSM] transition', {
            exportSessionId,
            from: exportPhaseRef.current,
            to: exportPhaseRef.current,
            reason: isConfirmedMediaRecorderCompletion
              ? 'recovered stale user-cancel after confirmed MediaRecorder completion'
              : 'recovered stale user-cancel after natural end',
            cancelReason: exportCancelReasonRef.current,
            hasExportUrl: Boolean(exportUrl),
            hasDownloadableResult,
            playbackTimeSec,
            totalDuration: audioSources?.totalDuration,
            recordingResult: result ?? null,
          });
          exportCancelReasonRef.current = 'none';
        }
        hasNotifiedRecordingStop = true;
        const previousPhase = exportPhaseRef.current;
        exportPhaseRef.current = 'completed';
        exportCompletedRef.current = true;
        logInfo('[EXPORT-FSM] transition', {
          from: previousPhase,
          to: 'completed',
          reason: 'callback invoked',
          cancelReason: exportCancelReasonRef.current,
          hasExportUrl: hasDownloadableResult,
        });
        onRecordingStop(url, ext);
        return true;
      };

      const canvas = canvasRef.current;
      const width = canvas.width;
      const height = canvas.height;
      const audioContext = masterDestRef.current.context;
      const audioTrack = masterDestRef.current.stream.getAudioTracks()[0] || null;
      const hasLiveAudioTrack = !!audioTrack && audioTrack.readyState === 'live';
      const platformCapabilities = config.getPlatformCapabilities();
      const {
        userAgent,
        isIOS,
        isSafari,
        isIosSafari,
        supportsTrackProcessor: canUseTrackProcessor,
        supportedMediaRecorderProfile,
        trackProcessorCtor,
      } = platformCapabilities;

      // ============================================================
      const resolvedExportDuration = audioSources
        ? resolveExportDuration(audioSources.totalDuration, FPS)
        : null;
      updatePreparationStep(audioSources, 2);

      // [DIAG-1] プラットフォーム検出・入力情報の診断ログ
      // ============================================================
      logInfo('[DIAG-1] プラットフォーム・入力診断', {
        isIOS,
        isSafari,
        isIosSafari,
        userAgent: userAgent.substring(0, 120),
        platform: typeof navigator !== 'undefined' ? navigator.platform : 'N/A',
        maxTouchPoints: typeof navigator !== 'undefined' ? navigator.maxTouchPoints : -1,
        hasAudioTrack: !!audioTrack,
        hasLiveAudioTrack,
        audioTrackReadyState: audioTrack?.readyState ?? 'none',
        audioContextState: (audioContext as AudioContext).state,
        audioContextSampleRate: audioContext.sampleRate,
        hasAudioSources: !!audioSources,
        audioSourcesDetail: audioSources ? {
          mediaItemCount: audioSources.mediaItems.length,
          videoItemCount: audioSources.mediaItems.filter(i => i.type === 'video').length,
          hasBgm: !!audioSources.bgm,
          narrationCount: audioSources.narrations.length,
          totalDuration: Math.round(audioSources.totalDuration * 100) / 100,
          exportDurationSec: resolvedExportDuration
            ? Math.round(resolvedExportDuration.exportDurationSec * 1000) / 1000
            : null,
          exportDurationUs: resolvedExportDuration?.exportDurationUs ?? null,
          alignedDurationSec: resolvedExportDuration
            ? Math.round(resolvedExportDuration.alignedDurationSec * 1000) / 1000
            : null,
          alignedFrameCount: resolvedExportDuration?.frameCount ?? null,
        } : null,
      });

      // [DIAG-1b] 全MediaItemの詳細一覧
      if (audioSources && isIosSafari) {
        audioSources.mediaItems.forEach((item, idx) => {
          logInfo(`[DIAG-1b] MediaItem[${idx}]`, {
            type: item.type,
            name: item.file instanceof File ? item.file.name : '(not File)',
            hasFile: item.file instanceof File,
            hasUrl: !!item.url,
            duration: Math.round(item.duration * 100) / 100,
            volume: item.volume,
            isMuted: item.isMuted,
            trimStart: item.trimStart,
            fadeIn: item.fadeIn,
            fadeOut: item.fadeOut,
          });
        });
      }

      // 映像経路は安定性優先で常に Canvas 直接フレーム方式を使用する。
      // TrackProcessor/captureStream 経路は環境差で静止画区間の尺ズレが発生しやすいため、
      // 問題収束まで一時的に固定運用とする。
      const useManualCanvasFrames = true;
      // 停止用シグナル
      const controller = new AbortController();
      abortControllerRef.current = controller;
      const { signal } = controller;
      const exportDurationUs = resolvedExportDuration
        ? resolvedExportDuration.exportDurationUs
        : Number.POSITIVE_INFINITY;
      const exportDurationSec = resolvedExportDuration
        ? resolvedExportDuration.exportDurationSec
        : null;
      const maxAudioTimestampUs = resolvedExportDuration
        ? resolvedExportDuration.exportDurationUs
        : Number.POSITIVE_INFINITY;
      const expectedVideoFrames = resolvedExportDuration
        ? Math.max(1, resolvedExportDuration.frameCount)
        : null;
      exportPhaseRef.current = 'rendering';
      logInfo('[EXPORT-FSM] transition', {
        from: 'preparing',
        to: 'rendering',
        reason: 'rendering started',
        cancelReason: exportCancelReasonRef.current,
        hasExportUrl: Boolean(exportUrl),
      });
      const getPlaybackTimeSec = (): number | null => {
        if (!audioSources?.getPlaybackTimeSec) return null;
        const raw = audioSources.getPlaybackTimeSec();
        if (!Number.isFinite(raw)) return null;
        return Math.max(0, raw);
      };

      // ScriptProcessorNode用（OfflineAudioContext失敗時のフォールバック）
      let scriptProcessorNode: ScriptProcessorNode | null = null;
      let scriptProcessorSource: MediaStreamAudioSourceNode | null = null;
      let canvasFramePumpTimer: ReturnType<typeof setInterval> | null = null;
      let preRenderedAudioBuffer: AudioBuffer | null = null;
      let preRenderedAudioPrepared = false;
      let preRenderedAudioPromise: Promise<AudioBuffer | null> | null = null;
      const shouldPrepareOfflineAudioBuffer = shouldUseOfflineAudioPreRender({
        hasAudioSources: !!audioSources,
        isIosSafari,
      });

      const ensurePreRenderedAudioBuffer = async (reason: 'required' = 'required'): Promise<AudioBuffer | null> => {
        if (preRenderedAudioPromise) {
          return preRenderedAudioPromise;
        }
        if (preRenderedAudioPrepared) {
          return preRenderedAudioBuffer;
        }
        preRenderedAudioPrepared = true;

        if (!shouldPrepareOfflineAudioBuffer || !audioSources) {
          return null;
        }

        const preRenderedAudioDurationSec = exportDurationSec ?? audioSources.totalDuration;

        logInfo('[DIAG-3] OfflineAudioContext パス開始', {
          totalDuration: audioSources.totalDuration,
          alignedDurationSec: preRenderedAudioDurationSec,
          sampleRate: audioContext.sampleRate,
          isIosSafari,
          reason,
        });

        preRenderedAudioPromise = (async () => {
          try {
            const renderedAudio = await offlineRenderAudio(
              {
                ...audioSources,
                totalDuration: preRenderedAudioDurationSec,
              },
              audioContext as AudioContext,
              audioContext.sampleRate,
              signal,
              {
                diagnostics: { exportSessionId },
                resolveExportAudioSource: config.resolveExportAudioSource,
                isIosSafari,
                audioDecodeCache,
              },
            );
            if (renderedAudio && !signal.aborted) {
              preRenderedAudioBuffer = renderedAudio;
            }
          } catch (e) {
            logWarn('OfflineAudioContext失敗、通常経路へフォールバック', {
              error: e instanceof Error ? e.message : String(e),
              reason,
            });
          }
          return preRenderedAudioBuffer;
        })();

        return preRenderedAudioPromise;
      };

      try {
        // キャンバスをエクスポート用の高解像度モードへ切り替える。
        // プレビュー時は軽量サイズ（〜720p）で描画し、エクスポート時のみ最大 1080p で書き出す。
        // React 再レンダリング前に captureStream が呼ばれる可能性があるため、
        // canvas 要素の width/height は ref 経由で即座に書き換える。
        useCanvasStore.getState().beginExportMode();
        const { exportWidth, exportHeight } = useCanvasStore.getState();
        if (canvasRef.current.width !== exportWidth) {
          canvasRef.current.width = exportWidth;
        }
        if (canvasRef.current.height !== exportHeight) {
          canvasRef.current.height = exportHeight;
        }

        const exportVideoBitrate = computeExportVideoBitrate(
          canvasRef.current.width,
          canvasRef.current.height,
        );
        logInfo('エクスポート用キャンバスサイズへ切替', {
          width: canvasRef.current.width,
          height: canvasRef.current.height,
          bitrate: exportVideoBitrate,
        });

        const strategyOrder = config.resolveExportStrategyOrder({
          isIosSafari,
          supportedMediaRecorderProfile,
        });

        logInfo('エクスポート戦略候補を解決', {
          strategyOrder,
          isIosSafari,
          supportsTrackProcessor: canUseTrackProcessor,
          supportsMp4MediaRecorder: !!supportedMediaRecorderProfile,
          preRenderOfflineAudio: shouldPrepareOfflineAudioBuffer,
        });

        if (isIosSafari) {
          logInfo('iOS Safari export route', {
            safariDetected: isIosSafari,
            exportRoute: strategyOrder[0] ?? 'webcodecs-mp4',
            audioContextState: (audioContext as AudioContext).state,
            hasLiveAudioTrack,
            hasAudioSources: !!audioSources,
          });
        }

        if (strategyOrder.includes('ios-safari-mediarecorder') && config.runMediaRecorderStrategy) {
          let preRenderedAudio: PreRenderedRecorderAudioSource | null = null;
          const renderedAudioForMediaRecorder = await ensurePreRenderedAudioBuffer('required');
          if (renderedAudioForMediaRecorder && !signal.aborted) {
            preRenderedAudio = createPreRenderedRecorderAudioSource(
              renderedAudioForMediaRecorder,
              audioContext as AudioContext,
            );
          }

          let handledByMediaRecorder = false;
          try {
            handledByMediaRecorder = await config.runMediaRecorderStrategy({
              canvas,
              masterDest: masterDestRef.current!,
              audioContext: audioContext as AudioContext,
              signal,
              audioSources,
              preRenderedAudio,
              callbacks: {
                onRecordingStop: notifyRecordingStop,
                onRecordingError,
              },
              state: {
                setExportUrl,
                setExportExt,
              },
              refs: {
                recorderRef,
              },
              exportConfig: {
                fps: FPS,
                videoBitrate: exportVideoBitrate,
              },
              supportedMediaRecorderProfile,
              diagnostics: {
                exportSessionId,
              },
            });
          } finally {
            if (!handledByMediaRecorder) {
              preRenderedAudio?.cleanup();
            }
          }
          if (handledByMediaRecorder) {
            return;
          }
        } else if (strategyOrder.includes('ios-safari-mediarecorder')) {
          logWarn('MediaRecorder export strategy is unavailable in this runtime; falling back to WebCodecs');
        }

        if (typeof VideoEncoder === 'undefined' || typeof AudioEncoder === 'undefined') {
          throw new Error('WebCodecsに対応していないブラウザです');
        }

        updatePreparationStep(audioSources, 8);
        // 1. Muxerの初期化 (ArrayBufferTarget -> メモリ上に構築)
        // 音声は常にセットアップする（iOS Safariでは audioTrack が取得できないケースでも
        // ScriptProcessorNode 経由で音声データをキャプチャするため）
        const muxer = new Mp4Muxer.Muxer({
          target: new Mp4Muxer.ArrayBufferTarget(),
          video: {
            codec: 'avc', // H.264
            width,
            height,
            // frameRate を指定しない → デフォルト timescale 57600 を使用。
            // 57600 は 30 の倍数 (57600/30=1920) なので通常フレームは整数 ticks で
            // 正確に表現でき、短い最終フレーム (例: 0.01s → 576 ticks) も有効値を保つ。
            // frameRate: FPS (=30) を設定すると timescale=30 になり、最終フレームの
            // duration が丸めで 0 になる (例: 0.01s × 30 = 0.3 → round → 0 ticks)。
            // その結果 AV 尺差が発生し Teams デスクトップでスロー再生となる。
          },
          audio: {
            codec: 'aac' as const,
            sampleRate: audioContext.sampleRate,
            numberOfChannels: 2,
          },
          firstTimestampBehavior: 'offset',
          fastStart: 'in-memory',
        });

        // 2. VideoEncoder の設定
        let encodedVideoEndUs = 0;
        let muxedAudioEndUs = 0;
        let finalAudioInputSamples = 0;
        const videoEncoder = new VideoEncoder({
          output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
          error: (e) => console.error('VideoEncoder error:', e),
        });
        videoEncoder.configure({
          codec: 'avc1.4d002a', // Main Profile, Level 4.2 (widely supported)
          width,
          height,
          bitrate: exportVideoBitrate,
          framerate: FPS,
        });

        // 3. AudioEncoder の設定（常に作成する）
        let audioEncoderOutputChunks = 0;
        let audioEncoderOutputBytes = 0;
        let audioEncoderSkippedChunks = 0;
        let audioEncoderClippedChunks = 0;
        let audioEncoderClippedDurationUs = 0;
        let audioEncoderPaddedChunks = 0;
        let audioEncoderPaddedSamples = 0;
        // AAC-LC は通常 1024 sample/frame。duration が取れないケースの保険値。
        const fallbackAacChunkDurationUs = Math.max(1, Math.round((1024 / audioContext.sampleRate) * 1e6));
        const audioEncoder = new AudioEncoder({
          output: (chunk, meta) => {
            audioEncoderOutputChunks++;
            audioEncoderOutputBytes += chunk.byteLength;
            // [DIAG-ENC-OUT] 初回出力とその後10チャンクごとにログ
            if (audioEncoderOutputChunks === 1) {
              useLogStore.getState().info('RENDER', '[DIAG-ENC-OUT] AudioEncoder 初回出力チャンク', {
                chunkByteLength: chunk.byteLength,
                chunkType: chunk.type,
                chunkTimestamp: chunk.timestamp,
                chunkDuration: chunk.duration,
                hasMeta: !!meta,
                metaDecoderConfig: meta?.decoderConfig ? {
                  codec: meta.decoderConfig.codec,
                  sampleRate: meta.decoderConfig.sampleRate,
                  numberOfChannels: meta.decoderConfig.numberOfChannels,
                } : null,
              });
            } else if (audioEncoderOutputChunks % 50 === 0) {
              useLogStore.getState().info('RENDER', `[DIAG-ENC-OUT] AudioEncoder 出力中 (${audioEncoderOutputChunks}チャンク)`, {
                totalBytes: audioEncoderOutputBytes,
              });
            }
            const chunkTimestampUs = Math.max(0, Math.round(chunk.timestamp));
            const chunkDurationUs = typeof chunk.duration === 'number' && Number.isFinite(chunk.duration) && chunk.duration > 0
              ? Math.round(chunk.duration)
              : fallbackAacChunkDurationUs;
            const chunkEndUs = chunkTimestampUs + chunkDurationUs;

            if (Number.isFinite(maxAudioTimestampUs)) {
              if (chunkTimestampUs >= maxAudioTimestampUs) {
                audioEncoderSkippedChunks++;
                if (audioEncoderSkippedChunks === 1 || audioEncoderSkippedChunks % 25 === 0) {
                  useLogStore.getState().warn('RENDER', '[DIAG-AUDIO-CLAMP] 音声チャンクを終端超過でスキップ', {
                    chunkTimestampUs,
                    maxAudioTimestampUs,
                    skippedChunks: audioEncoderSkippedChunks,
                  });
                }
                return;
              }

              if (chunkEndUs > maxAudioTimestampUs) {
                const clippedDurationUs = Math.max(0, Math.round(maxAudioTimestampUs - chunkTimestampUs));
                if (clippedDurationUs <= 0) {
                  audioEncoderSkippedChunks++;
                  return;
                }
                const rawData = new Uint8Array(chunk.byteLength);
                chunk.copyTo(rawData);
                muxer.addAudioChunkRaw(rawData, chunk.type, chunkTimestampUs, clippedDurationUs, meta);
                muxedAudioEndUs = Math.max(muxedAudioEndUs, chunkTimestampUs + clippedDurationUs);
                audioEncoderClippedChunks++;
                audioEncoderClippedDurationUs += chunkDurationUs - clippedDurationUs;
                if (audioEncoderClippedChunks === 1 || audioEncoderClippedChunks % 10 === 0) {
                  useLogStore.getState().warn('RENDER', '[DIAG-AUDIO-CLAMP] 音声チャンク終端をクランプ', {
                    chunkTimestampUs,
                    originalDurationUs: chunkDurationUs,
                    clippedDurationUs,
                    maxAudioTimestampUs,
                    clippedChunks: audioEncoderClippedChunks,
                    totalClippedDurationUs: audioEncoderClippedDurationUs,
                  });
                }
                return;
              }
            }

            muxer.addAudioChunk(chunk, meta);
            muxedAudioEndUs = Math.max(muxedAudioEndUs, chunkEndUs);
          },
          error: (e) => {
            useLogStore.getState().error('RENDER', 'AudioEncoder エラー', { error: String(e) });
            console.error('AudioEncoder error:', e);
          },
        });
        const audioEncoderConfig = {
          codec: 'mp4a.40.2' as const, // AAC-LC
          sampleRate: audioContext.sampleRate,
          numberOfChannels: 2 as const,
          bitrate: 128000,
        };
        audioEncoder.configure(audioEncoderConfig);

        // ============================================================
        // [DIAG-2] AudioEncoder 設定完了後の状態確認
        // ============================================================
        useLogStore.getState().info('RENDER', '[DIAG-2] AudioEncoder 設定完了', {
          state: audioEncoder.state,
          codec: audioEncoderConfig.codec,
          sampleRate: audioEncoderConfig.sampleRate,
          numberOfChannels: audioEncoderConfig.numberOfChannels,
          bitrate: audioEncoderConfig.bitrate,
        });

        // === 条件付き: OfflineAudioContext による音声プリレンダリング ===
        let offlineAudioDone = false;
        const shouldPreRenderAudio = shouldUseOfflineAudioPreRender({
          hasAudioSources: !!audioSources,
          isIosSafari,
        });
        if (shouldPreRenderAudio && audioSources) {
          const renderedAudio = await ensurePreRenderedAudioBuffer('required');
          if (renderedAudio && !signal.aborted) {
            useLogStore.getState().info('RENDER', '[DIAG-4] feed開始前 AudioEncoder状態', {
              state: audioEncoder.state,
              queueSize: audioEncoder.encodeQueueSize,
              outputChunksSoFar: audioEncoderOutputChunks,
            });
            const audioFeedResult = feedPreRenderedAudio(
              renderedAudio,
              audioEncoder,
              signal,
              exportDurationUs,
            );
            finalAudioInputSamples = Math.max(finalAudioInputSamples, audioFeedResult.encodedSamples);
            useLogStore.getState().info('RENDER', '[DIAG-5] feed完了後 AudioEncoder状態', {
              state: audioEncoder.state,
              queueSize: audioEncoder.encodeQueueSize,
              outputChunksAfterFeed: audioEncoderOutputChunks,
              encodedInputChunks: audioFeedResult.encodedChunks,
              encodedInputSamples: audioFeedResult.encodedSamples,
              trimmedInputSamples: audioFeedResult.trimmedSamples,
            });
            offlineAudioDone = true;
            useLogStore.getState().info('RENDER', '[DIAG-5b] iOS Safari: 音声プリレンダリング＆エンコード完了', {
              encodedChunks: audioFeedResult.encodedChunks,
              audioEncoderOutputChunks,
              audioEncoderOutputBytes,
              finalAudioInputSamples,
              offlineAudioDone,
            });
          } else if (!signal.aborted) {
            useLogStore.getState().warn('RENDER', 'OfflineAudioContext失敗、ScriptProcessorにフォールバック');
          }
        }

        // ============================================================
        // [DIAG-6] オフラインレンダリング後のパス分岐判断
        // ============================================================
        const webCodecsAudioCaptureStrategy = resolveWebCodecsAudioCaptureStrategy({
          offlineAudioDone,
          isIosSafari,
          hasLiveAudioTrack,
          canUseTrackProcessor,
        });
        logInfo('[DIAG-6] 音声パス判断結果', {
          offlineAudioDone,
          isIosSafari,
          hasAudioSources: !!audioSources,
          hasAudioTrack: !!audioTrack,
          hasLiveAudioTrack,
          audioTrackReadyState: audioTrack?.readyState ?? 'none',
          audioEncoderOutputChunks,
          audioEncoderOutputBytes,
          audioCaptureStrategy: webCodecsAudioCaptureStrategy,
          willUseScriptProcessor: webCodecsAudioCaptureStrategy === 'script-processor',
          willUseTrackProcessor: webCodecsAudioCaptureStrategy === 'track-processor',
        });

        // 4. ストリームの取得と処理
        let videoReader: ReadableStreamDefaultReader<VideoFrame> | null = null;
        let audioReader: ReadableStreamDefaultReader<AudioData> | null = null;
        let canvasStream: MediaStream | null = null;
        const videoCaptureStartedAtMs = Date.now();
        let requestedCanvasFrames = 0;
        let requestCanvasFrame: (() => void) | null = null;
        const getTargetVideoFrameCount = (forceToEnd: boolean): number | null => {
          if (expectedVideoFrames === null) return null;
          if (forceToEnd || completionRequestedRef.current) return expectedVideoFrames;

          const playbackTimeSec = getPlaybackTimeSec();
          if (playbackTimeSec !== null) {
            return Math.min(expectedVideoFrames, Math.max(1, Math.floor(playbackTimeSec * FPS) + 1));
          }

          const elapsedSec = (Date.now() - videoCaptureStartedAtMs) / 1000;
          return Math.min(expectedVideoFrames, Math.max(1, Math.floor(elapsedSec * FPS) + 1));
        };
        const pumpCanvasFrames = (forceToEnd: boolean) => {
          if (!requestCanvasFrame) return;
          const targetFrameCount = getTargetVideoFrameCount(forceToEnd);
          if (targetFrameCount === null) {
            if (!completionRequestedRef.current) requestCanvasFrame();
            return;
          }
          let needed = targetFrameCount - requestedCanvasFrames;
          if (needed <= 0) return;
          const burst = forceToEnd ? needed : Math.min(needed, Math.max(1, Math.ceil(FPS / 2)));
          for (let i = 0; i < burst; i++) {
            requestCanvasFrame();
          }
        };

        if (!useManualCanvasFrames) {
          if (!trackProcessorCtor) {
            throw new Error('TrackProcessorの初期化に失敗しました');
          }
          const autoCanvasStream = canvas.captureStream(FPS);
          let selectedCanvasStream: MediaStream = autoCanvasStream;
          let videoTrack = selectedCanvasStream.getVideoTracks()[0];
          if (!videoTrack) throw new Error('No video track found');
          let canvasVideoTrack = videoTrack as MediaStreamTrack & { requestFrame?: () => void };
          let captureMode: 'auto-fps' | 'manual-requestFrame' = 'auto-fps';

          // requestFrame が使える環境では、captureStream(0) の手動モードへ切り替える。
          // captureStream(FPS) + requestFrame の併用は二重供給になり、映像尺が伸びる場合がある。
          if (typeof canvasVideoTrack.requestFrame === 'function') {
            try {
              const manualCanvasStream = canvas.captureStream(0);
              const manualTrack = manualCanvasStream.getVideoTracks()[0];
              if (manualTrack && typeof (manualTrack as MediaStreamTrack & { requestFrame?: () => void }).requestFrame === 'function') {
                selectedCanvasStream = manualCanvasStream;
                videoTrack = manualTrack;
                canvasVideoTrack = manualTrack as MediaStreamTrack & { requestFrame?: () => void };
                captureMode = 'manual-requestFrame';
                autoCanvasStream.getTracks().forEach((track) => {
                  try { track.stop(); } catch { /* ignore */ }
                });
              } else {
                manualCanvasStream.getTracks().forEach((track) => {
                  try { track.stop(); } catch { /* ignore */ }
                });
              }
            } catch {
              // manual capture が失敗したら自動モードを継続
            }
          }

          canvasStream = selectedCanvasStream;

          if (captureMode === 'manual-requestFrame') {
            const framePumpIntervalMs = 16;
            requestCanvasFrame = () => {
              try {
                canvasVideoTrack.requestFrame?.();
                requestedCanvasFrames += 1;
              } catch {
                // ignore
              }
            };
            pumpCanvasFrames(false);
            canvasFramePumpTimer = setInterval(() => {
              if (signal.aborted) return;
              pumpCanvasFrames(false);
            }, framePumpIntervalMs);
          }

          const videoProcessor = new trackProcessorCtor({ track: videoTrack });
          videoReader = videoProcessor.readable.getReader() as ReadableStreamDefaultReader<VideoFrame>;
          videoReaderRef.current = videoReader;

          useLogStore.getState().info('RENDER', 'WebCodecs: Canvas frame pump の状態', {
            hasCanvasFramePump: !!canvasFramePumpTimer,
            canRequestFrame: typeof canvasVideoTrack.requestFrame === 'function',
            captureMode,
            expectedVideoFrames,
          });
        } else {
          useLogStore.getState().info('RENDER', 'iOS Safari向けにCanvas直接キャプチャを使用');
        }

        if (webCodecsAudioCaptureStrategy === 'track-processor' && audioTrack && trackProcessorCtor) {
          // TrackProcessor 経由の音声キャプチャ（PC/Android 向け）
          const audioProcessor = new trackProcessorCtor({ track: audioTrack });
          audioReader = audioProcessor.readable.getReader() as ReadableStreamDefaultReader<AudioData>;
          audioReaderRef.current = audioReader;
          useLogStore.getState().info('RENDER', 'TrackProcessor経由で音声をキャプチャ');
        } else if (webCodecsAudioCaptureStrategy === 'script-processor') {
          // ScriptProcessorNode 経由の音声キャプチャ（フォールバック）
          // iOS Safari で OfflineAudioContext が失敗した場合、または非Safari で TrackProcessor 非対応時。
          useLogStore.getState().info('RENDER', 'ScriptProcessorNode経由で音声をキャプチャ（フォールバック）', {
            isIosSafari,
            canUseTrackProcessor,
            hasAudioTrack: !!audioTrack,
            hasLiveAudioTrack,
            audioTrackReadyState: audioTrack?.readyState ?? 'none',
          });

          const audioCtx = audioContext as AudioContext;
          const bufferSize = 4096;
          scriptProcessorNode = audioCtx.createScriptProcessor(bufferSize, 2, 2);

          let audioTimestamp = 0;
          let capturedChunks = 0;

          scriptProcessorSource = audioCtx.createMediaStreamSource(masterDestRef.current!.stream);
          scriptProcessorSource.connect(scriptProcessorNode);
          scriptProcessorNode.connect(audioCtx.destination);

          scriptProcessorNode.onaudioprocess = (event: AudioProcessingEvent) => {
            if (signal.aborted || audioEncoder.state !== 'configured') return;
            if (audioTimestamp >= maxAudioTimestampUs) return;

            const inputBuffer = event.inputBuffer;
            const numberOfFrames = inputBuffer.length;
            const numberOfChannels = inputBuffer.numberOfChannels;

            // インターリーブ f32 形式（Safari AudioEncoder との互換性が最も高い）
            const interleavedData = new Float32Array(numberOfFrames * 2);
            const ch0 = inputBuffer.getChannelData(0);
            const ch1 = numberOfChannels >= 2 ? inputBuffer.getChannelData(1) : ch0;
            for (let i = 0; i < numberOfFrames; i++) {
              interleavedData[i * 2] = ch0[i];
              interleavedData[i * 2 + 1] = ch1[i];
            }

            try {
              const audioData = new AudioData({
                format: 'f32' as AudioSampleFormat,
                sampleRate: audioCtx.sampleRate,
                numberOfFrames,
                numberOfChannels: 2,
                timestamp: audioTimestamp,
                data: interleavedData,
              });

              audioEncoder.encode(audioData);
              audioData.close();

              capturedChunks++;
              finalAudioInputSamples = Math.max(
                finalAudioInputSamples,
                calculateFinalAudioSampleCount(audioCtx.sampleRate, audioTimestamp, numberOfFrames, exportDurationUs),
              );
              audioTimestamp += Math.round((numberOfFrames / audioCtx.sampleRate) * 1e6);

              // 初回キャプチャ成功をログ
              if (capturedChunks === 1) {
                useLogStore.getState().info('RENDER', 'ScriptProcessor 音声キャプチャ開始', {
                  sampleRate: audioCtx.sampleRate,
                  bufferSize: numberOfFrames,
                  channels: numberOfChannels,
                });
              }
            } catch (e) {
              // 初回エラーのみログ（連続エラーの抑制）
              if (capturedChunks === 0) {
                useLogStore.getState().error('RENDER', 'ScriptProcessor 音声キャプチャ失敗', {
                  error: e instanceof Error ? e.message : String(e),
                });
                console.error('ScriptProcessor audio capture error:', e);
              }
            }

            // 出力に極小値を設定してiOS Safariのノード最適化を防止
            // （完全ゼロだとSafariがonaudioprocess発火を停止する可能性がある）
            for (let ch = 0; ch < event.outputBuffer.numberOfChannels; ch++) {
              const output = event.outputBuffer.getChannelData(ch);
              for (let i = 0; i < output.length; i++) {
                output[i] = 1e-10;
              }
            }
          };
        }

        // 録画開始時刻
        // const startTime = document.timeline ? document.timeline.currentTime : performance.now();

        const isAbortError = (e: any) => {
          return (
            e?.name === 'AbortError' ||
            e?.message?.includes('Aborted') ||
            signal.aborted
          );
        };

        const waitForVisibleIfNeeded = async () => {
          if (
            typeof document === 'undefined' ||
            document.visibilityState === 'visible' ||
            signal.aborted ||
            completionRequestedRef.current
          ) {
            return;
          }

          await new Promise<void>((resolve) => {
            let completionPoll: ReturnType<typeof setInterval> | null = null;

            const cleanup = () => {
              signal.removeEventListener('abort', onAbort);
              document.removeEventListener('visibilitychange', onVisibility);
              if (typeof window !== 'undefined') {
                window.removeEventListener('focus', onVisibility);
                window.removeEventListener('pageshow', onVisibility);
              }
              if (completionPoll !== null) {
                clearInterval(completionPoll);
                completionPoll = null;
              }
            };

            const onAbort = () => {
              cleanup();
              resolve();
            };

            const onVisibility = () => {
              if (document.visibilityState === 'visible') {
                cleanup();
                resolve();
              }
            };

            signal.addEventListener('abort', onAbort, { once: true });
            document.addEventListener('visibilitychange', onVisibility);
            if (typeof window !== 'undefined') {
              window.addEventListener('focus', onVisibility);
              window.addEventListener('pageshow', onVisibility);
            }

            completionPoll = setInterval(() => {
              if (completionRequestedRef.current) {
                cleanup();
                resolve();
              }
            }, 50);
          });
        };

        const processVideoWithTrackProcessor = async () => {
          let frameIndex = 0;
          const isKeyFrame = (index: number) => index === 0 || index % FPS === 0;

          try {
            while (!signal.aborted) {
              if (completionRequestedRef.current) {
                if (expectedVideoFrames === null) break;
                if (frameIndex >= expectedVideoFrames) break;
              }

              await waitForVisibleIfNeeded();
              if (signal.aborted) break;
              if (completionRequestedRef.current && expectedVideoFrames === null) break;
              if (completionRequestedRef.current && expectedVideoFrames !== null && frameIndex >= expectedVideoFrames) break;
              if (completionRequestedRef.current) {
                pumpCanvasFrames(true);
              }

              if (!videoReader) break;
              const { done, value } = await videoReader.read();
              if (done) break;

              if (value) {
                const originalFrame = value as VideoFrame;
                if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
                  originalFrame.close();
                  continue;
                }

                if (videoEncoder.state === 'configured') {
                  // [FIX] Teamsスロー再生対策
                  // オリジナルのtimestamp（実時間ベース）を使うと、レンダリング遅延（ジッター）が含まれ
                  // 結果としてVFR（可変フレームレート）となり、一部プレーヤーで再生時間が間延びする。
                  // そのため、フレーム順序ベースの決定的なタイムスタンプへ揃えつつ、
                  // 総尺は生のタイムライン値へ一致させる。
                  const frameTiming = resolvedExportDuration
                    ? getExportFrameTiming(resolvedExportDuration, FPS, frameIndex)
                    : {
                      timestampUs: Math.round(frameIndex * (1e6 / FPS)),
                      durationUs: Math.round(1e6 / FPS),
                    };
                  encodedVideoEndUs = Math.max(encodedVideoEndUs, frameTiming.timestampUs + frameTiming.durationUs);

                  // 新しいタイムスタンプでフレームを再作成
                  // copyToなどのコストを避けるため、VideoFrameコンストラクタでラップする
                  const newFrame = new VideoFrame(originalFrame, {
                    timestamp: frameTiming.timestampUs,
                    duration: frameTiming.durationUs,
                  });

                  // エンコード
                  videoEncoder.encode(newFrame, { keyFrame: isKeyFrame(frameIndex) });

                  // クローズ
                  newFrame.close();
                }
                originalFrame.close();
                frameIndex++;
              }
            }

            // 終了要求時に不足フレームが残っていた場合、最終キャンバスを複製して尺を揃える。
            // 画像区間の供給遅延で映像尺が短くなるのを防ぐための保険。
            if (!signal.aborted && completionRequestedRef.current && expectedVideoFrames !== null && frameIndex < expectedVideoFrames && videoEncoder.state === 'configured') {
              const missingFrames = expectedVideoFrames - frameIndex;
              for (let i = 0; i < missingFrames; i++) {
                const frameTiming = resolvedExportDuration
                  ? getExportFrameTiming(resolvedExportDuration, FPS, frameIndex)
                  : {
                    timestampUs: Math.round(frameIndex * (1e6 / FPS)),
                    durationUs: Math.round(1e6 / FPS),
                  };
                encodedVideoEndUs = Math.max(encodedVideoEndUs, frameTiming.timestampUs + frameTiming.durationUs);
                const frame = new VideoFrame(canvas, {
                  timestamp: frameTiming.timestampUs,
                  duration: frameTiming.durationUs,
                });
                videoEncoder.encode(frame, { keyFrame: isKeyFrame(frameIndex) });
                frame.close();
                frameIndex++;
              }
              useLogStore.getState().warn('RENDER', '映像不足フレームを末尾補完', {
                missingFrames,
                finalFrameIndex: frameIndex,
                expectedVideoFrames,
              });
            }
          } catch (e) {
            if (!isAbortError(e)) {
              console.error('Video processing error:', e);
            }
          }
        };

        const processVideoWithCanvasFrames = async () => {
          let frameIndex = 0;
          const framePollInterval = 16;
          const isKeyFrame = (index: number) => index === 0 || index % FPS === 0;

          try {
            while (!signal.aborted) {
              if (completionRequestedRef.current) {
                if (expectedVideoFrames === null) break;
                if (frameIndex >= expectedVideoFrames) break;
              }

              await waitForVisibleIfNeeded();
              if (signal.aborted) break;
              if (completionRequestedRef.current && expectedVideoFrames === null) break;

              const forceToEnd = completionRequestedRef.current;
              const targetFrameCount = getTargetVideoFrameCount(forceToEnd);
              const pendingFrameCount = targetFrameCount === null ? 1 : targetFrameCount - frameIndex;
              const framesToEncode = resolveExportCanvasFrameBurstCount({
                pendingFrameCount,
              });

              if (videoEncoder.state === 'configured' && framesToEncode > 0) {
                for (let i = 0; i < framesToEncode; i++) {
                  const frameTiming = resolvedExportDuration
                    ? getExportFrameTiming(resolvedExportDuration, FPS, frameIndex)
                    : {
                      timestampUs: Math.round(frameIndex * (1e6 / FPS)),
                      durationUs: Math.round(1e6 / FPS),
                    };
                  encodedVideoEndUs = Math.max(encodedVideoEndUs, frameTiming.timestampUs + frameTiming.durationUs);
                  const frame = new VideoFrame(canvas, {
                    timestamp: frameTiming.timestampUs,
                    duration: frameTiming.durationUs,
                  });
                  videoEncoder.encode(frame, { keyFrame: isKeyFrame(frameIndex) });
                  frame.close();
                  frameIndex++;
                }
              }

              if (completionRequestedRef.current && expectedVideoFrames !== null && frameIndex >= expectedVideoFrames) {
                break;
              }

              await new Promise<void>((resolve) => {
                const timeoutId = setTimeout(() => {
                  signal.removeEventListener('abort', onAbort);
                  resolve();
                }, framePollInterval);
                const onAbort = () => {
                  clearTimeout(timeoutId);
                  signal.removeEventListener('abort', onAbort);
                  resolve();
                };
                signal.addEventListener('abort', onAbort, { once: true });
              });
            }
          } catch (e) {
            if (!isAbortError(e)) {
              console.error('Video processing error (canvas):', e);
            }
          }
        };

        const processAudio = async () => {
          if (!audioReader) return;

          try {
            while (!signal.aborted && !completionRequestedRef.current) {
              await waitForVisibleIfNeeded();
              if (signal.aborted || completionRequestedRef.current) break;

              const { done, value } = await audioReader.read();
              if (done) break;

              if (value) {
                const data = value as AudioData;
                if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
                  data.close();
                  continue;
                }
                if (data.timestamp >= maxAudioTimestampUs) {
                  data.close();
                  break;
                }
                const dataTimestampUs = Math.max(0, Math.round(data.timestamp));
                finalAudioInputSamples = Math.max(
                  finalAudioInputSamples,
                  calculateFinalAudioSampleCount(data.sampleRate, dataTimestampUs, data.numberOfFrames, exportDurationUs),
                );
                if (audioEncoder.state === 'configured') {
                  audioEncoder.encode(data);
                }
                data.close();
              }
            }
          } catch (e) {
            if (!isAbortError(e)) {
              console.error('Audio processing error:', e);
            }
          }
        };

        // ScriptProcessorNode使用時は停止要求待機のみ（音声キャプチャはコールバックで非同期実行）
        const waitForStopRequest = async () => {
          await new Promise<void>((resolve) => {
            if (signal.aborted || completionRequestedRef.current) { resolve(); return; }
            let pollTimer: ReturnType<typeof setInterval> | null = null;
            const onAbort = () => {
              signal.removeEventListener('abort', onAbort);
              if (pollTimer !== null) clearInterval(pollTimer);
              resolve();
            };
            signal.addEventListener('abort', onAbort, { once: true });
            pollTimer = setInterval(() => {
              if (completionRequestedRef.current) {
                signal.removeEventListener('abort', onAbort);
                if (pollTimer !== null) clearInterval(pollTimer);
                resolve();
              }
            }, 50);
          });
        };

        // 並列実行
        const processingTasks = [
          useManualCanvasFrames ? processVideoWithCanvasFrames() : processVideoWithTrackProcessor(),
          audioReader ? processAudio() : (scriptProcessorNode ? waitForStopRequest() : Promise.resolve()),
        ];
        const processing = Promise.all(processingTasks);

        // 停止を待つためのPromiseを作成
        // 実際のアプリでは「再生終了」などのイベントで stopExport が呼ばれることを想定するが、
        // 現状の useExport インターフェースだと MediaRecorder.onstop のようなコールバックフローになっている。
        // -> ここでは startExport を呼び出した側が、適切なタイミングで stopExport を呼ぶ必要がある。
        // しかし既存コードは `rec.start()` して終わりで、停止は別トリガー（恐らくPlayback制御側）が `rec.stop()` を呼ぶ？
        // いいえ、既存コードを見ると `rec.onstop` を定義しているだけで、誰が止めるかがここには書かれていません。
        // MediaRecorder のインスタンスを返していないので、外部から止める手段がない…？
        // -> いえ、`recorderRef.current` に入れているので、外部コンポーネントが `recorderRef.current.stop()` しているはずです。

        // 【重要】既存ロジックとの互換性
        // 外部コンポーネントは `recorderRef.current.stop()` を呼んで録画を止めようとします。
        // しかし今回は MediaRecorder を使いません。
        // そのため、recorderRef.current にダミーのオブジェクト（stopメソッドを持つ）を入れるハックが必要です。

        recorderRef.current = {
          stop: () => {
            // 正常終了シグナルを送る（abortしない）
            completeExport();
          },
          state: 'recording',
          // 他に必要なプロパティがあればダミー実装する
          start: () => { },
          pause: () => { },
          resume: () => { },
          requestData: () => { },
          stream: new MediaStream(),
          mimeType: 'video/mp4',
          ondataavailable: null,
          onerror: null,
          onpause: null,
          onresume: null,
          onstart: null,
          onstop: null,
          addEventListener: () => { },
          removeEventListener: () => { },
          dispatchEvent: () => true,
          audioBitsPerSecond: 128000,
          videoBitsPerSecond: exportVideoBitrate
        } as unknown as MediaRecorder;

        // 音声プリレンダリング完了を通知 — エクスポート用の再生ループを開始させる
        // iOS Safari では extractAudioViaVideoElement にリアルタイムがかかるため、
        // このコールバックのタイミングが重要。
        // Step 9 は実際の映像生成ループ開始直前に進め、直後の onAudioPreRenderComplete
        // で preview/export loop を始動させる。
        updatePreparationStep(audioSources, 9);
        logInfo('[DIAG-READY] 音声準備完了、再生ループ開始通知');
        audioSources?.onAudioPreRenderComplete?.();

        // 停止されるまで待機（processingは停止シグナルで終わる）
        await processing;

        // ScriptProcessorNodeのクリーンアップ（flush前に停止して新規データ送信を防止）
        if (scriptProcessorNode) {
          scriptProcessorNode.onaudioprocess = null;
          try { scriptProcessorNode.disconnect(); } catch (e) { /* ignore */ }
          scriptProcessorNode = null;
        }
        if (scriptProcessorSource) {
          try { scriptProcessorSource.disconnect(); } catch (e) { /* ignore */ }
          scriptProcessorSource = null;
        }

        if (!signal.aborted && audioSources && !offlineAudioDone && audioEncoderOutputChunks === 0) {
          useLogStore.getState().warn('RENDER', 'リアルタイム音声キャプチャ結果が空のため、OfflineAudioContext へフォールバック', {
            isIosSafari,
            hasAudioTrack: !!audioTrack,
            hasLiveAudioTrack,
            audioTrackReadyState: audioTrack?.readyState ?? 'none',
            canUseTrackProcessor,
          });
          const renderedAudio = await ensurePreRenderedAudioBuffer('required');
          if (renderedAudio && !signal.aborted) {
            const audioFeedResult = feedPreRenderedAudio(
              renderedAudio,
              audioEncoder,
              signal,
              exportDurationUs,
            );
            finalAudioInputSamples = Math.max(finalAudioInputSamples, audioFeedResult.encodedSamples);
            offlineAudioDone = true;
            useLogStore.getState().info('RENDER', 'OfflineAudioContext フォールバックで音声を補完', {
              encodedChunks: audioFeedResult.encodedChunks,
              encodedInputSamples: audioFeedResult.encodedSamples,
              audioEncoderOutputChunks,
              audioEncoderOutputBytes,
            });
          }
        }

        if (!signal.aborted && Number.isFinite(exportDurationUs)) {
          const finalAudioResult = finalizeAudioForExport(
            audioEncoder,
            audioContext.sampleRate,
            signal,
            finalAudioInputSamples,
            exportDurationUs,
          );
          finalAudioInputSamples = finalAudioResult.finalSampleCount;
          audioEncoderPaddedChunks += finalAudioResult.paddedChunks;
          audioEncoderPaddedSamples += finalAudioResult.paddedSamples;
        }

        updatePreparationStep(audioSources, 10);
        // ============================================================
        // [DIAG-7] フラッシュ前の最終状態
        // ============================================================
        logInfo('[DIAG-7] エンコーダー flush 開始', {
          audioEncoderOutputChunks,
          audioEncoderOutputBytes,
          audioEncoderSkippedChunks,
          audioEncoderClippedChunks,
          audioEncoderClippedDurationMs: Math.round(audioEncoderClippedDurationUs / 1000),
          audioEncoderPaddedChunks,
          audioEncoderPaddedSamples,
          audioEncoderState: audioEncoder.state,
          audioEncoderQueueSize: audioEncoder.encodeQueueSize,
          videoEncoderState: videoEncoder.state,
          videoEncoderQueueSize: videoEncoder.encodeQueueSize,
          encodedVideoEndUs,
          muxedAudioEndUs,
          exportDurationUs: Number.isFinite(exportDurationUs) ? exportDurationUs : null,
          offlineAudioDone,
        });
        await videoEncoder.flush();
        useLogStore.getState().info('RENDER', '[DIAG-7b] VideoEncoder flush 完了');
        try {
          await audioEncoder.flush();
          useLogStore.getState().info('RENDER', '[DIAG-7c] AudioEncoder flush 完了', {
            outputChunksAfterFlush: audioEncoderOutputChunks,
            outputBytesAfterFlush: audioEncoderOutputBytes,
            skippedChunks: audioEncoderSkippedChunks,
            clippedChunks: audioEncoderClippedChunks,
            totalClippedDurationMs: Math.round(audioEncoderClippedDurationUs / 1000),
            paddedChunks: audioEncoderPaddedChunks,
            paddedSamples: audioEncoderPaddedSamples,
            muxedAudioEndUs,
            encodedVideoEndUs,
          });
        } catch (flushErr) {
          useLogStore.getState().error('RENDER', '[DIAG-7c] AudioEncoder flush 失敗', {
            error: flushErr instanceof Error ? flushErr.message : String(flushErr),
            audioEncoderState: audioEncoder.state,
          });
        }

        if (Number.isFinite(exportDurationUs)) {
          const audioVideoDiffUs = Math.abs(muxedAudioEndUs - encodedVideoEndUs);
          const audioExportDiffUs = Math.abs(muxedAudioEndUs - exportDurationUs);
          const videoExportDiffUs = Math.abs(encodedVideoEndUs - exportDurationUs);
          const exceedsDurationThreshold =
            audioVideoDiffUs > DURATION_DIFF_THRESHOLD_US ||
            audioExportDiffUs > DURATION_DIFF_THRESHOLD_US ||
            videoExportDiffUs > DURATION_DIFF_THRESHOLD_US;
          const durationPayload = {
            exportDurationUs,
            muxedAudioEndUs,
            encodedVideoEndUs,
            audioVideoDiffMs: Math.round(audioVideoDiffUs) / 1000,
            audioExportDiffMs: Math.round(audioExportDiffUs) / 1000,
            videoExportDiffMs: Math.round(videoExportDiffUs) / 1000,
          };
          if (exceedsDurationThreshold) {
            useLogStore.getState().warn('RENDER', '[DIAG-DURATION-1] AAC後 duration 差分警告', durationPayload);
          } else {
            useLogStore.getState().info('RENDER', '[DIAG-DURATION-1] AAC後 duration 差分確認', durationPayload);
          }
        }

        // ============================================================
        // [DIAG-8] Muxer finalize
        // ============================================================
        muxer.finalize();
        logInfo('[DIAG-8] Muxer finalize 完了', {
          bufferByteLength: muxer.target.buffer.byteLength,
          audioEncoderOutputChunks,
          audioEncoderOutputBytes,
          audioEncoderSkippedChunks,
          audioEncoderClippedChunks,
          audioEncoderClippedDurationMs: Math.round(audioEncoderClippedDurationUs / 1000),
          audioEncoderPaddedChunks,
          audioEncoderPaddedSamples,
          muxedAudioEndUs,
          encodedVideoEndUs,
          exportDurationUs: Number.isFinite(exportDurationUs) ? exportDurationUs : null,
        });

        // Canvasストリームを停止
        if (canvasFramePumpTimer) {
          clearInterval(canvasFramePumpTimer);
          canvasFramePumpTimer = null;
        }
        if (canvasStream) {
          canvasStream.getTracks().forEach((track) => {
            try {
              track.stop();
            } catch (e) {
              /* ignore */
            }
          });
        }

        // バッファ取得とBlob作成
        const { buffer } = muxer.target;

        if (Number.isFinite(exportDurationUs)) {
          const muxDurationSummary = inspectMp4Durations(buffer);
          if (!muxDurationSummary) {
            throw new Error(`MP4ファイルからduration情報を読み取れませんでした。mux 処理に問題がある可能性があります (bufferBytes: ${buffer.byteLength})`);
          }

          const {
            containerDurationUs,
            videoDurationUs,
            audioDurationUs,
          } = muxDurationSummary;

          if (
            containerDurationUs == null ||
            videoDurationUs == null ||
            audioDurationUs == null
          ) {
            const missingDurationPayload = {
              exportDurationUs,
              bufferBytes: buffer.byteLength,
              containerDurationUs,
              videoDurationUs,
              audioDurationUs,
            };
            useLogStore
              .getState()
              .error('RENDER', '[DIAG-DURATION-2] mux後 duration 欠落', missingDurationPayload);
            throw new Error(
              `mux 後の duration 情報に欠落があります (containerDurationUs: ${containerDurationUs}, videoDurationUs: ${videoDurationUs}, audioDurationUs: ${audioDurationUs})`,
            );
          }

          const videoTrackDurationUs = videoDurationUs;
          const audioTrackDurationUs = audioDurationUs;
          const audioVideoDiffUs = Math.abs(audioTrackDurationUs - videoTrackDurationUs);
          const audioContainerDiffUs = Math.abs(audioTrackDurationUs - containerDurationUs);
          const videoContainerDiffUs = Math.abs(videoTrackDurationUs - containerDurationUs);
          const containerExportDiffUs = Math.abs(containerDurationUs - exportDurationUs);
          const exceedsMuxDurationThreshold =
            audioVideoDiffUs > DURATION_DIFF_THRESHOLD_US ||
            audioContainerDiffUs > DURATION_DIFF_THRESHOLD_US ||
            videoContainerDiffUs > DURATION_DIFF_THRESHOLD_US ||
            containerExportDiffUs > DURATION_DIFF_THRESHOLD_US;

          const muxDurationPayload = {
            exportDurationUs,
            containerDurationUs,
            videoTrackDurationUs,
            audioTrackDurationUs,
            audioVideoDiffMs: Math.round(audioVideoDiffUs) / 1000,
            audioContainerDiffMs: Math.round(audioContainerDiffUs) / 1000,
            videoContainerDiffMs: Math.round(videoContainerDiffUs) / 1000,
            containerExportDiffMs: Math.round(containerExportDiffUs) / 1000,
          };

          if (exceedsMuxDurationThreshold) {
            useLogStore.getState().error('RENDER', '[DIAG-DURATION-2] mux後 duration 差分異常', muxDurationPayload);
            throw new Error(
              `mux 後の duration 差分が閾値を超えました (audio-video: ${Math.round(audioVideoDiffUs) / 1000}ms, container-export: ${Math.round(containerExportDiffUs) / 1000}ms)`,
            );
          }

          useLogStore.getState().info('RENDER', '[DIAG-DURATION-2] mux後 duration 差分確認', muxDurationPayload);
        }

        if (buffer.byteLength > 0) {
          exportFinalizingRef.current = true;
          const blob = new Blob([buffer], { type: 'video/mp4' });
          if (blob.size <= 0) {
            throw new Error('書き出し結果が空です');
          }
          logInfo('[DIAG-BLOB] export blob created', {
            blobSize: blob.size,
            blobType: blob.type,
          });
          let url: string;
          try {
            url = URL.createObjectURL(blob);
          } catch {
            throw new Error('保存用URLの作成に失敗しました');
          }
          try {
            const metadata = await probeExportBlobUrl(url);
            logInfo('[DIAG-BLOB] export blob metadata loaded', metadata);
          } catch (error) {
            logWarn('[DIAG-BLOB] export blob metadata probe failed', {
              error: error instanceof Error ? error.message : String(error),
            });
          }
          // ============================================================
          // [DIAG-9] エクスポート最終結果
          // ============================================================
          logInfo('[DIAG-9] エクスポート完了 最終結果', {
            fileSizeBytes: buffer.byteLength,
            fileSizeMB: (buffer.byteLength / 1024 / 1024).toFixed(2),
            audioEncoderOutputChunks,
            audioEncoderOutputBytes,
            audioEncoderSkippedChunks,
            audioEncoderClippedChunks,
            audioEncoderClippedDurationMs: Math.round(audioEncoderClippedDurationUs / 1000),
            audioEncoderPaddedChunks,
            audioEncoderPaddedSamples,
            muxedAudioEndUs,
            encodedVideoEndUs,
            exportDurationUs: Number.isFinite(exportDurationUs) ? exportDurationUs : null,
            audioDataPresent: audioEncoderOutputChunks > 0,
            offlineAudioDone,
          });
          logInfo('[DIAG-10] export URL 作成完了', {
            blobSize: blob.size,
            urlCreated: Boolean(url),
            cancelReason: exportCancelReasonRef.current,
            phase: exportPhaseRef.current,
          });
          logInfo('[EXPORT-FSM] transition', {
            from: exportPhaseRef.current,
            to: exportPhaseRef.current,
            reason: 'url created',
            cancelReason: exportCancelReasonRef.current,
            hasExportUrl: Boolean(exportUrl),
          });
          try {
            const cancelReasonAtUrl = exportCancelReasonRef.current as ExportCancelReason;
            if (cancelReasonAtUrl === 'user') {
              // blob が正常に生成されている場合は、古い cancelReason='user' を無視して完了扱いに復旧する。
              // stopAll() → stopWebCodecsExport({ reason: 'user' }) の誤呼び出しで cancelReason が汚染された場合の保険。
              if (blob.size > 0) {
                logWarn('[EXPORT-FSM] transition', {
                  from: exportPhaseRef.current,
                  to: exportPhaseRef.current,
                  reason: 'recovered from stale user-cancel — valid export result will be delivered',
                  cancelReason: cancelReasonAtUrl,
                  blobSize: blob.size,
                  hasExportUrl: Boolean(exportUrl),
                });
                exportCancelReasonRef.current = 'none';
              } else {
                URL.revokeObjectURL(url);
                logWarn('[EXPORT-FSM] transition', {
                  from: exportPhaseRef.current,
                  to: exportPhaseRef.current,
                  reason: 'callback suppressed',
                  cancelReason: cancelReasonAtUrl,
                  hasExportUrl: Boolean(exportUrl),
                });
                return;
              }
            }
            exportPhaseRef.current = 'completed';
            exportCompletedRef.current = true;
            logInfo('[EXPORT-FSM] invoking onRecordingStop', {
              urlPresent: Boolean(url),
              ext: 'mp4',
            });
            const callbackDelivered = notifyRecordingStop(url, 'mp4', {
              source: 'webcodecs',
              blobSizeBytes: blob.size,
              signalAborted: signal.aborted,
            });
            if (!callbackDelivered) {
              exportCompletedRef.current = false;
              URL.revokeObjectURL(url);
              return;
            }
            setExportUrl(url);
            setExportExt('mp4');
            logInfo('[EXPORT-FSM] transition', {
              from: 'completed',
              to: 'completed',
              reason: 'ui exportUrl set',
              cancelReason: exportCancelReasonRef.current,
              hasExportUrl: true,
            });
          } catch (error) {
            exportCompletedRef.current = false;
            exportPhaseRef.current = 'failed';
            URL.revokeObjectURL(url);
            throw error;
          }
        } else {
          throw new Error('書き出し結果が空です');
        }

      } catch (err) {
        const isAbort =
          signal.aborted ||
          (err as any)?.name === 'AbortError' ||
          (err as any)?.message?.includes('Aborted');
        const cancelReason = exportCancelReasonRef.current as ExportCancelReason;
        exportCancelReasonRef.current = isAbort ? cancelReason : 'error';
        exportPhaseRef.current = isAbort ? 'cancelled' : 'failed';

        if (!hasNotifiedRecordingStop) {
          logError('recording stop callback was not delivered before export finalization failed');
        }

        if (!isAbort) {
          logError('[EXPORT-FSM] transition', {
            from: 'finalizing',
            to: 'failed',
            reason: 'failed',
            cancelReason,
            hasExportUrl: Boolean(exportUrl),
          });
          logError('export finalize failed', {
            error: err instanceof Error ? err.message : String(err)
          });
          console.error('Export failed:', err);
          onRecordingError?.(
            err instanceof Error ? err.message : '動画ファイルの作成に失敗しました'
          );
        } else if (cancelReason === 'user') {
          logInfo('エクスポートが中断されました');
          if (!silentAbortRef.current) {
            onRecordingError?.('エクスポートが中断されました');
          }
        } else if (cancelReason === 'superseded' || cancelReason === 'unmount') {
          logInfo('エクスポートが後続処理のため中断されました', {
            cancelReason,
          });
        } else if (finalizeRequestedRef.current || completionRequestedRef.current) {
          logInfo('正常終了要求後の中断を検出しましたが、完了処理を優先します');
        } else {
          logInfo('エクスポートが中断されました');
        }
      } finally {
        if (canvasFramePumpTimer) {
          clearInterval(canvasFramePumpTimer);
          canvasFramePumpTimer = null;
        }
        // ScriptProcessorNodeのクリーンアップ（エラー時の保険）
        if (scriptProcessorNode) {
          scriptProcessorNode.onaudioprocess = null;
          try { scriptProcessorNode.disconnect(); } catch (e) { /* ignore */ }
        }
        if (scriptProcessorSource) {
          try { scriptProcessorSource.disconnect(); } catch (e) { /* ignore */ }
        }
        // リソース解放などはGCに任せるが、明示的なcloseも可
        // controllerはstopExportでabort済み
        // ReaderのキャンセルもstopExportで実施済み
        abortControllerRef.current = null;
        videoReaderRef.current = null;
        audioReaderRef.current = null;
        recorderRef.current = null;
        exportSessionIdRef.current = null;
        completionRequestedRef.current = false;
        finalizeRequestedRef.current = false;
        exportFinalizingRef.current = false;
        exportCancelReasonRef.current = 'none';
        exportPhaseRef.current = 'idle';
        silentAbortRef.current = false;
        setIsProcessing(false);
        // キャンバスをプレビューサイズへ戻す（プレビュー描画を軽量に保つ）。
        useCanvasStore.getState().endExportMode();
        const { previewWidth, previewHeight } = useCanvasStore.getState();
        if (canvasRef.current) {
          if (canvasRef.current.width !== previewWidth) {
            canvasRef.current.width = previewWidth;
          }
          if (canvasRef.current.height !== previewHeight) {
            canvasRef.current.height = previewHeight;
          }
        }
      }
    },
    [completeExport, stopExport, updatePreparationStep]
  );

  // エクスポートURLクリア
  const clearExportUrl = useCallback(() => {
    if (exportUrl) {
      URL.revokeObjectURL(exportUrl);
    }
    setExportUrl(null);
    setExportExt(null);
  }, [exportUrl]);

    return {
      isProcessing,
      setIsProcessing,
      exportUrl,
      setExportUrl,
      exportExt,
      setExportExt,
      recorderRef,
      startExport, // 既存I/F維持
      completeExport,
      stopExport, // 新規追加（必要であれば使う）
      clearExportUrl,
    };
  };
}
