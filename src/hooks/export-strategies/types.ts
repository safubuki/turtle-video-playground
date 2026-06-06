import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { AudioTrack, MediaItem, NarrationClip } from '../../types';
import type { MediaRecorderProfile } from '../../utils/platform';

export type ExportStrategyId = 'ios-safari-mediarecorder' | 'webcodecs-mp4';
export const EXPORT_PREPARATION_STEP_ORDER = [
  1,
  2,
  3,
  4,
  5,
  6,
  7,
  8,
  9,
  10,
] as const;
export type ExportPreparationStep = (typeof EXPORT_PREPARATION_STEP_ORDER)[number];
export const EXPORT_PREPARATION_TOTAL_STEPS = EXPORT_PREPARATION_STEP_ORDER.length;
export const EXPORT_PREPARATION_STEP_LABELS: Record<ExportPreparationStep, string> = {
  1: '書き出し初期化',
  2: 'メディア情報確認',
  3: '動画音声の解析',
  4: 'BGM音声の解析',
  5: 'ナレーション音声の解析',
  6: '音声ミックス準備',
  7: '音声ミックス生成',
  8: '映像エンコード準備',
  9: '映像生成中',
  10: 'ファイル最終化',
};

export interface ExportSessionDiagnostics {
  exportSessionId: string;
}

export interface ExportAudioSourceResolution {
  strategy: 'decode-audio-data' | 'media-element';
  reason: string;
  mimeType: string | null;
  extension: string | null;
}

export type ResolveExportAudioSource = (input: {
  fileName: string;
  mimeType: string | null;
}) => ExportAudioSourceResolution;

export interface ExportStrategyResolutionInput {
  isIosSafari: boolean;
  supportedMediaRecorderProfile: MediaRecorderProfile | null;
}

export type ResolveExportStrategyOrder = (
  input: ExportStrategyResolutionInput,
) => ExportStrategyId[];

/**
 * エクスポート用の音声ソース情報。
 * iOS Safari の OfflineAudioContext プリレンダリングに使用。
 */
export interface ExportAudioSources {
  mediaItems: MediaItem[];
  bgm: AudioTrack | null;
  narrations: NarrationClip[];
  totalDuration: number;
  onPreparationStepChange?: (step: ExportPreparationStep) => void;
  /**
   * 音声プリレンダリング完了時に呼ばれるコールバック。
   * iOS Safari では音声抽出にリアルタイムで動画再生が必要なため、
   * エクスポート用の再生ループ（loop）はこのコールバック後に開始する。
   * 音声プリレンダリングが不要な環境（PC/Android）では即座に呼ばれる。
   */
  onAudioPreRenderComplete?: () => void;
  /**
   * エクスポート再生ループの現在時刻（秒）を返す。
   * 映像フレーム供給数をタイムライン進行に追従させるために使用する。
   */
  getPlaybackTimeSec?: () => number;
}

export interface ExportCallbacks {
  onRecordingStop: (url: string, ext: string, result?: ExportRecordingResult) => void;
  onRecordingError?: (message: string) => void;
}

export interface ExportRecordingResult {
  source: 'media-recorder' | 'webcodecs';
  blobSizeBytes?: number;
  signalAborted?: boolean;
}

export interface ExportStateSetters {
  setExportUrl: Dispatch<SetStateAction<string | null>>;
  setExportExt: Dispatch<SetStateAction<string | null>>;
}

export interface ExportRecorderRefs {
  recorderRef: MutableRefObject<MediaRecorder | null>;
}

export interface PreRenderedRecorderAudioSource {
  stream: MediaStream;
  startPlayback: () => void;
  cleanup: () => void;
}

export interface IosSafariMediaRecorderStrategyContext {
  canvas: HTMLCanvasElement;
  masterDest: MediaStreamAudioDestinationNode;
  audioContext: AudioContext;
  signal: AbortSignal;
  audioSources?: ExportAudioSources;
  preRenderedAudio?: PreRenderedRecorderAudioSource | null;
  callbacks: ExportCallbacks;
  state: ExportStateSetters;
  refs: ExportRecorderRefs;
  exportConfig: {
    fps: number;
    videoBitrate: number;
  };
  supportedMediaRecorderProfile: MediaRecorderProfile | null;
  diagnostics?: ExportSessionDiagnostics;
}

export type MediaRecorderExportStrategyRunner = (
  context: IosSafariMediaRecorderStrategyContext,
) => Promise<boolean>;
