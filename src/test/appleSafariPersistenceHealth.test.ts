import { afterEach, describe, expect, it, vi } from 'vitest';

import { collectAppleSafariPersistenceHealth } from '../flavors/apple-safari/save/persistenceHealth';

const originalStorageDescriptor = Object.getOwnPropertyDescriptor(window.navigator, 'storage');
const originalStandaloneDescriptor = Object.getOwnPropertyDescriptor(window.navigator, 'standalone');

function restoreNavigatorProperty(property: 'storage' | 'standalone', descriptor?: PropertyDescriptor) {
  if (descriptor) {
    Object.defineProperty(window.navigator, property, descriptor);
    return;
  }

  Reflect.deleteProperty(window.navigator, property);
}

afterEach(() => {
  restoreNavigatorProperty('storage', originalStorageDescriptor);
  restoreNavigatorProperty('standalone', originalStandaloneDescriptor);
  vi.restoreAllMocks();
});

describe('apple safari persistence health', () => {
  it('永続化済みストレージと見積もり情報を正規化する', async () => {
    Object.defineProperty(window.navigator, 'storage', {
      configurable: true,
      value: {
        estimate: vi.fn().mockResolvedValue({ usage: 512, quota: 1024 }),
        persisted: vi.fn().mockResolvedValue(true),
        persist: vi.fn().mockResolvedValue(true),
      },
    });

    const health = await collectAppleSafariPersistenceHealth();

    expect(health.persistenceMode).toBe('persistent');
    expect(health.launchContext).toBe('browser-tab');
    expect(health.storageEstimate).toEqual({
      usage: 512,
      quota: 1024,
      usageRatio: 0.5,
    });
    expect(health.warnings).toEqual([]);
  });

  it('ホーム画面追加かつ best-effort の場合は警告を含める', async () => {
    Object.defineProperty(window.navigator, 'storage', {
      configurable: true,
      value: {
        estimate: vi.fn().mockResolvedValue({ usage: 256, quota: 2048 }),
        persisted: vi.fn().mockResolvedValue(false),
        persist: vi.fn().mockResolvedValue(false),
      },
    });
    Object.defineProperty(window.navigator, 'standalone', {
      configurable: true,
      value: true,
    });

    const health = await collectAppleSafariPersistenceHealth();

    expect(health.launchContext).toBe('standalone');
    expect(health.persistenceMode).toBe('best-effort');
    expect(health.warnings).toContain('ホーム画面追加で起動した保存領域は、通常タブと別扱いになる場合があります。');
    expect(health.warnings).toContain('Safari は best-effort 保存のため、OS やブラウザの判断で保存領域が整理される場合があります。');
  });
});