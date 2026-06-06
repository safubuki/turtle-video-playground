import type { SaveRuntime } from '../../components/turtle-video/saveRuntime';
import {
  createIndexedDbProjectPersistenceAdapter,
  setProjectPersistenceAdapter,
} from '../../stores/projectPersistence';
import { saveBlobWithClientFileStrategy } from '../../utils/fileSave';
import { getPlatformCapabilities } from '../../utils/platform';

export const standardProjectPersistenceAdapter = createIndexedDbProjectPersistenceAdapter();

export function configureStandardProjectStore(): void {
  setProjectPersistenceAdapter(standardProjectPersistenceAdapter);
}

export const standardSaveRuntime: SaveRuntime = {
  configureProjectStore: configureStandardProjectStore,
  getPlatformCapabilities,
  saveBlobWithClientFileStrategy,
  getPersistenceHealth: async () => null,
};