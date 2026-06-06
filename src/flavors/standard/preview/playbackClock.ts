/**
 * standard preview 専用の再生クロック。
 * loop/start/seek resume で同じ time origin を使い、Android の再生カクつきを防ぐ。
 */
export function getStandardPreviewNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
