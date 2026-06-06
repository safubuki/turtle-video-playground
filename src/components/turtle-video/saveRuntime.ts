import { saveBlobWithClientFileStrategy } from '../../utils/fileSave';
import { getPlatformCapabilities } from '../../utils/platform';
import type { ProjectPersistenceHealthSnapshot } from '../../stores/projectPersistenceHealth';

export interface SaveRuntime {
  configureProjectStore: () => void;
  getPlatformCapabilities: typeof getPlatformCapabilities;
  saveBlobWithClientFileStrategy: typeof saveBlobWithClientFileStrategy;
  getPersistenceHealth?: () => Promise<ProjectPersistenceHealthSnapshot | null>;
}