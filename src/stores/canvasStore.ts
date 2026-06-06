/**
 * @file canvasStore.ts
 * @author Turtle Village
 * @description プレビュー / エクスポートのキャンバスサイズを管理するストア。
 *
 * プレビューは描画負荷を抑えるため上限 1280×720 とする。
 * 書き出し時のみ、ソース動画の解像度に応じて 1920×1080 まで動的に拡大する。
 * 横向き固定とし、縦長ソースは既定サイズへフォールバックする。
 */
import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import {
  DEFAULT_CANVAS_WIDTH,
  DEFAULT_CANVAS_HEIGHT,
  MAX_CANVAS_WIDTH,
  MAX_CANVAS_HEIGHT,
  MAX_PREVIEW_CANVAS_WIDTH,
  MAX_PREVIEW_CANVAS_HEIGHT,
} from '../constants';

interface CanvasState {
  /** 現在キャンバス要素が取るサイズ（プレビュー時は preview*、エクスポート時は export*）。 */
  width: number;
  height: number;
  /** プレビュー専用のサイズ（軽量描画用、上限 1280×720）。 */
  previewWidth: number;
  previewHeight: number;
  /** 書き出し時のキャンバスサイズ（最大 1920×1080）。 */
  exportWidth: number;
  exportHeight: number;
  /** 現在エクスポートモードか。プレビューサイズへの自動戻しに使う。 */
  isExportMode: boolean;
  /** ソース動画の解像度を入力し、プレビュー/エクスポート両方のサイズを更新する。 */
  applyFromSource: (sourceWidth: number, sourceHeight: number) => void;
  /** ストアを既定状態へ戻す。 */
  resetCanvasSize: () => void;
  /** 書き出し開始時に呼び出し、キャンバスを高解像度モードへ切り替える。 */
  beginExportMode: () => void;
  /** 書き出し終了時に呼び出し、プレビューサイズへ戻す。 */
  endExportMode: () => void;
}

/**
 * ソースサイズと最大サイズから、横向き固定でキャンバスサイズを算出する。
 *
 * - 縦長ソース（height > width）はフォールバックとして既定 16:9 サイズへ戻す。
 * - 横長ソースはアスペクト比を保ったまま max{Width,Height} へ収まるよう縮小する。
 * - H.264 の都合により幅・高さは偶数に丸める。
 */
export function computeCanvasSizeFromSource(
  sourceWidth: number,
  sourceHeight: number,
  maxWidth: number = MAX_CANVAS_WIDTH,
  maxHeight: number = MAX_CANVAS_HEIGHT,
): { width: number; height: number } {
  if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight)
    || sourceWidth <= 0 || sourceHeight <= 0) {
    return fallbackLandscape(maxWidth, maxHeight);
  }
  if (sourceHeight > sourceWidth) {
    return fallbackLandscape(maxWidth, maxHeight);
  }
  if (sourceWidth <= maxWidth && sourceHeight <= maxHeight) {
    return {
      width: roundToEven(sourceWidth),
      height: roundToEven(sourceHeight),
    };
  }
  const scale = Math.min(maxWidth / sourceWidth, maxHeight / sourceHeight);
  return {
    width: roundToEven(sourceWidth * scale),
    height: roundToEven(sourceHeight * scale),
  };
}

function fallbackLandscape(maxWidth: number, maxHeight: number): { width: number; height: number } {
  // 既定の 16:9 を最大枠に収める
  const targetAspect = 16 / 9;
  const widthByHeight = roundToEven(maxHeight * targetAspect);
  if (widthByHeight <= maxWidth) {
    return { width: widthByHeight, height: roundToEven(maxHeight) };
  }
  return {
    width: roundToEven(maxWidth),
    height: roundToEven(maxWidth / targetAspect),
  };
}

function roundToEven(value: number): number {
  const rounded = Math.round(value);
  return rounded % 2 === 0 ? rounded : rounded + 1;
}

export const useCanvasStore = create<CanvasState>()(
  devtools((set, get) => ({
    width: DEFAULT_CANVAS_WIDTH,
    height: DEFAULT_CANVAS_HEIGHT,
    previewWidth: DEFAULT_CANVAS_WIDTH,
    previewHeight: DEFAULT_CANVAS_HEIGHT,
    exportWidth: MAX_CANVAS_WIDTH,
    exportHeight: MAX_CANVAS_HEIGHT,
    isExportMode: false,
    applyFromSource: (sourceWidth, sourceHeight) => {
      const previewSize = computeCanvasSizeFromSource(
        sourceWidth,
        sourceHeight,
        MAX_PREVIEW_CANVAS_WIDTH,
        MAX_PREVIEW_CANVAS_HEIGHT,
      );
      const exportSize = computeCanvasSizeFromSource(
        sourceWidth,
        sourceHeight,
        MAX_CANVAS_WIDTH,
        MAX_CANVAS_HEIGHT,
      );
      const isExportMode = get().isExportMode;
      set({
        previewWidth: previewSize.width,
        previewHeight: previewSize.height,
        exportWidth: exportSize.width,
        exportHeight: exportSize.height,
        width: isExportMode ? exportSize.width : previewSize.width,
        height: isExportMode ? exportSize.height : previewSize.height,
      });
    },
    resetCanvasSize: () => set({
      width: DEFAULT_CANVAS_WIDTH,
      height: DEFAULT_CANVAS_HEIGHT,
      previewWidth: DEFAULT_CANVAS_WIDTH,
      previewHeight: DEFAULT_CANVAS_HEIGHT,
      exportWidth: MAX_CANVAS_WIDTH,
      exportHeight: MAX_CANVAS_HEIGHT,
      isExportMode: false,
    }),
    beginExportMode: () => {
      const { exportWidth, exportHeight } = get();
      set({
        isExportMode: true,
        width: exportWidth,
        height: exportHeight,
      });
    },
    endExportMode: () => {
      const { previewWidth, previewHeight } = get();
      set({
        isExportMode: false,
        width: previewWidth,
        height: previewHeight,
      });
    },
  })),
);
