import { describe, expect, it } from 'vitest';

import { resolveAppFlavor } from '../app/resolveAppFlavor';

describe('resolveAppFlavor', () => {
  it('iOS Safari は apple-safari flavor を返す', () => {
    expect(resolveAppFlavor({ isIosSafari: true })).toBe('apple-safari');
  });

  it('非 iOS Safari は standard flavor を返す', () => {
    expect(resolveAppFlavor({ isIosSafari: false })).toBe('standard');
  });
});