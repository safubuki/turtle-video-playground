import type { ResolveExportAudioSource } from '../../../hooks/export-strategies/types';

const VIDEO_EXTENSIONS = new Set(['mov', 'mp4', 'm4v', 'webm']);
const AUDIO_EXTENSIONS = new Set(['mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'oga', 'opus', 'caf', 'aif', 'aiff']);

function getFileExtension(fileName: string): string | null {
  const lastDot = fileName.lastIndexOf('.');
  if (lastDot < 0 || lastDot === fileName.length - 1) {
    return null;
  }

  return fileName.slice(lastDot + 1).toLowerCase();
}

export const resolveAppleSafariExportAudioSource: ResolveExportAudioSource = ({ fileName, mimeType }) => {
  const extension = getFileExtension(fileName);
  const normalizedMimeType = mimeType || null;

  if (normalizedMimeType?.startsWith('video/') || (extension && VIDEO_EXTENSIONS.has(extension))) {
    return {
      strategy: 'media-element',
      reason: 'video-container-audio',
      mimeType: normalizedMimeType,
      extension,
    };
  }

  if (normalizedMimeType?.startsWith('audio/') || (extension && AUDIO_EXTENSIONS.has(extension))) {
    return {
      strategy: 'decode-audio-data',
      reason: 'direct-audio-file',
      mimeType: normalizedMimeType,
      extension,
    };
  }

  return {
    strategy: 'media-element',
    reason: 'unknown-content-type',
    mimeType: normalizedMimeType,
    extension,
  };
};
