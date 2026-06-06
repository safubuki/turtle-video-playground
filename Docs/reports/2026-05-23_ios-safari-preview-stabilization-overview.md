# iOS Safari プレビュー安定化 オーバービュー (v5.1.11 → v5.1.14)

**作成日**: 2026-05-23
**対象バージョン**: v5.1.11 〜 v5.1.14
**ステータス**: ✅ プレビュー安定動作確認済み (実機テスト) — この動作を維持する

## 1. このドキュメントの目的

iPhone / iPad Safari (`apple-safari` flavor) のプレビュー再生がようやく
安定動作に到達したため、その「現状の動作」を維持基準として保存する。
今後 standard flavor 側の改修や apple-safari の export 側修正を行う際は、
**ここに記載された preview 経路には触れない / 機能保持を回帰テストで担保する**。

## 2. 安定動作確認済みのシナリオ (実機)

| シナリオ | 期待動作 | 確認結果 |
| --- | --- | --- |
| 動画 1 本のプレビュー再生 | 映像と音声が再生される | ✅ |
| 動画 2 本のプレビュー再生 (BGM 無し) | 1 本目・2 本目とも映像・音声が再生される | ✅ |
| 動画 → 画像 → 動画 のプレビュー再生 | 各クリップ区間で映像・音声が再生される | ✅ |
| 動画→動画 境界 | 「黒画面」「映像 freeze + 音だけ」の退行が無い | ✅ |
| 動画→動画 境界の音声 | 立ち上がり ~50ms 程度の短い音声ギャップは許容 | ✅ |

> **注**: BGM ありシナリオは引き続き要実機確認 (本ドキュメント執筆時点)。
> BGM 関連の修正・調整を入れる場合は、上記の動画単独シナリオが退行しないことを
> 必ず先に保証する。

## 3. 維持すべき主要な実装ポイント

iOS Safari preview の安定動作は、v5.1.11 〜 v5.1.14 にかけて積み上げた
次の 4 つの修正の組み合わせで成立している。**これらは単独ではなく
組み合わせて初めて成立する**ため、個別に rollback すると退行する。

### 3.1 動画境界の play() キック (v5.1.11 起点 / v5.1.12 で安定化)

- 場所: `src/flavors/apple-safari/preview/usePreviewEngine.ts`
  内の active video branch (`renderFrame` 内、`becameActiveOnThisFrame` 判定)
- 役割: active video が切り替わったフレームで `paused` 状態の video に
  対して `play()` を 1 度キックする。preparation event listener
  (`loadedmetadata` / `loadeddata` / `canplay` / `seeked`) を `{ once: true }`
  で仕掛け、`readyState=0/1` 取りこぼしを救済する。
- **触ってはいけない条件**:
  - `currentTime` を上書きしない (seek すると iOS Safari で `seeking=true`
    のまま戻らず映像 freeze 退行が起きる)
  - 既に再生中 (`paused=false`) の video には介入しない
  - export 中 (`_isExporting=true`)・ユーザーシーク中 (`isSeekingRef.current`)
    では発火しない

### 3.2 BGM 無し単独動画でも WebAudio 経路を強制 (v5.1.13)

- 場所: `src/flavors/apple-safari/preview/previewPlatform.ts`
  内の `getPreviewAudioOutputMode`
- 役割: iOS Safari (`policy.muteNativeMediaWhenAudioRouted=true`) では、
  `audibleSourceCount=1` の単独動画でも `'webaudio'` を返し、
  `ensureAudioNodeForElement` 経由で WebAudio 経路を確立させる。
- **背景**: iOS Safari は `AudioContext` が `running` 状態のとき、
  `createMediaElementSource()` で WebAudio に接続していない
  `HTMLMediaElement` の native audio を暗黙に抑制する挙動が観測される。
  WebAudio 経路を経由しないと、BGM 有無で音が出たり出なかったりする
  不安定さが残る。
- **触ってはいけない**: 単独動画で `'native'` に戻すと、BGM 無しシナリオで
  音が出なくなる。

### 3.3 silent prewarm の完全廃止 (v5.1.14)

- 場所:
  - `src/flavors/apple-safari/preview/previewPlatform.ts` の
    `shouldPrimeFutureInactiveVideoInPreview` (全条件で `false` を返す)
  - `src/flavors/apple-safari/preview/usePreviewEngine.ts` の
    `startEngine` 内 startup prewarm ループ (`el.play()` 削除済み)
- 役割: silent (`gain=0` / `native volume=0`) prewarm の `play()` を 2 経路
  すべて廃止する。`currentTime` の位置合わせと audio 経路の確立
  (`sourceNode` + `applyPreviewAudioOutputState`) のみ残す。
- **背景**: iOS Safari は `createMediaElementSource()` 接続済みの video を
  silent 再生すると、視覚フレームの decode を停止し「音は鳴るのに
  1 フレーム目で映像が固まる」退行を引き起こす。
- **触ってはいけない**: silent prewarm を再導入すると、v5.1.13 と同じ
  映像 freeze 退行が再発する。再導入する場合は、`gain=0` ではなく
  audible (例: `gain=0.001`) で prewarm するなどの代案検証が必要。

### 3.4 active 化のタイミングで play() を担う単一経路

- 上記 3.1 の境界キックが唯一の `play()` 起動経路となる。
- silent prewarm が無いため、active 化直後の動画は `paused` 状態から
  fresh `play()` で立ち上がる。立ち上がり (~50ms) の短い音声ギャップは
  「動画と動画のつなぎ目で stutter を許容する」前提に合わせた割り切り。

## 4. 回帰テスト (現時点で揃っているもの)

| テストファイル | カバー範囲 |
| --- | --- |
| `src/test/appleSafariPreviewEngineBoundary.test.tsx` | 境界キックの発火条件、currentTime を触らないこと、export 中・seek 中は無効、prewarm 済みには介入しないこと |
| `src/test/appleSafariFlavorRegression.test.ts` | 単独動画でも `'webaudio'` を返すこと、`shouldPrimeFutureInactiveVideoInPreview` が全条件で `false` を返すこと、video→image→video の future probe / single mix |
| `src/test/previewRuntimeIsolation.test.ts` | standard と apple-safari の `getPreviewAudioOutputMode` が単独動画で異なる値を返すこと (`'native'` vs `'webaudio'`) |

## 5. 影響範囲の境界

| 領域 | 変更可否 |
| --- | --- |
| `src/flavors/apple-safari/preview/` | プレビューの維持を目的とする限定的な改修のみ。回帰テスト先 |
| `src/flavors/apple-safari/export/` | preview に影響しない限り変更可 |
| `src/flavors/standard/preview/` | 元々 silent prewarm を実行しない (`muteNativeMediaWhenAudioRouted=false`) ため iOS Safari の修正は届かない。standard 単独の改修は可 |
| `src/components/sections/PreviewSection.tsx` (UI) | 操作系の変更は可。ただし `isProcessing` / `exportUrl` の state 駆動ロジックは preview 経由の発火条件と整合 |

## 6. 残課題

- BGM ありシナリオの実機受け入れ (本ドキュメント時点で部分的に未完了)
- Export 完了時の UI 状態同期 (Android と同じく緑のダウンロードボタンへ
  切り替わるかどうかの実機確認)

## 7. 参考コミット

| バージョン | コミット | 内容 |
| --- | --- | --- |
| v5.1.11 | `03a999f` | 動画→動画 / 画像→動画 境界キック導入 |
| v5.1.12 | `277f5fc` | 境界キックで currentTime を触らない (映像 freeze 解消) |
| v5.1.13 | `7e98a93` | 単独動画でも WebAudio 経路を強制 (音声不通解消) |
| v5.1.14 | `22a57af` | silent prewarm を完全廃止 (映像 freeze 再発解消) |
