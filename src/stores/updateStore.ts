import { create } from 'zustand';

interface UpdateState {
    needRefresh: boolean;
    offlineReady: boolean;
    updateServiceWorker: (reloadPage?: boolean) => Promise<void>;
    setNeedRefresh: (value: boolean) => void;
    setOfflineReady: (value: boolean) => void;
    setUpdateServiceWorker: (fn: (reloadPage?: boolean) => Promise<void>) => void;
}

export const useUpdateStore = create<UpdateState>((set) => ({
    needRefresh: false,
    offlineReady: false,
    updateServiceWorker: async () => { },
    setNeedRefresh: (value) => set({ needRefresh: value }),
    setOfflineReady: (value) => set({ offlineReady: value }),
    setUpdateServiceWorker: (fn) => set({ updateServiceWorker: fn }),
}));
