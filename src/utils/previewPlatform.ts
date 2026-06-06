/**
 * @file previewPlatform.ts
 * @description プレビュー再生に関わるブラウザ差分ポリシーを集約する utility。
 * `TurtleVideo.tsx` 側では個別の iOS 判定を持たず、このポリシーを参照して
 * 同期しきい値、caption blur fallback、AudioContext 復帰方針を決める。
 */

import type { PlatformCapabilities } from './platform';
import { resolveIosSafariSingleMixedAudio } from './iosSafariAudio';

export interface PreviewPlatformPolicy {
  previewSyncThresholdSec: number;
  exportSyncThresholdSec: number;
  exportFallbackSyncThresholdSec: number;
  needsCaptionBlurFallback: boolean;
  muteNativeMediaWhenAudioRouted: boolean;
  muteNativeMediaDuringExportWhenAudioRouted: boolean;
  reinitializeAudioRouteOnPlay: boolean;
  resumeAudioContextOnVisibilityReturn: boolean;
  visibilityRecoveryDebounceMs: number;
  audioContextResumeRetryCount: number;
}

export interface VisibilityRecoveryPlan {
  shouldKeepRunning: boolean;
  shouldResyncMedia: boolean;
  shouldDelayAudioResume: boolean;
}

export interface PageHidePausePlan {
  shouldPauseMediaElements: boolean;
}

export type PreviewAudioOutputMode = 'native' | 'webaudio';

export interface PreviewAudioRoutingCandidate {
  id: string;
  hasAudioNode: boolean;
  desiredVolume: number;
  sourceType?: 'video' | 'audio';
}

export interface PreviewAudioRoutingDecision extends PreviewAudioRoutingCandidate {
  audibleSourceCount: number;
  outputMode: PreviewAudioOutputMode;
}

export interface PreviewBundledStartOptions {
  hasActiveVideo: boolean;
  audibleSourceCount: number;
  requiresWebAudio: boolean;
}

export interface PreviewAudioProbeTimelineItem {
  type: 'video' | 'image';
  duration: number;
}

export interface VideoClipEndGuardOptions {
  clipLocalTime: number;
  clipDuration: number;
  trimStart: number;
  videoCurrentTime: number;
  videoEnded: boolean;
  isExporting?: boolean;
  isIosSafari?: boolean;
  isLastTimelineItem?: boolean;
  nextItemType?: 'video' | 'image' | null;
  fps?: number;
  clipEndGuardWindowSec?: number;
  videoEndToleranceSec?: number;
}


export interface FadeTailBlackoutGuardOptions {
  clipLocalTime: number;
  clipDuration: number;
  fadeOut: boolean;
  fadeOutDuration: number;
  blackoutAlphaThreshold?: number;
  minBlackoutWindowSec?: number;
  maxBlackoutWindowSec?: number;
}

export interface ExportImageToVideoStabilizationOptions {
  isExporting: boolean;
  isAndroid: boolean;
  activeItemType: 'video' | 'image' | null;
  previousItemType: 'video' | 'image' | null;
  clipLocalTime: number;
  stabilizationWindowSec?: number;
}

export interface ExportImageToVideoFrameHoldOptions extends ExportImageToVideoStabilizationOptions {
  /** HTMLMediaElement.readyState (0-4)。2=HAVE_CURRENT_DATA を描画可能ラインとみなす。 */
  videoReadyState: HTMLMediaElement['readyState'];
  /** currentTime 補正直後など、描画対象フレームが未確定な seeking 状態か。 */
  isVideoSeeking: boolean;
  /** 判定時点の video.currentTime。 */
  videoCurrentTime: number;
  /** このフレームで描くべき targetTime。 */
  targetTime: number;
  /** currentTime 補正が必要とみなす許容誤差。既定値は 0.004 秒。 */
  syncToleranceSec?: number;
}

export interface AndroidPreviewVideoRecoveryOptions {
  isAndroid: boolean;
  isExporting: boolean;
  isActivePlaying: boolean;
  isUserSeeking: boolean;
  videoPaused: boolean;
  videoSeeking: boolean;
  videoReadyState: number;
  readyStateFloor?: number;
}

// HTMLMediaElement.HAVE_CURRENT_DATA 相当。現在フレームを canvas 描画に使える最小 readyState。
const MIN_VIDEO_READY_STATE_FOR_CURRENT_FRAME: HTMLMediaElement['readyState'] =
  typeof HTMLMediaElement !== 'undefined'
    ? HTMLMediaElement.HAVE_CURRENT_DATA
    : 2;
export const EXPORT_IMAGE_TO_VIDEO_STABILIZATION_SYNC_TOLERANCE_SEC = 0.004;

/**
 * プラットフォーム capability から、プレビュー制御用の方針を組み立てる。
 */
export function getPreviewPlatformPolicy(
  capabilities: Pick<PlatformCapabilities, 'isIosSafari' | 'isAndroid' | 'audioContextMayInterrupt'>,
): PreviewPlatformPolicy {
  return {
    previewSyncThresholdSec: capabilities.isIosSafari ? 1.0 : 0.5,
    exportSyncThresholdSec: capabilities.isIosSafari ? 1.2 : 0.5,
    exportFallbackSyncThresholdSec: 0.35,
    needsCaptionBlurFallback: capabilities.isIosSafari,
    muteNativeMediaWhenAudioRouted: capabilities.isIosSafari,
    muteNativeMediaDuringExportWhenAudioRouted: capabilities.isIosSafari || capabilities.isAndroid,
    reinitializeAudioRouteOnPlay: capabilities.isIosSafari,
    resumeAudioContextOnVisibilityReturn: true,
    visibilityRecoveryDebounceMs: 120,
    // 既存実装は全ブラウザで最大2回まで resume を試みていたため、その挙動を維持する。
    audioContextResumeRetryCount: 2,
  };
}

/**
 * 通常プレビュー/エクスポート/フォールバックの状況から、動画同期しきい値を返す。
 */
export function getPreviewVideoSyncThreshold(
  policy: PreviewPlatformPolicy,
  options: { isExporting: boolean; hasExportPlayFailure: boolean },
): number {
  if (options.isExporting) {
    return options.hasExportPlayFailure
      ? policy.exportFallbackSyncThresholdSec
      : policy.exportSyncThresholdSec;
  }

  return policy.previewSyncThresholdSec;
}

/**
 * iOS Safari 向けの caption blur fallback 描画が必要かを返す。
 */
export function shouldUseCaptionBlurFallback(
  policy: PreviewPlatformPolicy,
  blurStrength: number,
): boolean {
  return policy.needsCaptionBlurFallback && blurStrength > 0;
}

/**
 * WebAudio 経路が確立した要素について、ネイティブ音声出力をミュートすべきかを返す。
 */
export function shouldMuteNativeMediaElement(
  policy: PreviewPlatformPolicy,
  options: {
    hasAudioNode: boolean;
    isExporting: boolean;
  },
): boolean {
  if (!options.hasAudioNode) {
    return false;
  }

  return options.isExporting
    ? policy.muteNativeMediaDuringExportWhenAudioRouted
    : policy.muteNativeMediaWhenAudioRouted;
}

/**
 * iOS Safari preview で inactive video を無音再生のまま維持すべきかを返す。
 * 通過済み video は止め、future/current だけを prewarm 対象として残す。
 */
export function shouldKeepInactiveVideoPrewarmed(
  policy: PreviewPlatformPolicy,
  options: {
    hasAudioNode: boolean;
    isExporting: boolean;
    isActivePlaying: boolean;
    timeSinceVideoEndSec: number | null;
    timeUntilVideoStartSec?: number | null;
    pauseGraceSec?: number;
    prewarmLeadSec?: number;
    isNearestFutureVideo?: boolean;
    allowExtendedFuturePrewarm?: boolean;
  },
): boolean {
  const pauseGraceSec = options.pauseGraceSec ?? 0.25;
  const prewarmLeadSec = options.prewarmLeadSec ?? 0.35;
  const shouldAllowExtendedFuturePrewarm =
    options.allowExtendedFuturePrewarm
    && options.isNearestFutureVideo
    && options.timeUntilVideoStartSec !== null
    && options.timeUntilVideoStartSec !== undefined
    && options.timeUntilVideoStartSec >= 0;
  const isPastVideoBeyondGrace =
    options.timeSinceVideoEndSec !== null
    && options.timeSinceVideoEndSec >= pauseGraceSec;
  const isFutureVideoTooFar =
    options.timeUntilVideoStartSec !== null
    && options.timeUntilVideoStartSec !== undefined
    && options.timeUntilVideoStartSec > prewarmLeadSec
    && !shouldAllowExtendedFuturePrewarm;

  return options.hasAudioNode
    && policy.muteNativeMediaWhenAudioRouted
    && !options.isExporting
    && options.isActivePlaying
    && !isFutureVideoTooFar
    && !isPastVideoBeyondGrace;
}

/**
 * iOS Safari preview で WebAudio 済み inactive video を pause せず維持するかを返す。
 * pause -> play サイクルが AudioSession を壊すケースを避けるため、iOS preview だけ分離する。
 */
export function shouldAvoidPauseInactiveVideoInPreview(
  policy: PreviewPlatformPolicy,
  options: {
    hasAudioNode: boolean;
    isExporting: boolean;
    isActivePlaying: boolean;
  },
): boolean {
  return options.hasAudioNode
    && policy.muteNativeMediaWhenAudioRouted
    && !options.isExporting
    && options.isActivePlaying;
}

/**
 * iOS Safari preview で future video の silent prewarm を開始すべきかを返す。
 * 画像ギャップ中の次動画は active 化前に play しておき、切替時の AudioSession 破壊を避ける。
 */
export function shouldPrimeFutureInactiveVideoInPreview(
  policy: PreviewPlatformPolicy,
  options: {
    hasAudioNode: boolean;
    isExporting: boolean;
    isActivePlaying: boolean;
    shouldKeepVideoPrewarmed: boolean;
    timeUntilVideoStartSec?: number | null;
  },
): boolean {
  const isFutureVideo =
    options.timeUntilVideoStartSec !== null
    && options.timeUntilVideoStartSec !== undefined
    && options.timeUntilVideoStartSec >= 0;

  return options.shouldKeepVideoPrewarmed
    && isFutureVideo
    && shouldAvoidPauseInactiveVideoInPreview(policy, {
      hasAudioNode: options.hasAudioNode,
      isExporting: options.isExporting,
      isActivePlaying: options.isActivePlaying,
    });
}

/**
 * iOS Safari preview では単一音源時のみ native 出力へ逃がし、複数同時再生時は WebAudio mix を使う。
 */
/**
 * iOS Safari preview では stop 復帰時に stopAll を先に済ませ、AudioSession を作り直してから再生を始める。
 */
export function shouldStopBeforePreviewAudioRouteInit(
  policy: PreviewPlatformPolicy,
  options: { isExporting: boolean },
): boolean {
  return policy.muteNativeMediaWhenAudioRouted && !options.isExporting;
}

/**
 * iOS Safari preview で video -> image 境界直後に audio-only を再 prime すべきかを返す。
 */
export function shouldRecoverAudioOnlyAfterVideoBoundary(
  policy: PreviewPlatformPolicy,
  options: {
    hasAudioNode: boolean;
    isExporting: boolean;
    isActivePlaying: boolean;
    timeSinceVideoEndSec: number | null;
    recoveryWindowSec?: number;
  },
): boolean {
  const recoveryWindowSec = options.recoveryWindowSec ?? 0.08;
  return options.hasAudioNode
    && policy.muteNativeMediaWhenAudioRouted
    && !options.isExporting
    && options.isActivePlaying
    && options.timeSinceVideoEndSec !== null
    && options.timeSinceVideoEndSec >= 0
    && options.timeSinceVideoEndSec <= recoveryWindowSec;
}

/**
 * iOS Safari preview で先頭が静止画のときは audio-only の prime が開始条件になる。
 * stop 復帰直後は seek/readyState の競合で最初の prime を取りこぼすことがあるため、
 * ループ開始直前に 1 回だけ再 prime する。
 */
export function shouldRetryAudioOnlyPrimeAtPreviewStart(
  policy: PreviewPlatformPolicy,
  options: {
    isExporting: boolean;
    hasActiveVideo: boolean;
    requiresWebAudio: boolean;
  },
): boolean {
  return policy.muteNativeMediaWhenAudioRouted
    && !options.isExporting
    && !options.hasActiveVideo
    && options.requiresWebAudio;
}

export function getPreviewAudioOutputMode(
  policy: PreviewPlatformPolicy,
  options: {
    hasAudioNode: boolean;
    isExporting: boolean;
    audibleSourceCount: number;
    desiredVolume: number;
    sourceType?: 'video' | 'audio';
  },
): PreviewAudioOutputMode {
  if (!policy.muteNativeMediaWhenAudioRouted) {
    return 'webaudio';
  }

  const iosSafariSingleMixDecision = resolveIosSafariSingleMixedAudio({
    isIosSafari: policy.muteNativeMediaWhenAudioRouted,
    isExporting: options.isExporting,
    audibleSourceCount: options.audibleSourceCount,
    sourceType: options.sourceType,
  });

  if (iosSafariSingleMixDecision.shouldUseSingleMixedAudio) {
    return 'webaudio';
  }

  if (options.hasAudioNode) {
    // 混在区間を抜けて単独動画に戻った場合は native を優先する。
    // 呼び出し元は outputMode が native のとき不要な AudioNode を切り離す。
    // ただし iOS Safari (muteNativeMediaWhenAudioRouted) では
    // createMediaElementSource() が1要素に対して1回しか呼べないため、
    // detach 後に再接続できない。iOS Safari では常に webaudio を維持する。
    if (
      !policy.muteNativeMediaWhenAudioRouted
      && !options.isExporting
      && options.sourceType === 'video'
      && options.audibleSourceCount <= 1
    ) {
      return 'native';
    }
    return 'webaudio';
  }

  if (options.sourceType === 'audio' && !options.isExporting) {
    return 'webaudio';
  }

  if (!options.isExporting && options.sourceType === 'video') {
    return 'native';
  }

  if (Math.abs(options.desiredVolume - 1) > 0.001) {
    return 'webaudio';
  }

  if (!options.isExporting && options.audibleSourceCount <= 1) {
    return 'native';
  }

  return 'webaudio';
}

/**
 * 同一フレームで可聴な preview 音源群に対する出力モードをまとめて判定する。
 */
export function getPreviewAudioRoutingPlan(
  policy: PreviewPlatformPolicy,
  options: {
    isExporting: boolean;
    candidates: PreviewAudioRoutingCandidate[];
  },
): PreviewAudioRoutingDecision[] {
  const audibleSourceCount = options.candidates.reduce(
    (count, candidate) => count + (candidate.desiredVolume > 0 ? 1 : 0),
    0,
  );

  return options.candidates.map((candidate) => {
    const candidateAudibleSourceCount = candidate.desiredVolume > 0 ? audibleSourceCount : 0;
    return {
      id: candidate.id,
      hasAudioNode: candidate.hasAudioNode,
      desiredVolume: candidate.desiredVolume,
      audibleSourceCount: candidateAudibleSourceCount,
      outputMode: getPreviewAudioOutputMode(policy, {
        hasAudioNode: candidate.hasAudioNode,
        isExporting: options.isExporting,
        audibleSourceCount: candidateAudibleSourceCount,
        desiredVolume: candidate.desiredVolume,
        sourceType: candidate.sourceType,
      }),
    };
  });
}

/**
 * iOS Safari preview で、可聴な音声専用トラックを先に起動し、
 * 動画は最後に開始した方が安定するケースかを返す。
 */
export function shouldBundlePreviewStartForWebAudioMix(
  policy: PreviewPlatformPolicy,
  options: PreviewBundledStartOptions,
): boolean {
  return policy.muteNativeMediaWhenAudioRouted
    && options.hasActiveVideo
    && options.requiresWebAudio
    && options.audibleSourceCount > 1;
}

/**
 * export 中の画像 -> 動画切替直前だけ、次の video を muted のまま短時間 warm-up するかを判定する。
 * MediaRecorder/live export で境界時の play() 立ち上がり遅延を抑える目的。
 */

/**
 * iOS Safari preview で将来の動画開始点だけを事前評価するための probe time を返す。
 * 単独動画 native fallback を壊さないよう、開始直後の少し先だけを warm-up 対象にする。
 */
export function getFutureVideoAudioProbeTimes(
  items: PreviewAudioProbeTimelineItem[],
  fromTime: number,
): number[] {
  const probeTimes: number[] = [];
  let cursor = 0;

  for (const item of items) {
    const startTime = cursor;
    const duration = Math.max(0, item.duration);
    cursor += duration;

    if (item.type !== 'video' || duration <= 0.001) {
      continue;
    }

    if (startTime <= fromTime + 0.0005) {
      continue;
    }

    const probeOffset = duration <= 0.1 ? duration / 2 : 0.05;
    probeTimes.push(startTime + probeOffset);
  }

  return probeTimes;
}

/**
 * クリップ終端直前に ended 済み動画を再始動すると position 0 へ巻き戻るため、
 * その瞬間だけ最終フレーム保持へ倒す。
 */
export function shouldHoldVideoFrameAtClipEnd(
  options: VideoClipEndGuardOptions,
): boolean {
  const clipDuration = Math.max(0, options.clipDuration);
  if (clipDuration <= 0) {
    return false;
  }

  const clipEndGuardWindowSec = options.clipEndGuardWindowSec ?? 0.2;
  const videoEndToleranceSec = options.videoEndToleranceSec ?? 0.05;
  const remainingClipTime = Math.max(0, clipDuration - Math.max(0, options.clipLocalTime));
  if (remainingClipTime > clipEndGuardWindowSec) {
    return false;
  }

  const safeClipEndTime = options.trimStart + Math.max(0, clipDuration - 0.001);
  // PC / Android export では、途中クリップ終端の hold が
  // requestAnimationFrame ベースの export 時刻停止を誘発しやすい。
  // ただし video -> video 境界だけは、切替瞬間の単発黒フレームを避けるため
  // 1 フレーム近傍の最小 hold を許可する。
  if (options.isExporting && !options.isIosSafari && !options.isLastTimelineItem) {
    if (options.nextItemType !== 'video') {
      return false;
    }

    const safeFps = Number.isFinite(options.fps) && (options.fps ?? 0) > 0
      ? (options.fps as number)
      : 30;
    const videoTransitionGuardWindowSec = Math.min(clipEndGuardWindowSec, 1 / safeFps);
    if (remainingClipTime > videoTransitionGuardWindowSec) {
      return false;
    }

    // 黒フレーム防止に必要な pre-hold は残しつつ、2 フレーム重複を減らすため
    // currentTime ベースの near-end 判定は半フレームぶんまで縮める。
    const transitionVideoEndToleranceSec = Math.min(videoEndToleranceSec, 0.5 / safeFps);
    return options.videoEnded
      || options.videoCurrentTime >= safeClipEndTime - transitionVideoEndToleranceSec;
  }

  return options.videoEnded || options.videoCurrentTime >= safeClipEndTime - videoEndToleranceSec;
}

/**
 * フェードアウト終端で動画フレームを保持すると、低頻度で「黒へ落ち切る直前の最終フレーム」が残留する。
 * ほぼ黒になるはずの tail では holdFrame より黒クリアを優先すべきかを返す。
 */
export function shouldBlackoutVideoFadeTail(
  options: FadeTailBlackoutGuardOptions,
): boolean {
  if (!options.fadeOut) {
    return false;
  }

  const clipDuration = Math.max(0, options.clipDuration);
  const fadeOutDuration = Math.max(0, options.fadeOutDuration);
  if (clipDuration <= 0 || fadeOutDuration <= 0) {
    return false;
  }

  const remainingClipTime = Math.max(0, clipDuration - Math.max(0, options.clipLocalTime));
  const blackoutAlphaThreshold = options.blackoutAlphaThreshold ?? 0.05;
  const minBlackoutWindowSec = options.minBlackoutWindowSec ?? (1 / 60);
  const maxBlackoutWindowSec = options.maxBlackoutWindowSec ?? 0.5;
  const alphaDerivedWindowSec = fadeOutDuration * blackoutAlphaThreshold;
  const blackoutWindowSec = Math.min(
    maxBlackoutWindowSec,
    Math.max(minBlackoutWindowSec, alphaDerivedWindowSec),
  );

  return remainingClipTime <= blackoutWindowSec;
}

/**
 * Android export で「画像 -> 動画」の直後は、デコーダが前クリップの状態から
 * 立ち上がる途中に `play()`/sync が競合しやすい。短い安定化ウィンドウだけ
 * 動画を時刻同期優先で扱うための判定を返す。
 */
export function shouldStabilizeImageToVideoTransitionDuringExport(
  options: ExportImageToVideoStabilizationOptions,
): boolean {
  if (!options.isExporting || !options.isAndroid) {
    return false;
  }

  if (options.activeItemType !== 'video' || options.previousItemType !== 'image') {
    return false;
  }

  const stabilizationWindowSec = options.stabilizationWindowSec ?? 0.12;
  if (!Number.isFinite(stabilizationWindowSec) || stabilizationWindowSec <= 0) {
    return false;
  }

  return options.clipLocalTime >= 0 && options.clipLocalTime <= stabilizationWindowSec;
}

/**
 * 画像→動画の export 切り替え直後、プリウォーム済み動画が一見 ready に見えても、
 * 直後の currentTime 補正で seeking に入るとそのフレームは描画できない。
 * この瞬間だけ前フレーム保持へ倒し、黒クリアのちらつきを防ぐ。
 * なお、この保持は既存の安定化ウィンドウ内に限定し、ウィンドウ終了までに
 * 同期が完了する前提で使う。安定化後は通常の hasFrame / needsCorrection 判定へ戻す。
 */
export function shouldHoldFrameForImageToVideoExportTransition(
  options: ExportImageToVideoFrameHoldOptions,
): boolean {
  if (!shouldStabilizeImageToVideoTransitionDuringExport(options)) {
    return false;
  }

  // 既存の export 安定化処理が `abs(video.currentTime - targetTime) > 0.004`
  // で currentTime 補正を入れるため、この保持判定も同じ既定値に揃える。
  // こうしておくと「このフレームで seek 補正が入って描画不能になるか」と
  // 「前フレーム保持が必要か」の境界が一致し、過保持や保持漏れを防げる。
  const syncToleranceSec =
    options.syncToleranceSec ?? EXPORT_IMAGE_TO_VIDEO_STABILIZATION_SYNC_TOLERANCE_SEC;
  const isVideoNotReady =
    options.videoReadyState < MIN_VIDEO_READY_STATE_FOR_CURRENT_FRAME;
  const isVideoFrameSeeking = options.isVideoSeeking;
  const needsTimeCorrection =
    Math.abs(options.videoCurrentTime - options.targetTime) > syncToleranceSec;

  return isVideoNotReady || isVideoFrameSeeking || needsTimeCorrection;
}

/**
 * 可視復帰時に AudioContext の resume を試みるべきかを返す。
 */
export function shouldResumeAudioContextOnVisibilityReturn(
  policy: PreviewPlatformPolicy,
  state: AudioContextState | 'interrupted',
): boolean {
  return policy.resumeAudioContextOnVisibilityReturn && state !== 'running';
}

/**
 * 非同期の canplay/seeked 復帰で play() を実行してよいかを判定する。
 * 古い再生試行や seek 中の遅延イベントが、後から割り込んで play() しないようにする。
 */
export function shouldAttemptDeferredPreviewPlay(options: {
  isCurrentAttempt: boolean;
  isPlaying: boolean;
  isSeeking: boolean;
  mediaSeeking: boolean;
  readyState: number;
  minReadyState?: number;
}): boolean {
  const minReadyState = options.minReadyState ?? 1;
  return options.isCurrentAttempt
    && options.isPlaying
    && !options.isSeeking
    && !options.mediaSeeking
    && options.readyState >= minReadyState;
}

/**
 * 再生開始時に AudioContext の経路再初期化が必要かを返す。
 */
export function shouldReinitializeAudioRoute(
  policy: PreviewPlatformPolicy,
  isExportMode: boolean,
): boolean {
  return policy.reinitializeAudioRouteOnPlay && !isExportMode;
}

/**
 * 可視復帰時に、再生状態を維持するか・メディア同期を取り直すかを判定する。
 * blur / hidden / pageshow の発火順は環境依存のため、復帰契機が取れた場合は
 * 「実行中だったか」と「非アクティブ経由か」をまとめて判定する。
 */
export function getVisibilityRecoveryPlan(options: {
  resumedFromHidden: boolean;
  needsResyncFromLifecycle: boolean;
  isPlaying: boolean;
  isProcessing: boolean;
}): VisibilityRecoveryPlan {
  const shouldKeepRunning = options.isPlaying || options.isProcessing;

  return {
    shouldKeepRunning,
    shouldResyncMedia: shouldKeepRunning && (options.resumedFromHidden || options.needsResyncFromLifecycle),
    shouldDelayAudioResume: shouldKeepRunning && options.resumedFromHidden,
  };
}

/**
 * `pagehide` が `visibilitychange(hidden)` より先に来る環境では、
 * export を止める前に入力メディアだけ pause すると黒フレーム/無音の原因になる。
 * 通常 preview は停止してよいが、export 中は hidden 側の停止契機へ委ねる。
 */
export function getPageHidePausePlan(options: {
  isProcessing: boolean;
}): PageHidePausePlan {
  return {
    shouldPauseMediaElements: !options.isProcessing,
  };
}

export function shouldRecoverAndroidPreviewVideoPlayback(
  options: AndroidPreviewVideoRecoveryOptions,
): boolean {
  if (!options.isAndroid || options.isExporting) return false;
  if (!options.isActivePlaying || options.isUserSeeking) return false;

  const readyStateFloor = options.readyStateFloor ?? MIN_VIDEO_READY_STATE_FOR_CURRENT_FRAME;
  return options.videoPaused || options.videoSeeking || options.videoReadyState < readyStateFloor;
}
