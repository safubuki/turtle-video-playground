import { describe, expect, it } from 'vitest';
import {
  alignExportDurationToFrameGrid,
  getExportFrameTiming,
  resolveExportCanvasFrameBurstCount,
  resolveNonIosExportTimelineTimeSec,
  resolveExportPlaybackTimeSec,
  resolveExportDuration,
} from '../utils/exportTimeline';
import { isCaptionActiveAtTime } from '../utils/captionTimeline';
import type { Caption } from '../types';

describe('resolveExportDuration', () => {
  it('raw timeline duration を exportDuration として一本化する', () => {
    expect(resolveExportDuration(2, 30)).toEqual({
      exportDurationSec: 2,
      exportDurationUs: 2_000_000,
      rawDurationSec: 2,
      rawDurationUs: 2_000_000,
      frameCount: 60,
      alignedDurationSec: 2,
      alignedDurationUs: 2_000_000,
      nominalFrameDurationUs: Math.round(1e6 / 30),
    });
  });
});

describe('alignExportDurationToFrameGrid', () => {
  it('フレーム境界ちょうどの尺はそのまま維持する', () => {
    expect(alignExportDurationToFrameGrid(2, 30)).toEqual({
      rawDurationSec: 2,
      rawDurationUs: 2_000_000,
      frameCount: 60,
      alignedDurationSec: 2,
      alignedDurationUs: 2_000_000,
    });
  });

  it('フレーム境界に乗らない尺は切り上げて動画と音声の終端を一致させる', () => {
    const aligned = alignExportDurationToFrameGrid(10.01, 30);

    expect(aligned.rawDurationSec).toBe(10.01);
    expect(aligned.rawDurationUs).toBe(10_010_000);
    expect(aligned.frameCount).toBe(301);
    expect(aligned.alignedDurationSec).toBeCloseTo(301 / 30, 10);
    expect(aligned.alignedDurationUs).toBe(Math.round((301 / 30) * 1e6));
  });

  it('浮動小数の誤差で余計な1フレームを増やさない', () => {
    const aligned = alignExportDurationToFrameGrid(60 / 30 + 1e-12, 30);

    expect(aligned.frameCount).toBe(60);
    expect(aligned.alignedDurationSec).toBe(2);
  });

  it('不正な入力はゼロ尺として扱う', () => {
    expect(alignExportDurationToFrameGrid(-1, 30).frameCount).toBe(0);
    expect(alignExportDurationToFrameGrid(10, 0).alignedDurationSec).toBe(0);
  });

  it('最終フレームだけを短くして総尺を元のタイムラインへ一致させる', () => {
    const resolved = resolveExportDuration(10.01, 30);
    const lastFrameIndex = resolved.frameCount - 1;
    const penultimate = getExportFrameTiming(resolved, 30, lastFrameIndex - 1);
    const last = getExportFrameTiming(resolved, 30, lastFrameIndex);

    expect(penultimate.timestampUs + penultimate.durationUs).toBe(last.timestampUs);
    expect(last.timestampUs + last.durationUs).toBe(resolved.exportDurationUs);
    expect(last.durationUs).toBeLessThanOrEqual(Math.round(1e6 / 30));
    expect(last.durationUs).toBeGreaterThan(0);
  });
});

describe('resolveExportPlaybackTimeSec', () => {
  it('非 iOS export では描画済みフレーム時刻を優先する', () => {
    expect(
      resolveExportPlaybackTimeSec(1, 2 / 3, true),
    ).toBeCloseTo(2 / 3, 10);
  });

  it('描画済み時刻が不正な場合は currentTime へフォールバックする', () => {
    expect(resolveExportPlaybackTimeSec(1, Number.NaN, true)).toBe(1);
  });

  it('iOS export では従来どおり currentTime を使う', () => {
    expect(resolveExportPlaybackTimeSec(1.5, 1, false)).toBe(1.5);
  });

  it('負値は 0 秒へ正規化する', () => {
    expect(resolveExportPlaybackTimeSec(-1, Number.NaN, false)).toBe(0);
  });
});

describe('resolveNonIosExportTimelineTimeSec', () => {
  it('advances at most one frame beyond the last rendered frame', () => {
    expect(
      resolveNonIosExportTimelineTimeSec({
        elapsedSec: 0.101,
        lastRenderedPlaybackTimeSec: 1 / 30,
        fps: 30,
      }),
    ).toBeCloseTo(2 / 30, 10);
  });

  it('uses the snapped wall-clock time while it stays within one frame', () => {
    expect(
      resolveNonIosExportTimelineTimeSec({
        elapsedSec: 0.064,
        lastRenderedPlaybackTimeSec: 1 / 30,
        fps: 30,
      }),
    ).toBeCloseTo(1 / 30, 10);

    expect(
      resolveNonIosExportTimelineTimeSec({
        elapsedSec: 0.068,
        lastRenderedPlaybackTimeSec: 1 / 30,
        fps: 30,
      }),
    ).toBeCloseTo(2 / 30, 10);
  });

  it('does not move backward when the wall clock lags behind the rendered frame', () => {
    expect(
      resolveNonIosExportTimelineTimeSec({
        elapsedSec: 0.01,
        lastRenderedPlaybackTimeSec: 0.5,
        fps: 30,
      }),
    ).toBeCloseTo(0.5, 10);
  });
});

describe('resolveExportCanvasFrameBurstCount', () => {
  it('encodes at most one canvas frame per poll even if multiple frames are pending', () => {
    expect(
      resolveExportCanvasFrameBurstCount({
        pendingFrameCount: 4,
      }),
    ).toBe(1);
  });

  it('returns zero when there is no pending frame', () => {
    expect(
      resolveExportCanvasFrameBurstCount({
        pendingFrameCount: 0,
      }),
    ).toBe(0);
  });

  it('normalizes invalid pending counts to zero', () => {
    expect(
      resolveExportCanvasFrameBurstCount({
        pendingFrameCount: Number.NaN,
      }),
    ).toBe(0);
  });
});

describe('isCaptionActiveAtTime', () => {
  const caption: Caption = {
    id: 'cap-1',
    text: 'caption',
    startTime: 1.0,
    endTime: 2.0,
    fadeIn: false,
    fadeOut: false,
    fadeInDuration: 0.5,
    fadeOutDuration: 0.5,
  };

  it('caption の開始を含み終了を含まない区間判定を行う', () => {
    expect(isCaptionActiveAtTime(caption, 0.999)).toBe(false);
    expect(isCaptionActiveAtTime(caption, 1.000)).toBe(true);
    expect(isCaptionActiveAtTime(caption, 1.033)).toBe(true);
    expect(isCaptionActiveAtTime(caption, 1.999)).toBe(true);
    expect(isCaptionActiveAtTime(caption, 2.000)).toBe(false);
  });

  it('export frame timestamp 由来の時刻でも同じ判定になる', () => {
    const alignment = resolveExportDuration(3, 30);

    const before = getExportFrameTiming(alignment, 30, 29).timestampUs / 1e6;
    const firstActiveFrameIndex = Array.from({ length: alignment.frameCount }).findIndex((_, frameIndex) => {
      const timeSec = getExportFrameTiming(alignment, 30, frameIndex).timestampUs / 1e6;
      return isCaptionActiveAtTime(caption, timeSec);
    });
    const firstInactiveAfterActiveFrameIndex = Array.from({ length: alignment.frameCount }).findIndex((_, frameIndex) => {
      if (frameIndex <= firstActiveFrameIndex) return false;
      const timeSec = getExportFrameTiming(alignment, 30, frameIndex).timestampUs / 1e6;
      return !isCaptionActiveAtTime(caption, timeSec);
    });

    const atStart = getExportFrameTiming(alignment, 30, firstActiveFrameIndex).timestampUs / 1e6;
    const nearEnd = getExportFrameTiming(alignment, 30, firstInactiveAfterActiveFrameIndex - 1).timestampUs / 1e6;
    const atEnd = getExportFrameTiming(alignment, 30, firstInactiveAfterActiveFrameIndex).timestampUs / 1e6;

    expect(isCaptionActiveAtTime(caption, before)).toBe(false);
    expect(firstActiveFrameIndex).toBeGreaterThan(0);
    expect(isCaptionActiveAtTime(caption, atStart)).toBe(true);
    expect(isCaptionActiveAtTime(caption, nearEnd)).toBe(true);
    expect(isCaptionActiveAtTime(caption, atEnd)).toBe(false);
  });
});
