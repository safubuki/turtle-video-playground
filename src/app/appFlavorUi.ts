import type { AppFlavor } from './resolveAppFlavor';

export interface AppFlavorBadge {
  label: string;
  compactLabel: string;
  title: string;
  className: string;
}

export interface DownloadRouteInfo {
  label: string;
  description: string;
}

export interface SaveLoadRuntimeGuidance {
  title: string;
  summary: string;
  bullets: string[];
}

export function getAppFlavorBadge(appFlavor: AppFlavor): AppFlavorBadge {
  if (appFlavor === 'apple-safari') {
    return {
      label: 'Apple Safari 動作モード',
      compactLabel: 'Safari動作',
      title: 'iPhone / iPad Safari 向けの安定動作優先モードです',
      className: 'border-amber-400/40 bg-amber-500/10 text-amber-200',
    };
  }

  return {
    label: '標準モード',
    compactLabel: '標準',
    title: 'Android / PC 向けの標準ランタイムです',
    className: 'border-emerald-400/35 bg-emerald-500/10 text-emerald-200',
  };
}

export function getDownloadRouteInfo(input: {
  appFlavor: AppFlavor;
  supportsShowSaveFilePicker: boolean;
}): DownloadRouteInfo {
  if (input.supportsShowSaveFilePicker) {
    return {
      label: '保存先ダイアログ',
      description: '対応ブラウザでは保存先ダイアログが開き、保存場所を選べます。',
    };
  }

  if (input.appFlavor === 'apple-safari') {
    return {
      label: 'ブラウザの共有・ダウンロード',
      description: 'Apple Safari では、ブラウザの共有メニュー、または通常のダウンロード手順で保存します。',
    };
  }

  return {
    label: 'ブラウザの標準ダウンロード',
    description: 'このブラウザでは通常のダウンロード手順で保存します。',
  };
}

export function getAppFlavorSupportSummary(appFlavor: AppFlavor): string {
  if (appFlavor === 'apple-safari') {
    return 'iPhone / iPad の Safari は安定動作優先の動作モードです。基本編集・保存・書き出しを優先し、高度機能は標準モードが先行する場合があります。';
  }

  return 'Android / PC は標準モードです。iPhone / iPad の Safari は安定動作を優先する動作モードとして分離して扱います。高機能の改善はこの系統を先行し、保存や書き出しもブラウザ capability に応じて最適化されます。';
}

export function getDownloadHelpSentence(input: {
  appFlavor: AppFlavor;
  supportsShowSaveFilePicker: boolean;
}): string {
  if (input.supportsShowSaveFilePicker) {
    return '対応ブラウザでは保存先ダイアログを利用し、未対応ブラウザでは標準ダウンロードに切り替わります。';
  }

  if (input.appFlavor === 'apple-safari') {
    return 'Apple Safari 動作モードでは、ブラウザの共有メニュー、または通常のダウンロード手順で保存します。';
  }

  return 'このブラウザでは標準ダウンロードを利用します。';
}

export function getPreviewRuntimeNotice(input: {
  appFlavor: AppFlavor;
  supportsShowSaveFilePicker: boolean;
}): { title: string; description: string } | null {
  if (input.appFlavor !== 'apple-safari') {
    return null;
  }

  return {
    title: 'Apple Safari 動作モード',
    description:
      'この環境では安定動作を優先します。書き出し中は画面を切り替えず、作成後の保存は '
      + 'ブラウザの共有メニュー、または通常のダウンロード手順をご利用ください。',
  };
}

export function getSaveLoadRuntimeGuidance(input: {
  appFlavor: AppFlavor;
  supportsShowSaveFilePicker: boolean;
}): SaveLoadRuntimeGuidance {
  const downloadRoute = getDownloadRouteInfo(input);

  if (input.appFlavor === 'apple-safari') {
    return {
      title: 'Apple Safari 動作モード',
      summary:
        '保存データはブラウザ内に保持されます。Safari は通常タブ、ホーム画面追加、プライベートブラウズで保存領域が分かれる場合があります。',
      bullets: [
        `ファイル保存は ${downloadRoute.label} を利用します。`,
        '手動保存→読み込み→ブラウザ再起動後の保持を、同じ起動方法のまま確認してください。',
        'プライベートブラウズは正式サポート対象外です。',
        '高度機能の改善は標準モードが先行する場合があります。',
      ],
    };
  }

  return {
    title: '標準モード',
    summary:
      '保存データはブラウザ内に保持され、手動保存・自動保存は共通の IndexedDB 2 スロットで管理されます。',
    bullets: [
      `ファイル保存は ${downloadRoute.label} を利用します。`,
      '自動保存は定期的に上書きされるため、不要に保存データが増え続けない構成です。',
      '高機能の改善は標準モードを先行します。',
    ],
  };
}