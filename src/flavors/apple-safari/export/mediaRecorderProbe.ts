import type { MediaRecorderProfile } from '../../../utils/platform';

export type MediaRecorderProbeFailureStage = 'constructor' | 'start' | null;

export interface MediaRecorderProbeResult {
  mimeType: string | null;
  extension: 'mp4' | 'webm' | null;
  constructorOk: boolean;
  startOk: boolean;
  requestDataSupported: boolean;
  failureStage: MediaRecorderProbeFailureStage;
  failureReason: string | null;
}

export function createMediaRecorderProbeResult(
  profile: MediaRecorderProfile | null,
): MediaRecorderProbeResult {
  return {
    mimeType: profile?.mimeType ?? null,
    extension: profile?.extension ?? null,
    constructorOk: false,
    startOk: false,
    requestDataSupported: false,
    failureStage: null,
    failureReason: null,
  };
}

export function markMediaRecorderProbeSuccess(
  probe: MediaRecorderProbeResult,
  stage: 'constructor' | 'start',
): MediaRecorderProbeResult {
  return {
    ...probe,
    constructorOk: probe.constructorOk || stage === 'constructor',
    startOk: probe.startOk || stage === 'start',
  };
}

export function markMediaRecorderProbeFailure(
  probe: MediaRecorderProbeResult,
  stage: Exclude<MediaRecorderProbeFailureStage, null>,
  error: unknown,
): MediaRecorderProbeResult {
  return {
    ...probe,
    failureStage: stage,
    failureReason: error instanceof Error ? error.message : String(error),
  };
}
