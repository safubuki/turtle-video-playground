import { describe, expect, it } from 'vitest';
import {
  resolveWebCodecsAudioCaptureStrategy,
  shouldUseOfflineAudioPreRender,
} from '../hooks/export-strategies/exportStrategyResolver';

describe('resolveWebCodecsAudioCaptureStrategy', () => {
  it('オフライン音声が完了していれば追加の音声キャプチャを行わない', () => {
    expect(
      resolveWebCodecsAudioCaptureStrategy({
        offlineAudioDone: true,
        isIosSafari: false,
        hasLiveAudioTrack: true,
        canUseTrackProcessor: true,
      })
    ).toBe('pre-rendered');
  });

  it('非 iOS かつ TrackProcessor 対応時は TrackProcessor を選ぶ', () => {
    expect(
      resolveWebCodecsAudioCaptureStrategy({
        offlineAudioDone: false,
        isIosSafari: false,
        hasLiveAudioTrack: true,
        canUseTrackProcessor: true,
      })
    ).toBe('track-processor');
  });
  it('非 iOS でも audio track が live でなければ TrackProcessor を選ばない', () => {
    expect(
      resolveWebCodecsAudioCaptureStrategy({
        offlineAudioDone: false,
        isIosSafari: false,
        hasLiveAudioTrack: false,
        canUseTrackProcessor: true,
      })
    ).toBe('script-processor');
  });

  it('iOS Safari では ScriptProcessor フォールバックを維持する', () => {
    expect(
      resolveWebCodecsAudioCaptureStrategy({
        offlineAudioDone: false,
        isIosSafari: true,
        hasLiveAudioTrack: true,
        canUseTrackProcessor: true,
      })
    ).toBe('script-processor');
  });

  it('非 iOS でも音声トラックまたは TrackProcessor が無ければ ScriptProcessor を選ぶ', () => {
    expect(
      resolveWebCodecsAudioCaptureStrategy({
        offlineAudioDone: false,
        isIosSafari: false,
        hasLiveAudioTrack: false,
        canUseTrackProcessor: true,
      })
    ).toBe('script-processor');
  });
});

describe('shouldUseOfflineAudioPreRender', () => {
  it('iOS Safari かつ音声ソースありのときは OfflineAudioContext を使う', () => {
    expect(
      shouldUseOfflineAudioPreRender({
        hasAudioSources: true,
        isIosSafari: true,
      })
    ).toBe(true);
  });

  it('iOS Safari では live でない track でも事前プリレンダリングを維持する', () => {
    expect(
      shouldUseOfflineAudioPreRender({
        hasAudioSources: true,
        isIosSafari: true,
      })
    ).toBe(true);
  });

  it('非iOS でも音声ソースありなら事前プリレンダリングを使う', () => {
    expect(
      shouldUseOfflineAudioPreRender({
        hasAudioSources: true,
        isIosSafari: false,
      })
    ).toBe(true);
  });

  it('非iOS では TrackProcessor 有無に関係なく事前プリレンダリングを使う', () => {
    expect(
      shouldUseOfflineAudioPreRender({
        hasAudioSources: true,
        isIosSafari: false,
      })
    ).toBe(true);
  });

  it('非iOS で live track があっても事前プリレンダリングを優先する', () => {
    expect(
      shouldUseOfflineAudioPreRender({
        hasAudioSources: true,
        isIosSafari: false,
      })
    ).toBe(true);
  });

  it('iOS Safari でも音声ソースが無ければ OfflineAudioContext を使わない', () => {
    expect(
      shouldUseOfflineAudioPreRender({
        hasAudioSources: false,
        isIosSafari: true,
      })
    ).toBe(false);
  });

  it('非iOS でも音声ソースが無ければ OfflineAudioContext を使わない', () => {
    expect(
      shouldUseOfflineAudioPreRender({
        hasAudioSources: false,
        isIosSafari: false,
      })
    ).toBe(false);
  });
});
