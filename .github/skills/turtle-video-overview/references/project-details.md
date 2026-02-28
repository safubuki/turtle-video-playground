# Turtle Video プロジェクト詳細リファレンス

## プロジェクト概要

**Turtle Video（タートルビデオ）**は、ブラウザベースの動画編集アプリケーションです。
React + TypeScript で構築されており、動画・画像のタイムライン編集、BGM・ナレーションの合成、AIナレーション生成機能を備えています。

- **リポジトリ**: `safubuki/turtle-video`
- **ライセンス**: GPL-3.0
- **バージョン管理**: `version.json` で管理

## 技術スタック

| カテゴリ | 技術 | バージョン |
|---------|------|-----------|
| フレームワーク | React + TypeScript | React 19 / TS 5.9 |
| ビルドツール | Vite | 7.x |
| スタイリング | Tailwind CSS | 4.x |
| 状態管理 | Zustand | 5.x |
| アイコン | Lucide React | — |
| 動画エンコード | mp4-muxer | — |
| テスト | Vitest + Testing Library | — |
| AI API | Google Gemini API | TTS・スクリプト生成 |
| PWA | vite-plugin-pwa | — |

## ディレクトリ構成

```
turtle-video/
├── public/                  # 静的アセット
├── src/
│   ├── components/          # UIコンポーネント
│   │   ├── common/          # 共通UI (Toast, ErrorBoundary, MiniPreview)
│   │   ├── media/           # メディア関連 (ClipItem, CaptionItem, MediaResourceLoader)
│   │   ├── sections/        # セクション (Clips, BGM, Narration, Caption, Preview)
│   │   ├── modals/          # モーダル (AI, Settings, SaveLoad, CaptionSettings)
│   │   ├── Header.tsx       # ヘッダー
│   │   ├── SwipeProtectedSlider.tsx  # 誤操作防止スライダー
│   │   └── TurtleVideo.tsx  # メインコンポーネント
│   ├── hooks/               # カスタムフック
│   │   ├── useMediaItems.ts       # メディア管理
│   │   ├── useAudioTracks.ts      # 音声トラック管理
│   │   ├── usePlayback.ts         # 再生制御
│   │   ├── useAudioContext.ts     # Web Audio API
│   │   ├── useExport.ts           # 動画エクスポート
│   │   ├── useAiNarration.ts      # AIナレーション
│   │   ├── useAutoSave.ts         # 自動保存
│   │   └── useSwipeProtectedValue.ts  # スワイプ保護
│   ├── stores/              # Zustand ストア
│   │   ├── mediaStore.ts    # メディア状態
│   │   ├── audioStore.ts    # BGM/ナレーション状態
│   │   ├── captionStore.ts  # キャプション状態
│   │   ├── projectStore.ts  # プロジェクト保存・読み込み
│   │   ├── logStore.ts      # ログ管理
│   │   └── uiStore.ts       # UI状態
│   ├── utils/               # ユーティリティ
│   │   ├── format.ts        # フォーマット関数
│   │   ├── audio.ts         # 音声変換
│   │   ├── media.ts         # メディア操作
│   │   ├── canvas.ts        # Canvas描画
│   │   ├── indexedDB.ts     # IndexedDB操作
│   │   └── index.ts         # バレルエクスポート
│   ├── types/               # 型定義
│   │   └── index.ts         # MediaItem, AudioTrack, CaptionItem 等
│   ├── constants/           # 定数
│   │   └── index.ts
│   └── test/                # テスト
│       ├── setup.ts
│       ├── format.test.ts
│       ├── media.test.ts
│       └── stores/          # ストアテスト
├── Docs/                    # ドキュメント
├── scripts/                 # ビルドスクリプト
├── spec.md                  # 仕様書 & 実装計画
├── version.json             # バージョン管理
├── index.html               # エントリーHTML
├── vite.config.ts           # Vite設定
├── tsconfig.json            # TypeScript設定
├── tailwind.config.js       # Tailwind設定
└── package.json             # 依存関係・スクリプト
```

## 主要機能

### 1. メディア管理
- 動画・画像の複数アップロード、並べ替え、削除
- クリップ個別ロック / セクション一括ロック

### 2. 動画・画像編集
- トリミング（開始・終了位置）
- ボリューム調整、ミュート
- フェードイン/アウト（映像・音声）
- スケール調整（0.5倍〜3.0倍）、位置調整（X/Y）
- 画像の表示時間設定（0.5秒〜60秒）

### 3. BGM・ナレーション
- 音声ファイルのアップロード
- 開始位置（頭出し）、開始タイミング（遅延）
- ボリューム調整、フェードイン/アウト

### 4. AIナレーション（Gemini API）
- テーマからスクリプト自動生成
- テキスト→音声合成（TTS）
- 5種類のAIボイス選択（Aoede, Kore, Puck, Fenrir, Charon）

### 5. キャプション
- テキスト字幕の追加・編集
- スタイル設定（文字サイズ、表示位置）
- タイムライン上の開始/終了時間設定

### 6. プレビュー & 再生
- Canvas上でのリアルタイムプレビュー
- 再生/一時停止/停止、シークバー
- タブ復帰時の自動リフレッシュ
- プレビューキャプチャ（現在のフレームをPNG画像として保存）

### 7. エクスポート
- MediaRecorder を使用した動画出力
- MP4 / WebM 形式対応

### 8. プロジェクト管理
- 自動保存（設定可能な間隔）
- 手動保存・読み込み（IndexedDB 2スロット方式）
- データ永続化

## 状態管理アーキテクチャ

Zustand を使用し、機能ごとにストアを分離しています。

| ストア | 責務 |
|--------|------|
| `mediaStore` | メディアアイテム（動画・画像）の状態管理 |
| `audioStore` | BGM・ナレーションの状態管理 |
| `captionStore` | キャプションの状態管理 |
| `projectStore` | プロジェクト保存・読み込み管理 |
| `logStore` | ログ管理（エラー・警告・情報） |
| `uiStore` | UI状態（トースト、モーダル、再生状態） |

## 主要な型定義

- `MediaItem`: 動画/画像クリップの全プロパティ
- `AudioTrack`: BGM/ナレーションの共通型
- `CaptionItem`: キャプションアイテム
- `VoiceId` / `VoiceOption`: AIボイスの型

## 開発コマンド

```bash
npm run dev         # 開発サーバー起動
npm run build       # プロダクションビルド (tsc && vite build)
npm run preview     # ビルド結果プレビュー
npm run test        # テスト（ウォッチモード）
npm run test:run    # テスト一回実行
npm run test:coverage  # カバレッジ確認
npm run lint        # ESLint
npm run format      # Prettier
```

## コーディング規約

- TypeScript strict モード使用
- ESLint + Prettier でフォーマット統一
- コンポーネントは `React.memo` で最適化
- 状態管理は Zustand ストアを使用、ローカル状態は最小限に
- 型定義は `src/types/index.ts` に集約
- テストは `src/test/` に配置、Vitest + Testing Library を使用

## AI機能について

Google Gemini API を使用。APIキーは以下の方法で設定：
1. **設定モーダル**（推奨）: ヘッダーの歯車アイコン → APIキータブ
2. **環境変数**: `VITE_GEMINI_API_KEY` を `.env` に設定

## 9. Development Scripts (Media Analyzer)

- `npm run dev:media:setup`: base analysis venv setup
- `npm run dev:media:setup:stt`: base + Whisper STT dependencies (`faster-whisper`) in `.venv-media-analysis`
- `npm run dev:media:setup:stt:models`: install STT deps and prefetch Whisper models (`tiny`, `small`)
- `npm run dev:media:analyze -- -Mode transcribe ...`: speech-to-text extraction for video audio
- `npm run dev:media:cleanup`: remove generated artifacts under `tmp/video-analysis` and `.media-analysis-output`
- `npm run dev:media:cleanup:keep-json`: keep JSON reports and remove other generated artifacts
