# タートルビデオ - 仕様書 & 実装計画

## 概要

「タートルビデオ」は、ブラウザベースの動画編集アプリケーションです。React で構築されており、動画・画像のタイムライン編集、BGM・ナレーションの合成、AIナレーション生成機能を備えています。

## 2026-03-11 iOS Safari 正式対応 - 仕様書

### 概要

iOS Safari で、Android Chrome / PC ブラウザと同等の主要機能を正式提供する。  
その際、プレビュー再生系とエクスポート系の制御を必要な範囲で分離し、共通化できるタイムライン・描画・保存データ構造は維持する。

### 背景・課題

- 現状は PC / Android を既定経路にし、iOS Safari 向け回避を個別追加している。
- `src/hooks/useExport.ts` と `src/components/TurtleVideo.tsx` に iOS Safari 固有ロジックが集中し、プレビューとエクスポートの相互影響リスクが高い。
- ヘルプ文言上も iPhone（iOS Safari）は未対応扱いのままで、正式対応の検証基準が未整理。
- 事前調査結果は `Docs/reports/2026-03-11_report_ios.md` に整理済み。

### 要件一覧

| # | 要件 | 優先度 | 説明 |
|---|------|--------|------|
| R1 | iOS Safari 正式対応 | 必須 | 動画・画像追加、BGM、ナレーション、キャプション、プレビュー、エクスポート、保存/読込、設定を実用レベルで提供する |
| R2 | 分離方針の明確化 | 必須 | プレビュー制御とエクスポート制御を必要な範囲で分離し、相互デグレを避ける |
| R3 | capability 共通化 | 必須 | `isIosSafari`、保存 API、TrackProcessor、MediaRecorder MP4 などの判定を共通 utility に集約する |
| R4 | エクスポート戦略分離 | 必須 | iOS Safari MediaRecorder 経路と標準 WebCodecs 経路を strategy として分離する |
| R5 | プレビュー制御分離 | 必須 | AudioContext 復帰、ネイティブ音声 mute、同期しきい値、visibility 復帰を preview controller / policy として切り出す |
| R6 | 既存データ互換維持 | 必須 | 保存データ構造、既存プロジェクト読込、既存機能の操作性を壊さない |
| R7 | iOS 専用 UI 差分の最小化 | 推奨 | UI 全体を platform fork せず、入力 accept、ヘルプ文言、ダウンロード経路など必要最小限に留める |
| R8 | 実機検証観点の整備 | 必須 | iOS Safari 向けの再生・エクスポート・保存の確認観点を文書化し、再現確認可能にする |
| R9 | テスト/検証追加 | 必須 | 少なくとも capability 判定、戦略選択、保存経路、主要 pure logic を自動検証できるようにする |
| R10 | 正式対応表示への更新 | 推奨 | 検証完了後、ヘルプ等の「iPhone非対応」表記を見直す |

### 分離・共通化方針

#### 分離するもの

- プレビュー再生制御
  - AudioContext 復帰
  - visibility 復帰
  - ネイティブ音声 mute 方針
  - ブラウザ別同期しきい値
- エクスポート戦略
  - iOS Safari MediaRecorder
  - 標準 WebCodecs
  - 最終フォールバック
- プラットフォーム capability 判定

#### 共通化するもの

- タイムライン計算
- Canvas の基本描画ルール
- BGM / ナレーション / クリップ音声のタイムライン意味論
- 保存/読込データ構造
- ダウンロード UI の capability fallback

### 影響を受けるファイル

| ファイル | 変更内容 |
|---------|---------|
| `src/components/TurtleVideo.tsx` | プレビュー/再生/AudioContext/保存ハンドラの整理、preview controller への責務分割 |
| `src/hooks/useExport.ts` | strategy resolver 化、iOS Safari MediaRecorder と標準 WebCodecs の分離 |
| `src/components/sections/BgmSection.tsx` | `accept` 文字列を共通 utility 経由へ変更 |
| `src/components/sections/NarrationSection.tsx` | `accept` 文字列を共通 utility 経由へ変更 |
| `src/components/media/MediaResourceLoader.tsx` | 必要に応じて playback/export 共通前提の見直し |
| `src/utils/playbackTimeline.ts` | 共通タイムライン計算の再利用強化 |
| `src/utils/` 配下新規 | platform capabilities、download/save、preview/export policy 用 utility 追加 |
| `src/test/` 配下新規 | capability 判定、strategy 選択、pure logic テスト追加 |
| `src/constants/sectionHelp.ts` | 正式対応後のヘルプ文言更新 |
| `Docs/reports/2026-03-11_report_ios.md` | 事前調査レポート |

### データ構造（計画）

```ts
export interface PlatformCapabilities {
  isIosSafari: boolean;
  supportsShowSaveFilePicker: boolean;
  supportsTrackProcessor: boolean;
  supportsCanvasRequestFrame: boolean;
  supportsMp4MediaRecorder: boolean;
  audioContextMayInterrupt: boolean;
}

export interface PreviewPlatformPolicy {
  previewSyncThresholdSec: number;
  exportSyncThresholdSec: number;
  shouldMuteNativeMedia: boolean;
  needsCaptionBlurFallback: boolean;
  shouldReinitializeAudioRouteOnPlay: boolean;
}

export type ExportStrategyId =
  | 'ios-safari-mediarecorder'
  | 'webcodecs-mp4'
  | 'webcodecs-fallback';
```

### 検証対象

- 動画・画像追加
- BGM 追加
- ナレーション追加
- キャプション追加
- プレビュー再生、一時停止、停止、シーク、タブ復帰
- 動画エクスポート
- 手動保存 / 自動保存 / 読込
- 各種設定
- ダウンロード
- 操作性、安定性、既存データ互換

## 実装計画

### Phase 0: 現状調査と設計整理 (完了)

**目標**: iOS Safari 正式対応の前提となる現状分岐と制約を整理する

**前提条件**: なし

タスク:
├── [x] 既存ドキュメントと実装の調査
├── [x] iOS / Android / 共通の分岐点の棚卸し
├── [x] iOS Safari 制約の原因整理
└── [x] `Docs/reports/2026-03-11_report_ios.md` 作成

**成果物**:
- `Docs/reports/2026-03-11_report_ios.md`
- 本仕様セクション

**完了条件**:
- [x] 調査結果が文書化されている
- [x] 分離/共通化の基本方針が明文化されている

---

### Phase 1: Platform Capability 共通化

**目標**: OS/ブラウザ依存判定を1か所に集約する

**前提条件**: Phase 0 完了

タスク:
├── [x] `PlatformCapabilities` utility を追加
├── [x] `isIosSafari` 重複判定を共通化
├── [x] `showSaveFilePicker` / `TrackProcessor` / `MediaRecorder MP4` 判定を共通化
└── [x] 動作確認

**成果物**:
- `src/utils/platform*.ts`（新規）
- `src/components/TurtleVideo.tsx`
- `src/hooks/useExport.ts`
- `src/components/sections/BgmSection.tsx`
- `src/components/sections/NarrationSection.tsx`

**完了条件**:
- [x] 各所の重複判定が除去されている
- [x] 既存テストがパスする
- [x] ビルドが成功する

---

### Phase 2: プレビュー制御の分離

**目標**: preview 再生制御を export 制御から切り離す

**前提条件**: Phase 1 完了

タスク:
├── [ ] `renderFrame` から export 専用制御を切り離す
├── [x] AudioContext 復帰、visibility 復帰、mute 方針を preview policy 化する
├── [x] iOS Safari の caption blur fallback を描画ポリシーへ整理する
└── [x] 動作確認

**成果物**:
- `src/components/TurtleVideo.tsx`
- `src/utils/preview*` または `src/hooks/usePreview*`（新規）

**完了条件**:
- [ ] 一時停止、停止、シーク、タブ復帰で既存デグレがない
- [x] iOS 専用制御が preview 側に閉じている
- [x] ビルドが成功する

---

### Phase 3: エクスポート戦略の分離

**目標**: iOS Safari と標準ブラウザのエクスポート経路を strategy として分離する

**前提条件**: Phase 2 完了

タスク:
├── [x] `useExport.ts` から iOS Safari MediaRecorder 経路を strategy 化する
├── [ ] 標準 WebCodecs 経路を strategy 化する
├── [x] strategy resolver を導入する
└── [x] 動作確認

**成果物**:
- `src/hooks/useExport.ts`
- `src/hooks/export-strategies/*` または同等の新規ファイル

**完了条件**:
- [ ] iOS Safari と非iOS の責務境界が明確
- [ ] 音声/映像の既存回避策が strategy 内に閉じる
- [x] 既存テストがパスする
- [x] ビルドが成功する

---

### Phase 4: 保存・入力・ヘルプの正式対応整理

**目標**: 入力/保存/UI 文言の platform 差分を最小限で整理する

**前提条件**: Phase 3 完了

タスク:
├── [x] BGM/Narration の `accept` を共通 utility 化する
├── [x] ダウンロード経路を capability ベースで整理する
├── [x] 手動保存 / 自動保存 / 読込の iOS Safari 実機確認項目を反映する
└── [x] ヘルプ文言更新方針を確定する

**成果物**:
- `src/components/sections/BgmSection.tsx`
- `src/components/sections/NarrationSection.tsx`
- `src/components/TurtleVideo.tsx`
- `src/components/modals/SaveLoadModal.tsx`
- `src/constants/sectionHelp.ts`
- `src/utils/fileSave.ts`

**完了条件**:
- [x] iOS Safari で入力/ダウンロード/保存の方針が明確
- [x] 不要な platform fork を増やしていない
- [x] ビルドが成功する

---

### Phase 5: テスト・検証・正式対応化

**目標**: 検証観点を揃え、正式対応の判断材料を揃える

**前提条件**: Phase 4 完了

タスク:
├── [x] capability 判定と strategy 選択のテスト追加
├── [x] プレビュー/エクスポートの pure logic テスト追加
├── [x] 実機確認結果をドキュメントに反映
└── [ ] 正式対応表記へ更新

**成果物**:
- `src/test/` 配下の新規/更新テスト
- 必要な Docs 更新

**完了条件**:
- [x] `npm run test:run` が通る
- [x] `npm run build` が成功する
- [ ] iOS Safari の主要受け入れ条件を確認済み
- [x] 「iPhone 非対応」表記の更新可否を判断できる

### ブランチ運用方針

- 統合作業ブランチは `feature/ios-safari-support` とする。
- まず、現状調査レポートと iOS Safari 対応の仕様/実装計画を `feature/ios-safari-support` にコミットする。
- 各実装フェーズは以下の個別ブランチで進める。
  - `feature/ios-phase1-capabilities`
  - `feature/ios-phase2-preview-policy`
  - `feature/ios-phase3-export-strategy`
- 各フェーズブランチは `feature/ios-safari-support` から作成し、フェーズ単位で動作確認・コミット後、`feature/ios-safari-support` へ段階的にマージする。
- `main` へは各フェーズを統合した `feature/ios-safari-support` で最終動作確認完了後にマージする。
- Android/PC 既定経路への影響を避けるため、各フェーズのマージ条件は「そのフェーズ単体で責務が閉じていること」「既存テスト/ビルドが成功すること」「Android/PC の主要導線にデグレがないこと」とする。

---

## 現状の機能一覧

### 1. メディア管理機能

| 機能 | 説明 |
|------|------|
| 動画アップロード | 複数の動画ファイルをアップロード |
| 画像アップロード | 複数の画像ファイルをアップロード |
| メディア並べ替え | クリップの順序を上下に移動 |
| メディア削除 | 個別クリップの削除 |
| 個別ロック機能 | クリップ単位でのロック/アンロック |
| セクションロック機能 | クリップセクション全体のロック |

### 2. 動画編集機能

| 機能 | 説明 |
|------|------|
| トリミング | 動画の開始・終了位置を調整 |
| ボリューム調整 | 動画音声のボリューム設定 |
| ミュート | 動画音声のミュート切り替え |
| フェードイン | 映像・音声のフェードイン効果 |
| フェードアウト | 映像・音声のフェードアウト効果 |
| スケール調整 | 拡大率の調整 (0.5倍〜3.0倍) |
| 位置調整 | X/Y座標での位置調整 |
| 黒帯除去 | 102.5%拡大による黒帯除去オプション |

### 3. 画像編集機能

| 機能 | 説明 |
|------|------|
| 表示時間設定 | 画像の表示秒数を設定 (0.5秒〜60秒) |
| フェードイン/アウト | 画像のフェード効果 |
| スケール調整 | 拡大率の調整 |
| 位置調整 | X/Y座標での位置調整 |

### 4. BGM機能

| 機能 | 説明 |
|------|------|
| BGMアップロード | 音声ファイルのアップロード |
| 開始位置 (頭出し) | BGMの再生開始位置を設定 |
| 開始タイミング (遅延) | 動画タイムライン上での再生開始タイミング |
| ボリューム調整 | BGMのボリューム設定 |
| フェードイン/アウト | BGMのフェード効果 |
| セクションロック | BGMセクションのロック |

### 5. ナレーション機能

| 機能 | 説明 |
|------|------|
| ナレーションアップロード | 音声ファイルのアップロード |
| 開始位置 (頭出し) | ナレーションの再生開始位置を設定 |
| 開始タイミング (遅延) | 動画タイムライン上での再生開始タイミング |
| ボリューム調整 | ナレーションのボリューム設定 |
| フェードイン/アウト | ナレーションのフェード効果 |
| セクションロック | ナレーションセクションのロック |
| AI生成音声の保存 | 生成した音声ファイルのダウンロード |

### 6. AI機能 (Gemini API)

| 機能 | 説明 |
|------|------|
| スクリプト生成 | テーマからナレーション原稿を自動生成 |
| 音声合成 (TTS) | 原稿から音声を生成 |
| ボイス選択 | 5種類のAIボイスから選択 |

### 7. プレビュー & 再生機能

| 機能 | 説明 |
|------|------|
| リアルタイムプレビュー | Canvas上でのリアルタイム描画 |
| 再生/一時停止 | タイムラインの再生制御 |
| 停止 | 再生停止と位置リセット |
| シークバー | 任意の位置へのシーク |
| リソースリロード | メディア要素の強制リロード |
| タブ復帰時自動リフレッシュ | ブラウザタブ復帰時の再描画 |

### 8. エクスポート機能

| 機能 | 説明 |
|------|------|
| 動画書き出し | MediaRecorderを使用した動画出力 |
| MP4/WebM対応 | ブラウザ対応に応じたフォーマット選択 |
| ダウンロード | 生成した動画のダウンロード |

### 9. UI/UX機能

| 機能 | 説明 |
|------|------|
| トースト通知 | 操作結果のフィードバック表示 |
| エラー表示 | エラーメッセージの表示 |
| 一括クリア | 全データのリセット |
| レスポンシブレイアウト | モバイル対応デザイン |

---

## 現状の課題・問題点

### 🔴 Critical (重大な問題)

| # | 問題 | 詳細 |
|---|------|------|
| C1 | APIキーのハードコーディング | `apiKey = ""` が空文字。環境変数で管理すべき |
| C2 | 1ファイル巨大コード | 約1400行が1ファイルに集約されており保守困難 |
| C3 | 型安全性なし | JavaScript のため型エラーが実行時まで検出できない |

### 🟠 Major (大きな問題)

| # | 問題 | 詳細 |
|---|------|------|
| M1 | メモリリーク | `URL.revokeObjectURL` が適切に呼ばれない場合がある |
| M2 | エラーハンドリング不足 | try-catch が不十分で、ユーザーにフィードバックされないエラーあり |
| M3 | 非同期処理の競合 | `startEngine` の複数回呼び出しで競合状態が発生する可能性 |
| M4 | AudioContext の状態管理 | `suspended` 状態のハンドリングが不完全 |
| M5 | useEffect 依存配列 | `renderFrame` が依存配列に含まれておらず、stale closure の危険 |
| M6 | memoization 不足 | コールバック関数が毎回再生成され、不要な再レンダリング発生 |
| M7 | Ref と State の二重管理 | `mediaItems` と `mediaItemsRef` の同期が複雑でバグの温床 |

### 🟡 Minor (軽微な問題)

| # | 問題 | 詳細 |
|---|------|------|
| m1 | マジックナンバー | フェード時間 (1.0秒, 2.0秒) などがハードコーディング |
| m2 | console.log/error 残留 | 開発用ログがプロダクションコードに残存 |
| m3 | CSS クラス名混在 | Tailwind CSS クラスが長大で可読性が低い |
| m4 | アクセシビリティ | ARIA 属性やキーボード操作のサポート不足 |
| m5 | 国際化非対応 | 日本語ハードコーディング |

### 🔵 技術的負債

| # | 問題 | 詳細 |
|---|------|------|
| T1 | テストなし | 単体テスト・統合テストが存在しない |
| T2 | ビルド設定なし | Vite/webpack などのビルド設定がない |
| T3 | Linter/Formatter なし | ESLint/Prettier 設定がない |
| T4 | コンポーネント分離なし | UI がモノリシックで再利用性が低い |
| T5 | 状態管理の複雑さ | useState が多すぎて管理困難 |

---

## 推奨技術スタック

### コア

| 技術 | 用途 | 理由 |
|------|------|------|
| **Vite** | ビルドツール | 高速なHMR、TypeScript対応、設定が簡単 |
| **TypeScript** | 型安全性 | 開発時のエラー検出、IDE補完向上 |
| **React 18+** | UIフレームワーク | 既存コードとの互換性 |

### 状態管理

| 技術 | 用途 | 理由 |
|------|------|------|
| **Zustand** または **Jotai** | グローバル状態 | シンプルで軽量、学習コスト低 |
| Context API | 限定的な共有状態 | React 標準、追加依存なし |

### スタイリング

| 技術 | 用途 | 理由 |
|------|------|------|
| **Tailwind CSS** | ユーティリティCSS | 既存コードとの互換性維持 |

### 開発ツール

| 技術 | 用途 | 理由 |
|------|------|------|
| **ESLint** | 静的解析 | コード品質向上 |
| **Prettier** | フォーマッター | 統一されたコードスタイル |
| **Vitest** | テスト | Vite との親和性が高い |

### オプション (将来的に)

| 技術 | 用途 | 理由 |
|------|------|------|
| React Query / TanStack Query | API状態管理 | AI API呼び出しの管理 |
| Framer Motion | アニメーション | UI アニメーション強化 |

---

## 実装計画 (フェーズ別) - AI支援による高速開発

> 🤖 **AI支援開発**: 各フェーズでAIを活用し、コード生成・型定義・テスト作成を自動化することで、従来の約1/3の期間で完了します。

### Phase 0: 環境構築 (0.5日 = 数時間)

**目標**: Vite + TypeScript のプロジェクト基盤を構築

**AI活用ポイント**: プロジェクト初期化スクリプト生成、設定ファイル自動生成

```
タスク:
├── [x] Vite プロジェクト初期化 (AI: コマンド一括実行)
├── [x] TypeScript 設定 (AI: tsconfig自動生成)
├── [x] Tailwind CSS 設定 (AI: 設定ファイル自動生成)
├── [x] ESLint + Prettier 設定 (AI: ルール推奨・自動適用)
├── [x] 基本ディレクトリ構造の作成 (AI: 構造自動生成)
└── [x] 既存コードの動作確認（そのまま移行）
```

**成果物**:
```
src/
├── main.tsx
├── App.tsx
├── index.css
└── vite-env.d.ts
```

---

### Phase 1: 型定義 & 基本構造 (1日)

**目標**: TypeScript 型定義を整備し、既存機能を維持しながら移行

**AI活用ポイント**: 既存JSコードから型を自動推論、型定義ファイル一括生成

```
タスク:
├── [x] 型定義ファイル作成 (AI: 既存コードから型推論)
│   ├── MediaItem 型
│   ├── AudioTrack 型 (BGM/Narration)
│   ├── VoiceOption 型
│   └── その他共通型
├── [x] 定数ファイル分離 (AI: 定数抽出自動化)
├── [x] 既存コードの TypeScript 化 (AI: JS→TS変換)
└── [x] 動作確認
```

**成果物**:
```
src/
├── types/
│   └── index.ts
├── constants/
│   └── index.ts
└── components/
    └── TurtleVideo.tsx (TypeScript化)
```

---

### Phase 2: コンポーネント分割 (1-2日)

**目標**: UI コンポーネントを機能単位で分離

**AI活用ポイント**: 巨大コンポーネントから自動分割、props推論、export文自動生成

```
タスク:
├── [x] Toast コンポーネント分離 (AI: 自動抽出)
├── [x] MediaResourceLoader コンポーネント分離 (AI: 自動抽出)
├── [x] Header コンポーネント (AI: 自動抽出)
├── [x] ClipsSection コンポーネント (AI: 自動抽出 + ClipItem分離)
├── [x] BgmSection コンポーネント (AI: 自動抽出)
├── [x] NarrationSection コンポーネント (AI: 自動抽出)
├── [x] PreviewSection コンポーネント (AI: 自動抽出 + Controls分離)
├── [x] AiModal コンポーネント (AI: 自動抽出)
└── [x] 動作確認
```

**成果物**:
```
src/
├── components/
│   ├── common/
│   │   ├── Toast.tsx
│   │   └── ErrorMessage.tsx
│   ├── media/
│   │   ├── MediaResourceLoader.tsx
│   │   └── ClipItem.tsx
│   ├── sections/
│   │   ├── ClipsSection.tsx
│   │   ├── BgmSection.tsx
│   │   ├── NarrationSection.tsx
│   │   └── PreviewSection.tsx
│   ├── modals/
│   │   └── AiModal.tsx
│   ├── Header.tsx
│   └── TurtleVideo.tsx (親コンポーネント)
```

---

### Phase 3: ロジック分離 - カスタムフック (1-2日)

**目標**: ビジネスロジックをカスタムフックに抽出

**AI活用ポイント**: ロジック自動抽出、依存配列自動推論、型安全なフック生成

```
タスク:
├── [x] useMediaItems フック (AI: state/logicを自動抽出)
├── [x] useAudioTracks フック (AI: BGM/ナレーションロジック抽出)
├── [x] usePlayback フック (AI: 再生制御ロジック抽出)
├── [x] useAudioContext フック (AI: Web Audio APIラッパー生成)
├── [x] useExport フック (AI: 書き出しロジック抽出)
├── [x] useAiNarration フック (AI: Gemini API呼び出し抽出)
└── [x] 動作確認
```

**成果物**:
```
src/
├── hooks/
│   ├── useMediaItems.ts
│   ├── useAudioTracks.ts
│   ├── usePlayback.ts
│   ├── useAudioContext.ts
│   ├── useExport.ts
│   └── useAiNarration.ts
```

---

### Phase 4: ユーティリティ分離 (0.5-1日)

**目標**: 共通ユーティリティ関数を分離

**AI活用ポイント**: 純粋関数の自動抽出、単体テスト同時生成

```
タスク:
├── [x] 時間フォーマット関数 (AI: 自動抽出 + テスト生成)
├── [x] PCM to WAV 変換関数 (AI: 自動抽出 + テスト生成)
├── [x] メディア操作ユーティリティ (AI: 自動抽出 + テスト生成)
├── [x] Canvas 描画ユーティリティ (AI: 自動抽出 + テスト生成)
└── [x] 動作確認
```

**成果物**:
```
src/
├── utils/
│   ├── format.ts
│   ├── audio.ts
│   ├── media.ts
│   └── canvas.ts
```

---

### Phase 5: 状態管理リファクタリング (1日) ✅

**目標**: 状態管理を Zustand で整理

**AI活用ポイント**: Zustandストア設計自動化、useState→Zustand移行コード自動生成

```
タスク:
├── [x] Zustand ストア設計 (AI: 既存stateから最適構造提案)
├── [x] メディアストア (AI: 自動生成)
├── [x] オーディオストア (AI: 自動生成)
├── [x] UI ストア (AI: 自動生成)
├── [x] 既存 useState からの移行 (AI: リファクタリング自動化)
└── [x] 動作確認
```

**成果物**:
```
src/
├── stores/
│   ├── mediaStore.ts
│   ├── audioStore.ts
│   └── uiStore.ts
```

---

### Phase 6: エラーハンドリング & テスト (1-2日) ✅ 完了

**目標**: 堅牢なエラーハンドリングとテスト追加

**AI活用ポイント**: テストコード自動生成、エッジケース自動抽出、モック自動作成

```
タスク:
├── [x] エラーバウンダリ実装 (AI: ボイラープレート生成)
├── [x] API エラーハンドリング改善 (AI: try-catch自動追加)
├── [x] メモリリーク対策 (AI: cleanup関数自動生成)
├── [x] Vitest セットアップ (AI: 設定自動生成)
├── [x] ユーティリティ関数のテスト (AI: テストケース自動生成)
├── [x] ストアのテスト (Zustandストアのテスト)
└── [x] 動作確認 (62テストパス、ビルド成功)
```

**成果物**:
```
src/
├── components/common/
│   └── ErrorBoundary.tsx   # React Error Boundary
├── test/
│   ├── setup.ts            # Vitest セットアップ
│   ├── format.test.ts      # フォーマット関数テスト
│   ├── media.test.ts       # メディア関数テスト
│   └── stores/
│       ├── mediaStore.test.ts   # メディアストアテスト
│       ├── audioStore.test.ts   # オーディオストアテスト
│       └── uiStore.test.ts      # UIストアテスト
```

---

### Phase 7: 最適化 & 仕上げ (0.5-1日) ✅ 完了

**目標**: パフォーマンス最適化と仕上げ

**AI活用ポイント**: 最適化ポイント自動検出、memo/callback自動適用

```
タスク:
├── [x] React.memo 適用 (ClipItem, Toast, ErrorMessage, 全セクションコンポーネント)
├── [x] useMemo/useCallback 最適化 (既に適切に使用済み)
├── [x] 環境変数設定 (.env.example 既存)
├── [x] README 更新 (セットアップ、機能、構造を記載)
├── [x] ビルド最適化 (JS: 261kB/80kB gzip, CSS: 35kB/7kB gzip)
└── [x] 最終動作確認 (62テストパス、ビルド成功)
```

---

## 最終ディレクトリ構造

```
turtle-video/
├── public/
├── src/
│   ├── components/
│   │   ├── common/
│   │   │   ├── Toast.tsx
│   │   │   ├── ErrorMessage.tsx
│   │   │   └── Button.tsx
│   │   ├── media/
│   │   │   ├── MediaResourceLoader.tsx
│   │   │   └── ClipItem.tsx
│   │   ├── sections/
│   │   │   ├── ClipsSection.tsx
│   │   │   ├── BgmSection.tsx
│   │   │   ├── NarrationSection.tsx
│   │   │   └── PreviewSection.tsx
│   │   ├── modals/
│   │   │   └── AiModal.tsx
│   │   ├── Header.tsx
│   │   └── TurtleVideo.tsx
│   ├── hooks/
│   │   ├── useMediaItems.ts
│   │   ├── useAudioTracks.ts
│   │   ├── usePlayback.ts
│   │   ├── useAudioContext.ts
│   │   ├── useExport.ts
│   │   └── useAiNarration.ts
│   ├── stores/
│   │   ├── mediaStore.ts
│   │   ├── audioStore.ts
│   │   └── uiStore.ts
│   ├── utils/
│   │   ├── format.ts
│   │   ├── audio.ts
│   │   ├── media.ts
│   │   └── canvas.ts
│   ├── types/
│   │   └── index.ts
│   ├── constants/
│   │   └── index.ts
│   ├── __tests__/
│   │   ├── utils/
│   │   └── hooks/
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css
├── .env.example
├── .eslintrc.cjs
├── .prettierrc
├── index.html
├── package.json
├── tsconfig.json
├── tsconfig.node.json
├── vite.config.ts
├── tailwind.config.js
├── postcss.config.js
├── README.md
└── spec.md
```

---

## 想定スケジュール (AI支援開発)

| フェーズ | 期間 | 累計 | AI削減率 |
|----------|------|------|----------|
| Phase 0 | 0.5日 | 0.5日 | 75%削減 |
| Phase 1 | 1日 | 1.5日 | 60%削減 |
| Phase 2 | 1-2日 | 3.5日 | 60%削減 |
| Phase 3 | 1-2日 | 5.5日 | 60%削減 |
| Phase 4 | 0.5-1日 | 6.5日 | 70%削減 |
| Phase 5 | 1日 | 7.5日 | 60%削減 |
| Phase 6 | 1-2日 | 9.5日 | 60%削減 |
| Phase 7 | 0.5-1日 | 10.5日 | 70%削減 |

**合計**: 約7-11日 (実質1.5-2週間)

### 並行作業による更なる短縮

Phase 2-4 は部分的に並行作業可能：
- Phase 2 (コンポーネント分割) と Phase 4 (ユーティリティ) は独立
- Phase 3 (フック) は Phase 2 完了後すぐ開始可能

**最速スケジュール**: 集中作業で約5-7日 (1週間)

---

## 次のステップ

Phase 0 から開始する場合は、以下のコマンドでプロジェクトを初期化します:

```bash
npm create vite@latest turtle-video -- --template react-ts
cd turtle-video
npm install
npm install -D tailwindcss postcss autoprefixer
npm install lucide-react zustand
npm install -D eslint prettier eslint-config-prettier @typescript-eslint/eslint-plugin @typescript-eslint/parser vitest @testing-library/react @testing-library/jest-dom
npx tailwindcss init -p
```

---

## 備考

- 各フェーズ終了時に必ず動作確認を行う
- 既存機能を壊さないことを最優先とする
- 段階的に改善し、一度に大きな変更は避ける
