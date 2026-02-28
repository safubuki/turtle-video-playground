/**
 * @file ClipThumbnail.tsx
 * @author Turtle Village
 * @description メディアクリップのサムネイルを表示する軽量コンポーネント。
 * 画像はそのまま、動画は先頭フレームをキャプチャして表示する。
 */
import React, { useRef, useEffect, useState } from 'react';

interface ClipThumbnailProps {
  file: File;
  type: 'video' | 'image';
}

const THUMB_WIDTH = 48;
const THUMB_HEIGHT = 28;
const VIDEO_FRAME_WAIT_MS = 80;
const VIDEO_DRAW_RETRY_COUNT = 4;

type FrameAwareVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: (...args: unknown[]) => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

/**
 * クリップサムネイルコンポーネント
 * ヘッダー付近にメディアの小さなプレビューを表示する
 */
const ClipThumbnail: React.FC<ClipThumbnailProps> = ({ file, type }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    setReady(false);

    let cancelled = false;
    const timeoutIds = new Set<number>();

    const registerTimeout = (id: number): number => {
      timeoutIds.add(id);
      return id;
    };

    const clearAllTimeouts = () => {
      timeoutIds.forEach((id) => window.clearTimeout(id));
      timeoutIds.clear();
    };

    const url = URL.createObjectURL(file);
    urlRef.current = url;

    const revokeUrl = () => {
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
    };

    const wait = (ms: number): Promise<void> =>
      new Promise((resolve) => {
        const timeoutId = registerTimeout(window.setTimeout(() => {
          timeoutIds.delete(timeoutId);
          resolve();
        }, ms));
      });

    const waitForEvent = (
      target: EventTarget,
      eventName: string,
      timeoutMs: number
    ): Promise<boolean> =>
      new Promise((resolve) => {
        if (cancelled) {
          resolve(false);
          return;
        }

        let settled = false;
        const onEvent = () => finish(true);
        const finish = (result: boolean) => {
          if (settled) return;
          settled = true;
          target.removeEventListener(eventName, onEvent as EventListener);
          window.clearTimeout(timeoutId);
          timeoutIds.delete(timeoutId);
          resolve(result);
        };

        const timeoutId = registerTimeout(window.setTimeout(() => finish(false), timeoutMs));
        target.addEventListener(eventName, onEvent as EventListener, { once: true });
      });

    const drawCentered = (
      source: CanvasImageSource,
      sourceWidth: number,
      sourceHeight: number
    ): boolean => {
      if (sourceWidth <= 0 || sourceHeight <= 0) return false;

      const scale = Math.min(THUMB_WIDTH / sourceWidth, THUMB_HEIGHT / sourceHeight);
      const w = sourceWidth * scale;
      const h = sourceHeight * scale;

      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, THUMB_WIDTH, THUMB_HEIGHT);

      try {
        ctx.drawImage(source, (THUMB_WIDTH - w) / 2, (THUMB_HEIGHT - h) / 2, w, h);
        return true;
      } catch {
        return false;
      }
    };

    const drawVideoFallback = () => {
      ctx.fillStyle = '#1f2937';
      ctx.fillRect(0, 0, THUMB_WIDTH, THUMB_HEIGHT);
      ctx.fillStyle = '#9ca3af';
      ctx.beginPath();
      ctx.moveTo(19, 8);
      ctx.lineTo(19, 20);
      ctx.lineTo(30, 14);
      ctx.closePath();
      ctx.fill();
    };

    const waitForDecodedFrame = async (video: FrameAwareVideo): Promise<void> => {
      if (cancelled) return;

      if (typeof video.requestVideoFrameCallback === 'function') {
        await new Promise<void>((resolve) => {
          let settled = false;
          const finish = () => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timeoutId);
            timeoutIds.delete(timeoutId);
            resolve();
          };

          const callbackId = video.requestVideoFrameCallback?.(() => finish());
          const timeoutId = registerTimeout(window.setTimeout(() => {
            if (typeof callbackId === 'number' && typeof video.cancelVideoFrameCallback === 'function') {
              video.cancelVideoFrameCallback(callbackId);
            }
            finish();
          }, VIDEO_FRAME_WAIT_MS));
        });
        return;
      }

      await wait(VIDEO_FRAME_WAIT_MS);
    };

    const seekVideo = async (video: HTMLVideoElement, time: number): Promise<void> => {
      if (cancelled) return;

      const safeTime = Number.isFinite(time) ? Math.max(0, time) : 0;
      const needsSeek = Math.abs(video.currentTime - safeTime) > 0.03;
      if (!needsSeek) return;

      const seekPromise = waitForEvent(video, 'seeked', 1500);
      try {
        video.currentTime = safeTime;
        await seekPromise;
      } catch {
        // シーク失敗時は次の候補時刻へフォールバック
      }
    };

    const buildSeekCandidates = (duration: number): number[] => {
      if (!Number.isFinite(duration) || duration <= 0) return [0];

      const maxSeek = Math.max(0, duration - 0.05);
      const head = Math.min(1, duration * 0.1, maxSeek);
      const middle = Math.min(duration * 0.5, maxSeek);

      return Array.from(new Set([head, 0, middle].map((value) => Math.max(0, value))));
    };

    if (type === 'image') {
      const img = new Image();
      img.onload = () => {
        if (cancelled) return;
        drawCentered(img, img.naturalWidth, img.naturalHeight);
        setReady(true);
        revokeUrl();
      };
      img.onerror = () => {
        if (cancelled) return;
        drawVideoFallback();
        setReady(true);
        revokeUrl();
      };
      img.src = url;
    } else {
      const loadVideoThumbnail = async () => {
        const video = document.createElement('video') as FrameAwareVideo;
        video.muted = true;
        video.preload = 'auto';
        video.playsInline = true;
        video.src = url;

        const loadedMetadata = video.readyState >= 1 || await waitForEvent(video, 'loadedmetadata', 3000);
        if (!loadedMetadata || cancelled) {
          if (!cancelled) {
            drawVideoFallback();
            setReady(true);
          }
          revokeUrl();
          return;
        }

        const seekCandidates = buildSeekCandidates(video.duration);
        let captured = false;

        for (const seekTime of seekCandidates) {
          if (cancelled) break;

          await seekVideo(video, seekTime);

          if (video.readyState < 2) {
            await waitForEvent(video, 'loadeddata', 800);
          }

          await waitForDecodedFrame(video);

          for (let retry = 0; retry < VIDEO_DRAW_RETRY_COUNT; retry++) {
            if (cancelled) break;
            if (drawCentered(video, video.videoWidth, video.videoHeight)) {
              captured = true;
              break;
            }
            await wait(60);
          }

          if (captured) break;
        }

        if (!cancelled) {
          if (!captured) {
            drawVideoFallback();
          }
          setReady(true);
        }
        revokeUrl();
      };

      void loadVideoThumbnail();
    }

    return () => {
      cancelled = true;
      clearAllTimeouts();
      revokeUrl();
    };
  }, [file, type]);

  return (
    <canvas
      ref={canvasRef}
      width={THUMB_WIDTH}
      height={THUMB_HEIGHT}
      className={`rounded shrink-0 border border-gray-600/50 ${ready ? 'opacity-100' : 'opacity-0'}`}
      style={{ width: THUMB_WIDTH, height: THUMB_HEIGHT }}
    />
  );
};

export default React.memo(ClipThumbnail);
