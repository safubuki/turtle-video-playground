import type { SaveRuntime } from '../../components/turtle-video/saveRuntime';
import {
  createIndexedDbProjectPersistenceAdapter,
  setProjectPersistenceAdapter,
} from '../../stores/projectPersistence';
import { saveBlobWithClientFileStrategy } from '../../utils/fileSave';
import { getPlatformCapabilities } from '../../utils/platform';
import { collectAppleSafariPersistenceHealth } from './save/persistenceHealth';

export const appleSafariProjectPersistenceAdapter = createIndexedDbProjectPersistenceAdapter();

export function configureAppleSafariProjectStore(): void {
  setProjectPersistenceAdapter(appleSafariProjectPersistenceAdapter);
}

export const appleSafariSaveRuntime: SaveRuntime = {
  configureProjectStore: configureAppleSafariProjectStore,
  getPlatformCapabilities,
  saveBlobWithClientFileStrategy,
  getPersistenceHealth: collectAppleSafariPersistenceHealth,
};