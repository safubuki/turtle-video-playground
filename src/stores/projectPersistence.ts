import {
  saveProject as saveProjectToIndexedDb,
  loadProject as loadProjectFromIndexedDb,
  deleteProject as deleteProjectFromIndexedDb,
  deleteAllProjects as deleteAllProjectsFromIndexedDb,
  resetProjectDatabase as resetProjectDatabaseInIndexedDb,
  getProjectsInfo as getProjectsInfoFromIndexedDb,
  getStorageEstimate as getStorageEstimateFromIndexedDb,
  fileToArrayBuffer as fileToArrayBufferFromIndexedDb,
  blobUrlToArrayBuffer as blobUrlToArrayBufferFromIndexedDb,
  arrayBufferToFile as arrayBufferToFileFromIndexedDb,
} from '../utils/indexedDB';

export type {
  ProjectData,
  SaveSlot,
  SerializedAudioTrack,
  SerializedCaption,
  SerializedMediaItem,
  SerializedNarrationClip,
} from '../utils/indexedDB';

export interface ProjectPersistenceAdapter {
  saveProject: typeof saveProjectToIndexedDb;
  loadProject: typeof loadProjectFromIndexedDb;
  deleteProject: typeof deleteProjectFromIndexedDb;
  deleteAllProjects: typeof deleteAllProjectsFromIndexedDb;
  resetProjectDatabase: typeof resetProjectDatabaseInIndexedDb;
  getProjectsInfo: typeof getProjectsInfoFromIndexedDb;
  getStorageEstimate: typeof getStorageEstimateFromIndexedDb;
  fileToArrayBuffer: typeof fileToArrayBufferFromIndexedDb;
  blobUrlToArrayBuffer: typeof blobUrlToArrayBufferFromIndexedDb;
  arrayBufferToFile: typeof arrayBufferToFileFromIndexedDb;
}

export function createIndexedDbProjectPersistenceAdapter(): ProjectPersistenceAdapter {
  return {
    saveProject: saveProjectToIndexedDb,
    loadProject: loadProjectFromIndexedDb,
    deleteProject: deleteProjectFromIndexedDb,
    deleteAllProjects: deleteAllProjectsFromIndexedDb,
    resetProjectDatabase: resetProjectDatabaseInIndexedDb,
    getProjectsInfo: getProjectsInfoFromIndexedDb,
    getStorageEstimate: getStorageEstimateFromIndexedDb,
    fileToArrayBuffer: fileToArrayBufferFromIndexedDb,
    blobUrlToArrayBuffer: blobUrlToArrayBufferFromIndexedDb,
    arrayBufferToFile: arrayBufferToFileFromIndexedDb,
  };
}

let currentProjectPersistenceAdapter = createIndexedDbProjectPersistenceAdapter();

export function getProjectPersistenceAdapter(): ProjectPersistenceAdapter {
  return currentProjectPersistenceAdapter;
}

export function setProjectPersistenceAdapter(adapter: ProjectPersistenceAdapter): void {
  currentProjectPersistenceAdapter = adapter;
}

export function resetProjectPersistenceAdapter(): void {
  currentProjectPersistenceAdapter = createIndexedDbProjectPersistenceAdapter();
}