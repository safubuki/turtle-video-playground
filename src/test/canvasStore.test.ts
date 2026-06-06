/**
 * @file canvasStore.test.ts
 * @description Tests for dynamic canvas size resolution and computed export bitrate.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useCanvasStore, computeCanvasSizeFromSource } from '../stores/canvasStore';
import {
  computeExportVideoBitrate,
  DEFAULT_CANVAS_WIDTH,
  DEFAULT_CANVAS_HEIGHT,
  MAX_CANVAS_WIDTH,
  MAX_CANVAS_HEIGHT,
  MAX_PREVIEW_CANVAS_WIDTH,
  MAX_PREVIEW_CANVAS_HEIGHT,
  EXPORT_VIDEO_BITRATE,
  EXPORT_VIDEO_BITRATE_MIN,
} from '../constants';

describe('computeCanvasSizeFromSource', () => {
  it('returns landscape fallback when source dimensions are invalid', () => {
    const fallback = computeCanvasSizeFromSource(0, 0);
    expect(fallback.width).toBe(MAX_CANVAS_WIDTH);
    expect(fallback.height).toBe(MAX_CANVAS_HEIGHT);
    const nanFallback = computeCanvasSizeFromSource(NaN, 720);
    expect(nanFallback.width).toBe(MAX_CANVAS_WIDTH);
    expect(nanFallback.height).toBe(MAX_CANVAS_HEIGHT);
  });

  it('uses source dimensions when within cap (landscape)', () => {
    expect(computeCanvasSizeFromSource(1280, 720)).toEqual({
      width: 1280,
      height: 720,
    });
    expect(computeCanvasSizeFromSource(854, 480)).toEqual({
      width: 854,
      height: 480,
    });
  });

  it('caps source dimensions to 1920x1080 maintaining aspect ratio (export cap)', () => {
    expect(computeCanvasSizeFromSource(3840, 2160)).toEqual({
      width: 1920,
      height: 1080,
    });
    expect(computeCanvasSizeFromSource(1920, 1080)).toEqual({
      width: 1920,
      height: 1080,
    });
  });

  it('falls back to landscape default for portrait sources (landscape-only policy)', () => {
    const result = computeCanvasSizeFromSource(1080, 1920);
    expect(result.width).toBe(MAX_CANVAS_WIDTH);
    expect(result.height).toBe(MAX_CANVAS_HEIGHT);
  });

  it('preserves non-16:9 landscape aspect ratios', () => {
    expect(computeCanvasSizeFromSource(1024, 768)).toEqual({
      width: 1024,
      height: 768,
    });
  });

  it('caps preview at 1280x720 when given preview limits', () => {
    const result = computeCanvasSizeFromSource(
      1920,
      1080,
      MAX_PREVIEW_CANVAS_WIDTH,
      MAX_PREVIEW_CANVAS_HEIGHT,
    );
    expect(result.width).toBe(1280);
    expect(result.height).toBe(720);
  });

  it('produces even width/height values (H.264 requirement)', () => {
    const result = computeCanvasSizeFromSource(1919, 1079);
    expect(result.width % 2).toBe(0);
    expect(result.height % 2).toBe(0);
  });
});

describe('useCanvasStore', () => {
  beforeEach(() => {
    useCanvasStore.getState().resetCanvasSize();
  });

  it('defaults to preview size 1280x720 with separate export cap of 1920x1080', () => {
    const state = useCanvasStore.getState();
    expect(state.width).toBe(DEFAULT_CANVAS_WIDTH);
    expect(state.height).toBe(DEFAULT_CANVAS_HEIGHT);
    expect(state.previewWidth).toBe(MAX_PREVIEW_CANVAS_WIDTH);
    expect(state.previewHeight).toBe(MAX_PREVIEW_CANVAS_HEIGHT);
    expect(state.exportWidth).toBe(MAX_CANVAS_WIDTH);
    expect(state.exportHeight).toBe(MAX_CANVAS_HEIGHT);
    expect(state.isExportMode).toBe(false);
  });

  it('applyFromSource updates both preview and export sizes independently', () => {
    useCanvasStore.getState().applyFromSource(1920, 1080);
    const state = useCanvasStore.getState();
    expect(state.previewWidth).toBe(1280);
    expect(state.previewHeight).toBe(720);
    expect(state.exportWidth).toBe(1920);
    expect(state.exportHeight).toBe(1080);
    // current visible size is preview while not in export mode
    expect(state.width).toBe(1280);
    expect(state.height).toBe(720);
  });

  it('beginExportMode switches current size to export dimensions', () => {
    useCanvasStore.getState().applyFromSource(1920, 1080);
    useCanvasStore.getState().beginExportMode();
    const state = useCanvasStore.getState();
    expect(state.isExportMode).toBe(true);
    expect(state.width).toBe(1920);
    expect(state.height).toBe(1080);
  });

  it('endExportMode restores preview dimensions', () => {
    useCanvasStore.getState().applyFromSource(1920, 1080);
    useCanvasStore.getState().beginExportMode();
    useCanvasStore.getState().endExportMode();
    const state = useCanvasStore.getState();
    expect(state.isExportMode).toBe(false);
    expect(state.width).toBe(1280);
    expect(state.height).toBe(720);
  });

  it('resetCanvasSize returns to defaults and exits export mode', () => {
    useCanvasStore.getState().applyFromSource(1920, 1080);
    useCanvasStore.getState().beginExportMode();
    useCanvasStore.getState().resetCanvasSize();
    const state = useCanvasStore.getState();
    expect(state.isExportMode).toBe(false);
    expect(state.width).toBe(DEFAULT_CANVAS_WIDTH);
    expect(state.height).toBe(DEFAULT_CANVAS_HEIGHT);
  });
});

describe('computeExportVideoBitrate', () => {
  it('returns max 12 Mbps at 1920x1080', () => {
    expect(computeExportVideoBitrate(1920, 1080)).toBe(EXPORT_VIDEO_BITRATE);
  });

  it('scales down proportionally for smaller resolutions but respects min', () => {
    const bitrate = computeExportVideoBitrate(1280, 720);
    expect(bitrate).toBeGreaterThanOrEqual(EXPORT_VIDEO_BITRATE_MIN);
    expect(bitrate).toBeLessThanOrEqual(EXPORT_VIDEO_BITRATE);
  });

  it('does not go below the minimum (6 Mbps)', () => {
    expect(computeExportVideoBitrate(640, 360)).toBe(EXPORT_VIDEO_BITRATE_MIN);
  });

  it('returns max bitrate for invalid dimensions', () => {
    expect(computeExportVideoBitrate(0, 0)).toBe(EXPORT_VIDEO_BITRATE);
  });
});
