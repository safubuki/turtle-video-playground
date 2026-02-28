/**
 * @file SettingsModal.tsx
 * @author Turtle Village
 * @description アプリケーションの設定（Gemini APIキーの管理）およびシステムログの閲覧を行うモーダル。
 */
import React, { useState, useEffect, useRef } from 'react';
import {
  X, Key, Eye, EyeOff, ExternalLink, CheckCircle, AlertCircle,
  FileText, Copy, Download, Trash2, CheckCircle2, RefreshCw, CircleHelp
} from 'lucide-react';
import { useLogStore } from '../../stores';
import { useUpdateStore } from '../../stores/updateStore';
import type { LogEntry } from '../../stores';
import { useDisableBodyScroll } from '../../hooks/useDisableBodyScroll';

// アプリバージョン
import versionData from '../../../version.json';
export const APP_VERSION = versionData.version;

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const API_KEY_STORAGE_KEY = 'turtle-video-gemini-api-key';

/**
 * APIキーをlocalStorageから取得
 */
export function getStoredApiKey(): string {
  try {
    return localStorage.getItem(API_KEY_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

/**
 * APIキーをlocalStorageに保存
 */
export function setStoredApiKey(key: string): void {
  try {
    if (key) {
      localStorage.setItem(API_KEY_STORAGE_KEY, key);
    } else {
      localStorage.removeItem(API_KEY_STORAGE_KEY);
    }
  } catch {
    // localStorage が使えない環境では何もしない
  }
}

type TabType = 'apikey' | 'logs';

/**
 * ログレベルに応じた色を返す
 */
function getLogLevelColor(level: string): string {
  switch (level) {
    case 'ERROR': return 'text-red-400';
    case 'WARN': return 'text-yellow-400';
    case 'INFO': return 'text-blue-400';
    case 'DEBUG': return 'text-gray-500';
    default: return 'text-gray-400';
  }
}

/**
 * ログレベルに応じた背景色を返す
 */
function getLogLevelBg(level: string): string {
  switch (level) {
    case 'ERROR': return 'bg-red-500/10';
    case 'WARN': return 'bg-yellow-500/10';
    case 'INFO': return 'bg-blue-500/10';
    case 'DEBUG': return 'bg-gray-500/10';
    default: return 'bg-gray-500/10';
  }
}

/**
 * 設定モーダルコンポーネント
 * APIキーの設定UI + ログ表示
 */
const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<TabType>('apikey');
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const showHelpRef = useRef(false);
  const modalHistoryIdRef = useRef<string | null>(null);
  const closedByPopstateRef = useRef(false);
  const apikeyScrollRef = useRef<HTMLDivElement>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const touchStartXRef = useRef<number | null>(null);
  const touchStartYRef = useRef<number | null>(null);
  const touchStartScrollTopRef = useRef(0);
  const touchDeltaYRef = useRef(0);
  const swipeCloseEligibleRef = useRef(false);

  const isMobileViewport = () => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(max-width: 767px)').matches;
  };

  // モーダル表示中は背景のスクロールを防止
  useDisableBodyScroll(isOpen);

  // Log Store
  const entries = useLogStore((s) => s.entries);
  const hasError = useLogStore((s) => s.hasError);
  const clearLogs = useLogStore((s) => s.clearLogs);
  const clearErrorFlag = useLogStore((s) => s.clearErrorFlag);
  const exportLogs = useLogStore((s) => s.exportLogs);

  useEffect(() => {
    if (isOpen) {
      setApiKey(getStoredApiKey());
      setSaved(false);
      setShowKey(false);
      setCopied(false);
      setShowHelp(false);
      // ログタブを開いたらエラーフラグをクリア
      if (activeTab === 'logs') {
        clearErrorFlag();
      }
    }
  }, [isOpen, activeTab, clearErrorFlag]);

  useEffect(() => {
    showHelpRef.current = showHelp;
  }, [showHelp]);

  useEffect(() => {
    if (!isOpen || typeof window === 'undefined') return;
    const stateId = `settings-modal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    modalHistoryIdRef.current = stateId;
    closedByPopstateRef.current = false;

    const currentState = (window.history.state && typeof window.history.state === 'object')
      ? window.history.state as Record<string, unknown>
      : {};
    window.history.pushState({ ...currentState, __settingsModal: stateId }, '');

    const handlePopState = () => {
      if (showHelpRef.current) {
        setShowHelp(false);
        const state = (window.history.state && typeof window.history.state === 'object')
          ? window.history.state as Record<string, unknown>
          : {};
        window.history.pushState({ ...state, __settingsModal: stateId }, '');
        return;
      }
      closedByPopstateRef.current = true;
      onClose();
    };

    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('popstate', handlePopState);
      const current = (window.history.state && typeof window.history.state === 'object')
        ? window.history.state as Record<string, unknown>
        : null;
      const ownStateOnTop = Boolean(
        modalHistoryIdRef.current &&
        current &&
        current.__settingsModal === modalHistoryIdRef.current
      );
      if (!closedByPopstateRef.current && ownStateOnTop) {
        window.history.back();
      }
      modalHistoryIdRef.current = null;
      closedByPopstateRef.current = false;
    };
  }, [isOpen, onClose]);

  const getActiveScrollTop = () => {
    if (activeTab === 'apikey') return apikeyScrollRef.current?.scrollTop ?? 0;
    return logContainerRef.current?.scrollTop ?? 0;
  };

  const resetTouchTracking = () => {
    touchStartXRef.current = null;
    touchStartYRef.current = null;
    touchStartScrollTopRef.current = 0;
    touchDeltaYRef.current = 0;
    swipeCloseEligibleRef.current = false;
  };

  const handleSheetTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    if (!isMobileViewport() || event.touches.length !== 1) {
      resetTouchTracking();
      return;
    }
    const touch = event.touches[0];
    touchStartXRef.current = touch.clientX;
    touchStartYRef.current = touch.clientY;
    touchDeltaYRef.current = 0;
    touchStartScrollTopRef.current = getActiveScrollTop();
    swipeCloseEligibleRef.current = touchStartScrollTopRef.current <= 0;
  };

  const handleSheetTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    if (!swipeCloseEligibleRef.current || touchStartXRef.current === null || touchStartYRef.current === null || event.touches.length !== 1) {
      return;
    }

    const touch = event.touches[0];
    const deltaX = touch.clientX - touchStartXRef.current;
    const deltaY = touch.clientY - touchStartYRef.current;
    touchDeltaYRef.current = deltaY;

    const atTop = getActiveScrollTop() <= 0;
    const isVerticalDownSwipe = deltaY > 0 && Math.abs(deltaY) > Math.abs(deltaX);
    if (!atTop || touchStartScrollTopRef.current > 0 || !isVerticalDownSwipe) {
      swipeCloseEligibleRef.current = false;
      return;
    }

    event.preventDefault();
  };

  const handleSheetTouchEnd = () => {
    if (swipeCloseEligibleRef.current && touchDeltaYRef.current > 72) {
      onClose();
    }
    resetTouchTracking();
  };

  // ログが追加されたら自動スクロール
  useEffect(() => {
    if (logContainerRef.current && activeTab === 'logs') {
      logContainerRef.current.scrollTop = 0;
    }
  }, [entries, activeTab]);

  const handleSave = () => {
    setStoredApiKey(apiKey.trim());
    setSaved(true);
    setTimeout(() => {
      onClose();
    }, 1000);
  };

  const handleClear = () => {
    setApiKey('');
    setStoredApiKey('');
    setSaved(false);
  };

  const maskApiKey = (key: string): string => {
    if (!key) return '';
    if (key.length <= 8) return '●'.repeat(key.length);
    return key.slice(0, 4) + '●'.repeat(key.length - 8) + key.slice(-4);
  };

  const handleCopyLogs = async () => {
    const logsJson = exportLogs();
    try {
      await navigator.clipboard.writeText(logsJson);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // フォールバック
      const textarea = document.createElement('textarea');
      textarea.value = logsJson;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleExportLogs = () => {
    const content = exportLogs();
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'turtle-video-logs.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const formatTimestamp = (timestamp: string): string => {
    const date = new Date(timestamp);
    const timeStr = date.toLocaleTimeString('ja-JP', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    const ms = date.getMilliseconds().toString().padStart(3, '0');
    return `${timeStr}.${ms}`;
  };

  const errorCount = entries.filter(e => e.level === 'ERROR').length;
  const warnCount = entries.filter(e => e.level === 'WARN').length;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-end md:items-center md:justify-center z-[300] md:p-4">
      <div
        className="bg-gray-900 rounded-t-2xl md:rounded-2xl border border-gray-700 w-full max-w-lg shadow-2xl max-h-[calc(100dvh-0.5rem)] md:max-h-[90vh] flex flex-col overflow-hidden animate-ai-modal-sheet"
        onTouchStart={handleSheetTouchStart}
        onTouchMove={handleSheetTouchMove}
        onTouchEnd={handleSheetTouchEnd}
        onTouchCancel={resetTouchTracking}
      >
        <div className="md:hidden pt-2 px-4 shrink-0">
          <div className="mx-auto h-1 w-12 rounded-full bg-gray-600/80" />
        </div>
        {/* ヘッダー */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700 shrink-0">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold flex items-center gap-2">
              ⚙️ 設定
            </h2>
            <button
              onClick={() => setShowHelp((prev) => !prev)}
              className="p-1 rounded-lg transition border border-blue-500/45 bg-blue-500/10 text-blue-300 hover:bg-blue-500/20 hover:text-blue-200"
              title="このセクションの説明"
              aria-label="設定モーダルの説明"
            >
              <CircleHelp className="w-4 h-4" />
            </button>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg border border-gray-600/80 bg-gray-800/80 text-gray-200 hover:text-white hover:bg-gray-700 hover:border-gray-500 transition"
            title="閉じる"
            aria-label="閉じる"
          >
            <X className="w-[18px] h-[18px]" />
          </button>
        </div>

        {/* タブ */}
        <div className="flex border-b border-gray-700 shrink-0">
          <button
            onClick={() => setActiveTab('apikey')}
            className={`flex-1 py-3 px-2 text-xs font-bold flex items-center justify-center gap-1 transition ${activeTab === 'apikey'
              ? 'text-white border-b-2 border-blue-500 bg-gray-800/50'
              : 'text-gray-400 hover:text-white hover:bg-gray-800/30'
              }`}
          >
            <Key className="w-4 h-4" />
            APIキー
          </button>
          <button
            onClick={() => { setActiveTab('logs'); clearErrorFlag(); }}
            className={`flex-1 py-3 px-2 text-xs font-bold flex items-center justify-center gap-1 transition ${activeTab === 'logs'
              ? 'text-white border-b-2 border-blue-500 bg-gray-800/50'
              : 'text-gray-400 hover:text-white hover:bg-gray-800/30'
              }`}
          >
            <FileText className="w-4 h-4" />
            ログ
            {hasError && activeTab !== 'logs' && (
              <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
            )}
          </button>
        </div>

        {/* コンテンツ */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {showHelp && (
            <div className="p-3 border-b border-gray-700/70 shrink-0">
              <div className="rounded-xl border border-orange-400/45 bg-linear-to-br from-orange-500/18 via-amber-500/12 to-orange-500/6 p-3 md:p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-sm font-bold text-orange-100 flex items-center gap-1">
                    <CircleHelp className="w-4 h-4" /> 設定の使い方
                  </h3>
                  <button
                    onClick={() => setShowHelp(false)}
                    className="p-1.5 rounded-md border border-orange-300/40 bg-orange-500/10 text-orange-100 hover:bg-orange-500/25 hover:border-orange-200/60 transition"
                    title="ヘルプを閉じる"
                    aria-label="ヘルプを閉じる"
                  >
                    <X className="w-[18px] h-[18px]" />
                  </button>
                </div>
                <ol className="list-decimal ml-4 space-y-1 text-xs md:text-sm text-orange-50 leading-relaxed">
                  <li>APIキータブで Gemini APIキーを保存すると、AIナレーション機能が使えます。</li>
                  <li>APIキーはこのブラウザに保存されます。端末を変える場合は再設定が必要です。</li>
                  <li>ログタブでは実行ログ確認、コピー、JSON出力、クリアができます。</li>
                </ol>
                <p className="text-xs md:text-sm text-orange-100/95 leading-relaxed">
                  ※ Google AI Studio / Gemini API には利用上限（レート制限・日次上限など）があります。一定量の利用を超えると一時的に利用できなくなり、一定時間待ってから再試行が必要です。
                </p>
                <a
                  href="https://aistudio.google.com/app/apikey"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs md:text-sm text-orange-200 hover:text-orange-100 underline underline-offset-2"
                >
                  APIキー取得（Google AI Studio）
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>
          )}
          {activeTab === 'apikey' ? (
            /* APIキータブ */
            <div ref={apikeyScrollRef} className="p-4 space-y-4 overflow-y-auto">
              {/* 説明 */}
              <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3">
                <h3 className="font-bold text-blue-400 mb-2 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4" />
                  AIナレーション機能について
                </h3>
                <p className="text-sm text-gray-300 leading-relaxed">
                  AIナレーション機能を使用するには、Google Gemini APIキーが必要です。
                  以下の手順でAPIキーを取得してください：
                </p>
                <ol className="text-sm text-gray-300 mt-2 space-y-1 list-decimal list-inside">
                  <li>下のリンクからGoogle AI Studioにアクセス</li>
                  <li>Googleアカウントでログイン</li>
                  <li>「Get API Key」をクリックしてキーを発行</li>
                  <li>発行されたキーをコピーして下に貼り付け</li>
                </ol>
              </div>

              {/* AI Studio リンク */}
              <a
                href="https://aistudio.google.com/app/apikey"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white py-3 px-4 rounded-lg font-bold transition shadow-lg"
              >
                <ExternalLink className="w-4 h-4" />
                Google AI Studio でAPIキーを取得
              </a>

              {/* APIキー入力 */}
              <div className="space-y-2">
                <label className="block text-sm font-bold text-gray-300">
                  Gemini APIキー
                </label>
                <div className="relative">
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={showKey ? apiKey : (apiKey ? maskApiKey(apiKey) : '')}
                    onChange={(e) => {
                      if (showKey) {
                        setApiKey(e.target.value);
                        setSaved(false);
                      }
                    }}
                    onFocus={() => setShowKey(true)}
                    placeholder="AIza..."
                    className="w-full bg-gray-800 border border-gray-600 rounded-lg px-4 py-3 pr-12 text-sm font-mono focus:outline-none focus:border-blue-500 transition"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white transition"
                  >
                    {showKey ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
                <p className="text-xs text-gray-500">
                  ※ APIキーはブラウザのローカルストレージに保存されます
                </p>
              </div>

              {/* 保存成功メッセージ */}
              {saved && (
                <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 flex items-center gap-2 text-green-400">
                  <CheckCircle className="w-4 h-4" />
                  <span className="text-sm font-bold">保存しました！</span>
                </div>
              )}

              {/* フッター */}
              <div className="flex gap-3 pt-2">
                <button
                  onClick={handleClear}
                  className="flex-1 bg-gray-700 hover:bg-gray-600 text-white py-2.5 rounded-lg font-bold transition"
                >
                  クリア
                </button>
                <button
                  onClick={handleSave}
                  disabled={!apiKey.trim()}
                  className="flex-1 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white py-2.5 rounded-lg font-bold transition shadow-lg"
                >
                  保存
                </button>
              </div>
            </div>
          ) : activeTab === 'logs' ? (
            /* ログタブ */
            <div className="flex flex-col flex-1 overflow-hidden">
              {/* ステータス */}
              <div className="p-3 border-b border-gray-700 shrink-0">
                <div className={`flex items-center gap-3 p-3 rounded-lg ${errorCount > 0 ? 'bg-red-500/10 border border-red-500/30' :
                  'bg-green-500/10 border border-green-500/30'
                  }`}>
                  {errorCount > 0 ? (
                    <>
                      <AlertCircle className="w-5 h-5 text-red-400" />
                      <div>
                        <p className="font-bold text-red-400">エラー発生</p>
                        <p className="text-xs text-gray-400">
                          エラー: {errorCount}件 / ワーニング: {warnCount}件
                        </p>
                      </div>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-5 h-5 text-green-400" />
                      <div>
                        <p className="font-bold text-green-400">正常動作中</p>
                        <p className="text-xs text-gray-400">
                          ログ: {entries.length}件
                          {warnCount > 0 && <span className="text-yellow-400 ml-2">（ワーニングあり: {warnCount}件）</span>}
                        </p>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* ログ一覧 */}
              <div
                ref={logContainerRef}
                className="flex-1 overflow-y-auto p-3 space-y-1 font-mono text-xs"
              >
                {entries.length === 0 ? (
                  <div className="text-center text-gray-500 py-8">
                    ログはまだありません
                  </div>
                ) : (
                  [...entries].reverse().map((entry: LogEntry) => (
                    <div
                      key={entry.id}
                      className={`p-2 rounded ${getLogLevelBg(entry.level)}`}
                    >
                      <div className="flex items-start gap-2">
                        <span className="text-gray-500 shrink-0">
                          {formatTimestamp(entry.timestamp)}
                        </span>
                        <span className={`font-bold shrink-0 w-12 ${getLogLevelColor(entry.level)}`}>
                          {entry.level}
                        </span>
                        <span className="text-gray-400 shrink-0">
                          [{entry.category}]
                        </span>
                        <span className="text-gray-200 break-all">
                          {entry.message}
                        </span>
                      </div>
                      {entry.details && Object.keys(entry.details).length > 0 && (
                        <div className="mt-1 ml-[7.5rem] text-gray-500 break-all">
                          {JSON.stringify(entry.details)}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>

              {/* アクションボタン */}
              <div className="p-3 border-t border-gray-700 flex gap-2 shrink-0">
                <button
                  onClick={handleCopyLogs}
                  disabled={entries.length === 0}
                  className="flex-1 flex items-center justify-center gap-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed text-white py-2 rounded-lg text-sm font-bold transition"
                >
                  {copied ? <CheckCircle className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  {copied ? 'コピー完了' : 'コピー'}
                </button>
                <button
                  onClick={handleExportLogs}
                  disabled={entries.length === 0}
                  className="flex items-center justify-center gap-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white py-2 px-3 rounded-lg text-sm font-bold transition"
                >
                  <Download className="w-4 h-4" />
                  JSON
                </button>
                <button
                  onClick={clearLogs}
                  disabled={entries.length === 0}
                  className="flex items-center justify-center gap-1 bg-red-600 hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed text-white py-2 px-3 rounded-lg text-sm font-bold transition"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ) : null}
        </div>

        {/* バージョン情報 & 更新確認 */}
        <div className="px-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] md:pb-3 border-t border-gray-700 pt-3 shrink-0 flex flex-col items-center gap-2">
          <span className="text-xs text-gray-500">
            タートルビデオ v{APP_VERSION}
          </span>
          <UpdateStatus />
        </div>
      </div>
    </div>
  );
};

const UpdateStatus: React.FC = () => {
  const { needRefresh, updateServiceWorker } = useUpdateStore();

  if (!needRefresh) return null;

  return (
    <div className="w-full bg-blue-500/10 border border-blue-500/30 rounded-lg p-2 flex items-center justify-between gap-2">
      <div className="flex items-center gap-2 text-blue-400">
        <RefreshCw className="w-4 h-4 animate-spin-slow" />
        <span className="text-xs font-bold">新しいバージョンがあります</span>
      </div>
      <button
        onClick={() => updateServiceWorker(true)}
        className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded text-xs font-bold transition"
      >
        更新
      </button>
    </div>
  );
};

export default React.memo(SettingsModal);

