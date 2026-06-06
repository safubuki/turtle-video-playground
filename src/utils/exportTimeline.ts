export interface ExportTimelineAlignment {
  rawDurationSec: number;
  rawDurationUs: number;
  frameCount: number;
  alignedDurationSec: number;
  alignedDurationUs: number;
}

export interface ResolvedExportDuration extends ExportTimelineAlignment {
  exportDurationSec: number;
  exportDurationUs: number;
  nominalFrameDurationUs: number;
}

export interface ExportFrameTiming {
  timestampUs: number;
  durationUs: number;
}

export interface NonIosExportTimelineTimeInput {
  elapsedSec: number;
  lastRenderedPlaybackTimeSec: number;
  fps: number;
}

export interface ExportCanvasFrameBurstInput {
  pendingFrameCount: number;
}

const DURATION_EPSILON = 1e-9;

function sanitizePlaybackTimeSec(timeSec: number): number | null {
  if (!Number.isFinite(timeSec)) return null;
  // export の初期化や停止境界で未初期化値を拾っても安全側へ倒せるよう、
  // フレーム供給用の時刻は 0 以上に正規化して扱う。
  return Math.max(0, timeSec);
}

function isResolvedExportDuration(
  alignment: ExportTimelineAlignment | ResolvedExportDuration,
): alignment is ResolvedExportDuration {
  return 'exportDurationUs' in alignment && 'nominalFrameDurationUs' in alignment;
}

export function resolveExportDuration(
  totalDurationSec: number,
  fps: number,
): ResolvedExportDuration {
  const safeDurationSec = Number.isFinite(totalDurationSec) && totalDurationSec > 0 ? totalDurationSec : 0;
  const safeFps = Number.isFinite(fps) && fps > 0 ? fps : 0;

  if (safeDurationSec <= 0 || safeFps <= 0) {
    return {
      exportDurationSec: safeDurationSec,
      exportDurationUs: 0,
      rawDurationSec: safeDurationSec,
      rawDurationUs: 0,
      frameCount: 0,
      alignedDurationSec: 0,
      alignedDurationUs: 0,
      nominalFrameDurationUs: 0,
    };
  }

  const exportDurationUs = Math.max(0, Math.round(safeDurationSec * 1e6));
  const rawFrameCount = safeDurationSec * safeFps;
  const frameCount = Math.max(1, Math.ceil(rawFrameCount - DURATION_EPSILON));
  const alignedDurationSec = frameCount / safeFps;
  const alignedDurationUs = Math.max(0, Math.round(alignedDurationSec * 1e6));
  const nominalFrameDurationUs = Math.max(1, Math.round(alignedDurationUs / frameCount));

  return {
    exportDurationSec: safeDurationSec,
    exportDurationUs,
    rawDurationSec: safeDurationSec,
    rawDurationUs: exportDurationUs,
    frameCount,
    alignedDurationSec,
    alignedDurationUs,
    nominalFrameDurationUs,
  };
}

export function alignExportDurationToFrameGrid(
  totalDurationSec: number,
  fps: number,
): ExportTimelineAlignment {
  const resolved = resolveExportDuration(totalDurationSec, fps);

  return {
    rawDurationSec: resolved.rawDurationSec,
    rawDurationUs: resolved.rawDurationUs,
    frameCount: resolved.frameCount,
    alignedDurationSec: resolved.alignedDurationSec,
    alignedDurationUs: resolved.alignedDurationUs,
  };
}

export function getExportFrameTiming(
  alignment: ExportTimelineAlignment | ResolvedExportDuration,
  fps: number,
  frameIndex: number,
): ExportFrameTiming {
  const safeFps = Number.isFinite(fps) && fps > 0 ? fps : 0;
  if (alignment.frameCount <= 0 || safeFps <= 0 || frameIndex < 0 || frameIndex >= alignment.frameCount) {
    return {
      timestampUs: 0,
      durationUs: 0,
    };
  }

  const nominalFrameDurationUs = isResolvedExportDuration(alignment) && alignment.nominalFrameDurationUs > 0
    ? alignment.nominalFrameDurationUs
    : Math.max(1, Math.round(1e6 / safeFps));
  const exportDurationUs = isResolvedExportDuration(alignment)
    ? alignment.exportDurationUs
    : alignment.rawDurationUs;
  const timestampUs = Math.max(0, Math.round(frameIndex * nominalFrameDurationUs));
  const isLastFrame = frameIndex === alignment.frameCount - 1;
  const nextBoundaryUs = isLastFrame
    ? exportDurationUs
    : Math.max(timestampUs, Math.round((frameIndex + 1) * nominalFrameDurationUs));

  return {
    timestampUs,
    durationUs: Math.max(1, nextBoundaryUs - timestampUs),
  };
}

export function resolveExportPlaybackTimeSec(
  currentPlaybackTimeSec: number,
  lastRenderedPlaybackTimeSec: number,
  preferRenderedPlaybackTime: boolean,
): number {
  const preferred = preferRenderedPlaybackTime
    ? lastRenderedPlaybackTimeSec
    : currentPlaybackTimeSec;
  const sanitizedPreferred = sanitizePlaybackTimeSec(preferred);
  if (sanitizedPreferred !== null) {
    return sanitizedPreferred;
  }

  const fallback = preferRenderedPlaybackTime
    ? currentPlaybackTimeSec
    : lastRenderedPlaybackTimeSec;
  const sanitizedFallback = sanitizePlaybackTimeSec(fallback);
  if (sanitizedFallback !== null) {
    return sanitizedFallback;
  }

  return 0;
}

export function resolveNonIosExportTimelineTimeSec(
  input: NonIosExportTimelineTimeInput,
): number {
  const safeElapsedSec = sanitizePlaybackTimeSec(input.elapsedSec) ?? 0;
  const safeFps = Number.isFinite(input.fps) && input.fps > 0 ? input.fps : 30;
  const frameDurationSec = 1 / safeFps;
  const snappedElapsedSec = Math.floor(safeElapsedSec / frameDurationSec) * frameDurationSec;
  const safeLastRenderedSec = sanitizePlaybackTimeSec(input.lastRenderedPlaybackTimeSec);

  if (safeLastRenderedSec === null) {
    return snappedElapsedSec;
  }

  const maxAdvancedElapsedSec = safeLastRenderedSec + frameDurationSec;
  return Math.max(
    safeLastRenderedSec,
    Math.min(snappedElapsedSec, maxAdvancedElapsedSec),
  );
}

export function resolveExportCanvasFrameBurstCount(
  input: ExportCanvasFrameBurstInput,
): number {
  if (!Number.isFinite(input.pendingFrameCount)) {
    return 0;
  }

  const safePendingFrameCount = Math.max(0, Math.floor(input.pendingFrameCount));
  if (safePendingFrameCount <= 0) {
    return 0;
  }

  return 1;
}
