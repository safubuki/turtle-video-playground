import React, { useEffect } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useUpdateStore } from '../stores/updateStore';
import { RefreshCw, X } from 'lucide-react';

export const ReloadPrompt: React.FC = () => {
    const storeNeedRefresh = useUpdateStore((state) => state.needRefresh);
    const setNeedRefresh = useUpdateStore((state) => state.setNeedRefresh);
    const setOfflineReady = useUpdateStore((state) => state.setOfflineReady);
    const setUpdateServiceWorker = useUpdateStore((state) => state.setUpdateServiceWorker);

    const {
        needRefresh: [needRefresh],
        offlineReady: [offlineReady],
        updateServiceWorker: hookUpdateServiceWorker,
    } = useRegisterSW({
        onRegistered(r) {
            // eslint-disable-next-line no-console
            console.log('SW Registered: ' + r);
        },
        onRegisterError(error) {
            console.error('SW registration error', error);
        },
    });

    // Sync hook state to store
    // Only update when true to allow user to dismiss
    useEffect(() => {
        if (needRefresh) {
            setNeedRefresh(true);
        }
    }, [needRefresh, setNeedRefresh]);

    useEffect(() => {
        if (offlineReady) {
            setOfflineReady(true);
        }
    }, [offlineReady, setOfflineReady]);

    useEffect(() => {
        setUpdateServiceWorker(hookUpdateServiceWorker);
    }, [hookUpdateServiceWorker, setUpdateServiceWorker]);

    const close = () => {
        setOfflineReady(false);
        setNeedRefresh(false);
    };

    if (!storeNeedRefresh) return null;

    return (
        <div className="fixed bottom-4 right-4 z-[400] flex flex-col gap-2 w-full max-w-sm">
            {storeNeedRefresh && (
                <div className="bg-gray-800 border border-blue-500/50 shadow-2xl rounded-lg p-4 flex flex-col gap-3 animate-slide-up">
                    <div className="flex items-start justify-between">
                        <div className="flex items-center gap-2 text-blue-400 font-bold">
                            <RefreshCw className="w-5 h-5 animate-spin-slow" />
                            <span>新しいバージョンが利用可能です</span>
                        </div>
                        <button
                            onClick={close}
                            className="text-gray-400 hover:text-white transition p-1"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    <p className="text-sm text-gray-300">
                        アプリの更新準備ができました。更新して最新の機能をご利用ください。
                    </p>

                    <div className="flex gap-2 mt-1">
                        <button
                            onClick={() => hookUpdateServiceWorker(true)}
                            className="flex-1 bg-blue-600 hover:bg-blue-500 text-white py-2 rounded-lg font-bold text-sm transition"
                        >
                            更新する
                        </button>
                        <button
                            onClick={close}
                            className="flex-1 bg-gray-700 hover:bg-gray-600 text-white py-2 rounded-lg font-bold text-sm transition"
                        >
                            閉じる
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};
