export interface OfflineAudioPreRenderResolutionInput {
  hasAudioSources: boolean;
  isIosSafari: boolean;
}

export function shouldUseOfflineAudioPreRender(
  input: OfflineAudioPreRenderResolutionInput
): boolean {
  return input.hasAudioSources;
}

export type WebCodecsAudioCaptureStrategy = 'pre-rendered' | 'track-processor' | 'script-processor';

export interface WebCodecsAudioCaptureResolutionInput {
  offlineAudioDone: boolean;
  isIosSafari: boolean;
  hasLiveAudioTrack: boolean;
  canUseTrackProcessor: boolean;
}

export function resolveWebCodecsAudioCaptureStrategy(
  input: WebCodecsAudioCaptureResolutionInput
): WebCodecsAudioCaptureStrategy {
  if (input.offlineAudioDone) {
    return 'pre-rendered';
  }

  if (input.hasLiveAudioTrack && !input.isIosSafari && input.canUseTrackProcessor) {
    return 'track-processor';
  }

  return 'script-processor';
}
