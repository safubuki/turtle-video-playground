/**
 * @file projectStore.ts
 * @author Turtle Village
 * @description Project save/load store
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { MediaItem, AudioTrack, Caption, CaptionSettings, NarrationClip } from '../types';
import {
  saveProject,
  loadProject,
  deleteProject,
  deleteAllProjects,
  getProjectsInfo,
  fileToArrayBuffer,
  blobUrlToArrayBuffer,
  arrayBufferToFile,
  type ProjectData,
  type SaveSlot,
  type SerializedMediaItem,
  type SerializedAudioTrack,
  type SerializedCaption,
  type SerializedNarrationClip,
} from '../utils/indexedDB';
import { useLogStore } from './logStore';
import versionData from '../../version.json';

export function getProjectStoreErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function isStorageQuotaError(error: unknown): boolean {
  const lower = getProjectStoreErrorMessage(error).toLowerCase();
  return (
    lower.includes('quotaexceeded') ||
    lower.includes('quota exceeded') ||
    lower.includes('quota') ||
    lower.includes('storage') ||
    lower.includes('容量')
  );
}

interface ProjectState {
  isSaving: boolean;
  isLoading: boolean;
  lastAutoSave: string | null;
  lastManualSave: string | null;
  autoSaveError: string | null;

  saveProjectManual: (
    mediaItems: MediaItem[],
    isClipsLocked: boolean,
    bgm: AudioTrack | null,
    isBgmLocked: boolean,
    narrations: NarrationClip[],
    isNarrationLocked: boolean,
    captions: Caption[],
    captionSettings: CaptionSettings,
    isCaptionsLocked: boolean
  ) => Promise<void>;

  saveProjectAuto: (
    mediaItems: MediaItem[],
    isClipsLocked: boolean,
    bgm: AudioTrack | null,
    isBgmLocked: boolean,
    narrations: NarrationClip[],
    isNarrationLocked: boolean,
    captions: Caption[],
    captionSettings: CaptionSettings,
    isCaptionsLocked: boolean
  ) => Promise<void>;

  loadProjectFromSlot: (slot: SaveSlot) => Promise<{
    mediaItems: MediaItem[];
    isClipsLocked: boolean;
    bgm: AudioTrack | null;
    isBgmLocked: boolean;
    narrations: NarrationClip[];
    isNarrationLocked: boolean;
    captions: Caption[];
    captionSettings: CaptionSettings;
    isCaptionsLocked: boolean;
  } | null>;

  deleteAllSaves: () => Promise<void>;
  deleteAutoSaveOnly: () => Promise<void>;
  refreshSaveInfo: () => Promise<void>;
  clearAutoSaveError: () => void;
}

async function serializeMediaItem(item: MediaItem): Promise<SerializedMediaItem> {
  const fileData = await fileToArrayBuffer(item.file);
  return {
    id: item.id,
    fileName: item.file.name,
    fileType: item.file.type,
    fileData,
    type: item.type,
    volume: item.volume,
    isMuted: item.isMuted,
    fadeIn: item.fadeIn,
    fadeOut: item.fadeOut,
    fadeInDuration: item.fadeInDuration,
    fadeOutDuration: item.fadeOutDuration,
    duration: item.duration,
    originalDuration: item.originalDuration,
    trimStart: item.trimStart,
    trimEnd: item.trimEnd,
    scale: item.scale,
    positionX: item.positionX,
    positionY: item.positionY,
    isTransformOpen: item.isTransformOpen,
    isLocked: item.isLocked,
  };
}

function deserializeMediaItem(data: SerializedMediaItem): MediaItem {
  const file = arrayBufferToFile(data.fileData, data.fileName, data.fileType);
  return {
    id: data.id,
    file,
    type: data.type,
    url: URL.createObjectURL(file),
    volume: data.volume,
    isMuted: data.isMuted,
    fadeIn: data.fadeIn,
    fadeOut: data.fadeOut,
    fadeInDuration: data.fadeInDuration,
    fadeOutDuration: data.fadeOutDuration,
    duration: data.duration,
    originalDuration: data.originalDuration,
    trimStart: data.trimStart,
    trimEnd: data.trimEnd,
    scale: data.scale,
    positionX: data.positionX,
    positionY: data.positionY,
    isTransformOpen: data.isTransformOpen,
    isLocked: data.isLocked,
  };
}

async function serializeAudioTrack(track: AudioTrack): Promise<SerializedAudioTrack> {
  let fileData: ArrayBuffer | null = null;
  let blobData: ArrayBuffer | undefined;

  if (track.file instanceof File) {
    fileData = await fileToArrayBuffer(track.file);
  }

  if (track.blobUrl) {
    try {
      blobData = await blobUrlToArrayBuffer(track.blobUrl);
    } catch {
      // ignore blob fetch errors
    }
  }

  const fileName = track.file instanceof File ? track.file.name : track.file.name;

  return {
    fileName,
    fileType: track.file instanceof File ? track.file.type : 'audio/wav',
    fileData,
    blobData,
    startPoint: track.startPoint,
    delay: track.delay,
    volume: track.volume,
    fadeIn: track.fadeIn,
    fadeOut: track.fadeOut,
    fadeInDuration: track.fadeInDuration,
    fadeOutDuration: track.fadeOutDuration,
    duration: track.duration,
    isAi: track.isAi,
  };
}

function deserializeAudioTrack(data: SerializedAudioTrack): AudioTrack {
  let file: File | { name: string };
  let url: string;
  let blobUrl: string | undefined;

  if (data.fileData) {
    const f = arrayBufferToFile(data.fileData, data.fileName, data.fileType);
    file = f;
    url = URL.createObjectURL(f);
  } else if (data.blobData) {
    const blob = new Blob([data.blobData], { type: data.fileType });
    file = { name: data.fileName };
    url = URL.createObjectURL(blob);
    blobUrl = url;
  } else {
    file = { name: data.fileName };
    url = '';
  }

  return {
    file,
    url,
    blobUrl,
    startPoint: data.startPoint,
    delay: data.delay,
    volume: data.volume,
    fadeIn: data.fadeIn,
    fadeOut: data.fadeOut,
    fadeInDuration: data.fadeInDuration,
    fadeOutDuration: data.fadeOutDuration,
    duration: data.duration,
    isAi: data.isAi,
  };
}

async function serializeNarrationClip(clip: NarrationClip): Promise<SerializedNarrationClip> {
  let fileData: ArrayBuffer | null = null;
  let blobData: ArrayBuffer | undefined;

  if (clip.file instanceof File) {
    fileData = await fileToArrayBuffer(clip.file);
  }

  if (clip.blobUrl) {
    try {
      blobData = await blobUrlToArrayBuffer(clip.blobUrl);
    } catch {
      // ignore blob fetch errors
    }
  }

  const fileName = clip.file instanceof File ? clip.file.name : clip.file.name;

  return {
    id: clip.id,
    sourceType: clip.sourceType,
    fileName,
    fileType: clip.file instanceof File ? clip.file.type : 'audio/wav',
    fileData,
    blobData,
    startTime: clip.startTime,
    volume: clip.volume,
    isMuted: clip.isMuted,
    trimStart: clip.trimStart,
    trimEnd: clip.trimEnd,
    duration: clip.duration,
    isAiEditable: clip.isAiEditable,
    aiScript: clip.aiScript,
    aiVoice: clip.aiVoice,
    aiVoiceStyle: clip.aiVoiceStyle,
  };
}

function deserializeNarrationClip(data: SerializedNarrationClip): NarrationClip {
  let file: File | { name: string };
  let url: string;
  let blobUrl: string | undefined;

  if (data.fileData) {
    const f = arrayBufferToFile(data.fileData, data.fileName, data.fileType);
    file = f;
    url = URL.createObjectURL(f);
  } else if (data.blobData) {
    const blob = new Blob([data.blobData], { type: data.fileType });
    file = { name: data.fileName };
    url = URL.createObjectURL(blob);
    blobUrl = url;
  } else {
    file = { name: data.fileName };
    url = '';
  }

  const duration = Math.max(0, data.duration);
  const trimStart = Math.max(0, Math.min(duration, data.trimStart ?? 0));
  const trimEnd = Math.max(trimStart, Math.min(duration, data.trimEnd ?? duration));

  return {
    id: data.id,
    sourceType: data.sourceType,
    file,
    url,
    blobUrl,
    startTime: Math.max(0, data.startTime),
    volume: Math.max(0, Math.min(2.5, data.volume)),
    isMuted: Boolean(data.isMuted),
    trimStart,
    trimEnd,
    duration,
    isAiEditable: data.isAiEditable,
    aiScript: data.aiScript,
    aiVoice: data.aiVoice as NarrationClip['aiVoice'],
    aiVoiceStyle: data.aiVoiceStyle,
  };
}

function convertLegacyNarrationToClip(track: AudioTrack): NarrationClip {
  return {
    id: `legacy_narration_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    sourceType: track.isAi ? 'ai' : 'file',
    file: track.file,
    url: track.url,
    blobUrl: track.blobUrl,
    startTime: Math.max(0, track.delay || 0),
    volume: Math.max(0, Math.min(2.5, track.volume)),
    isMuted: false,
    trimStart: 0,
    trimEnd: Math.max(0, track.duration),
    duration: track.duration,
    isAiEditable: !!track.isAi,
  };
}

function serializeCaption(caption: Caption): SerializedCaption {
  return {
    id: caption.id,
    text: caption.text,
    startTime: caption.startTime,
    endTime: caption.endTime,
    fadeIn: caption.fadeIn,
    fadeOut: caption.fadeOut,
    fadeInDuration: caption.fadeInDuration,
    fadeOutDuration: caption.fadeOutDuration,
    overridePosition: caption.overridePosition,
    overrideFontStyle: caption.overrideFontStyle,
    overrideFontSize: caption.overrideFontSize,
    overrideFadeIn: caption.overrideFadeIn,
    overrideFadeOut: caption.overrideFadeOut,
    overrideFadeInDuration: caption.overrideFadeInDuration,
    overrideFadeOutDuration: caption.overrideFadeOutDuration,
  };
}

function deserializeCaption(data: SerializedCaption): Caption {
  return {
    id: data.id,
    text: data.text,
    startTime: data.startTime,
    endTime: data.endTime,
    fadeIn: data.fadeIn,
    fadeOut: data.fadeOut,
    fadeInDuration: data.fadeInDuration,
    fadeOutDuration: data.fadeOutDuration,
    overridePosition: data.overridePosition,
    overrideFontStyle: data.overrideFontStyle,
    overrideFontSize: data.overrideFontSize,
    overrideFadeIn: data.overrideFadeIn,
    overrideFadeOut: data.overrideFadeOut,
    overrideFadeInDuration: data.overrideFadeInDuration,
    overrideFadeOutDuration: data.overrideFadeOutDuration,
  };
}

export const useProjectStore = create<ProjectState>()(
  devtools(
    (set) => ({
      isSaving: false,
      isLoading: false,
      lastAutoSave: null,
      lastManualSave: null,
      autoSaveError: null,

      saveProjectManual: async (
        mediaItems,
        isClipsLocked,
        bgm,
        isBgmLocked,
        narrations,
        isNarrationLocked,
        captions,
        captionSettings,
        isCaptionsLocked
      ) => {
        set({ isSaving: true });
        useLogStore.getState().info('SYSTEM', '手動保存を開始', {
          mediaCount: mediaItems.length,
          hasBgm: !!bgm,
          narrationCount: narrations.length,
          captionCount: captions.length,
        });

        try {
          const serializedMediaItems = await Promise.all(mediaItems.map(serializeMediaItem));
          const serializedBgm = bgm ? await serializeAudioTrack(bgm) : null;
          const serializedNarrations = await Promise.all(narrations.map(serializeNarrationClip));
          const serializedCaptions = captions.map(serializeCaption);

          const projectData: ProjectData = {
            slot: 'manual',
            savedAt: new Date().toISOString(),
            version: versionData.version,
            mediaItems: serializedMediaItems,
            isClipsLocked,
            bgm: serializedBgm,
            isBgmLocked,
            narrations: serializedNarrations,
            isNarrationLocked,
            captions: serializedCaptions,
            captionSettings,
            isCaptionsLocked,
          };

          await saveProject(projectData);

          useLogStore.getState().info('SYSTEM', '手動保存完了', { savedAt: projectData.savedAt });
          set({
            lastManualSave: projectData.savedAt,
            isSaving: false,
          });
        } catch (error) {
          useLogStore.getState().error('SYSTEM', '手動保存失敗', {
            error: getProjectStoreErrorMessage(error),
          });
          set({ isSaving: false });
          throw error;
        }
      },

      saveProjectAuto: async (
        mediaItems,
        isClipsLocked,
        bgm,
        isBgmLocked,
        narrations,
        isNarrationLocked,
        captions,
        captionSettings,
        isCaptionsLocked
      ) => {
        if (mediaItems.length === 0 && !bgm && narrations.length === 0 && captions.length === 0) {
          return;
        }

        useLogStore.getState().debug('SYSTEM', '自動保存を開始', {
          mediaCount: mediaItems.length,
          hasBgm: !!bgm,
          narrationCount: narrations.length,
          captionCount: captions.length,
        });

        try {
          const serializedMediaItems = await Promise.all(mediaItems.map(serializeMediaItem));
          const serializedBgm = bgm ? await serializeAudioTrack(bgm) : null;
          const serializedNarrations = await Promise.all(narrations.map(serializeNarrationClip));
          const serializedCaptions = captions.map(serializeCaption);

          const projectData: ProjectData = {
            slot: 'auto',
            savedAt: new Date().toISOString(),
            version: versionData.version,
            mediaItems: serializedMediaItems,
            isClipsLocked,
            bgm: serializedBgm,
            isBgmLocked,
            narrations: serializedNarrations,
            isNarrationLocked,
            captions: serializedCaptions,
            captionSettings,
            isCaptionsLocked,
          };

          await saveProject(projectData);
          useLogStore.getState().debug('SYSTEM', '自動保存完了', { savedAt: projectData.savedAt });
          set({ lastAutoSave: projectData.savedAt, autoSaveError: null });
        } catch (error) {
          const message = isStorageQuotaError(error)
            ? '保存容量が不足しています。不要な保存データを削除してください'
            : getProjectStoreErrorMessage(error);
          useLogStore.getState().error('SYSTEM', '自動保存失敗', { error: message });
          set({ autoSaveError: message });
        }
      },

      loadProjectFromSlot: async (slot) => {
        set({ isLoading: true });
        useLogStore.getState().info('SYSTEM', 'プロジェクトを読み込み中', { slot });

        try {
          const data = await loadProject(slot);
          if (!data) {
            useLogStore.getState().warn('SYSTEM', '読み込み対象のプロジェクトが存在しません', { slot });
            set({ isLoading: false });
            return null;
          }

          const mediaItems = data.mediaItems.map(deserializeMediaItem);
          const bgm = data.bgm ? deserializeAudioTrack(data.bgm) : null;
          const narrations = (data.narrations && data.narrations.length > 0)
            ? data.narrations.map(deserializeNarrationClip)
            : (data.narration ? [convertLegacyNarrationToClip(deserializeAudioTrack(data.narration))] : []);
          const captions = data.captions.map(deserializeCaption);

          useLogStore.getState().info('SYSTEM', 'プロジェクト読み込み完了', {
            slot,
            mediaCount: mediaItems.length,
            hasBgm: !!bgm,
            narrationCount: narrations.length,
            captionCount: captions.length,
            savedAt: data.savedAt,
          });
          set({ isLoading: false });

          return {
            mediaItems,
            isClipsLocked: data.isClipsLocked,
            bgm,
            isBgmLocked: data.isBgmLocked,
            narrations,
            isNarrationLocked: data.isNarrationLocked,
            captions,
            captionSettings: data.captionSettings,
            isCaptionsLocked: data.isCaptionsLocked,
          };
        } catch (error) {
          useLogStore.getState().error('SYSTEM', 'プロジェクト読み込み失敗', {
            slot,
            error: error instanceof Error ? error.message : String(error),
          });
          set({ isLoading: false });
          throw error;
        }
      },

      deleteAllSaves: async () => {
        useLogStore.getState().info('SYSTEM', '全保存データを削除');
        await deleteAllProjects();
        set({ lastAutoSave: null, lastManualSave: null });
        useLogStore.getState().info('SYSTEM', '全保存データ削除完了');
      },

      deleteAutoSaveOnly: async () => {
        useLogStore.getState().info('SYSTEM', '自動保存データを削除');
        await deleteProject('auto');
        set({ lastAutoSave: null });
        useLogStore.getState().info('SYSTEM', '自動保存データ削除完了');
      },

      refreshSaveInfo: async () => {
        try {
          const info = await getProjectsInfo();
          set({
            lastAutoSave: info.auto?.savedAt || null,
            lastManualSave: info.manual?.savedAt || null,
          });
        } catch {
          // ignore
        }
      },

      clearAutoSaveError: () => set({ autoSaveError: null }),
    }),
    { name: 'ProjectStore' }
  )
);
