# iOS Safari 正式対応 事前調査レポート

**作成日**: 2026-03-11  
**対象バージョン**: v4.1.0  
**目的**: iOS Safari 正式対応に向けて、現状実装の分岐点、Safari 固有制約、分離/共通化方針を整理する。

---

## 1. 結論

- 現状の実装は、**PC/Android を既定経路**にしつつ、**iOS Safari だけを例外パッチで吸収**している構造になっている。
- **Android 固有の分岐は少ない**。実際には「Android と iOS の二分岐」よりも、**Safari 固有制約をどう隔離するか**が主要論点。
- **動画プレビュー再生**と**エクスポート**は、描画対象やタイムライン概念は共通化できるが、**制御層は分離した方が安全**。
- iOS Safari が正式対応になっていない理由は、単一不具合ではなく、**AudioContext / decodeAudioData / MediaRecorder / Canvas / 複数メディア同時再生**の制約が複合し、しかもその回避が `TurtleVideo.tsx` と `useExport.ts` に散在しているため。

---

## 2. 現状の実装マップ

| 領域 | 主ファイル | 現状 | 評価 |
|---|---|---|---|
| プラットフォーム判定 | `src/components/TurtleVideo.tsx`, `src/hooks/useExport.ts`, `src/components/sections/BgmSection.tsx`, `src/components/sections/NarrationSection.tsx` | `isIosSafari` 判定が4か所に重複 | まず共通化すべき |
| 動画プレビュー再生 | `src/components/TurtleVideo.tsx` | 再生・シーク・可視復帰・AudioContext復帰・iOS用回避が集中 | 分離不足 |
| エクスポート | `src/hooks/useExport.ts` | iOS Safari は MediaRecorder 優先、非iOS は WebCodecs 系 | 方向性は良いが1ファイルに混在 |
| メディア読込 | `src/components/media/MediaResourceLoader.tsx` | `playsInline`、可視配置で共通運用 | 共通化維持でよい |
| BGM/ナレーション入力 | `src/components/sections/BgmSection.tsx`, `src/components/sections/NarrationSection.tsx` | iOS Safari のみ `accept` 拡張 | capability/utility 化候補 |
| ダウンロード/保存 | `src/components/TurtleVideo.tsx` | `showSaveFilePicker` があれば使用、なければ `<a download>` | OS分岐ではなく capability 分岐で良い |
| 自動保存/手動保存 | `src/hooks/useAutoSave.ts`, `src/stores/projectStore.ts`, `src/utils/indexedDB.ts` | iOS専用分岐なし | まずは共通経路の実機検証対象 |

補足:

- `src/hooks/usePlayback.ts` と `src/hooks/useAudioContext.ts` は存在するが、**現在の実行経路では使われていない**。
- 実際の再生制御・オーディオ接続は `src/components/TurtleVideo.tsx` に集約されており、抽象化レイヤーが名目上しか存在しない。

---

## 3. Android と iOS で現状分けている処理

### 3.1 iOS Safari 専用で分けている処理

1. **音声ファイル入力の `accept` 拡張**
   - `src/components/sections/BgmSection.tsx`
   - `src/components/sections/NarrationSection.tsx`
   - `audio/*` だけでは iOS Safari で mp3 等が選択しづらいため、拡張子列挙を追加している。

2. **AudioContext 復帰・再初期化**
   - `src/components/TurtleVideo.tsx`
   - `interrupted` 状態を考慮し、`running` 以外なら `resume()`、通常再生開始時には `suspend() -> resume()` を挟んでいる。

3. **複数メディア同時再生時のネイティブ音声経路ミュート**
   - `src/components/TurtleVideo.tsx`
   - iOS Safari ではネイティブ音声経路競合があるため、WebAudio ノード接続に成功した要素のみ `muted` 化している。

4. **キャプションぼかしの描画フォールバック**
   - `src/components/TurtleVideo.tsx`
   - `CanvasRenderingContext2D.filter` のテキスト反映が不安定なため、多重描画で代替している。

5. **エクスポート中の動画同期しきい値緩和**
   - `src/components/TurtleVideo.tsx`
   - エクスポート時のドリフト補正しきい値が iOS Safari のみ緩く設定されている。

6. **エクスポート戦略そのものの切り替え**
   - `src/hooks/useExport.ts`
   - iOS Safari では MediaRecorder MP4 経路を最優先にし、非iOS は WebCodecs + mp4-muxer 系を通る。

7. **iOS Safari 向け音声抽出フォールバック**
   - `src/hooks/useExport.ts`
   - `decodeAudioData()` がビデオコンテナ音声を扱えないため、`<video>` + `MediaElementAudioSourceNode` + `ScriptProcessorNode` のリアルタイム抽出にフォールバックしている。

8. **iOS Safari MediaRecorder 安定化処理**
   - `src/hooks/useExport.ts`
   - clone track、`requestFrame()`、keep-alive 微小音、visibility pause/resume、短い timeslice、`requestData()` 後 stop 遅延を実装している。

### 3.2 Android 寄り、または非iOS既定経路として分けている処理

1. **シークバー遅延 `change` 競合対策**
   - `src/components/TurtleVideo.tsx`
   - コメント上も Android を主対象としており、シークセッション外 `change` に対して再生状態を壊さず位置同期だけ行う。

2. **WebCodecs + TrackProcessor 経路**
   - `src/hooks/useExport.ts`
   - 実質的に PC/Android の既定経路。`TrackProcessor` が使える場合はこちらを使う。

3. **保存系の capability fallback**
   - `src/components/TurtleVideo.tsx`
   - これは Android 専用ではなく、`showSaveFilePicker` があれば使い、なければ `<a download>` にフォールバックする共通設計。

### 3.3 実態として分けていない処理

- 自動保存/手動保存
- 各種設定
- IndexedDB 永続化
- プロジェクト保存データ構造

この領域は現状**共通実装のまま**であり、iOS Safari 正式対応では「まず実機検証し、必要時だけ局所分岐」を採るのが妥当。

---

## 4. なぜ iOS Safari だと正式対応になっていないか

### 4.1 API/ブラウザ仕様差分

1. **`decodeAudioData()` がビデオコンテナ音声を扱えない**
   - `src/hooks/useExport.ts`
   - `.mov/.mp4` 由来の音声をそのままオフライン処理できず、リアルタイム抽出フォールバックが必要。

2. **`AudioContext.state === 'running'` だけでは安全ではない**
   - `src/components/TurtleVideo.tsx`
   - iOS Safari では `interrupted` や、`running` でも無音化するケースがあり、通常ブラウザ前提の復帰ロジックがそのまま通用しない。

3. **複数メディア要素のネイティブ音声経路競合**
   - `src/components/TurtleVideo.tsx`
   - 動画音声、BGM、ナレーションを重畳する時に iOS Safari だけ経路競合しやすい。

4. **Canvas/録画系 API の挙動差**
   - `src/hooks/useExport.ts`
   - `requestFrame()`、終端チャンク、静止画主体タイムライン、visibility 復帰で PC/Android と挙動が揺れる。

5. **Canvas text filter 差分**
   - `src/components/TurtleVideo.tsx`
   - キャプションぼかしに分岐が必要。

### 4.2 実装構造上の問題

1. **iOS回避と共通再生制御が `TurtleVideo.tsx` に混在**
   - `renderFrame()` が `_isExporting`、`isIosSafari`、`exportPlayFailedRef` を直接見ており、プレビューとエクスポートが制御層で結びついている。

2. **プラットフォーム判定が散在**
   - 同じ `isIosSafari` 判定が4か所に重複しており、条件不整合や将来修正漏れの温床。

3. **戦略分離は一部だけ**
   - エクスポートは iOS Safari MediaRecorder 経路があるが、`useExport.ts` 内部に埋め込まれていて差し替え可能な構造ではない。

4. **自動テストが不足**
   - `src/test/` 配下に、プレビュー再生・エクスポート・プラットフォーム分岐を検証するテストは見当たらない。

5. **プロダクト上もまだ非対応表示**
   - `src/constants/sectionHelp.ts` に「iPhone（iOS・Safari）は現状非対応」と残っている。

要するに、**一部機能は既に動くが、正式対応として安全に保証できる構造と検証がまだ不足している**。

---

## 5. 分離すべき箇所 / 共通化すべき箇所

### 5.1 分離すべき箇所

1. **エクスポート戦略**
   - `iOS Safari MediaRecorder`
   - `標準 WebCodecs`
   - `最終フォールバック`

2. **プレビュー制御ポリシー**
   - AudioContext 復帰
   - ネイティブ音声ミュート方針
   - 同期しきい値
   - キャプション描画フォールバック

3. **プラットフォーム capability 判定**
   - `isIosSafari`
   - `supportsTrackProcessor`
   - `supportsCanvasRequestFrame`
   - `supportsShowSaveFilePicker`
   - `supportsMp4MediaRecorder`

4. **アップロード `accept` 生成**
   - BGM/Narration から分離し、共通 utility 化する。

### 5.2 共通化すべき箇所

1. **タイムライン計算**
   - `src/utils/playbackTimeline.ts` は共通化の核として維持。

2. **Canvas 基本描画**
   - アクティブクリップ判定
   - スケール/位置/フェード計算
   - キャプションのレイアウト計算

3. **音声ミックスの概念モデル**
   - BGM/ナレーション/クリップ音声の時間配置そのものは共通。
   - Safari で変えるべきなのは「抽出・取得経路」であって「タイムライン意味論」ではない。

4. **保存/読込データ構造**
   - 保存形式まで platform fork しない。

5. **ダウンロード UI**
   - capability fallback は共通のまま維持し、OS分岐にしない。

### 5.3 ユーザー提案の評価

> おそらく動画プレビュー再生、エクスポートを処理は影響を与えないように分離したほうが良い

この評価は妥当。  
ただし、**完全に別実装へ二重化するのではなく**、

- **共通**: タイムライン、描画ルール、音量/フェード意味論
- **分離**: 再生制御、AudioContext復帰、動画同期、エクスポート戦略

という切り方が最も安全。

---

## 6. 推奨アーキテクチャ

### 6.1 追加したい共通 capability 層

```ts
export interface PlatformCapabilities {
  isIosSafari: boolean;
  supportsShowSaveFilePicker: boolean;
  supportsTrackProcessor: boolean;
  supportsCanvasRequestFrame: boolean;
  supportsMp4MediaRecorder: boolean;
  audioContextMayInterrupt: boolean;
}
```

### 6.2 プレビュー側の分離イメージ

- `preview/renderFrameCore.ts`
  - Canvas 描画の共通ロジック
- `preview/previewPlatformPolicy.ts`
  - ブラウザ差分のしきい値・mute戦略・復帰戦略
- `preview/usePreviewController.ts`
  - 再生/停止/シーク/visibility を管理

### 6.3 エクスポート側の分離イメージ

- `export/strategies/iosSafariMediaRecorder.ts`
- `export/strategies/webCodecsMp4.ts`
- `export/exportStrategyResolver.ts`
- `useExport.ts`
  - strategy 選択と UI 連携だけを担当

---

## 7. 実装優先順位

1. **platform 判定と capability を共通化する**
2. **プレビュー制御を export 制御から切り離す**
3. **`useExport.ts` を strategy 分離する**
4. **アップロード/保存/ヘルプ表記の iOS 対応を整理する**
5. **iOS Safari 実機観点を含むテスト/検証項目を追加する**

---

## 8. 今回の判断

- **今すぐ二重実装にしない**
- **iOS Safari 固有制約だけを adapter / strategy に隔離する**
- **Android は専用実装を増やすより、既定経路 + capability fallback で扱う**
- **正式対応の判定は、プレビューとエクスポートだけでなく、保存/読込/設定まで通しで確認してから行う**

---

## 9. 2026-03-11 時点の確認状況

| 項目 | 状況 | 根拠 |
| --- | --- | --- |
| capability 判定 / strategy 選択 / 保存経路の pure logic | 自動確認済み | `src/test/platform.test.ts`, `src/test/exportStrategyResolver.test.ts`, `src/test/fileSave.test.ts` |
| プレビュー / export policy の pure logic | 自動確認済み | `src/test/previewPlatform.test.ts`, `src/test/useExport.test.ts`, `src/test/iosSafariMediaRecorder.test.ts` |
| TypeScript / build | 確認済み | `npm run build` |
| iOS Safari の音声付きエクスポート | 部分確認済み | `Docs/reports/ios-safari-audio-export-fix-report.md` の iPhone Safari 実機結果 |
| iOS Safari の手動保存 / 自動保存 / 読込 | 未確認 | IndexedDB は共通経路のまま。Safari 通常タブ / ホーム画面追加 / 再起動後保持の通し確認が残る |
| サポート表記 | 「非対応」から「検証中」へ更新 | `README.md`, `src/constants/sectionHelp.ts` |

### 9.1 正式対応判断の暫定結論

- 自動テストと build は、正式対応に向けた最低限の判断材料として揃っている
- iOS Safari の export 系は実機確認が進んでいるが、保存 / 読込 / 設定を含む主要受け入れ条件はまだ未完了
- したがって、2026-03-11 時点では「正式対応済み」と断定せず、「正式対応に向けて検証中」と表記するのが妥当
