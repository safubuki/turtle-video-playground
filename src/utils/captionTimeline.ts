import type { Caption } from '../types';

export function isCaptionActiveAtTime(caption: Caption, timeSec: number): boolean {
  return timeSec >= caption.startTime && timeSec < caption.endTime;
}
