export interface Mp4DurationSummary {
  containerDurationUs: number | null;
  videoDurationUs: number | null;
  audioDurationUs: number | null;
}

interface Mp4Box {
  type: string;
  contentStart: number;
  end: number;
}

function toDurationUs(duration: number, timescale: number): number | null {
  if (!Number.isFinite(duration) || !Number.isFinite(timescale) || timescale === 0) {
    return null;
  }

  return Math.max(0, Math.round((duration / timescale) * 1e6));
}

function readType(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

function readUint64(view: DataView, offset: number): number {
  const high = view.getUint32(offset);
  const low = view.getUint32(offset + 4);
  return high * 0x1_0000_0000 + low;
}

function readBox(view: DataView, offset: number, end: number): Mp4Box | null {
  if (offset + 8 > end) return null;

  let size = view.getUint32(offset);
  const type = readType(view, offset + 4);
  let headerSize = 8;

  if (size === 1) {
    if (offset + 16 > end) return null;
    size = readUint64(view, offset + 8);
    headerSize = 16;
  } else if (size === 0) {
    size = end - offset;
  }

  if (!Number.isFinite(size) || size < headerSize || offset + size > end) {
    return null;
  }

  return {
    type,
    contentStart: offset + headerSize,
    end: offset + size,
  };
}

function readDurationUsFromFullBox(view: DataView, contentStart: number, end: number): number | null {
  if (contentStart + 20 > end) return null;

  const version = view.getUint8(contentStart);
  if (version === 1) {
    if (contentStart + 32 > end) return null;
    const timescale = view.getUint32(contentStart + 20);
    const duration = readUint64(view, contentStart + 24);
    return toDurationUs(duration, timescale);
  }

  if (version === 0) {
    const timescale = view.getUint32(contentStart + 12);
    const duration = view.getUint32(contentStart + 16);
    return toDurationUs(duration, timescale);
  }

  // Unsupported or unknown version; fail safely.
  return null;
}

function inspectTrackDuration(view: DataView, start: number, end: number): { handlerType: string | null; durationUs: number | null } {
  let handlerType: string | null = null;
  let durationUs: number | null = null;
  let offset = start;

  while (offset < end) {
    const box = readBox(view, offset, end);
    if (!box) break;

    if (box.type === 'mdia') {
      let mdiaOffset = box.contentStart;
      while (mdiaOffset < box.end) {
        const mdiaBox = readBox(view, mdiaOffset, box.end);
        if (!mdiaBox) break;

        if (mdiaBox.type === 'mdhd') {
          durationUs = readDurationUsFromFullBox(view, mdiaBox.contentStart, mdiaBox.end);
        } else if (mdiaBox.type === 'hdlr' && mdiaBox.contentStart + 12 <= mdiaBox.end) {
          handlerType = readType(view, mdiaBox.contentStart + 8);
        }

        mdiaOffset = mdiaBox.end;
      }
    }

    offset = box.end;
  }

  return { handlerType, durationUs };
}

export function inspectMp4Durations(buffer: ArrayBuffer): Mp4DurationSummary | null {
  const view = new DataView(buffer);
  const summary: Mp4DurationSummary = {
    containerDurationUs: null,
    videoDurationUs: null,
    audioDurationUs: null,
  };

  let offset = 0;
  while (offset < view.byteLength) {
    const box = readBox(view, offset, view.byteLength);
    if (!box) break;

    if (box.type === 'moov') {
      let moovOffset = box.contentStart;
      while (moovOffset < box.end) {
        const moovBox = readBox(view, moovOffset, box.end);
        if (!moovBox) break;

        if (moovBox.type === 'mvhd') {
          summary.containerDurationUs = readDurationUsFromFullBox(view, moovBox.contentStart, moovBox.end);
        } else if (moovBox.type === 'trak') {
          const track = inspectTrackDuration(view, moovBox.contentStart, moovBox.end);
          if (track.handlerType === 'vide' && track.durationUs !== null) {
            // longest track を採用しておくと、補助トラックや重複メタデータが混ざっても
            // 実際の再生総尺を短く誤判定しにくい。
            summary.videoDurationUs = summary.videoDurationUs !== null
              ? Math.max(summary.videoDurationUs, track.durationUs)
              : track.durationUs;
          } else if (track.handlerType === 'soun' && track.durationUs !== null) {
            // audio も同様に最長尺を保持し、mux 後の総尺差分検査を過小評価しないようにする。
            summary.audioDurationUs = summary.audioDurationUs !== null
              ? Math.max(summary.audioDurationUs, track.durationUs)
              : track.durationUs;
          }
        }

        moovOffset = moovBox.end;
      }
    }

    offset = box.end;
  }

  const hasDuration =
    summary.containerDurationUs !== null ||
    summary.videoDurationUs !== null ||
    summary.audioDurationUs !== null;

  return hasDuration ? summary : null;
}
