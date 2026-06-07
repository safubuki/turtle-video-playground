/**
 * @file canvas.ts
 * @author Turtle Village
 * @description Canvasへの画像・動画の描画、サイズ計算、クリア処理などを行うユーティリティ関数群。
 */

import { CANVAS_WIDTH, CANVAS_HEIGHT } from '../constants';

/**
 * Canvasをクリア（黒で塗りつぶし）
 * @param ctx - CanvasRenderingContext2D
 */
export function clearCanvas(ctx: CanvasRenderingContext2D): void {
  ctx.globalAlpha = 1.0;
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
}

/**
 * メディア要素のサイズを取得
 * @param element - ビデオまたは画像要素
 * @returns { width, height } または null
 */
export function getMediaDimensions(
  element: HTMLVideoElement | HTMLImageElement
): { width: number; height: number } | null {
  if (element instanceof HTMLVideoElement) {
    const w = element.videoWidth;
    const h = element.videoHeight;
    if (w && h) return { width: w, height: h };
  } else if (element instanceof HTMLImageElement) {
    const w = element.naturalWidth;
    const h = element.naturalHeight;
    if (w && h) return { width: w, height: h };
  }
  return null;
}

/**
 * フィットするスケールを計算
 * @param elementWidth - 要素の幅
 * @param elementHeight - 要素の高さ
 * @param canvasWidth - Canvasの幅
 * @param canvasHeight - Canvasの高さ
 * @returns スケール値
 */
export function calculateFitScale(
  elementWidth: number,
  elementHeight: number,
  canvasWidth: number = CANVAS_WIDTH,
  canvasHeight: number = CANVAS_HEIGHT
): number {
  return Math.min(canvasWidth / elementWidth, canvasHeight / elementHeight);
}

/**
 * フェードアルファ値を計算（線形補間）
 *
 * 一般的な動画編集ソフトと同様、フェード期間中の経過時間にアルファ値を比例させる。
 * イージング曲線 (smoothstep など) は一見滑らかに見えても、開始/終了付近のアルファ変化が
 * 知覚できないほど小さくなり「フェードが始まらない / 終わらない」印象を与えるため、
 * プレビューでは線形が最も自然に映る。
 *
 * @param localTime - ローカル再生時間
 * @param duration - 総再生時間
 * @param fadeIn - フェードイン有効
 * @param fadeOut - フェードアウト有効
 * @param fadeDuration - フェード時間（秒）
 * @returns アルファ値 (0〜1)
 */
export function calculateFadeAlpha(
  localTime: number,
  duration: number,
  fadeIn: boolean,
  fadeOut: boolean,
  fadeDuration: number = 1.0
): number {
  let alpha = 1.0;

  if (fadeIn && localTime < fadeDuration) {
    alpha = localTime / fadeDuration;
  } else if (fadeOut && localTime > duration - fadeDuration) {
    alpha = (duration - localTime) / fadeDuration;
  }

  return Math.max(0, Math.min(1, alpha));
}

/**
 * メディア要素をCanvas中央に描画
 * @param ctx - CanvasRenderingContext2D
 * @param element - 描画するビデオまたは画像要素
 * @param options - 描画オプション
 */
export function drawMediaCentered(
  ctx: CanvasRenderingContext2D,
  element: HTMLVideoElement | HTMLImageElement,
  options: {
    scale?: number;
    offsetX?: number;
    offsetY?: number;
    alpha?: number;
  } = {}
): void {
  const { scale = 1.0, offsetX = 0, offsetY = 0, alpha = 1.0 } = options;

  const dims = getMediaDimensions(element);
  if (!dims) return;

  const baseScale = calculateFitScale(dims.width, dims.height);

  ctx.save();
  ctx.translate(CANVAS_WIDTH / 2 + offsetX, CANVAS_HEIGHT / 2 + offsetY);
  ctx.scale(baseScale * scale, baseScale * scale);
  ctx.globalAlpha = alpha;
  ctx.drawImage(element, -dims.width / 2, -dims.height / 2, dims.width, dims.height);
  ctx.restore();
  ctx.globalAlpha = 1.0;
}

/**
 * メディア要素が描画可能か判定
 * @param element - ビデオまたは画像要素
 * @returns 描画可能ならtrue
 */
export function isMediaReady(element: HTMLVideoElement | HTMLImageElement): boolean {
  if (element instanceof HTMLVideoElement) {
    return element.readyState >= 1;
  } else if (element instanceof HTMLImageElement) {
    return element.complete;
  }
  return false;
}

/**
 * ビデオの現在時間を安全に設定
 * @param video - ビデオ要素
 * @param time - 設定する時間
 * @param maxDuration - 最大長さ
 */
export function safeSetVideoTime(
  video: HTMLVideoElement,
  time: number,
  maxDuration?: number
): void {
  const max = maxDuration ?? video.duration;
  if (Number.isFinite(time) && Number.isFinite(max)) {
    video.currentTime = Math.max(0, Math.min(max, time));
  }
}

export interface CaptionGlyphOptions {
  text: string;
  font: string;
  fillColor: string;
  strokeColor: string;
  strokeWidth: number;
}

/**
 * キャプション文字（stroke + fill）を 1 枚のオフスクリーン Canvas に描画して返す。
 * 呼び出し側はこの Canvas を `drawImage` でメインキャンバスに転写するだけで済むため、
 * フェード時に stroke と fill が二重にアルファ合成されて「輪郭だけ残る」現象を防げる。
 *
 * 文字幅は呼び出し前に `font` を設定した一時 Canvas で計測する。
 * ストローク太さや句読点による descenders を含めるため左右上下に余白を確保する。
 */
export function createCaptionGlyphCanvas(options: CaptionGlyphOptions): HTMLCanvasElement {
  const { text, font, fillColor, strokeColor, strokeWidth } = options;

  const measureCanvas = document.createElement('canvas');
  const measureCtx = measureCanvas.getContext('2d');
  if (!measureCtx) {
    measureCanvas.width = 1;
    measureCanvas.height = 1;
    return measureCanvas;
  }
  measureCtx.font = font;
  measureCtx.textBaseline = 'middle';
  const metrics = measureCtx.measureText(text);

  // フォントサイズを font 文字列から推定（フォールバック）
  const fontSizeMatch = /(\d+(?:\.\d+)?)px/.exec(font);
  const inferredFontSize = fontSizeMatch ? parseFloat(fontSizeMatch[1]) : 48;

  const ascent = Number.isFinite(metrics.actualBoundingBoxAscent)
    ? metrics.actualBoundingBoxAscent
    : inferredFontSize * 0.8;
  const descent = Number.isFinite(metrics.actualBoundingBoxDescent)
    ? metrics.actualBoundingBoxDescent
    : inferredFontSize * 0.3;

  // strokeWidth はキャプション設定値で、描画時には *2 した lineWidth を使う。
  // ストロークは線の中心を境に内外に広がるため、片側で strokeWidth 分のはみ出しが起きる。
  // 加えてアンチエイリアスの余白として数 px 確保する。
  const paddingX = Math.ceil(strokeWidth * 2 + 8);
  const paddingY = Math.ceil(strokeWidth * 2 + 8);
  const width = Math.max(1, Math.ceil(metrics.width) + paddingX * 2);
  const height = Math.max(1, Math.ceil(ascent + descent) + paddingY * 2);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';

  const centerX = width / 2;
  const centerY = height / 2;

  // stroke を先に描き、その上に fill を載せる。オフスクリーン内では globalAlpha=1.0 のため
  // stroke と fill が二重合成される問題は起きず、外側ストロークと内側塗りが想定通り重なる。
  if (strokeWidth > 0) {
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = strokeWidth * 2;
    ctx.strokeText(text, centerX, centerY);
  }
  ctx.fillStyle = fillColor;
  ctx.fillText(text, centerX, centerY);

  return canvas;
}

/**
 * キャプチャ前に、プレビューフレームが確定するのを待つ。
 *
 * シークバーで終端などへ移動した直後は、video 要素のデコード済みフレームが
 * 目標時刻に追いつく前にキャンバスへ描画され得る。この状態でキャプチャすると
 * 「画面に見えているフレーム」と「保存画像」がずれ、1 フレーム前が保存される。
 *
 * 対策として、進行中のシーク（`seeking`）が `seeked` で完了するのを待ち、
 * さらにエンジンの再描画（requestAnimationFrame ベース）が走るのを待ってから
 * キャンバスを読み取ることで、画面に見えている確定フレームと一致させる。
 *
 * 通常再生で終端に達した場合は `seeking` 中の要素が無いため、ほぼ素通りする
 * （従来挙動を維持）。`timeoutMs` は、`seeked` が来ない／デコードが極端に遅い
 * 場合でも固まらないための保険。
 *
 * @param mediaElements - id をキーにしたメディア要素のレコード
 * @param timeoutMs - 確定待ちの上限（既定 400ms）
 */
export function waitForPreviewFrameSettled(
  mediaElements: Record<string, HTMLVideoElement | HTMLImageElement | HTMLAudioElement>,
  timeoutMs = 400,
): Promise<void> {
  const seekingVideos = Object.values(mediaElements).filter(
    (el): el is HTMLVideoElement => el instanceof HTMLVideoElement && el.seeking,
  );

  const waitSeeked: Promise<void> =
    seekingVideos.length === 0
      ? Promise.resolve()
      : Promise.all(
          seekingVideos.map(
            (video) =>
              new Promise<void>((resolve) => {
                const onSeeked = () => {
                  video.removeEventListener('seeked', onSeeked);
                  resolve();
                };
                video.addEventListener('seeked', onSeeked, { once: true });
              }),
          ),
        ).then(() => undefined);

  const settled = waitSeeked.then(
    () =>
      new Promise<void>((resolve) => {
        // seeked 後、エンジンの再描画（rAF）が走ってキャンバスが更新されるのを待つ。
        if (typeof requestAnimationFrame === 'function') {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        } else {
          resolve();
        }
      }),
  );

  const timeout = new Promise<void>((resolve) => setTimeout(resolve, timeoutMs));
  return Promise.race([settled, timeout]);
}

/**
 * Canvasの現在の内容をキャプチャしてPNG画像としてダウンロードする
 * @param canvas - キャプチャ対象のCanvas要素
 * @param filename - 保存ファイル名（拡張子なし）。未指定時はタイムスタンプベースの名前を生成
 * @returns ダウンロードが成功したらtrue、失敗したらfalse
 */
export function captureCanvasAsImage(
  canvas: HTMLCanvasElement,
  filename?: string
): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const name = filename || `turtle_capture_${Date.now()}`;
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            resolve(false);
            return;
          }
          const url = URL.createObjectURL(blob);
          try {
            const a = document.createElement('a');
            a.href = url;
            a.download = `${name}.png`;
            a.style.display = 'none';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            resolve(true);
          } finally {
            // ObjectURL を確実に解放
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          }
        },
        'image/png'
      );
    } catch {
      resolve(false);
    }
  });
}
