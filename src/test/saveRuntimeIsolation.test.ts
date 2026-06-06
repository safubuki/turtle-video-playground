import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  appleSafariProjectPersistenceAdapter,
  appleSafariSaveRuntime,
} from '../flavors/apple-safari/appleSafariSaveRuntime';
import {
  standardProjectPersistenceAdapter,
  standardSaveRuntime,
} from '../flavors/standard/standardSaveRuntime';
import {
  createIndexedDbProjectPersistenceAdapter,
  getProjectPersistenceAdapter,
  setProjectPersistenceAdapter,
} from '../stores/projectPersistence';

describe('save runtime isolation', () => {
  beforeEach(() => {
    setProjectPersistenceAdapter(createIndexedDbProjectPersistenceAdapter());
  });

  it('flavor runtimes own projectStore persistence configuration entry points', () => {
    standardSaveRuntime.configureProjectStore();
    expect(getProjectPersistenceAdapter()).toBe(standardProjectPersistenceAdapter);

    appleSafariSaveRuntime.configureProjectStore();
    expect(getProjectPersistenceAdapter()).toBe(appleSafariProjectPersistenceAdapter);
  });

  it('save runtimes keep distinct flavor-owned configuration functions', () => {
    expect(standardSaveRuntime.configureProjectStore).not.toBe(appleSafariSaveRuntime.configureProjectStore);
  });

  it('save runtime modules は import 時に adapter を書き換えない', async () => {
    vi.resetModules();

    const persistence = await import('../stores/projectPersistence');
    const sentinelAdapter = persistence.createIndexedDbProjectPersistenceAdapter();
    persistence.setProjectPersistenceAdapter(sentinelAdapter);

    await import('../flavors/standard/standardSaveRuntime');
    expect(persistence.getProjectPersistenceAdapter()).toBe(sentinelAdapter);

    await import('../flavors/apple-safari/appleSafariSaveRuntime');
    expect(persistence.getProjectPersistenceAdapter()).toBe(sentinelAdapter);
  });
});