/**
 * @file captureFrameSettle.test.ts
 * @description キャプチャ前のフレーム確定待ち（waitForPreviewFrameSettled）の挙動テスト。
 *   シークで終端へ移動した直後に保存画像が 1 フレーム前になる問題への対策を検証する。
 */
import { describe, it, expect } from 'vitest';
import { waitForPreviewFrameSettled } from '../utils/canvas';

function makeVideo(seeking: boolean): HTMLVideoElement {
  const v = document.createElement('video');
  // jsdom の seeking は読み取り専用のため、テスト用に上書きする。
  Object.defineProperty(v, 'seeking', { value: seeking, configurable: true });
  return v;
}

describe('waitForPreviewFrameSettled', () => {
  it('シーク中の要素が無ければ素通りで解決する（通常再生で終端に来たケース）', async () => {
    const v = makeVideo(false);
    await expect(waitForPreviewFrameSettled({ v })).resolves.toBeUndefined();
  });

  it('シーク中なら seeked 完了まで解決を待つ', async () => {
    const v = makeVideo(true);
    const p = waitForPreviewFrameSettled({ v }, 5000);
    let resolved = false;
    void p.then(() => {
      resolved = true;
    });
    // seeked 前は解決しない
    await Promise.resolve();
    expect(resolved).toBe(false);
    // seeked 発火後に解決する
    v.dispatchEvent(new Event('seeked'));
    await expect(p).resolves.toBeUndefined();
  });

  it('seeked が来なくても timeout で解決する（フリーズ防止の保険）', async () => {
    const v = makeVideo(true);
    await expect(waitForPreviewFrameSettled({ v }, 30)).resolves.toBeUndefined();
  });

  it('画像・音声要素はシーク待ちの対象にしない', async () => {
    const img = document.createElement('img');
    const audio = document.createElement('audio');
    await expect(waitForPreviewFrameSettled({ img, audio })).resolves.toBeUndefined();
  });
});
