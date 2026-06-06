export type DecodeAudioDataProbeStatus = 'success' | 'failure';

export interface DecodeAudioDataProbeResult {
  status: DecodeAudioDataProbeStatus;
  fileName: string;
  mimeType: string | null;
  extension: string | null;
  bufferBytes: number;
  durationSec: number | null;
  numberOfChannels: number | null;
  sampleRate: number | null;
  errorName: string | null;
  errorMessage: string | null;
}

export interface DecodeAudioDataProbeOutput {
  result: DecodeAudioDataProbeResult;
  audioBuffer: AudioBuffer | null;
}

function getErrorName(error: unknown): string | null {
  if (error && typeof error === 'object' && 'name' in error && typeof error.name === 'string') {
    return error.name;
  }
  return error instanceof Error ? error.name : null;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return String(error);
}

export async function probeDecodeAudioData(input: {
  audioContext: BaseAudioContext;
  arrayBuffer: ArrayBuffer;
  fileName: string;
  mimeType: string | null;
  extension: string | null;
}): Promise<DecodeAudioDataProbeOutput> {
  const baseResult = {
    fileName: input.fileName,
    mimeType: input.mimeType,
    extension: input.extension,
    bufferBytes: input.arrayBuffer.byteLength,
  };

  try {
    const audioBuffer = await input.audioContext.decodeAudioData(input.arrayBuffer.slice(0));
    return {
      audioBuffer,
      result: {
        ...baseResult,
        status: 'success',
        durationSec: audioBuffer.duration,
        numberOfChannels: audioBuffer.numberOfChannels,
        sampleRate: audioBuffer.sampleRate,
        errorName: null,
        errorMessage: null,
      },
    };
  } catch (error) {
    return {
      audioBuffer: null,
      result: {
        ...baseResult,
        status: 'failure',
        durationSec: null,
        numberOfChannels: null,
        sampleRate: null,
        errorName: getErrorName(error),
        errorMessage: getErrorMessage(error),
      },
    };
  }
}
