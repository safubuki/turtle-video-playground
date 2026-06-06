/**
 * @file canvasStore.ts
 * @author Turtle Village
 * @description プレビュー / エクスポートのキャンバスサイズを管理するストア。
 *
 * プレビューは描画負荷を抑えるため上限 1280×720 とする。
 * 書き出し時のみ、ソース動画の解像度に応じて 1920×1080 まで動的に拡大する。
 * 出力アスペクト比は常に 16:9 に固定し（先頭動画の比率に引きずられない）、
 * 16:9 でない横長ソースは黒帯付きで内包する。縦長ソースは既定サイズへフォールバックする。
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
 * ソースサイズと最大サイズから、常に 16:9 のキャンバスサイズを算出する。
 *
 * - 出力アスペクト比は常に 16:9 に固定する（先頭動画の比率に引きずられない）。
 * - 解像度は可変。ソースを縮小せず内包できる最小の 16:9 枠を採り、品質を保つ。
 *   - 16:9 より縦長（例 1204×764, 1024×768）のソースは、高さを基準に左右へ広げる
 *     （プレビュー/書き出しで左右が黒帯になり、拡大機能で押し出せる）。
 *   - 16:9 より横長（例 シネスコ）のソースは、幅を基準に上下へ広げる（上下が黒帯）。
 * - max{Width,Height} を超える場合のみ 16:9 を保ったまま縮小する。
 * - 縦長ソース（height > width）・無効値は既定の 16:9（最大枠）へフォールバックする。
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

  const targetAspect = 16 / 9;
  const sourceAspect = sourceWidth / sourceHeight;

  // ソースを縮小せずに内包できる 16:9 枠を求める（元解像度を維持し、黒帯で 16:9 へ整える）。
  let width: number;
  let height: number;
  if (sourceAspect >= targetAspect) {
    // 16:9 と同じか横長のソース → 幅が基準（上下が黒帯）。
    width = sourceWidth;
    height = width / targetAspect;
  } else {
    // 16:9 より縦長のソース → 高さが基準（左右が黒帯）。
    height = sourceHeight;
    width = height * targetAspect;
  }

  // 最大枠を超える場合のみ、16:9 を保ったまま縮小する。
  const scale = Math.min(1, maxWidth / width, maxHeight / height);
  return {
    width: roundToEven(width * scale),
    height: roundToEven(height * scale),
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
