# Turtle Video 実装パターン・注意点リファレンス

本プロジェクトに組み込まれている実装パターン・ワークアラウンド・注意すべきポイントを網羅的にまとめたドキュメントです。新機能の追加や既存コードの変更時に必ず確認してください。

---
## 0. Recent Notes

### 0-1. iOS Safari preview の遅延 `play()` は再生試行世代で無効化する

- **ファイル**: `src/components/TurtleVideo.tsx`, `src/utils/previewPlatform.ts`, `src/test/previewPlatform.test.ts`
- **背景**:
  - 同じ操作でも preview の成功率が揺れる場合、`seeked` / `canplay` を待っている古い `play()` callback が、次の seek や再生再開の後に遅れて発火していることがある
  - `isPlayingRef` だけでは「今の再生試行か」を識別できず、seek 中断や 0 秒戻しの直後に stale callback が割り込む
- **実装指針**:
  - `previewPlaybackAttemptRef` のような世代 ref を持ち、`stopAll()`, `handleSeekStart()`, preview の新規 `startEngine()`, `handleSeekEnd()` の再開時に必ずインクリメントする
  - 遅延 `play()` は helper で `isCurrentAttempt && isPlaying && !isSeeking && !mediaSeeking && readyState >= minReadyState` をまとめて判定する
  - seek 開始時は video だけでなく audio-only 要素も pause し、drag 中の古い再生状態を一旦切る
- **注意点**:
  - iOS Safari では `canplay` 自体が遅延到達することがあるため、listener を外すだけでは不十分で、発火後の no-op ガードが必要
  - timeout fallback で `play()` を再試行する場合も同じ世代 helper を使わないと、seek 直後の race が再発する


### 0-2. iOS Safari preview の future video prewarm は「画像区間中の次動画」を例外維持する

- **ファイル**: `src/components/TurtleVideo.tsx`, `src/utils/previewPlatform.ts`, `src/test/previewPlatform.test.ts`
- **背景**:
  - 遠い future video の prewarm を一律 `0.35s` に制限すると、画像クリップが 350ms を超える一般的なタイムラインで次動画が事前 `play()` 対象から外れる
  - `renderFrame()` は対象外になった inactive video を `pause()` するだけで、後から lead window に入っても rAF 外で再 prime されないため、iOS Safari の gesture credit を失った `play()` に逆戻りしやすい
- **実装指針**:
  - `shouldKeepInactiveVideoPrewarmed()` では、通常は lead window で future video を絞りつつ、**現在が画像/無動画区間で、かつ最も近い次動画** だけは距離に関係なく prewarm 維持を許可する
  - `startEngine()` / seek 再開 (`proceedWithPlayback`) / `renderFrame()` で同じ「最も近い future video」判定を共有し、初回 prime と維持判定が食い違わないようにする
- **注意点**:
  - 例外維持を許可するのは次動画 1 本だけに留め、2 本目以降の future video まで走らせない
  - active video 再生中まで例外を広げると、元の「遠い future video が BGM と競合する」問題を再発させやすい

### 0-3. iOS Safari の動画音声 + BGM preview は単一 WebAudio mix に寄せる

- **ファイル**: `src/utils/iosSafariAudio.ts`, `src/utils/previewPlatform.ts`, `src/components/TurtleVideo.tsx`, `src/hooks/useExport.ts`
- **背景**:
  - iOS Safari では動画要素のネイティブ音声と BGM/ナレーション要素を別経路で同時再生すると、AudioSession 競合で preview が無音化することがある
  - Android / PC の既存 preview / export は安定しているため、共通処理ではなく iOS Safari 専用分岐に閉じる必要がある
- **実装指針**:
  - iOS Safari 判定は `src/utils/platform.ts` の関数に集約し、呼び出し側へ UA 判定を散らさない
  - preview では `src/utils/iosSafariAudio.ts` の判定で「動画音声 + audio-only」が同時に鳴る場合だけ video も WebAudio へ寄せ、`masterDest` / `ctx.destination` に一本化する
  - `createMediaElementSource()` は `sourceElementsRef` と `sourceNodesRef` を使って同一 element へ 1 回だけ作成する
  - Safari 専用ログとして、判定結果・AudioContext state・gain 値・export route・失敗理由を残す
- **注意**:
  - Android / PC の既存ルートは変更しない。iOS Safari 専用 helper を経由して分岐させる
  - Safari 対応を理由に `previewPlatform` 全体の既定挙動を変えず、影響範囲を iOS 条件に限定する

### 0-4. 非アクティブ復帰の preview は blur / pagehide 先行でも再同期前提で扱う

- **ファイル**: `src/components/TurtleVideo.tsx`, `src/utils/previewPlatform.ts`, `src/test/previewPlatform.test.ts`
- **背景**:
  - Android / PC では別アプリ遷移やタブ移動の際、`visibilitychange(hidden)` より先に `blur` や `pagehide` が届くことがある
  - hidden 側イベントだけで `needsResyncAfterVisibilityRef` を立てていると、復帰時に `isPlayingRef` は再生中のままでもメディア要素が pause / decoder reset 済みで、ブラックアウトや `play()` 不安定が再発しやすい
- **実装指針**:
  - 復帰判定は `getVisibilityRecoveryPlan()` にまとめ、`resumedFromHidden` と `needsResyncFromLifecycle` の両方を見る
  - `blur` 先行時も、再生中 / 処理中なら `needsResyncAfterVisibilityRef` を立てて復帰時の `resyncMediaElementsToCurrentTime()` を保証する
  - `pagehide` では `visibilitychange(hidden)` と同様に pending seek を落とし、実行中メディアを pause して UI 再生状態も整える
- **注意点**:
  - `blur` だけで即 pause するとファイルピッカーや保存ダイアログでも再生が止まりやすいので、blur では「再同期予約」までに留める
  - 可視復帰時の `load()` は停止中だけに限定し、再生中は `resync + renderFrame` で復旧させる

### 0-5. export 音声は iOS/非 iOS とも OfflineAudioContext を先行プリレンダリングし、非 iOS はフレーム境界へ揃える

- **ファイル**: `src/hooks/useExport.ts`, `src/hooks/export-strategies/exportStrategyResolver.ts`, `src/test/exportStrategyResolver.test.ts`
- **背景**:
  - 非 iOS の warmup-only 経路では、端末負荷やリアルタイム音声キャプチャの揺れ次第で export 品質が不安定になりやすい
  - Android / PC では 30fps 出力でも、再生タイムラインがフレーム境界に揃っていないと「ところどころ引っかかる」見え方になりやすい
- **実装指針**:
  - `shouldUseOfflineAudioPreRender()` は platform を問わず `hasAudioSources` だけで判定し、iOS / Android / PC すべてで export 開始前に音声を確定生成する
  - 非 iOS の export 再生ループは `1 / FPS` のフレーム境界へ時間をスナップし、Canvas に描く映像時刻と CFR エンコード時刻を揃える
  - TrackProcessor / ScriptProcessor は OfflineAudioContext が失敗した場合のフォールバックとして維持する
- **注意点**:
  - iOS Safari の MediaRecorder 経路はそのまま維持し、非 iOS の滑らかさ対策を iOS 側へ波及させない
  - 非 iOS の時刻スナップは export ループだけに閉じ、通常 preview の再生体感は変えない

### 0-6. 非 iOS export の時間進行は壁時計ではなく決定的なフレームカウンタで進める（旧方針）

- **ファイル**: `src/components/TurtleVideo.tsx`, `src/utils/exportFrameTiming.ts`, `src/test/exportFrameTiming.test.ts`
- **背景**:
  - `Date.now()` ベースで `elapsed` を切り下げるだけでは、rAF の遅延やメインスレッド負荷が大きいと描画時刻自体が飛び、30fps 出力でも motion が所々で引っかかったように見えることがある
  - 非 iOS export は OfflineAudioContext で音声を先行確定できるため、映像側もリアルタイム追従より「1 フレームずつ確実に進める」方が安定しやすいと判断していた
- **実装指針**:
  - 非 iOS export では `fromTime + renderedFrameCount / FPS` を現在時刻として使い、壁時計ではなくフレームカウンタから `renderFrame()` の描画時刻を決める
  - export 開始時と `onAudioPreRenderComplete` 後にフレームカウンタを必ずリセットし、準備時間や一時停止の遅れがタイムライン進行へ混ざらないようにする
  - フレームカウンタは `stopAll()` でもクリアし、次回 preview / export セッションへ持ち越さない
- **注意点**:
  - この方針は 2026-03-23 時点で非 iOS 実機/実ブラウザでカクつき悪化報告があり、現行実装では採用しない
  - 進行基準を frame index に寄せても、実デコード/描画準備が追いつかないケースまでは吸収できない

### 0-7. 非 iOS export の滑らかさ制御は壁時計ベースへ戻し、音声プリレンダリングのみ維持する

- **ファイル**: `src/components/TurtleVideo.tsx`
- **背景**:
  - 非 iOS export を決定的なフレームカウンタ進行へ寄せると、rAF の遅延そのものは吸収できても、実ブラウザの動画デコードや Canvas 描画の準備が追いつかない場面で同一実フレームの取り込みが増え、結果として出力の体感がかえってカクつくケースがある
  - 一方で OfflineAudioContext による音声プリレンダリング自体は export 品質安定化に有効なため、その経路は維持する必要がある
- **実装指針**:
  - 非 iOS export の映像時刻は `Date.now()` ベースの既存進行へ戻しつつ、`1 / FPS` 単位のフレーム境界スナップは残して CFR エンコード時刻と概ね揃える
  - OfflineAudioContext の先行プリレンダリング判定や `onAudioPreRenderComplete` 後の開始時刻リセットは従来どおり維持する
- **注意点**:
  - 非 iOS の滑らかさ問題を再調整する場合でも、映像の時間進行変更と音声プリレンダリング変更は切り離して評価する
  - iOS Safari の MediaRecorder 経路や preview 再生の時間管理には波及させない

### 0-8. Teams 向け export は決定的なフレーム列を維持しつつ、最終フレームだけで総尺を合わせる

- **ファイル**: `src/hooks/useExport.ts`, `src/utils/exportTimeline.ts`, `src/test/exportTimeline.test.ts`
- **背景**:
  - Teams デスクトップへの投稿後は再エンコード時の音声・映像の総尺差に敏感で、1 フレーム未満の延長でも「少し遅い」見え方へ繋がることがある
  - 一方で全フレームの timestamp を実時間ベースへ戻すと、過去に潰した VFR ジッターが再発しやすい
- **実装指針**:
  - フレーム順序ベースの決定的 timestamp 採番は維持し、通常フレームの並びは壊さない
  - export の総尺は raw timeline duration に合わせ、必要な端数は **最後の 1 フレームだけ** の duration で吸収する
  - 音声のプリレンダリング長・AudioEncoder の終端 clamp も raw duration 基準へ揃え、映像側の切り上げ尺へ引っ張られないようにする
- **注意点**:
  - Teams 対策だからといって preview や iOS Safari MediaRecorder 経路へ同じ補正を広げない
  - 総尺合わせを理由に `frameCount` 自体を減らすと最後の静止保持が欠けるため、フレーム数は維持して duration 配分だけを調整する

### 0-9. Teams 向け export の音声 clamp / プリレンダ長も raw timeline duration へ揃える

- **ファイル**: `src/hooks/useExport.ts`, `src/utils/exportTimeline.ts`, `src/test/exportTimeline.test.ts`
- **背景**:
  - 映像だけ raw duration 基準へ戻しても、音声の clamp や OfflineAudioContext のプリレンダ長が `alignedDuration` のままだと、結局コンテナ上の総尺が CFR 切り上げ値へ寄ってしまう
  - その状態では Teams デスクトップ再エンコード時に AV 総尺差の補正が入り、以前抑えられていた「少し遅い」見え方が再発しやすい
- **実装指針**:
  - `expectedVideoFrames` は `ceil(totalDuration * FPS)` のまま維持し、映像フレーム数は減らさない
  - `getExportFrameTiming()` の最終フレーム duration、`maxAudioTimestampUs`、`feedPreRenderedAudio()` へ渡す最大長、`offlineRenderAudio()` へ渡す `totalDuration` は **すべて raw timeline duration 基準** に揃える
  - 通常フレームの timestamp / duration は決定的な CFR 採番を維持し、端数吸収は最終フレームだけへ閉じる
- **注意点**:
  - `alignedDurationSec` / `alignedDurationUs` は frame count 診断やデバッグ用途として残っていても、Teams 対策の実処理基準に混ぜない
  - raw duration へ戻す修正は export 専用で、preview の再生・シーク・停止や iOS Safari workaround へ波及させない

### 0-10. Android preview 境界の next video warmup は「実行済み状態」を必須にする

- **ファイル**: `src/flavors/standard/preview/usePreviewEngine.ts`
- **背景**:
  - `readyState=4` かつ次動画が存在していても、境界前 warmup が未実行だと `preview.trimmedEntry.preseekMiss` / `preview.nextVideo.startLatency` が再発し、境界直後の進みが鈍って `drift` が増える
  - 特に Android は decoder warmup が未完了のまま active 昇格すると、最初の 100ms 前後で停止体感が残りやすい
- **実装指針**:
  - 境界 500ms 前から next video warmup を開始し、`warmupExecuted` / `warmupCompleted` / `preseekCompleted` / `decoderWarmupCompleted` を state で保持する
  - `preview.preflight.ready` は上記 4 フラグが true になるまで成功扱いにしない（Android + 次動画ありの場合）
  - 境界ログで warmup state を必ず出し、active 昇格時の state 持ち越し成否（`stateCarriedToActive` / `stateLost`）を診断可能にする
- **注意点**:
  - holdFrame 条件や drift 閾値の緩和だけで品質問題を覆い隠さない
  - warmup 失敗時は warning を残し、次動画デコード未準備のまま smooth 扱いにしない

### 0-11. Android preview 境界は warmup フラグではなく実 video 状態と preroll で扱う

- **ファイル**: `src/flavors/standard/preview/usePreviewEngine.ts`, `src/flavors/standard/preview/useInactiveVideoManager.ts`, `src/test/standardPreviewEngine.test.tsx`
- **背景**:
  - Android preview の境界で warmup 系フラグが false 固定になり、実際には preroll 済みでも stateLost / preseekMiss 判定に引っ張られていた
- **実装指針**:
  - preflight では next video を `trimStart - 0.35s` へ合わせて `muted + playsInline + play()` で preroll し、readyState / currentTime / paused / seeking など実要素状態を基準に判定する
  - Android preview の inactive reset では active / next / previous を `protectedVideoIds` として除外し、境界前後の準備状態を壊さない
- **注意点**:
  - Android 分岐に閉じる（iOS Safari / export ルートへ波及させない）
  - preroll 失敗時は warning を残して診断可能にする

### 0-12. プレビュー再生中の video フェードアウト終端は黒クリア優先を無効化する

- **ファイル**: `src/components/turtle-video/usePreviewEngine.ts`
- **背景**:
  - `shouldBlackoutVideoFadeTail` は終端の残像対策として有効だが、再生中にも適用するとフェードアウトが途中で急に黒へ落ち、プレビューで「徐々に消える」見え方が損なわれる
  - 特にフェード長が短いクリップでは、終端保護の黒クリアが体感上ほぼ全量を上書きし、フェードが効いていないように見える
- **実装指針**:
  - `shouldSkipVideoDrawForFadeTail` は停止時/保持時（`!isActivePlaying`）に限定する
  - 再生中は `ctx.globalAlpha` による通常フェード描画を維持し、終端残像対策だけを最小範囲に閉じる
- **注意点**:
  - 終端黒フレーム防止の既存ロジックは維持し、export や iOS/Android 分岐の挙動は変更しない

### 0-13. iOS Safari export completion UI trusts only confirmed downloadable results

- **Files**: `src/hooks/useExport.ts`, `src/components/TurtleVideo.tsx`, `src/flavors/apple-safari/export/iosSafariMediaRecorder.ts`, `src/hooks/export-strategies/types.ts`
- **Issue**: iOS Safari MediaRecorder can create a valid Blob URL after the export loop reaches the natural end, while stale `cancelReason='user'` remains in the export FSM. If the UI callback is suppressed in that state, the preview button stays in the blue "creating video" state even though a downloadable result exists.
- **Approach**:
  - 2026-05-26 success baseline: iOS Safari preview and export both work. The successful export path reaches natural timeline end, stops the active MediaRecorder, creates a Blob URL, clears processing, and transitions the preview action area from the blue creating state to the green download button.
  - MediaRecorder completion callbacks must include `ExportRecordingResult` metadata: `source`, `blobSizeBytes`, and `signalAborted`.
  - `TurtleVideo` must pass the recorderRef returned by the main `exportRuntime.useExport()` call into `previewRuntime.usePreviewEngine()`. The iOS Safari natural-end path uses this ref to stop/requestData from the active MediaRecorder; a local or preview-cache ref leaves export finalization waiting and prevents `exportUrl` from reaching the UI.
  - `useExport` may recover from stale user-cancel only when the result is confirmed downloadable (`url`, `ext`, positive blob size) and either the timeline is at natural end or iOS MediaRecorder reports `signalAborted === false`.
  - User-initiated aborts keep `signalAborted === true`; even if a partial Blob arrives later, the UI callback remains suppressed and the green download button is not shown.
  - Recovery memo: `Docs/2026-05-26_success_ios-safari-preview-export.md`.
- **Caution**:
  - Do not broaden this recovery to Android/standard preview cleanup. Keep it inside export completion notification logic so iOS preview quality and Android preview behavior remain unchanged.
  - The green download button is controlled by the UI store `exportUrl`, so every successful export path must deliver the UI callback after the Blob URL is actually created.

## 1. スクロール/スワイプ誤操作防止

### 1-1. モーダル表示時のボディスクロールロック

- **ファイル**: `src/hooks/useDisableBodyScroll.ts`
- **問題**: モーダル表示中に背景がスクロールする（特にモバイル）
- **対策**:
  - `body.style.overflow = 'hidden'` + `position: fixed` + `top: -scrollY`
  - クリーンアップ時に `window.scrollTo({ behavior: 'instant' })` で元の位置に復帰
- **注意**: `position: fixed` にすると元のスクロール位置がリセットされるため、`top: -scrollY` で視覚的な位置を保持する必要がある

### 1-2. スライダーのスワイプ保護（モバイル誤操作防止）

- **ファイル**: `src/hooks/useSwipeProtectedValue.ts`, `src/components/SwipeProtectedSlider.tsx`
- **問題**: モバイルで縦スクロール中にスライダーに指が触れて値が変わる
- **対策**:
  - `onTouchStart` → `onTouchMove` で `deltaX` vs `deltaY` を比較し方向を判定
  - 縦移動 > 横移動 → 縦スクロールと判断しスライダーの値をリセット
  - 80ms 未満のタッチは「通りすがりタップ」としてリセット
- **注意**: 方向判定は一度決めたら変更されない（`directionDecidedRef`）。閾値は `minMovement=15px`, `minTouchDuration=200ms`

---

## 2. ブラックアウト対策・表示復帰

### 2-1. タブ復帰時の Canvas 自動リフレッシュ

- **ファイル**: `src/components/TurtleVideo.tsx`
- **問題**: タブ切り替え後に Canvas が黒画面のまま
- **対策**:
  - `visibilitychange` イベントで Page Visibility API を監視
  - `document.visibilityState === 'visible'` で `requestAnimationFrame(() => renderFrame(...))` を実行
  - `readyState < 2` のメディア要素には `element.load()` で再読み込み
- **注意**: `visibilitychange` リスナーのクリーンアップを必ず行う

### 2-2. メディアリソースの可視配置（display: none 回避）

- **ファイル**: `src/components/media/MediaResourceLoader.tsx`
- **問題**: `display: none` にするとブラウザがビデオのデコードを停止する
- **対策**: `opacity: 0.001`, `position: fixed`, `zIndex: -100`, `pointerEvents: 'none'` で視覚的に隠しつつ、ブラウザにはレンダリング対象として認識させる
- **禁止**: `display: none` や `visibility: hidden` は使わない

### 2-3. メディア読み込みエラー時の自動リトライ

- **ファイル**: `src/components/media/MediaResourceLoader.tsx`
- **対策**: `onerror` 時に `setTimeout(() => el.load(), 1000)` で 1 秒後に再読み込み

### 2-4. シークバー終端での最終フレーム表示

- **ファイル**: `src/components/TurtleVideo.tsx`（`renderFrame`, `syncVideoToTime`）
- **問題**: シークバーを終端までスライドすると `time === totalDuration` となり、アクティブクリップの検索条件 `time < t + item.duration` を満たさないため黒画面が表示される（通常再生の終端では直前フレームが保持されるため問題なし）
- **対策**:
  - `renderFrame`: アクティブクリップが見つからず `time >= totalDuration` の場合、最後のクリップの最終フレーム（`duration - 0.001`）にフォールバック
  - `syncVideoToTime`: 同様に終端ケースで最後のビデオの最終フレーム位置にシーク
- **注意**: `0.001` のオフセットは最終フレームを確実に表示するための安全マージン。フレーム保持（`holdFrame`）パターンとの組み合わせで黒画面を完全に防止

### 2-5. 停止→再生経路での終端黒フレーム防止

- **ファイル**: `src/components/TurtleVideo.tsx`（`renderFrame`, `loop`, `startEngine`）
- **問題**: 「停止→再生→終端到達」で黒画像が一瞬挟まる。「途中シーク→終端到達」では再現しない
- **原因（完全版）**:
  - **直接原因**: ビデオ要素の内部再生クロックと `Date.now()` ベースのタイムラインクロック（`startTimeRef`）のドリフト。ビデオクロックが僅かに速いと、最終クリップのビデオが `trimEnd`（`= originalDuration`）に先に到達し、ブラウザが `ended` / `paused=true` にする。次の `renderFrame`（`isActivePlaying=true`）で: ① `holdFrame` チェック: `readyState >= 2 && !seeking` = true → `holdFrame = false` ② 黒クリア実行（`shouldGuardNearEnd` は `isActivePlaying=true` で無効） ③ `play()` on ended → HTML仕様によりposition 0へシーク → `seeking=true` ④ 描画チェック `readyState >= 2 && !seeking` → `seeking=true` で描画スキップ → 黒フレーム
  - **シーク操作が防ぐ理由**: シーク後の再生再開（`proceedWithPlayback`）で `startTimeRef` がリベースされ、蓄積ドリフトがリセットされる。残り再生時間が短く、ビデオが先に自然終了する前にタイムライン finalization が到達する
  - （旧原因）`startEngine` に `resetInactiveVideos()` がなかった問題、`loop` 終端分岐後の遅延 `renderFrame` 競合 → 既に対策済
- **対策**:
  - `startEngine` に `resetInactiveVideos()` を追加し、seek 経路と同一の初期化を実施
  - `renderFrame` に `shouldGuardNearEnd` 条件を追加: `!isActivePlaying && time >= totalDuration - 0.1` のとき黒クリアを抑止
  - `endFinalizedRef` フラグ: `finalizeAtEnd()` で設定し、後続の遅延 `renderFrame` による黒クリアを 300ms 間完全に抑止。`startEngine` / `handleStop` / `handleSeekChange` でクリア
  - **`shouldHoldForVideoEnd` ガード（v3.0.6）**: holdFrame チェックで `activeEl.ended` またはビデオの `currentTime >= duration - 0.05` を検出し、タイムライン終端 0.2 秒以内なら `holdFrame = true` にして黒クリアを抑止。これにより `play()` on ended → seeking の連鎖を根本的にブロック
  - **`isEndedNearEnd` play() ガード（v3.0.6）**: forEach 内のアクティブビデオ処理で、ended 状態かつ終端 0.2 秒以内のとき sync と `play()` の両方を抑止。position 0 へのシーク発動自体を防止
  - 終端付近（±0.5秒以内）での黒クリア実行時に診断ログを出力
- **注意**: `shouldGuardNearEnd` は `isActivePlaying=false` のときのみ適用。`shouldHoldForVideoEnd` は `isActivePlaying` の値に関わらずビデオ終了状態を検出。アクティブ再生中のフェードアウト等には影響しない

### 2-6. Android再生中シークの遅延change競合対策

- **ファイル**: `src/components/TurtleVideo.tsx`（`handleSeekChange`, `handleSeekEnd`）
- **問題**: Android でシーク終了（`pointerup`/`touchend`）後に `change` が遅延発火すると、シーク再開準備と競合して `renderFrame(..., false)` が走り、再生のカクつきやブラックアウトが発生する
- **対策**:
  - `handleSeekChange` は `isSeekingRef.current === false` の場合、再生状態を維持したまま `syncVideoToTime(..., { force: true })` で同期する
  - `cancelPendingSeekPlaybackPrepare()` / `cancelPendingPausedSeekWait()` はアクティブなシークセッション中にのみ実行し、遅延 `change` で再開準備を破壊しない
  - `handleSeekEnd` の再生再開時刻は固定値ではなく `currentTimeRef.current` から再取得し、遅延イベントで更新された最終シーク位置を取りこぼさない
- **注意**: シークセッション外イベントで `renderFrame(..., false)` を実行すると、再生中動画を誤って `pause()` しやすい

---

## 3. AudioContext 管理

### 3-1. 遅延初期化 + ユーザージェスチャー要件

- **ファイル**: `src/hooks/useAudioContext.ts`, `src/utils/audio.ts`
- **問題**: AudioContext は Autoplay Policy によりユーザージェスチャー後でないと `resume()` できない
- **対策**:
  - `window.AudioContext || window.webkitAudioContext` でクロスブラウザ対応（Safari）
  - 初回呼び出し時にのみ AudioContext を作成（遅延初期化）
  - `ctx.state === 'suspended'` チェック後に `ctx.resume()`（必ず `.catch()` する）
- **注意**: メディアアップロード時やエンジン起動時に `resume()` を呼ぶ

### 3-2. SourceNode の重複防止

- **ファイル**: `src/components/TurtleVideo.tsx`, `src/hooks/useAudioContext.ts`
- **問題**: `createMediaElementSource()` を同じ要素に2回呼ぶとエラー
- **対策**: `sourceNodesRef.current[id]` で存在チェックし、既存のノードを再利用
- **注意**: 一度 `createMediaElementSource()` した要素は他の AudioContext で使えない

### 3-3. オーディオルーティング切替（再生 vs エクスポート）

- **ファイル**: `src/hooks/useAudioContext.ts`
- **対策**: `configureAudioRouting(isExporting)` で GainNode の接続先を `ctx.destination`（通常再生）/ `masterDest`（エクスポート）に切り替え

---

## 4. メモリ管理

### 4-1. ObjectURL の確実な解放

- **ファイル**: `src/utils/media.ts`, `src/stores/mediaStore.ts`, `src/stores/audioStore.ts`, `src/stores/uiStore.ts`
- **問題**: `URL.createObjectURL()` で作成した URL はメモリリークの原因
- **対策**:
  - `revokeObjectUrl()` ユーティリティで安全に解放（null/undefined チェック + try-catch）
  - メディア削除時、全クリア時、リストア時（既存 URL を先に解放）、エクスポート URL 更新時
- **注意**: `restoreFromSave` 時は「既存の」URL を先に解放してから新しいアイテムを設定する

### 4-2. AudioContext / MediaRecorder のクリーンアップ

- **ファイル**: `src/components/TurtleVideo.tsx`
- **対策**: `useEffect` のクリーンアップで `cancelAnimationFrame`、`audioCtx.close()`、`recorder.stop()`、全メディア要素の `pause()` を実行
- **注意**: 各操作を個別の `try-catch` で包み、1 つの失敗が全体のクリーンアップを阻害しないようにする

### 4-3. エクスポート中断時の AbortController

- **ファイル**: `src/hooks/useExport.ts`
- **対策**: `AbortController` + `videoReaderRef` / `audioReaderRef` を保持し、`stopExport()` で `abort()` + `reader.cancel()`

### 4-4. メモリ使用量の定期監視

- **ファイル**: `src/stores/logStore.ts`, `src/components/TurtleVideo.tsx`
- **対策**: 10 秒間隔で `performance.memory`（Chrome 限定）からヒープ使用量を取得・記録

---

## 5. エラーハンドリング（3層防御）

### 5-1. ErrorBoundary（コンポーネント層）

- **ファイル**: `src/components/common/ErrorBoundary.tsx`
- **対策**: クラスコンポーネントで `getDerivedStateFromError` + `componentDidCatch`。「再試行」と「リロード」の 2 段階リカバリ。`import.meta.env.DEV` で開発時のみ詳細表示

### 5-2. グローバルエラーハンドラ（window 層）

- **ファイル**: `src/main.tsx`
- **対策**: `window.addEventListener('error', ...)` + `unhandledrejection` で未捕捉エラーを `logStore` に記録

### 5-3. エラーメッセージの重複集約

- **ファイル**: `src/stores/uiStore.ts`
- **対策**: 同じメッセージはカウントインクリメント、`ErrorMessage` で「(N件)」表示。10 秒後に自動消去

### 5-4. ログの重複抑制

- **ファイル**: `src/stores/logStore.ts`
- **対策**: `DUPLICATE_SUPPRESS_MS = 10000` で 10 秒以内の同一キー（level+category+message）のログを抑制

---

## 6. パフォーマンス最適化

### 6-1. React.memo の適用

- **適用**: `ErrorMessage`, `Toast`, `MiniPreview`, `ClipItem`, `CaptionItem`, `PreviewSection`, `ClipsSection`, `BgmSection`, `NarrationSection`, `CaptionSection`, `SettingsModal`, `Header`
- **注意**: 新しいコンポーネントを作成したら、必要に応じて `React.memo` の適用を検討する

### 6-2. カスタム比較関数付き memo

- **ファイル**: `src/components/media/MediaResourceLoader.tsx`
- **問題**: トリミング等のプロパティ変更で DOM 要素を再作成したくない
- **対策**: `memo(Component, (prev, next) => prev.item.id === next.item.id && prev.item.url === next.item.url)` で URL と ID 以外の変更を無視

### 6-3. MiniPreview の描画最適化

- **ファイル**: `src/components/common/MiniPreview.tsx`
- **対策**:
  - `IntersectionObserver` で画面外のプレビューは描画しない
  - ビデオ再生中は約 15fps（66ms 間隔）でスロットリング
  - `itemRef` パターンで `useCallback` 依存から `item` を除外し関数再生成を防止

### 6-4. 再生/一時停止のデバウンス

- **ファイル**: `src/components/TurtleVideo.tsx`
- **対策**: `lastToggleTimeRef` で 200ms 以内の連続クリックを無視

### 6-5. シークのスロットリング

- **ファイル**: `src/components/TurtleVideo.tsx`
- **対策**: `lastSeekTimeRef` + `pendingSeekRef` で高頻度のシーク操作を間引く

### 6-6. 次のビデオのプリロード

- **ファイル**: `src/hooks/usePlayback.ts`
- **対策**: アクティブクリップの残り時間が 1.5 秒未満になったら、次のビデオの `currentTime` を `trimStart` 位置に設定

---

## 7. モバイル / レスポンシブ対応

### 7-1. 画面向き固定

- **ファイル**: `src/hooks/useOrientationLock.ts`
- **対策**: `screen.orientation.lock(orientation)` で固定。PC や非対応ブラウザではエラーを黙殺
- **注意**: クリーンアップ時のアンロックは**意図的に行わない**（アプリに戻った時も固定を維持）

### 7-2. playsInline 属性

- **ファイル**: `src/components/media/MediaResourceLoader.tsx`
- **問題**: iOS Safari ではデフォルトでビデオがフルスクリーン再生になる
- **対策**: `<video playsInline>` 属性を必ず付与

---

## 8. データ永続化

### 8-1. IndexedDB によるプロジェクト保存

- **ファイル**: `src/utils/indexedDB.ts`
- **対策**: Promise ベースのラッパー。`'auto'` / `'manual'` の 2 スロット方式
- **注意**: `request.onerror` と `request.onsuccess` の両方ハンドリングが必要。トランザクション後に `db.close()`

### 8-2. メディアファイルのシリアライズ

- **ファイル**: `src/stores/projectStore.ts`, `src/utils/indexedDB.ts`
- **問題**: `File` オブジェクトや Blob URL はそのまま IndexedDB に保存できない
- **対策**: 保存時 `File → ArrayBuffer`、復元時 `ArrayBuffer → File → URL.createObjectURL()`
- **注意**: ArrayBuffer は大容量になり得る。`getStorageEstimate()` で容量確認可能

### 8-3. 自動保存（変更検知付き）

- **ファイル**: `src/hooks/useAutoSave.ts`
- **対策**: 保存対象のメディア/BGM/ナレーション/キャプション属性を連結したハッシュで変更検知。少なくとも動画の `trimStart` / `trimEnd` に加え、`scale` / `positionX` / `positionY` の transform 変更も差分として扱う。空データ時とエクスポート中はスキップ
- **注意**: エクスポート中（`isProcessing`）は保存をスキップ（動画品質保護）

### 8-4. ページ離脱防止

- **ファイル**: `src/hooks/usePreventUnload.ts`
- **対策**: `beforeunload` イベントで `e.preventDefault()` + `e.returnValue` 設定（複数ストアのデータ有無を確認）


### 8-5. 手動保存の容量不足リカバリ

- **ファイル**: `src/stores/projectStore.ts`, `src/components/modals/SaveLoadModal.tsx`, `src/utils/indexedDB.ts`
- **問題**: 大きなプロジェクトでは `auto` + `manual` の2スロット保持で容量上限に達し、手動保存が `QuotaExceededError` で失敗しやすい
- **対策**:
  - IndexedDB 例外の詳細（DOMException名/メッセージ）を保存エラーに付与
  - 手動保存時に容量不足を検知した場合、`auto` は自動削除せず失敗を返す
  - UI 側で「自動保存を削除して続行」確認を出し、ユーザー同意時のみ `auto` 削除後に手動保存を再試行
- **注意**: `auto` 削除は明示同意時のみ実行し、勝手に復元ポイントを失わないようにする

### 8-6. 自動保存失敗時は変更検知ハッシュを進めない

- **ファイル**: `src/hooks/useAutoSave.ts`, `src/stores/projectStore.ts`, `src/test/useAutoSave.test.tsx`
- **背景**:
  - `saveProjectAuto()` は失敗を store に記録して呼び出し元へ例外を投げない設計のため、hook 側が戻り値なしで「成功」と見なすと、IndexedDB 失敗後でも `lastSaveHashRef` だけ進んでしまう
  - その状態では内容が変わらない限り次回以降が `skipped-nochange` になり、保存日時表示だけ古いまま固定される
- **実装指針**:
  - `saveProjectAuto()` は成功/失敗を boolean で返し、`useAutoSave()` は成功時だけ変更検知ハッシュを更新する
  - 失敗時は `autoSaveError` / `lastSaveFailure` を保持したまま、次周期で同じ内容を再試行できるようにする
- **注意**:
  - 自動保存は silent failure になりやすいので、hook 側で「保存 API を await した」ことと「実際に保存できた」ことを分けて扱う
  - `skipped-processing` だけでなく、失敗ケースでも catch-up 判定の基準時刻を不用意に進めない


---

## 9. メディアハンドリング

### 9-1. WebCodecs + mp4-muxer による MP4 エクスポート

- **ファイル**: `src/hooks/useExport.ts`
- **対策**:
  - `VideoEncoder`（H.264 Main Profile）+ `AudioEncoder`（AAC-LC）
  - **CFR 強制**: フレームインデックスからタイムスタンプを再計算し、VFR による再生速度問題を回避
  - `VideoFrame` は `close()` しないとメモリリーク
- **注意**: `recorderRef.current` にダミー MediaRecorder を設定（既存コードとの後方互換性）

### 9-2. Canvas 描画パイプライン

- **ファイル**: `src/hooks/usePlayback.ts`, `src/utils/canvas.ts`
- **対策**: 毎フレーム黒塗りクリア → `drawImage` → フェードアルファ適用。`ctx.save()/restore()` でトランスフォームを安全に管理
- **注意**: `ctx.globalAlpha` を描画後に `1.0` に戻す必要がある

### 9-3. ビデオ同期制御

- **ファイル**: `src/hooks/usePlayback.ts`
- **対策**: 再生中は `0.8 秒` 以上ズレた場合のみシーク（頻繁なシークを回避）。停止中は `0.01 秒` のより厳密な閾値

### 9-4. 再生開始時のビデオ準備待機

- **ファイル**: `src/components/TurtleVideo.tsx`
- **対策**: `canplay` イベント（readyState >= 3）を `{ once: true }` で待機。1 秒タイムアウトのフォールバック
- **注意**: `canplaythrough` ではなく `canplay` を使用（長い動画では `canplaythrough` が発火しない場合がある）

### 9-5. 再生ループの世代管理

- **ファイル**: `src/components/TurtleVideo.tsx`
- **問題**: 複数の再生ループが同時に走ると競合
- **対策**: `loopIdRef` をインクリメントし、各ループが自身の ID を検証。不一致なら自動終了

### 9-6. GainNode によるボリューム / フェード制御

- **ファイル**: `src/hooks/usePlayback.ts`
- **対策**: `gain.setTargetAtTime(vol, ctx.currentTime, 0.05)` でスムーズなボリューム遷移。非アクティブ要素は即座にミュート

### 9-7. iOS Safari エクスポート安定化

- **ファイル**: `src/hooks/useExport.ts`, `src/components/TurtleVideo.tsx`
- **問題**:
  - iOS Safari で音声トラックが取得できないケースや空バッファ時に、UI が「作成中」のまま復帰しない
  - エクスポート中の時間補正シークで、黒フレームが周期的に混入する
  - iOS Safari では `MediaStreamTrackProcessor` 経由の `masterDest.stream` 音声読み取りが正しく動作しない
  - `needsCorrection` が通常再生時にも `holdFrame` を発動し、iOS Safari で再生がカクつく
  - iOS Safari では `MediaStreamAudioDestinationNode` → `ScriptProcessorNode` 経由のリアルタイム音声キャプチャが root cause として機能しない（ストリーム経由データドロップ、ScriptProcessor メインスレッド競合、iOS 最適化によるノード無効化）
- **対策**:
  - `startExport` に失敗コールバックを追加し、例外・中断・空バッファ時に呼び出し元で `isProcessing` を確実に解除
  - `MediaStreamTrackProcessor` 非対応または iOS Safari では、`VideoFrame(canvas)` による直接キャプチャへフォールバック
  - **muxer と AudioEncoder は常に音声付きで設定**（`audioTrack` の有無に関わらず）
  - **iOS Safari では `OfflineAudioContext` による音声プリレンダリング方式を使用**:
    - エクスポート開始前に全音声ソース（動画音声、BGM、ナレーション）の `File` オブジェクトを **メインAudioContext** の `decodeAudioData` で `AudioBuffer` に変換（OfflineAudioContext上でのビデオコンテナ(MP4)デコード失敗を回避）
    - `OfflineAudioContext` 上で各ソースを `BufferSourceNode` + `GainNode` でタイムライン通りにスケジューリング（音量・フェードイン/アウト含む）
    - `startRendering()` で完全なミックスダウン済み `AudioBuffer` を生成
    - プリレンダリング済みバッファを **`f32-planar` 形式**の `AudioData` チャンクに分割し、`AudioEncoder` に直接供給（AudioBufferのネイティブ形式であり、iOS Safari AudioEncoderとの互換性が高い）
    - これにより `ScriptProcessorNode`、`MediaStreamAudioDestinationNode`、リアルタイム同期を完全に回避
    - **診断ログ**: レンダリング後の振幅チェック、AudioEncoder出力チャンクカウンタ、flush前後の状態ログを出力
  - **iOS Safari の `decodeAudioData` はビデオコンテナ(.mov/.mp4)のデコードに非対応**（`EncodingError: Decoding failed`）。音声専用ファイル(.mp3/.m4a/.wav)は正常にデコードできる
  - **ビデオコンテナのデコード失敗時のフォールバック**: `extractAudioViaVideoElement()` 関数で `<video>` 要素 → `MediaElementAudioSourceNode` → `ScriptProcessorNode` 経由のリアルタイム音声抽出を行う。動画の長さと同程度の時間がかかるが確実に動作する
  - **エクスポートのタイミング制御**: `ExportAudioSources.onAudioPreRenderComplete` コールバックにより、音声プリレンダリング（リアルタイム抽出含む）が完了した後にビデオキャプチャ用の再生ループを開始する。これにより、音声抽出とビデオエンコードのタイミング競合を回避。TurtleVideo.tsx の `startEngine` でエクスポートモード時は `loop()` をコールバック内で呼び出す
  - **startTimeRef のリセット（v3.0.5）**: `onAudioPreRenderComplete` コールバック内で `startTimeRef.current = Date.now() - fromTime * 1000` を再セットする。リアルタイム音声抽出に費やした時間（動画の長さと同等）だけ `startTimeRef` が古くなり、`loop()` の `elapsed` 計算で即座に `elapsed >= totalDuration` となりループが0フレームで終了する問題を防止
  - OfflineAudioContext 失敗時は従来の ScriptProcessorNode 方式にフォールバック
  - `renderFrame` で「補正シークが必要なフレーム」を事前に `holdFrame` 扱いにし、黒クリアを回避（**エクスポート時のみ適用、通常再生には影響させない**）
  - iOS Safari のエクスポート時は動画同期しきい値を緩和（通常 0.5 秒 / Safari エクスポート時 1.2 秒）
  - iOS Safari の通常再生時は同期しきい値を 1.0 秒に緩和し、過剰なシークによるカクつきを防止
  - iOS Safari MediaRecorder 経路では live `masterDest.stream` へ依存せず、`OfflineAudioContext` で事前レンダリングした `AudioBuffer` を `MediaStreamAudioDestinationNode` 経由の専用録音ストリームに変換して録音へ渡す。`画像 -> 動画` 境界で video 要素の `play()` 立ち上がりが遅れても、録音音声はそこで途切れない
- **注意**:
  - クリップ切替直後のみ厳密同期（0.05 秒）を維持し、それ以外は過剰なシークを避ける
  - `OfflineAudioContext` はリアルタイムではなく最大速度でレンダリングするため、メインスレッド負荷の影響を受けない
  - `decodeAudioData` が失敗した音声ソース（画像アイテム、音声トラックなし等）は自動的にスキップ（各ソースのデコード成否をログ出力）
  - フェード時間の重複（短いクリップ）は按分で自動クランプ
  - BGM/ナレーションのフェードアウトはプロジェクト終端からの相対位置で計算
  - iOS MediaRecorder がプリレンダ済み音声ストリームを使う場合は、strategy 側で `recorder.start()` 後に `preRenderedAudio.startPlayback()` を呼び、その後 `onAudioPreRenderComplete` で export ループを開始する。録音開始前に音声だけ先走らせない

### 9-8. Platform capability 判定の共通化

- **ファイル**: `src/utils/platform.ts`, `src/components/TurtleVideo.tsx`, `src/hooks/useExport.ts`, `src/components/sections/BgmSection.tsx`, `src/components/sections/NarrationSection.tsx`
- **問題**: `isIosSafari`、`showSaveFilePicker`、`MediaStreamTrackProcessor`、MediaRecorder MP4 対応、音声アップロード `accept` が複数箇所に重複し、iOS 分岐を更新するたびに Android/PC 側へ差分が漏れやすい
- **対策**:
  - `src/utils/platform.ts` にブラウザ判定と capability 判定を集約
  - セクション UI の `accept`、プレビュー側の保存 API 判定、エクスポート側の TrackProcessor / MediaRecorder 判定を同じ utility 参照へ統一
- **注意**: capability 共通化フェーズでは判定ロジックの集約に留め、再生ループやエクスポート戦略の分岐順序は変更しない

### 9-9. Preview platform policy による iOS 再生制御の分離

- **ファイル**: `src/utils/previewPlatform.ts`, `src/components/TurtleVideo.tsx`, `src/test/previewPlatform.test.ts`
- **問題**: プレビュー側の同期しきい値、caption blur fallback、AudioContext 再初期化、ネイティブ音声 mute 方針が `TurtleVideo.tsx` に直書きされ、iOS Safari 向け調整を変えるたびに render / visibility / audio attach の複数箇所を同時修正する必要があった
- **対策**:
  - `src/utils/previewPlatform.ts` に `PreviewPlatformPolicy` を追加し、通常再生/エクスポートの同期しきい値、可視復帰の debounce、AudioContext resume 再試行回数、caption blur fallback、native mute 方針を集約
  - `TurtleVideo.tsx` 側は `isIosSafari` を直接見ず、preview policy の helper で判定する形へ置換
  - pure logic は `src/test/previewPlatform.test.ts` で自動検証する
- **注意**:
  - iOS 向け挙動を追加調整するときは、`TurtleVideo.tsx` に数値や `isIosSafari` 条件を増やすのではなく、まず preview policy に寄せる
  - 既存の終端黒フレーム対策や export fallback seek の条件順序は変えず、policy は「閾値と方針」のみに留める

### 9-10. Export strategy resolver による iOS 経路の分離

- **ファイル**: `src/hooks/useExport.ts`, `src/hooks/export-strategies/exportStrategyResolver.ts`, `src/hooks/export-strategies/iosSafariMediaRecorder.ts`, `src/test/exportStrategyResolver.test.ts`, `src/test/iosSafariMediaRecorder.test.ts`, `src/test/useExport.test.ts`
- **問題**: `useExport.ts` に iOS Safari MediaRecorder 経路と標準 WebCodecs 経路の選択・実装が混在し、分岐条件の変更時に iOS 固有ワークアラウンドを WebCodecs 側へ誤って波及させやすかった。加えて、分離後に片方の経路だけが壊れても自動検知しづらかった
- **対策**:
  - strategy resolver で優先経路を決め、`useExport.ts` は選択と共通セッション初期化を担当する
  - iOS Safari の MediaRecorder 経路は `iosSafariMediaRecorder.ts` に切り出し、keep-alive 音声、visibility pause/resume、requestData 後 stop 遅延を strategy 側へ閉じ込める
  - resolver には WebCodecs 側の音声キャプチャ分岐（offline rendered / TrackProcessor / ScriptProcessor）も寄せ、純粋ロジックを `src/test/exportStrategyResolver.test.ts` で自動検証する
  - iOS strategy は `src/test/iosSafariMediaRecorder.test.ts` で、fallback、成功時の callback 伝播、track cleanup を検証する
  - `src/test/useExport.test.ts` では hook 契約として、iOS 優先起動、fallback 時の WebCodecs 移行、stop/abort、Blob URL 解放を薄く確認し、strategy 分離後のオーケストレーション回帰を拾う
- **注意**:
  - iOS 固有の録画回避策を追加する場合は `useExport.ts` に直接条件を戻さず、まず strategy / resolver へ寄せる
  - WebCodecs 側の CFR、AudioEncoder 終端クランプ、TrackProcessor / ScriptProcessor fallback の順序は既存どおり維持する

### 9-11. Capability ベースの保存/ダウンロード経路統一

- **ファイル**: `src/utils/fileSave.ts`, `src/components/TurtleVideo.tsx`, `src/components/modals/SaveLoadModal.tsx`, `src/constants/sectionHelp.ts`, `src/test/fileSave.test.ts`
- **問題**: エクスポート動画、AI ナレーション保存、生成画像保存で `showSaveFilePicker` と `a[download]` の分岐が重複し、iOS Safari 向けの保存導線や完了メッセージを調整するたびに複数箇所を直す必要があった。ヘルプ文言も iPhone を一律非対応扱いのままで、現状の保存方針とずれていた
- **対策**:
  - `src/utils/fileSave.ts` に `file-picker` / `anchor-download` の resolver と保存 helper を追加し、caller 側はファイル名・MIME・通知文言だけを持つ
  - `TurtleVideo.tsx` の動画ダウンロードとナレーション保存、`SaveLoadModal.tsx` の生成画像保存を同じ helper に寄せる
  - `src/test/fileSave.test.ts` で strategy 選択、object URL 保存、blob 保存の回帰を自動検証する
  - `sectionHelp.ts` と SaveLoadModal のヘルプでは、iPhone / iPad Safari を「正式対応に向けて検証中」とし、保存ダイアログ対応の有無で挙動が分かれること、手動保存 / 自動保存 / 読込の確認観点を明示する
- **注意**:
  - 保存データ本体は引き続き IndexedDB の共通経路を使い、iOS Safari 向けの保存領域 fork は実機不具合が出るまで追加しない
  - 新しいダウンロード導線を増やす場合は個別に `showSaveFilePicker` を判定せず、まず `fileSave.ts` の helper を再利用する

### 9-12. サポート表記は「検証中」と「正式対応」を分けて扱う

- **ファイル**: `README.md`, `Docs/2026-03-11_report_ios.md`, `src/constants/sectionHelp.ts`, `src/test/sectionHelp.test.ts`
- **問題**: 実装と自動テストが進んでも、README や help に「iPhone 非対応」が残ると現状の案内と乖離する。一方で、保存 / 読込 / 設定を含む実機受け入れが終わる前に「正式対応済み」と書くのも過剰
- **対策**:
  - ユーザー向け表記は「正式対応に向けて検証中」に統一し、保存先ダイアログ対応の有無などブラウザ差だけを案内する
  - `Docs/2026-03-11_report_ios.md` には、自動確認済み項目・部分実機確認済み項目・未確認項目を分けて記録し、正式対応可否の判断材料を残す
  - `src/test/sectionHelp.test.ts` で app/help 文言に「非対応」が戻っていないことと、保存導線の説明が維持されていることを確認する
- **注意**:
  - 「正式対応済み」へ切り替えるのは、保存 / 読込 / 設定まで含む iOS Safari の主要受け入れ条件を実機で確認した後に限る
  - ドキュメント上の表記変更だけで Phase 完了扱いにせず、必ず test/build と実機確認ステータスをセットで更新する

---

## 9.5. プレビューキャプチャ

### 9.5-1. CanvasフレームのPNGキャプチャ

- **ファイル**: `src/utils/canvas.ts` (`captureCanvasAsImage`), `src/components/TurtleVideo.tsx` (`handleCapture`), `src/components/sections/PreviewSection.tsx`
- **機能**: プレビューの現在のフレームをPNG画像としてダウンロード
- **対策**:
  - 再生停止中: 現在のCanvas内容をそのまま `canvas.toBlob('image/png')` でキャプチャ
  - 再生中: 先に `stopAll()` + `pause()` で一時停止し、現在のフレームをキャプチャ
  - `URL.createObjectURL(blob)` で一時URLを生成し、`<a>` 要素のクリックでダウンロードをトリガー
  - ObjectURLは `setTimeout(() => URL.revokeObjectURL(url), 1000)` で確実に解放
- **ファイル名规則**: `turtle_capture_{time}_{timestamp}.png`（例: `turtle_capture_1m30s_1738900000000.png`）
- **UI**: PreviewSectionの再生コントロール横にCameraアイコンボタンを配置する。停止とキャプチャの通常配色は既存のグレー系を維持し、キャプチャだけ押下後 0.42 秒のエメラルド系フラッシュ + 外側ハローで反応感を返す
- **注意**: エクスポート中（`isProcessing`）はキャプチャ不可。メディアがない場合も無効

## 10. 状態管理パターン

### 10-1. ストアの責務分離

| ストア | 責務 |
|--------|------|
| `mediaStore` | 動画・画像クリップの状態管理 |
| `audioStore` | BGM・ナレーションの状態管理 |
| `captionStore` | キャプションの状態管理 |
| `uiStore` | UI 状態（Toast、エラー、再生、エクスポート、AI モーダル） |
| `projectStore` | プロジェクト保存・読み込み管理 |
| `logStore` | ログ管理（エラー・警告・メモリ監視） |

### 10-2. ストア間の協調

- フック内で複数ストアのセレクタを使ってデータを集約
- ストア間の直接依存（import）は避け、**フック層で統合**する
- React 外からは `useXxxStore.getState().action()` でアクセス可能

### 10-3. Ref + State 並行管理

- **ファイル**: `src/components/TurtleVideo.tsx`
- **問題**: `useState` は非同期更新のため、再生ループ内で最新値が取れない
- **対策**: `currentTimeRef`, `isPlayingRef` 等の `useRef` でリアルタイム値を保持し、UI 再レンダリング用に `useState` も並行更新

### 10-4. 保存復元パターン（restoreFromSave）

- 全ストアに `restoreFromSave()` アクションを持たせ、保存データから状態を復元
- **復元前に既存 URL を `revokeObjectUrl` で解放**
- `totalDuration` も `calculateTotalDuration(items)` で再計算

### 10-5. ログの sessionStorage 永続化

- **ファイル**: `src/stores/logStore.ts`
- ページリロードでもログを保持。`MAX_LOG_ENTRIES = 500` でサイズ制限

---

## 11. PC / タブレット レスポンシブ対応

### 11-1. デスクトップアダプティブ戦略

- **原則**: モバイル（<768px）は一切変更せず、`md:` / `lg:` ブレイクポイントでのみPC/タブレット向けスタイルを追加
- **レイアウト**: `TurtleVideo.tsx` で `lg:grid lg:grid-cols-[1fr_480px]` による2カラムレイアウト（左: 編集コントロール、右: スティッキープレビュー）
- **コンテナ幅**: `max-w-md md:max-w-3xl lg:max-w-6xl` でビューポートに応じて拡大
- **注意**: 新しいコンポーネントを追加する場合は、モバイルファーストのスタイルを書き、必要に応じて `md:` / `lg:` レスポンシブバリアントを追加

### 11-2. テキスト・UIスケーリング

- **テキスト**: `text-[10px] md:text-xs`、`text-xs md:text-sm`、`text-sm md:text-base` のパターンで段階的に拡大
- **ボタン**: `px-3 py-1.5 lg:px-4 lg:py-2` でタッチターゲット拡大
- **アイコン**: `w-5 h-5 lg:w-6 lg:h-6` で視認性向上
- **スライダー**: `index.css` の `@media` クエリでトラック・サムのサイズを自動拡大
- **注意**: `index.css` に `@media (min-width: 768px)` / `@media (min-width: 1024px)` でグローバルなスライダー・スクロールバーの拡大ルールあり

### 11-3. 画面向き制御

- **ファイル**: `src/hooks/useOrientationLock.ts`
- **対策**: `window.innerWidth >= 768` の場合は向き固定をスキップし、タブレットの横画面使用を許可
- **注意**: スマホ（<768px）のみ `portrait` ロックを適用

---

## 横断的な注意点まとめ

| カテゴリ | 注意点 |
|---------|--------|
| **AudioContext** | `suspended` → `resume()` はユーザージェスチャーが必要。必ず `catch` する |
| **ObjectURL** | 作成したら必ず `revokeObjectURL` で解放。特にリストア時の古い URL に注意 |
| **Canvas** | `display: none` の video からは描画不可。`opacity: 0.001` で隠す |
| **WebCodecs** | `VideoFrame` は `close()` しないとメモリリーク。CFR 強制が重要 |
| **Safari Export** | iOS Safari では OfflineAudioContext による音声プリレンダリング方式を使用。メインAudioContextで`decodeAudioData`を実行し、`f32-planar`形式のAudioDataをAudioEncoderに直接供給する。**重要**: iOS Safari の `decodeAudioData` はビデオコンテナ(.mov/.mp4)をデコードできない（`EncodingError`）ため、`extractAudioViaVideoElement()` で `<video>` 要素経由のリアルタイム音声抽出にフォールバックする。muxer/AudioEncoder は常に音声付きで初期化。OfflineAudioContext 失敗時は ScriptProcessorNode にフォールバック |
| **タブ切替** | `visibilitychange` で hidden 時は通常再生を明示一時停止（`isPlayingRef=false` + `pause()`）、復帰時に Canvas 再描画と必要なメディア再同期を実行 |
| **下部モーダル** | 下から開くモーダルは `history.pushState` + `popstate` で戻るキー閉じを実装し、モバイルでは `scrollTop=0` かつ縦下スワイプ（72px超）で閉じる。長文入力を持つモーダルでは、`textarea` / テキスト入力など編集用フィールドから始まったタッチを閉じる判定の対象外にして、原稿スクロールと誤競合しないようにする。クリーンアップ時は自分の履歴 state が先頭のときのみ `history.back()` する |
| **AIナレーション(TTS)** | 声の調子は先頭に `（スタイル指示）` として付与し、TTS 指示で「括弧内は発話しない」を明示する。実際に読ませる本文は括弧の後ろのみ |
| **AIナレーション(原稿文量)** | 原稿生成は長さモードを秒数目安で統一する。`短め=約5秒（20〜35文字）` / `中くらい=約10秒（35〜60文字）` / `長め=約20秒（100〜140文字）` をプロンプトで明示し、過剰な長文化を防ぐ |
| **オフラインモード** | `offlineModeStore` を localStorage 永続化し、AIナレーション入口・Gemini 呼び出し・更新確認を一元ガードする。オフライン中の AI 追加/編集ボタンは disabled にして「押してエラー」ではなく「押せない」挙動へ寄せ、既存ナレーションの移動や削除は止めない。UI文言は「インターネット接続が必要な機能を使わない」ことを示し、ブラウザ/OSレベルの完全遮断ではないと明記する。ON 切替時だけ注意ダイアログを必須にし、OFF 復帰時は service worker 登録済みなら即時更新確認、未登録なら登録完了後に 1 回だけ更新確認する |
| **手動更新確認** | 設定タブの更新確認は `updateStore.checkForUpdate()` に集約し、更新検知時だけ既存の `ReloadPrompt` / `needRefresh` 表示を使う。更新が無いときだけ短い通知を出し、オフラインモード中はボタンを disabled にして実行自体を止める。`ReloadPrompt` の横幅は iOS Safari だけ左右余白付きの可変幅にして画面外にはみ出させず、Android / desktop の右下レイアウトは維持する |
| **設定モーダル操作** | API キー保存やオフラインモード切替のような設定変更は、その場で完了状態や警告を表示してモーダルを閉じない。説明文は短く保ち、無効/有効トグルや更新ボタンで分かる状態を重ねて説明しない。設定タブの操作ボタンは 無効=青系 / 有効=オレンジ系 の大きめトグルにし、ソフトウェア更新の手動確認は同サイズの青ボタンを中央寄せで置く。`history.pushState` を使うモーダルは最新の `onClose` を ref で参照し、親再描画だけで effect が張り直されて `history.back()` しないようにする |
| **自動保存タイマー** | `setInterval` は最新状態Refを参照して固定周期で実行し、編集状態の変化でタイマーを再生成しない。差分ハッシュは保存対象の実フィールドに合わせ、`trim` の後に `scale/position` だけ変わったケースも見逃さない。`visibilitychange/focus/pageshow` 復帰時は短い遅延でイベントを集約してから経過時間を判定し、手動保存中は追いつき保存を走らせない。手動保存成功時は現在ハッシュを自動保存の基準にも反映し、直後の重複 auto save を防ぐ。保存間隔変更は custom event + `storage` で即時反映する |
| **ヘッダーモーダル遷移** | 設定/保存ボタン押下でモーダルを開く前に、通常プレビュー再生中なら `stopAll() + pause()` で明示一時停止する。再生継続のまま開くとモバイルでタップ競合し、モーダルが瞬時に閉じる誤動作を誘発しやすい |
| **先頭フレーム描画** | `time <= 0.05` の先頭付近は、`エクスポート中` または `非再生時` に限ってキャンバスを強制クリアし、終端フレーム残像（終端キャプション）との重なりを防ぐ。通常再生開始時は保持ロジックを優先して黒フラッシュを回避する |
| **モバイル** | スライダー誤操作を `useSwipeProtectedValue` で防止。`playsInline` 必須 |
| **レスポンシブ** | モバイル既存スタイルは変更禁止。`md:` / `lg:` バリアントのみ追加で対応 |
| **IndexedDB** | `File → ArrayBuffer → File` のラウンドトリップが必要。大容量データに注意。容量不足時は`auto`を自動削除せず、確認後のみ削除リトライする。保存失敗は `lastSaveFailure` に reason / recoveryAction / storageEstimate を残し、復旧導線を UI から再実行できるようにする。`File` 読み出し失敗時は `file.arrayBuffer` / `FileReader` / object URL fetch の順に救済し、素材名付きで失敗理由を残す |
| **Zustand** | `getState()` で React 外アクセス可能。Ref+State 並行管理でリアルタイム値と再レンダリングを両立 |
| **再生ループ** | `loopIdRef` で世代管理。古いループの自動停止メカニズムが重要 |
| **シーク終端** | `time >= totalDuration` で最終クリップにフォールバックし黒画面を防止 |
| **停止→再生終端** | `startEngine` で `resetInactiveVideos()` を実行、`shouldGuardNearEnd` + `endFinalizedRef` で非アクティブ描画の黒クリア抑止、`shouldHoldForVideoEnd` でビデオ自然終了時の holdFrame 強制、`isEndedNearEnd` で ended ビデオへの play()/sync 抑止 |
| **キャプチャ** | 再生中は一時停止してからCanvasをキャプチャ。ObjectURLは`setTimeout`で解放 |
| **エラー** | 3 層防御: ErrorBoundary（コンポーネント）、グローバルハンドラ（window）、try-catch（個別処理） |

## 12. Dev Script Pattern (media-video-analyzer STT)

### 12-1. Whisper STT in dedicated venv

- **Files**: `scripts/dev/setup-media-analysis-env.ps1`, `scripts/dev/run-media-analysis.ps1`, `scripts/dev/analyze-video.py`, `scripts/dev/requirements-media-analysis-stt.txt`
- **Behavior**:
  - Keep STT dependencies optional via setup flag `-WithStt`.
  - Provide npm shortcut `npm run dev:media:setup:stt`.
  - `run-media-analysis.ps1` forwards STT args to analyzer for `-Mode transcribe`.
  - `analyze-video.py` uses provider fallback order: `faster-whisper` -> `openai-whisper`.
- **Caution**:
  - Install STT dependencies only after explicit user approval.
  - STT model download can require network and extra time; report this before execution.

### 12-2. Whisper model prefetch + blocked proxy guard

- **Files**: `scripts/dev/setup-media-analysis-env.ps1`, `scripts/dev/prefetch-whisper-models.py`, `package.json`
- **Behavior**:
  - Add `-PrefetchSttModels` and `-SttModels` to setup script for proactive model caching (`tiny`, `small`).
  - Add npm shortcut `npm run dev:media:setup:stt:models`.
  - Setup script temporarily disables only blocked loopback proxy values (`127.0.0.1:9`, `localhost:9`, `::1:9`) for install/prefetch commands and restores environment variables afterwards.
- **Caution**:
  - Guard is intentionally narrow; valid corporate proxies are left unchanged.
  - Prefetch still requires network access and can take time on first run.

### 12-3. Media analysis artifact cleanup policy

- **Files**: `scripts/dev/cleanup-media-analysis-artifacts.ps1`, `package.json`, `Docs/developer_guide.md`
- **Behavior**:
  - Provide `npm run dev:media:cleanup` to remove generated files under `tmp/video-analysis` and `.media-analysis-output`.
  - Provide `npm run dev:media:cleanup:keep-json` to keep only `*.json` reports in `tmp/video-analysis`.
  - Treat extracted audio and frame image dumps as disposable artifacts by default.
- **Caution**:
  - Keep JSON reports when evidence or review records are required.
  - Removing artifacts does not affect app runtime; they are developer-only outputs.

### 12-4. Issue CLI local gh fallback

- **Files**: `scripts/create-github-issue.mjs`, `.tools/gh/bin/gh.exe`, `Docs/github_issue_workflow.md`
- **Behavior**:
  - `issue:create` uses `gh` from `PATH` first.
  - If not found, it falls back to local bundled CLI at `.tools/gh/bin/gh.exe` (Windows).
  - Authentication remains required (`gh auth login` or `GH_TOKEN`).
- **Caution**:
  - `.tools/gh/LICENSE` should be kept together with bundled `gh.exe`.
  - Without authentication, issue creation fails even when `gh` binary is available.

### 12-5. Skills sync symlink preservation

- **Files**: `scripts/sync-skills.mjs`, `.github/skills/skills-sync-guard/scripts/safe-sync-skills.mjs`
- **Behavior**:
  - `Dirent.isFile()` だけではなく `Dirent.isSymbolicLink()` も同期対象・監査対象に含める。
  - 差分判定ハッシュは、通常ファイルは内容ハッシュ、symlink は `readlink()` のリンク先文字列を使う。
  - `latest` / `base` の両戦略で symlink を欠落させずに同期する。
- **Caution**:
- symlink をハッシュ対象から外すと `hasDiff=false` となり、必要な同期がスキップされる可能性がある。
- symlink を `stat/readFile` 前提で扱うと、リンク先の変更検知が不正確になる。

---

## 13. 文字コード・AI TTS 応答処理

### 13-1. ソース文字コードの UTF-8 統一

- **ファイル**: `src/components/sections/NarrationSection.tsx`, `src/stores/audioStore.ts`, `src/stores/projectStore.ts`
- **問題**: 一部ファイルが CP932 で保存されると、ビルド時に UTF-8 として解釈され、UI 文言が文字化けする
- **対策**:
  - 日本語文言を含むソースは UTF-8（BOMなし）で統一
  - 変換時は「CP932として読み取り → UTF-8で再保存」を行い、文字列自体は維持する
- **注意**:
  - PowerShell の既定エンコーディングで書き戻すと再発しやすい。書き込み時は `-Encoding utf8` または明示的な UTF-8 指定を使う
  - 画面上で `�` が出た場合は、まず対象ファイルの UTF-8 妥当性を確認する

### 13-2. Gemini TTS の `inlineData` 探索を固定位置依存にしない

- **ファイル**: `src/components/TurtleVideo.tsx`（`generateSpeech`）
- **問題**: `candidates[0].content.parts[0].inlineData` に固定すると、応答の並びや形式差分で `inlineData` を拾えず「音声データを取得できませんでした」になる
- **対策**:
  - 全 `candidates[].content.parts[]` を走査し、`inlineData` / `inline_data` の両方を探索
  - `promptFeedback.blockReason` / `finishReason` を補助情報として扱い、エラー原因を判別しやすくする
  - `mimeType` が WAV の場合は再変換せず利用し、PCM 系のみ WAV へ変換する
- **注意**:
  - `inlineData` 欠落時は API 側の安全ブロックや応答形式差分の可能性があるため、コンソール警告ログを確認する
  - `Model tried to generate text ... only be used for TTS` が返る場合は、話し方指示付きプロンプトが拒否されている可能性がある。`src/components/TurtleVideo.tsx` ではこのエラー時に「声の調子なしの素の原稿」で自動リトライする
  - `finishReason=OTHER` で音声未返却の場合は、`Say ...` / `TTS ... exactly` の厳密プロンプトへ切替えて再試行する
  - リトライは API コールを追加で消費するため、現在は最大2回（初回 + フォールバック1回）に制限してレートリミット悪化を抑える

### 13-3. ナレーションセクションの縦スクロール統一

- **ファイル**: `src/components/sections/NarrationSection.tsx`
- **問題**: ナレーションが増えるとセクションが伸び続け、動画・画像セクションと操作感が不一致になる
- **対策**: `max-h-75 lg:max-h-128 overflow-y-auto custom-scrollbar` を適用し、動画・画像セクションと同じ固定高さ + 内部スクロールに統一
- **注意**: モバイルの誤操作防止のため、既存の `SwipeProtectedSlider` は維持する

### 13-4. ナレーションの複数ファイル一括追加

- **ファイル**: `src/components/sections/NarrationSection.tsx`, `src/components/TurtleVideo.tsx`
- **問題**: ナレーションファイル入力が単一選択のみで、動画・画像セクションと操作性が揃っていない
- **対策**:
  - `NarrationSection` のファイル入力に `multiple` を付与
  - `handleNarrationUpload` を複数ファイル対応に変更し、選択された全ファイルを順番にメタデータ読み込みして `addNarration` する
  - 読み込み失敗したファイルは `ObjectURL` を解放し、失敗件数をトースト表示する
- **注意**:
  - 一括追加後の開始位置は「追加時点の currentTime スナップショット」を全ファイルに適用する
  - TTS側のフォールバックリトライと同様に、API呼び出しが増える処理は必要最小限に維持する

### 13-5. AIスクリプト生成モデル廃止へのフォールバック

- **ファイル**: `src/constants/index.ts`, `src/components/TurtleVideo.tsx`, `src/hooks/useAiNarration.ts`
- **問題**: `gemini-2.5-flash-preview-09-2025` のような preview モデルが廃止されると、スクリプト生成が即失敗する
- **対策**:
  - 既定モデルを `gemini-2.5-flash` に更新
  - `GEMINI_SCRIPT_FALLBACK_MODELS` を導入し、モデル未提供エラー時に自動で次候補へ再試行
  - フォールバックで成功した場合はユーザーへ通知し、生成体験を維持する
- **注意**:
  - モデル未提供判定は `no longer available / not found / 404` 系メッセージで実施
  - 不要な多段リトライはレートリミットを悪化させるため、候補数は最小限にする

### 13-6. ナレーションらしい原稿のための指示強化

- **ファイル**: `src/components/TurtleVideo.tsx`, `src/hooks/useAiNarration.ts`
- **問題**: テーマ入力だけでは説明文・見出し付き文など、読み上げに不向きな文体が生成されることがある
- **対策**:
  - `systemInstruction` を追加し、出力を「本文のみ・1段落・短尺動画向け口語文」に明示制約
  - ユーザープロンプトに用途（短い動画のナレーション）を明記
  - 生成後に軽い正規化（改行圧縮、先頭ラベル除去）を行い、読み上げ原稿として扱いやすくする
- **注意**:
  - 過度な整形は意味改変リスクがあるため、正規化は最小限に留める

### 13-7. AIナレーションUIの運用性向上

- **ファイル**: `src/components/modals/AiModal.tsx`, `src/components/TurtleVideo.tsx`, `src/types/index.ts`
- **問題**:
  - テーマ生成の長さ調整ができず、意図した尺の原稿を作りにくい
  - テーマ未入力でも手動で原稿を入力できることが画面上で伝わりにくい
  - PC表示で「声の調子」説明文が小さく視認性が低い
- **対策**:
  - `NarrationScriptLength`（`short` / `medium` / `long`）を導入し、Step 1 にラジオボタンで長さ選択UIを追加
  - 選択長さを `generateScript` の指示文に反映（文字数目安を可変化）
  - 「Step 1は任意」「Step 2へ直接入力可能」の補助文言を追加し、手動運用を明示
  - 「声の調子」ラベル・説明を `md:text-sm` へ拡大し、PCで読みやすく調整
- **注意**:
  - 音声生成ボタンは `aiScript.trim()` 判定で有効化し、空白のみの入力を防止する
  - 長さ選択は生成時のみ利用し、既存の手動編集フローを妨げない

### 13-8. ナレーション終了位置マーカー

- **ファイル**: `src/components/sections/NarrationSection.tsx`
- **問題**: 開始位置スライダー上で「そのクリップがどこで終わるか」が見えず、次クリップとの重なり確認がしづらい
- **対策**:
  - 各ナレーションカードの開始位置スライダー上に、終了位置（三角マーカー）を参考表示
  - 終了位置は `startTime + duration` から算出し、スライダー上に重ねて描画
  - タイムライン終端を超える場合はマーカーを右端にクランプして表示（非表示にはしない）
- **注意**:
  - マーカーは参考表示のみで、ナレーションの同時再生仕様（重なり許容）は変更しない
  - 右端クランプ時は色を変えて「終端超え」を視覚的に示す

### 13-9. AIナレーションモーダルの動線最適化

- **ファイル**: `src/components/modals/AiModal.tsx`
- **問題**:
  - Step1でテーマ入力後、長さ指定と作成操作の視線移動が大きく、操作動線が長い
  - 「声の選択」と「声の調子」で見出しのサイズ感・太さが揃っていない
- **対策**:
  - Step1の入力欄を `w-full` にし、長さ選択行の右端に「作成」ボタンを移動
  - `Step 3: 声の設定` を新設し、その下に「声の選択」「声の調子」を配置
  - 「声の選択」「声の調子」のラベルクラスを同一に統一して視覚的一貫性を確保
- **注意**:
  - `作成` は引き続き `aiPrompt.trim()` が空の場合は無効化する
  - Step2直入力フロー（テーマ未入力でも音声生成可能）は維持する

### 13-10. AIモーダルの操作ラベル明確化

- **ファイル**: `src/components/modals/AiModal.tsx`
- **問題**: ボタン文言が短すぎると、何を作る操作か分かりにくい
- **対策**:
  - Step1ボタンを `AI原稿を作成` に変更し、原稿生成操作だと明示
  - 最終ボタンを `AIナレーションを作成して追加` に変更し、音声生成と追加まで行う操作だと明示
- **注意**:
  - 生成対象の区別（原稿 vs 音声）を文言で維持し、誤操作を防ぐ

### 13-11. エクスポート音声の長さ超過・途切れ対策

- **ファイル**: `src/hooks/useExport.ts`
- **問題**:
  - 実動画で「映像尺より音声尺が長い」「後半ナレーションが途切れる/プツプツする」事象が発生
  - 既定のリアルタイム音声キャプチャ（TrackProcessor/ScriptProcessor）では、環境依存のバッファ遅延や終端超過が起きやすい
- **対策**:
  - `OfflineAudioContext` を iOS Safari 限定から全環境優先へ拡張し、エクスポート音声を非リアルタイムで確定生成
  - プリレンダリング音声長を `totalDuration` へ厳密に合わせる（余剰マージン `+0.5s` を廃止）
  - `feedPreRenderedAudio` に最大長指定を追加し、エンコード対象サンプル数を `totalDuration * sampleRate` で上限化
  - リアルタイム音声フォールバック経路でも `maxAudioTimestampUs` を超えるチャンクを打ち切り
- **注意**:
  - `offlineAudioDone=true` のときは TrackProcessor 音声キャプチャを同時実行しない（二重エンコード防止）
  - decode失敗時は既存フォールバック（ScriptProcessor / video要素抽出）を維持し、互換性を確保する

### 13-12. 静止画区間で映像尺が短くなる問題（TrackProcessor）

- **ファイル**: `src/hooks/useExport.ts`
- **問題**:
  - WebCodecs + `canvas.captureStream()` + `MediaStreamTrackProcessor` 経路では、Canvasに変化が少ない静止画区間でフレーム供給が疎になる場合がある
  - その状態でCFR用に `frameIndex * frameDuration` へタイムスタンプを書き換えると、静止画区間が圧縮され「画像の表示時間だけ短い」見え方になる
  - 結果として映像長が音声長より短くなり、後半でAVタイミングがズレる
- **対策**:
  - TrackProcessor映像経路でも `CanvasCaptureMediaStreamTrack.requestFrame()` を FPS 間隔で定期実行し、静止画区間でもフレームを明示供給
  - 完了時/例外時の両方で frame pump の `setInterval` を必ず `clearInterval` する
  - ログに frame pump 有効状態を出力し、現場診断を容易にする
- **注意**:
  - 本事象の主因はフェード設定ではなく、静止画区間のフレーム供給欠落とCFR補正の組み合わせ
  - iOS Safari の MediaRecorder 経路にある frame pump と同種の対策を、WebCodecs 経路にも適用する

### 13-13. `captureStream(FPS)` と `requestFrame()` 併用時の映像尺伸長

- **ファイル**: `src/hooks/useExport.ts`
- **問題**:
  - `captureStream(FPS)` の自動供給に加えて `requestFrame()` を定期実行すると、ブラウザ実装によってはフレームが二重供給される
  - CFRタイムスタンプ（`frameIndex * frameDuration`）でエンコードしているため、フレーム数増加がそのまま映像尺伸長（音声とのズレ増大）になる
- **対策**:
  - `requestFrame` 利用時は `captureStream(0)` の手動キャプチャモードへ切替え、自動供給を停止する
  - 手動モード時のみ frame pump を動かし、`captureStream(FPS)` とは併用しない
  - ログに `captureMode`（`manual-requestFrame` / `auto-fps`）を出力して診断可能にする
- **注意**:
  - 「静止画区間の欠落対策」と「二重供給対策」はセットで実装する必要がある
  - `requestFrame` 非対応ブラウザでは `auto-fps` にフォールバックする

### 13-14. フレーム供給を再生タイムライン基準で同期

- **ファイル**: `src/hooks/useExport.ts`, `src/components/TurtleVideo.tsx`
- **問題**:
  - `setInterval` の周期だけで `requestFrame()` を呼ぶと、CPU負荷やタブ状態でフレーム供給数が前後し、映像尺が短縮/伸長する
  - 特に静止画主体タイムラインでは「フレーム供給不足→画像が短い」「供給過多→映像が長い」が起こりやすい
- **対策**:
  - `TurtleVideo` から `getPlaybackTimeSec` を `useExport` へ渡し、エクスポート中の現在再生時刻を参照可能にする
  - `useExport` 側は `floor(playbackTimeSec * FPS)` を目標フレーム数として `requestFrame()` を補充し、供給数をタイムライン進行に同期
  - 停止要求後は目標フレーム数（`totalDuration * FPS`）まで不足分を補完してから終了し、AV尺を一致させる
- **注意**:
  - 壁時計（`Date.now()`）だけで供給数を決めると、非アクティブ時間や負荷変動を誤って取り込む
  - `completionRequested` 後の補完は末尾フレーム複製が入るため、常時発生する場合は供給遅延の根本要因調査が必要

### 13-15. 画像尺ズレ調査中の暫定運用（Canvas直接フレーム固定）

- **ファイル**: `src/hooks/useExport.ts`
- **問題**:
  - `captureStream` + TrackProcessor 経路は環境差が大きく、静止画区間で「短縮」と「伸長」の両症状が再現した
- **対策**:
  - 映像エンコード経路を一時的に `useManualCanvasFrames = true` で固定し、Canvasから直接 `VideoFrame` を生成
  - 音声は既存の OfflineAudioContext 優先経路を維持し、AV同期の切り分けを容易にする
- **注意**:
  - 暫定措置のため、将来的には TrackProcessor 経路を再導入する場合の再検証が必要
  - 固定後もズレが残る場合は、`renderFrame` 側（`TurtleVideo.tsx`）の時間進行と停止判定を優先調査する

### 13-16. エクスポート中UIの状態表示は `isPlaying` に依存しない

- **ファイル**: `src/components/sections/PreviewSection.tsx`
- **問題**:
  - エクスポート中は `isPlaying` が必ずしも true にならないため、`isPlaying` 依存の状態判定だと表示が「準備中」に固定される
- **対策**:
  - フェーズ判定を `currentTime` の進捗検知（差分閾値）ベースへ変更
  - 初回進捗前は `preparing`、進捗後に停滞したら `stalled`、進行中は `rendering` として表示
- **注意**:
  - 「再生中かどうか」と「エクスポート進捗の有無」は別概念として扱う

### 13-17. Androidでナレーション見出しが不自然に改行される問題

- **ファイル**: `src/components/sections/NarrationSection.tsx`
- **問題**:
  - Android の狭い画面幅でセクション見出し `ナレーション` が文字単位で改行され、`ナレ / ーション` のように分断されて見える
- **対策**:
  - 見出し文字列を `span.whitespace-nowrap` で包み、単語内改行を抑止
  - 同一ヘッダー内ボタン（`AI追加` / `ファイル追加`）のモバイル横余白を `px-2` に縮小し、見出し表示領域を確保
- **注意**:
  - タイトル文言を将来長文化する場合は、`whitespace-nowrap` により横幅不足が顕在化しやすいためモバイル実機で再確認する

### 13-18. ナレーションセクションは初期表示で閉じる

- **ファイル**: `src/components/sections/NarrationSection.tsx`
- **問題**:
  - 初回表示でナレーションセクションが常に展開されると、編集開始時の視認領域を圧迫しやすい
- **対策**:
  - アコーディオン状態の初期値を `useState(false)` に設定し、デフォルトで閉じた状態にする
- **注意**:
  - 既存のクリック開閉挙動は変更しない。初期状態のみ変更する

### 13-19. セクションヘッダー操作系の配置・文言統一

- **ファイル**: `src/components/sections/ClipsSection.tsx`, `src/components/sections/BgmSection.tsx`, `src/components/sections/NarrationSection.tsx`, `src/components/sections/CaptionSection.tsx`
- **問題**:
  - セクションごとにボタン配置・文言・色が揃っておらず、モバイルで操作の予測がしづらい
  - 2段レイアウトは視線移動が増え、ヘッダーの情報密度が上がりすぎる
- **対策**:
  - ヘッダー右側を1行レイアウトに統一し、右端を主要操作（`追加`）に固定
  - 動画・画像/BGM/ナレーションのアップロード導線は文言を `追加` に統一し、配色はタートルテーマ寄りの緑（`emerald`系）へ揃える
  - ナレーションは `AI追加` をインディゴ-ブルー系グラデーション、`追加` を緑で分離し、機能差を視覚化
  - ナレーションの `AI追加` / `追加` は `h-7 md:h-8` で縦幅を統一
  - キャプションの入力欄と `追加` ボタンは `h-9 md:h-10` に揃えて、全体を僅かにコンパクト化
  - `?` ボタンは青系ライン（青枠 + 青アイコン）に統一し、各セクションのタイトル横へ配置して文脈を明確化
  - キャプションは右側に「表示ON/OFF（目アイコン） + ロック」を維持し、ヘルプはタイトル側へ移動
  - ヘルプボタン押下時は `SectionHelpModal` を開き、項目別の説明を表示
- **注意**:
  - アコーディオンの開閉クリック領域と干渉しないよう、操作ボタン側は `stopPropagation` を維持する
  - 既存の編集フローを壊さないため、機能追加ではなく配置・文言・見た目の統一に留める
  - 4ボタンが並ぶナレーションヘッダーは、狭幅端末で折返しが発生しないか実機確認を行う

### 13-20. ヘッダーブランド表示のノイズ低減（AIバッジ削除 + ロゴ丸型化）

- **ファイル**: `src/components/Header.tsx`
- **問題**:
  - タイトル横の `AI` バッジがブランド名の視認を分断し、ヘッダー上部で視線ノイズになりやすい
  - ロゴが小さい角丸四角だと、端末によっては潰れて見えやすく、ブランドアイコンの認識性が下がる
- **対策**:
  - タイトルを `タートルビデオ` 単体にして `AI` バッジを削除
  - ロゴコンテナを `rounded-full` + `overflow-hidden` にし、サイズをモバイル/PCとも一段大きく調整
  - ロゴ画像は `object-cover` を適用して、比率崩れによる潰れ感を抑える
  - サイズは段階的に調整し、現行はコンテナ `h-10/w-10`（PC `h-12/w-12`）、画像 `h-8/w-8`（PC `h-9/w-9`）を基準にする
- **注意**:
  - モバイル/PCともにヘッダーの基本レイアウト（横並び）は維持し、操作導線を変えない
  - ロゴ拡大時は保存・設定アイコンとの最小タップ余白が不足しないか確認する

### 13-21. キャプション空状態カードと一覧パネルの高さバランス調整

- **ファイル**: `src/components/sections/CaptionSection.tsx`
- **問題**:
  - キャプション未登録時に `キャプションがありません` カードの縦幅が薄く見え、右カラムのプレビュー下部と高さ感が合いにくい
  - 一覧パネルの最小高さがなく、状態によってセクションの見た目が詰まって見える
- **対策**:
  - 一覧パネルに `min-h-28 lg:min-h-32` を追加し、空状態でも安定した高さを確保
  - 一覧パネルの上限を `max-h-64 lg:max-h-[23rem]` に拡張し、キャプション領域をさらに少し広げる
  - 空状態カードを `py-5 lg:py-7` + `min-h-24 lg:min-h-28` + `flex items-center justify-center` にして、縦方向の余白と視認性を向上
- **注意**:
  - 追加入力行（入力欄/追加ボタン）の `h-9 md:h-10` は維持し、操作系の高さ統一を崩さない
  - 一覧が長くなるケースでは `overflow-y-auto` を維持し、ページ全体のスクロール暴走を防ぐ

### 13-22. セクションヘルプのデータ駆動化（UI変更に追従しやすい構成）

- **ファイル**: `src/constants/sectionHelp.ts`, `src/components/modals/SectionHelpModal.tsx`, `src/components/TurtleVideo.tsx`, `src/components/sections/ClipsSection.tsx`, `src/components/sections/BgmSection.tsx`, `src/components/sections/NarrationSection.tsx`, `src/components/sections/CaptionSection.tsx`
- **問題**:
  - `?` ボタンの説明が `showToast` の短文固定だと、操作項目が増えた時に説明不足になりやすい
  - セクションごとに説明文が分散し、UI変更時の更新漏れが起きやすい
- **対策**:
  - セクション別ヘルプ文言を `src/constants/sectionHelp.ts` へ集約し、データ駆動で管理
  - `SectionHelpModal` を追加し、`?` 押下時に「追加/ロック/表示時間/位置・サイズ/フェード」等を項目ごとに表示
  - 文字だけでなく、ボタン色・アイコンを実物に近いトークンで表示し、認識負荷を下げる
  - 動画・画像の「削除」「個別ロック」などは、実UIに合わせてテキストなしのアイコンボタンとして表示する
  - スライダー操作は固定デモではなく、ヘルプ内で疑似的に動くトラック/ノブ表示でイメージを伝える
  - `TurtleVideo` でアクティブなヘルプセクションを管理し、各セクションは `onOpenHelp` を呼ぶだけに単純化
  - モバイルはボトムシート、PCは中央モーダルの同一実装で表示し、ESC・背景クリックで閉じられるようにする
- **注意**:
  - ヘルプ文言を更新する際は `src/constants/sectionHelp.ts` を修正すれば全セクションへ反映される
  - セクション見出しがアコーディオンの場合、ヘルプボタン押下で誤って開閉しないよう `stopPropagation` を維持する
  - お客様向けヘルプ画面には、開発者向けの更新ガイド文を表示しない

### 13-23. 操作ボタンの実UI統一とプレビューヘルプ追加

- **ファイル**: `src/components/sections/BgmSection.tsx`, `src/components/sections/NarrationSection.tsx`, `src/components/media/CaptionItem.tsx`, `src/components/sections/PreviewSection.tsx`, `src/components/TurtleVideo.tsx`, `src/constants/sectionHelp.ts`, `src/components/modals/SectionHelpModal.tsx`
- **問題**:
  - BGM削除導線がヘッダー側にあり、対象（現在のBGM）との距離が遠く分かりづらい
  - ナレーション/キャプションの行操作ボタンが、動画・画像（ClipItem）と見た目ルールが揃っていない
  - ヘルプがプレビューに無く、停止/再生/キャプチャ/書き出し/ダウンロードの意味が画面だけでは伝わりにくい
  - フェード・音量・リセット説明が抽象的で、実際のアイコンとの対応が弱い
- **対策**:
  - BGM削除をヘッダーから外し、BGMパネル内のゴミ箱アイコン（実UI同形）へ移動
  - ナレーション行に `設定` ボタンを追加し、開始位置/音量の詳細表示を開閉可能にした
  - ナレーション/キャプションの上下移動・編集・設定・削除・保存ボタンを `ClipItem` と同系統の角丸/枠/色ルールへ統一
  - `SectionHelpKey` に `preview` を追加し、プレビュー見出し横にも `?` ヘルプ導線を実装
  - ヘルプトークンにチェック付きフェード、スピーカー（ミュート）、くるくる（リセット）、プレビュー操作ボタン群を追加し、実UIに寄せた表記へ更新
  - プレビュー説明に「停止/再生後でも動画ファイル作成可能」「作成後はダウンロード表示」を明記
- **注意**:
  - `sectionHelp.ts` のトークン追加時は、`SectionHelpModal.tsx` の `renderVisualToken` に必ず対応ケースを追加する
  - プレビューヘルプ追加時も、既存のREC表示やヘッダーレイアウトを壊さないよう最小差分で実装する

### 13-24. ヘルプ表現の実UI追従強化（フェードチェック・黒帯除去・AIモーダル）

- **ファイル**: `src/constants/sectionHelp.ts`, `src/components/modals/SectionHelpModal.tsx`, `src/components/modals/AiModal.tsx`
- **問題**:
  - フェードON/OFFの説明がテキスト中心だと、実際のチェックボックス操作と結び付きにくい
  - 動画/画像の「黒帯除去」設定意図がヘルプに無く、用途が伝わりにくい
  - スライダーデモの幅がカードごとに揺れて見えやすく、補助テキストが冗長
  - AIナレーションスタジオ側に導線付きヘルプがなく、API準備やSTEP進行が初見で分かりにくい
- **対策**:
  - 各セクションのフェード説明は `fade_in_checkbox` / `fade_out_checkbox` トークンで統一し、チェック操作を視覚化
  - `blackbar_toggle_chip` を追加し、黒帯除去（102.5%拡大）の目的を「微妙な上下隙間を目立ちにくくする」と要約表示
  - `slider_demo` は `basis-full w-full` にして幅を統一、補助文（スライダー操作イメージ）を削除
  - AIモーダルのヘッダーにヘルプボタンを追加し、APIキー設定必須・Google AI Studioリンク・STEP1〜3説明を表示
  - プレビューヘルプは文言を見直し、`動画ファイルを作成できます` と `ダウンロード後に停止/再生で再作成可能` を明記
- **注意**:
  - 外部リンクは `target=\"_blank\" rel=\"noreferrer\"` を付与して安全に開く
  - ヘルプ文言は実画面ラベル変更に追従して `sectionHelp.ts` 側を先に更新する

### 13-25. モーダルヘルプ導線の統一（AI / 保存・素材 / 設定）

- **ファイル**: `src/components/modals/AiModal.tsx`, `src/components/modals/SaveLoadModal.tsx`, `src/components/modals/SettingsModal.tsx`, `src/constants/sectionHelp.ts`
- **問題**:
  - モーダルごとにヘルプ導線の位置と閉じ方が揃っておらず、初見ユーザーが使い方を探しづらい
  - AIモーダルのヘルプボタンがタイトルから離れており、機能文脈が伝わりにくい
  - 保存・素材モーダル、設定モーダル（APIキー・ログ）に共通ヘルプ導線が無かった
- **対策**:
  - ヘルプボタンをタイトル右横に統一し、セクションヘッダーと同じ青系 `?` スタイルへ統一
  - ヘルプカード内に `×` ボタンを追加し、カードのみを閉じられる導線を実装
  - 保存・素材モーダルに、自動保存間隔/保存読み込み/素材生成の要点ヘルプを追加
  - 設定モーダルに、APIキー運用とログ機能の要点ヘルプ、および API取得リンクを追加
  - プレビューヘルプのキャプチャ説明を「現在の表示内容を画像として保存」に更新
- **注意**:
  - 保存・素材モーダルは `menu` モード時のみヘルプ表示を許可し、確認ダイアログ系モードでは表示を閉じる
  - ヘルプ文言は重複を避けるため要点に絞り、詳細説明は既存の各タブ本文へ委ねる

### 13-26. モーダルヘルプの配色分離（本体UIとの差別化）

- **ファイル**: `src/components/modals/AiModal.tsx`, `src/components/modals/SaveLoadModal.tsx`, `src/components/modals/SettingsModal.tsx`
- **問題**:
  - モーダルのヘルプカードと本体UIが同系色（青系）だと、視覚的なレイヤー差が弱く、ヘルプ領域が埋もれやすい
- **対策**:
  - AIヘルプを `fuchsia/indigo`、保存・素材ヘルプを `emerald/teal`、設定ヘルプを `amber/orange` に分離
  - ヘルプボタン（`?`）とヘルプカードの色相を揃え、カード内テキスト/リンク/閉じるボタンも同系色で統一
- **注意**:
  - 色変更対象はヘルプUIに限定し、モーダル本体の既存ブランド配色や主要導線ボタン色は維持する

### 13-27. ダウンロード完了通知の確実化（File System Access API + フォールバック）

- **ファイル**: `src/components/TurtleVideo.tsx`, `src/components/sections/PreviewSection.tsx`
- **問題**:
  - `a[download]` のみで保存すると、アプリ側で「保存完了」のタイミングを検知できない
  - 同一レンダー中の `Date.now()` 由来ファイル名が再利用され、再ダウンロード時に上書き確認が出やすい
- **対策**:
  - ダウンロード操作を `TurtleVideo` の `handleDownload` に集約し、`PreviewSection` はボタン経由で呼び出す
  - `showSaveFilePicker` 対応ブラウザでは、`createWritable() -> write() -> close()` 完了後に「ダウンロード完了」ダイアログを表示
  - 非対応ブラウザでは `a[download]` フォールバックを使い、完了検知不可であることをトーストで案内する
  - ファイル名はクリック時に生成し、連続クリック時の同名衝突を減らす
- **注意**:
  - `showSaveFilePicker` はユーザーキャンセル時に `AbortError` を投げるため、エラー扱いせずキャンセル通知に分岐する
  - フォールバック経路ではブラウザ仕様上、完了時刻の厳密検知はできない

### 13-28. セクションヘルプの本文スクロール保証と下スワイプ閉じる競合回避

- **ファイル**: `src/components/modals/SectionHelpModal.tsx`
- **問題**:
  - モーダル本体に `max-height` があっても、本文スクロール領域が高さを確保できず、BGMヘルプなど項目数が多い場合に下部が見切れる
  - シート全体で下スワイプ閉じるを判定すると、本文の縦スクロール操作と競合しやすい
- **対策**:
  - モーダル本体を `flex flex-col` に変更し、本文を `flex-1 min-h-0 overflow-y-auto` で明示的にスクロール可能にする
  - タッチ開始位置が本文スクロール領域内の場合は、下スワイプ閉じる判定を開始しない
  - これにより本文スクロールを優先しつつ、ヘッダー/ハンドル側での下スワイプ閉じる操作は維持する
- **注意**:
  - `overflow-y-auto` を有効化する場合、親に `flex` と子に `min-h-0` が無いとスクロールが効かず見切れやすい
  - モーダル系で同様のジェスチャーを実装する際は、スクロール領域と閉じるジェスチャー領域を分離する

### 13-29. Skills同期ベース選定の更新進捗評価

- **ファイル**: `.github/skills/skills-sync-guard/scripts/safe-sync-skills.mjs`
- **問題**:
  - ディレクトリ単位の最終更新時刻のみで `base` 候補を選ぶと、1ファイルだけ新しいフォルダが正として選ばれ、更新が進んだ別フォルダを上書きするリスクがある
- **対策**:
  - `base` 候補の自動選定に `freshness` 指標（`latestWins` / `staleFiles` / `missingFiles`）を導入
  - 比較順を `latestWins` 優先にし、同点時は `staleFiles` / `missingFiles` / `fileCount` / `newestMtimeMs` で決定
  - `--verbose` / `--json` に各ディレクトリの freshness 指標を出力し、選定根拠を可視化
- **注意**:
  - ベース固定で運用する場合は `--base agents` などを明示し、意図しない自動選定を避ける

### 13-30. Issue Forms に AI簡易依頼テンプレートを追加する運用

- **ファイル**: `.github/ISSUE_TEMPLATE/00-ai-assist.yml`, `.github/skills/issue-specialist/assets/issue-templates/00-ai-assist.yml`, `.agents/skills/issue-specialist/assets/issue-templates/00-ai-assist.yml`, `.agent/skills/issue-specialist/assets/issue-templates/00-ai-assist.yml`, `.github/skills/issue-specialist/scripts/setup-issue-specialist.mjs`, `.agents/skills/issue-specialist/scripts/setup-issue-specialist.mjs`, `.agent/skills/issue-specialist/scripts/setup-issue-specialist.mjs`
- **問題**:
  - 詳細テンプレート（バグ/改善/ドキュメント/メンテ）だけだと、起票時の入力負荷が高く、アイデア段階の依頼が止まりやすい
  - テンプレート追加時に `assets` と `setup` スクリプトを同時更新しないと、再セットアップ時に新規テンプレートが消える
- **対策**:
  - 文章入力1欄のみの `00-ai-assist.yml` を追加し、Issue作成画面に「AI依頼（簡易）」を表示する
  - 追加テンプレートは実運用 `.github/ISSUE_TEMPLATE` だけでなく、スキル資産（`.github/skills`, `.agents`, `.agent`）にも同一内容で配置する
  - `setup-issue-specialist.mjs` の `ISSUE_TEMPLATE_FILES` に `00-ai-assist.yml` を追加して再生成時の消失を防ぐ
- **注意**:
  - Issue Forms ではトップレベル `type` は使わない（テンプレート無効化の原因になる）
  - 必須項目を増やすと「文章だけで依頼」の目的に反するため、必須は本文1欄に留める

### 13-31. Issue Forms の画像貼り付け欄は `render` を付けない

- **ファイル**: `.github/ISSUE_TEMPLATE/01-bug-report.yml`, `.github/skills/issue-specialist/assets/issue-templates/01-bug-report.yml`, `.agents/skills/issue-specialist/assets/issue-templates/01-bug-report.yml`, `.agent/skills/issue-specialist/assets/issue-templates/01-bug-report.yml`
- **問題**:
  - `textarea` に `render: shell` を付けると、コードブロック前提の入力になり、画像貼り付けや添付導線（Paste/Drop）が通常の本文欄より弱くなる
  - その結果、ログ・スクリーンショット欄で画像を貼り付けできない運用になりやすい
- **対策**:
  - 画像貼り付けを想定する `textarea` では `render` を指定しない
  - すでに設定済みの `render: shell` は削除し、通常の Markdown 入力欄に戻す
- **注意**:
  - `render` はコード片（JSON/YAML/ログテキスト）専用欄に限定して使用し、画像添付欄には使わない
  - 実運用テンプレートとスキル資産（`.github/skills`, `.agents`, `.agent`）を同時に更新して再生成時の逆戻りを防ぐ

### 13-32. 00テンプレートを「ザクっと登録→後でAI整理」前提にする

- **ファイル**: `.github/ISSUE_TEMPLATE/00-ai-assist.yml`, `.github/skills/issue-specialist/assets/issue-templates/00-ai-assist.yml`, `.agents/skills/issue-specialist/assets/issue-templates/00-ai-assist.yml`, `.agent/skills/issue-specialist/assets/issue-templates/00-ai-assist.yml`
- **問題**:
  - 起票時点で種別（bug/enhancement/documentation/maintenance）を判断し切れない内容は、詳細テンプレートに入力しづらく登録が止まりやすい
  - 後でAIに整理依頼するときに、毎回プロンプトを作る手間がある
- **対策**:
  - テンプレート名を「ザクっと登録」に変更し、最小入力で起票できる粗メモ欄を必須化
  - AIにそのまま渡せる「整理依頼文」を既定値付き textarea として同梱し、Issue本文に残す
  - 整理依頼文で、種別判定・タイトル整形・ラベル提案・本文構造化の出力フォーマットを固定化
- **注意**:
  - 00テンプレートではラベル固定を避け、種別確定は後段のAI整理で行う
  - 実運用テンプレートとスキル資産の4系統を同時更新し、再同期で仕様が戻らないようにする

### 13-33. ナレーションクリップの trimStart/trimEnd 対応

- **ファイル**: `src/types/index.ts`, `src/stores/audioStore.ts`, `src/components/sections/NarrationSection.tsx`, `src/components/TurtleVideo.tsx`, `src/hooks/useExport.ts`, `src/stores/projectStore.ts`, `src/hooks/useAutoSave.ts`
- **問題**: 波形分割機能を実装せずに、長いナレーション素材をクリップ単位の入出点トリムで再利用したい。
- **対策**:
  - `NarrationClip` に `trimStart` / `trimEnd` を追加し、クリップ作成時に初期化する。
  - ストア更新（`updateNarrationTrim`）で最小間隔を保った正規化・クランプを行い、無効レンジを防ぐ。
  - プレビュー再生と可視範囲再同期で、`sourceTime = trimStart + clipTime` によりタイムライン時刻をソース時刻へ変換する。
  - エクスポート時は `source.start(clipStart, trimStart, playDuration)` を使い、`playDuration` はトリム後尺と残りタイムラインから算出する。
  - trim項目はプロジェクト保存/読込に永続化し、旧データは後方互換デフォルトで補完する。
  - trim項目を自動保存の差分検知ハッシュに含める。
  - ナレーションUIに trim スライダー/入力を追加し、表示尺はトリム後レンジ基準で表示する。
- **注意**: 同一ナレーション素材を複数クリップとして配置し、クリップごとに trim する運用は、専用分割機能の実用的代替になる。

### 13-34. ナレーショントリム操作を折りたたみ化（初期は閉じる）

- **ファイル**: `src/components/sections/NarrationSection.tsx`
- **問題**: trim 操作を常時表示すると、ナレーションカードの情報密度が高くなりすぎる。
- **対策**:
  - 主要操作の `startTime` と `volume` は常時表示のまま維持する。
  - `trimStart` / `trimEnd` はクリップ単位アコーディオン（`openTrimMap`）に移し、初期は閉じる。
  - クリップ設定パネルと同じシェブロントグルの操作パターンを再利用する。
- **注意**: 日常操作を簡潔に保ちつつ、必要時だけ詳細トリム編集を開ける構成にする。

### 13-35. ナレーションヘルプをトリム折りたたみUIに同期

- **ファイル**: `src/constants/sectionHelp.ts`
- **問題**: trim 操作を折りたたみにした後、ヘルプ文面が実UIより古い内容のままになっていた。
- **対策**:
  - 実UI行操作に存在しない古いヘルプ表現（例: narration `settings_button`）を削除する。
  - trim 操作が折りたたみ内にあることを明示したヘルプ項目を追加する。
  - 通常操作として `startTime` と `volume` が常時表示である点を明記する。
- **注意**: ヘルプ説明を実UIに同期し、導入時の混乱や誤報告を減らす。

### 13-36. ナレーションのクリップ単位ミュート（プレビュー/エクスポート/保存）

- **ファイル**: `src/types/index.ts`, `src/stores/audioStore.ts`, `src/components/sections/NarrationSection.tsx`, `src/components/TurtleVideo.tsx`, `src/hooks/useExport.ts`, `src/stores/projectStore.ts`, `src/utils/indexedDB.ts`, `src/hooks/useAutoSave.ts`
- **問題**: ナレーションカードのミュートボタンは見た目だけで、実際のプレビュー/書き出し音声に反映されていなかった。
- **対策**:
  - `NarrationClip` に `isMuted` を追加し、後方互換デフォルト（`false`）で正規化する。
  - ストアに `toggleNarrationMute` を追加し、カードのスピーカーボタンへ接続する。
  - プレビュー再生では有効音量を `clip.isMuted ? 0 : clip.volume` とする。
  - エクスポート音声スケジューリングでは、ミュート中のナレーションクリップを混音対象から除外する。
  - `isMuted` をプロジェクト保存/読込に永続化し、自動保存差分ハッシュにも含める。
- **注意**: ミュート中もスライダー値は保持し、解除時に元の音量へ戻せるようにする。

### 13-37. 動画/BGM/ナレーションの音量レンジを0-250%に統一

- **ファイル**: `src/components/media/ClipItem.tsx`, `src/components/sections/BgmSection.tsx`, `src/components/sections/NarrationSection.tsx`, `src/stores/mediaStore.ts`, `src/stores/audioStore.ts`, `src/stores/projectStore.ts`, `src/hooks/useExport.ts`
- **問題**: 音量上限が経路ごとに不一致で、一部は200%に制限されていた。
- **対策**:
  - UIスライダー、ストアのクランプ、復元経路、エクスポート混音経路の上限を `2.5`（250%）に統一する。
  - 既定値は `1.0` を維持し、表示ラベルは `Math.round(volume * 100)` を使う。
  - BGM/ナレーションの上限クランプ（`2.5`）をテストで検証する。
- **注意**: 体感音量は対数的なので、振幅200%（約+6 dB）は知覚上の「2倍の大きさ」とは一致しない。

### 13-38. Android/フォールバック向けナレーション保存UX改善

- **ファイル**: `src/components/TurtleVideo.tsx`, `src/components/sections/NarrationSection.tsx`
- **問題**: Androidのフォールバック保存で、初回保存結果が分かりにくく、2回目保存時に上書き確認が混乱を招くことがあった。
- **対策**:
  - ナレーションカードの直接 `<a download>` をやめ、共通保存ハンドラ経由に統一する。
  - 保存時の提案ファイル名は元のファイル名を維持し、勝手な rename はしない。
  - `showSaveFilePicker` 対応時はそれを使い、非対応時はアンカーダウンロードへフォールバックする。
  - 保存開始/完了/キャンセルで明示的なユーザー通知（`alert` + toast）を出す。
- **注意**:
  - フォールバック経路ではOSレベル完了を厳密検知できないため、「保存開始」を明確に伝える。
  - 同名ファイルの扱いはブラウザ/OS側の保存UIに委ねる。

### 13-39. Gemini APIキー送信経路の強化（クエリパラメータ -> ヘッダー）

- **ファイル**: `src/components/TurtleVideo.tsx`, `src/hooks/useAiNarration.ts`
- **問題**: Gemini API呼び出しで `?key=...` をURLに付与しており、URL露出経路からの漏えいリスクが高まる。
- **対策**:
  - エンドポイント形式は `${GEMINI_API_BASE_URL}/{model}:generateContent`（クエリキーなし）を維持する。
  - APIキーは `x-goog-api-key` リクエストヘッダーで送る。
  - Gemini向け外部リクエストに `referrerPolicy: 'no-referrer'` を設定する。
  - 既存のリクエストボディ仕様とフォールバック動作は維持し、挙動/性能デグレを避ける。
- **注意**: 今後のGemini連携でも、APIキーをクエリパラメータに載せない。

### 13-40. キャプションヘルプの位置チップは厳密XY表現を避ける

- **ファイル**: `src/components/modals/SectionHelpModal.tsx`
- **問題**: キャプションヘルプのチップが `位置X/Y` 表記で、実際の操作意図（厳密座標指定ではない）とズレていた。
- **対策**:
  - キャプションスタイル案内のチップ文言は `位置` にする。
  - 移動アイコンは視覚連想のため維持しつつ、過度に座標を想起させる文言を避ける。
- **注意**: ヘルプラベルは内部パラメータ名ではなく、実運用での操作粒度に合わせる。

### 13-41. アプリヘルプ「主要な機能」にスワイプ誤操作防止の要約を追加

- **ファイル**: `src/constants/sectionHelp.ts`
- **問題**: ヘルプ上位サマリーにモバイルでのスライダー誤操作防止が記載されず、値が戻る挙動が意図不明に見えていた。
- **対策**:
  - `主要な機能` 配下に、誤操作防止の説明を1項目追加する。
  - スワイプ方向とタッチ時間による判定、および誤操作時に値が自動復元される点をユーザー向け表現で明記する。
- **注意**: 文言は `useSwipeProtectedValue` の実挙動と一致させ、過剰な期待を生まない。

### 13-42. Androidでのクリップ編集後の手動保存失敗を堅牢化（IDBトランザクション後始末 + 復旧経路）

- **ファイル**: `src/utils/indexedDB.ts`, `src/components/modals/SaveLoadModal.tsx`
- **問題**:
  - Androidでタイムラインのトリム/尺編集後に手動保存が失敗し、一度失敗すると連続して失敗しやすかった。
  - IndexedDB失敗経路でDBクローズが漏れる場合があり、容量復旧UIが古い `hasAutoSave` 状態に依存していた。
- **対策**:
  - IndexedDBラッパー（`saveProject` / `loadProject` / `deleteProject`）で、`oncomplete` / `onabort` / `onerror` / request error の全終端経路で idempotent ガード付きDBクローズを徹底する。
  - 書き込み/削除の成功判定は request success ではなく `transaction.oncomplete`（コミット確定）で行う。
  - 手動保存の容量エラー時は `refreshSaveInfo()` 後に必ず `confirmAutoDeleteForSave` へ誘導し、ローカル保存情報が古くても復旧経路を維持する。
- **注意**:
  - IndexedDBは request success だけではコミット確定を保証しないため、トランザクション完了で確定判定する。
  - 復旧UXを `lastAutoSave` のキャッシュ値だけに依存させない。

### 13-43. 音声エンコーダー（AudioEncoder）出力チャンクの終端クランプ（Teams向け最小保険）

- **ファイル**: `src/hooks/useExport.ts`
- **問題**:
  - 一部環境では、`maxAudioTimestampUs` を超えるAACチャンクが終端に残り、再生側（Teamsデスクトップ）で再エンコード/再パッケージ時に体感遅延が出るケースがある
  - 合計尺差分は小さくても、終端の扱い差で「わずかにスロー」に見えることがある
- **対策**:
  - `AudioEncoder` の `output` でチャンクごとに `timestamp/duration` を検査し、`maxAudioTimestampUs` 超過分をスキップまたはクランプする
  - 部分超過チャンクは `copyTo` + `muxer.addAudioChunkRaw(..., clippedDurationUs, ...)` で有効区間だけMuxする
  - `chunk.duration` が取れない場合に備えて、AAC 1024サンプル基準のフォールバック長を使う
  - クランプ/スキップ件数と切り詰め時間をDIAGログへ出し、実動画で追跡可能にする
- **解消確認（2026-03-05）**:
  - 本対応後、Teamsデスクトップで再生時の「わずかにスローに見える遅延」は再現しなくなった
- **なぜ解消したか**:
  - 以前は、動画末尾で音声チャンクが `maxAudioTimestampUs` をわずかに超えるケースが残り、Teams側の再パッケージ/再エンコードで終端タイミング補正が入ることで体感遅延につながっていた
  - 終端を事前にクランプして「音声終端が動画タイムライン内に収まる」状態を保証したため、Teams側での補正余地が減り、見かけ上のスロー再生が消えた
- **注意**:
  - 既存のエクスポート方式（WebCodecs + mp4-muxer）は維持し、コンテナ全面変更はしない
  - 本対応は「終端超過の抑制」が目的で、解像度・FPS・音量レンジなど他仕様には影響しない

### 13-44. 開始トリミング時のエクスポート黒画面防止（先頭フレーム事前同期）

- **ファイル**: `src/components/TurtleVideo.tsx`
- **問題**:
  - 開始トリミング（`trimStart > 0`）した動画で、エクスポート開始時に動画要素を `currentTime = 0` へ初期化していたため、タイムライン先頭（`t=0`）で必要なソース時刻（`trimStart`）との差分が大きくなり、補正シークが連続して黒フレーム化しやすかった
  - 停止後に書き出す経路では、先頭フレーム準備待ちが不足するとプレビュー/保存動画とも黒画面になり得た
- **対策**:
  - エクスポート開始時の動画初期位置を `0` ではなく各クリップの `trimStart` に揃える
  - エクスポート開始時に `currentTimeRef` を開始時刻へ同期し、フレーム供給側の時刻計算を安定化する
  - iOS Safari 限定だった「先頭動画フレーム準備待ち（`loadeddata`/`canplay`/`seeked`）」を全ブラウザに適用し、先頭フレーム確定後に録画処理へ進む
- **注意**:
  - 開始トリム案件では、エクスポート前に `trimStart` 位置へ事前同期しないと黒画面が再発しやすい
  - `setCurrentTime(...)` だけでは不十分で、`currentTimeRef` も同時に更新しないとエクスポートの目標フレーム数計算とズレる

### 13-45. エクスポート中の `video.play()` 失敗時フォールバック（音声のみ進行で映像静止を回避）

- **ファイル**: `src/components/TurtleVideo.tsx`
- **問題**:
  - 環境によってはエクスポート中の `video.play()` が失敗し、タイムライン時刻だけ進む一方で動画要素が停止し続け、出力が「音声は進むが映像は静止画」の状態になる
  - 失敗状態で通常のドリフト補正シークを継続すると `seeking` が連続して描画更新が止まりやすい
- **対策**:
  - エクスポート中の `play()` 失敗を動画IDごとに検知し、失敗した要素をフォールバックモードへ切り替える
  - フォールバック中は通常のドリフト補正（高頻度シーク）を止め、90ms間隔で制限した受動シーク同期を行う
  - 初回失敗時にログを出して、環境依存の再生開始失敗を追跡できるようにする
- **注意**:
  - フォールバックは「完全停止の回避」が目的で、通常再生経路（`play()` 成功時）の画質/同期特性は維持する
  - シーク実行間隔を短くし過ぎると `seeking` 連続で逆に静止化しやすいため、間隔制御が必須

### 13-46. 長い開始トリミング時のエクスポート静止化対策（trimStart 到達待ちの厳密化）

- **ファイル**: `src/components/TurtleVideo.tsx`
- **問題**:
  - `trimStart` が大きい動画では、先頭フレーム準備待ちが「`readyState>=2 && !seeking`」のみだと、目標時刻へ未到達でも待機が解除される場合がある
  - その状態でエクスポート再生を開始すると、補正シークが過密になり、音声だけ進んで映像が静止しやすい
- **対策**:
  - 先頭フレーム待機条件に `|currentTime - trimStart| <= 0.05` を追加し、目標時刻到達まで待つ
  - 待機中に未到達の場合は再シークを再試行する
  - 待機タイムアウトを `1500ms -> 4000ms` へ延長して長い開始トリミングにも対応
  - エクスポート時の同期しきい値を緩和（`iOS: 1.2s / 非iOS: 0.5s`）し、過剰な補正シークを抑える
- **注意**:
  - 開始トリミングが大きいケースでは、`readyState` だけでなく目標時刻到達の確認が必須
  - 補正しきい値を厳しくし過ぎると `seeking` が連続して描画が止まりやすい

### 13-47. Codex向けPRレビュー運用の固定化（`AGENTS.md` + `Docs/review` + 軽量PRテンプレート）

- **ファイル**: `AGENTS.md`, `Docs/review/README.md`, `Docs/review/functional-review-checklist.md`, `Docs/review/non-functional-and-regression-checklist.md`, `.github/pull_request_template.md`
- **問題**:
  - AIレビューの指示が散在していると、文法・作法中心の指摘に寄りやすく、要件充足・デグレ・非機能観点が抜けやすい
  - PR本文の粒度が揃わないと、レビュアが変更意図と影響範囲を読み取りにくい
- **対策**:
  - ルート `AGENTS.md` に、Codexレビュー時の言語、優先順位、出力形式を固定する
  - 具体的なレビュー観点は `Docs/review/` に分離し、機能要件と非機能・デグレ観点を明示する
  - `.github/pull_request_template.md` は Markdown ベースでさらに軽量にし、`何を変えたか` `なぜ変えたか` `見てほしい点` `確認メモ` の最小構成にする
  - PR本文が薄い場合も、レビュー側が差分・Issue・`spec.md` から意図を再構成して観点を補完する
- **注意**:
  - GitHub の PR テンプレートは Issue Forms のような YAML フォームではなく Markdown 前提で設計する
  - 個人開発では、PR作成者に要件整理を過剰に要求せず、「困りごと」や「作りたい方向」だけでもレビューが回るようにする

### 13-48. 設定モーダルに前回タグ差分の概要履歴を追加（軽量な履歴カード）

- **ファイル**: `src/components/modals/SettingsModal.tsx`, `version.json`
- **問題**:
  - バージョン番号だけでは、更新後に何が変わったかが設定画面から分かりにくい
  - 全履歴を設定画面に載せると重くなり、APIキー設定やログ確認の主導線を邪魔しやすい
- **対策**:
  - 設定タイトル横に履歴ボタンを追加し、ヘルプと同じ位置に補助カードとして表示する
  - 配色はヘルプの暖色系と分け、客観情報として薄いライトグレー系で静かに見せる
  - `version.json` に `history` を追加し、前回タグから今回バージョンまでの概要だけを保持する
  - 全履歴配列にはせず、`previousVersion` + `summary` + `highlights` の最小構成にして運用負荷を抑える
  - `history` が無いビルドでは履歴ボタン自体を表示せず、内部の情報パネル状態も `history` に遷移させない
- **注意**:
  - 履歴カードは要約レベルに留め、詳細な技術メモや全変更一覧は載せない
  - `version.json` のファイル名は維持し、既存参照や保存データ上のバージョン利用箇所への波及を最小化する
  - `popstate` による戻る操作では、見えていない履歴パネルを閉じるだけの無駄な状態遷移を作らない

### 13-49. リリース用バージョン更新スキルの追加（差分収集 + `version.json` 更新補助）

- **ファイル**: `.agents/skills/release-version-manager/SKILL.md`, `.agents/skills/release-version-manager/scripts/collect-release-context.ps1`, `.agents/skills/release-version-manager/scripts/update-version-json.mjs`, `.github/skills/release-version-manager/SKILL.md`
- **問題**:
  - バージョン更新時に、最新タグ・コミット・差分を毎回手作業で確認すると抜けや揺れが出やすい
  - `version.json` の `history` を都度手編集すると、粒度や形式がぶれやすい
- **対策**:
  - `release-version-manager` スキルを追加し、タグ取得、差分収集、AI要約、`version.json` 更新、検証、タグ運用を段階化する
  - 差分収集は PowerShell スクリプトで `safe.directory` を付けて Git 情報を収集し、Windows 環境でも扱いやすくする
  - `update-version-json.mjs` は dry-run を既定にし、確認後にだけ `--write` で反映する
- **注意**:
  - `git push` / `git push --tags` はスキル内でも必ずユーザー確認を挟む
  - `version.json` には全履歴ではなく最新差分だけを保持する前提を崩さない
  - 実運用で参照される `.agents/skills` 側と、共有元の `.github/skills` 側は同一内容を維持する

### 13-50. AIレビューでは「防御コード」と「現行契約」を切り分けて評価する

- **ファイル**: `AGENTS.md`, `Docs/review/README.md`, `Docs/review/functional-review-checklist.md`, `Docs/review/non-functional-and-regression-checklist.md`
- **問題**:
  - 防御コード（`??`, optional chaining, null guard など）だけを見ると、実際には必須前提のデータまで optional 仕様だと誤認してレビューしやすい
  - その結果、型・テスト・スキーマが示す現行契約とずれた仮説ベース指摘が高優先度で出ることがある
- **対策**:
  - レビュー時は PR本文、Issue、`spec.md`、差分だけでなく、型・スキーマ・保存/読込コード・既存テストで現行契約を確認する
  - 到達可能性が確認できない懸念は、断定せず前提付きの open question として扱う
  - findings が 1 件だけでも、要件充足・デグレ・非機能の主要観点を確認した結果を短く添える
- **注意**:
  - `Docs/review/` は詳細基準であり、入口としてルート `AGENTS.md` から明示参照する
  - `Docs/review/` を置くだけでは、Codex が常に自動参照する前提ではない

### 13-51. モーダルの領域外クリック挙動は用途で分ける（AIのみ閉じない）

- **ファイル**: `src/components/modals/AiModal.tsx`, `src/components/modals/SettingsModal.tsx`, `src/components/modals/SaveLoadModal.tsx`, `src/components/modals/SectionHelpModal.tsx`, `src/components/modals/CaptionSettingsModal.tsx`
- **問題**:
  - モーダルごとに backdrop クリック/タップ時の挙動が揺れると、誤操作時の期待が崩れる
  - 特に AIナレーションは文字入力中の内容を失いやすく、領域外クリックで閉じると事故コストが高い
- **対策**:
  - `AiModal` は領域外クリック/タップでは閉じない
  - `SettingsModal`、`SectionHelpModal`、`SaveLoadModal`、`CaptionSettingsModal` は領域外クリック/タップで閉じる
  - 閉じるモーダルは backdrop 側で `onClose`、本体側で `stopPropagation()` を明示して、意図せぬバブリングを防ぐ
- **注意**:
  - 入力途中の破壊コストが高いモーダルだけは「閉じない」を選び、その他は操作の軽さを優先する
  - モーダル追加時は、入力破壊リスクの有無を基準に backdrop 方針を先に決める
### 13-64. iOS Safari preview 音声は「単一音源かつ音量1倍」のときだけ native fallback を使う

- **ファイル**: `src/components/TurtleVideo.tsx`, `src/utils/previewPlatform.ts`, `src/test/previewPlatform.test.ts`
- **問題**:
  - iOS Safari で attach 時に全音源を一律 `muted` 化すると、単一音源の preview でも無音になるケースがある
  - ただし native `HTMLMediaElement.volume` 経路は、BGM 音量変更やフェードを正しく反映できず、音量が 1 以外のときに preview と export がずれる
- **対策**:
  - `getPreviewAudioOutputMode()` で iOS Safari の preview 音声出力モードを判定する
  - `audibleSourceCount === 1` かつ `desiredVolume === 1` のときだけ `native` を返し、それ以外は `webaudio` を返す
  - export 中、複数同時再生、AudioNode 接続済み、または音量変更ありの経路では常に WebAudio mix を使う
  - `stopAll()` と media attach 時には native の `muted` / `volume` を初期状態へ戻す
- **注意**:
  - iOS Safari preview の無音修正は `handleMediaRefAssign` の一律 mute へ戻さず、必ず output mode helper 経由で調整する
  - BGM やナレーションの音量が 1 以外なら、単一音源でも native fallback へ逃がさない

### 13-65. iOS Safari の動画サムネイルは offscreen DOM + prime 再生で黒化を避ける

- **ファイル**: `src/components/common/ClipThumbnail.tsx`, `src/test/clipThumbnail.test.tsx`
- **問題**:
  - iPhone Safari では、`document.createElement('video')` で作った未配置 video から即座に `drawImage()` すると、iPhone 撮影動画で黒いサムネイルになることがある
  - `loadedmetadata` / `seeked` だけではフレームのデコード完了を保証できず、キャンバス描画だけが先行しやすい
- **対策**:
  - iOS Safari だけ、サムネイル生成用 video を一時的に offscreen DOM へ追加し、`loadeddata` / `canplay` / `seeked` と短い待機でフレーム準備を待つ
  - `playsinline` / `webkit-playsinline` を付けた muted video を一度だけ短く `play()` して、ネイティブデコーダにフレーム確定を促す
  - prime 再生で時刻がずれた場合は、目標時刻へ再シークしてからキャンバスへ描画する
- **注意**:
  - この workaround は iOS Safari 限定で適用し、Android / PC の既存サムネイル経路には波及させない
  - offscreen 配置した video はサムネイル確定後すぐに `pause()` と DOM 解除を行い、不要なデコーダ保持を避ける

### 13-66. 動画クリップ終端の `ended -> play()` 巻き戻りは途中クリップでもガードする

- **ファイル**: `src/components/TurtleVideo.tsx`, `src/utils/previewPlatform.ts`, `src/test/previewPlatform.test.ts`
- **問題**:
  - 動画の直後に画像が続くタイムラインで、動画要素がクリップ終端よりわずかに先に `ended` になると、再生ループが `play()` を再実行して `position 0` へ巻き戻すことがある
  - その直後は `seeking=true` で `drawImage()` がスキップされるため、PC Edge や Android を含む非iOS経路でも「動画 -> 画像」の境界に黒フレームが挟まり得る
- **対策**:
  - `shouldHoldVideoFrameAtClipEnd()` で「クリップ残り時間」と「動画 currentTime/ended 状態」を合わせて判定し、タイムライン終端だけでなく各クリップ終端でも最終フレーム保持へ倒す
  - export fallback seek、通常の同期シーク、`play()` 再始動の全てで同じ helper を参照し、境界条件のずれを防ぐ
  - helper の pure logic は `src/test/previewPlatform.test.ts` で自動検証する
- **注意**:
  - 終端ガードを「タイムライン全体の最後」だけに限定すると、途中クリップの切り替わりで同種の黒フレームが再発する
  - クリップ終端ガードは動画の自然終了そのものを止めるのではなく、終端直前の再始動だけを抑止する

### 13-67. `OfflineAudioContext` の事前音声プリレンダリングは iOS Safari 専用に閉じる

- **ファイル**: `src/hooks/useExport.ts`, `src/hooks/export-strategies/exportStrategyResolver.ts`, `src/test/exportStrategyResolver.test.ts`
- **問題**:
  - Safari 向けの音声プリレンダリングを非iOSにも広げると、PC/Android のエクスポートが「先に音声準備、その後映像開始」の待機型フローへ変わり、既存の体感挙動を壊しやすい
  - 分離方針が曖昧なままだと、Safari 向け回避策が Edge / Android の標準経路へ混入する
- **対策**:
  - `shouldUseOfflineAudioPreRender()` で `OfflineAudioContext` の先行実行条件を `isIosSafari && hasAudioSources` に限定する
  - PC/Android は従来どおり TrackProcessor / ScriptProcessor のリアルタイム音声キャプチャを優先し、エクスポート再生ループを早く開始する
  - resolver の pure logic は `src/test/exportStrategyResolver.test.ts` で自動検証する
- **注意**:
  - Safari のために追加した「事前音声処理」は resolver で隔離し、`useExport.ts` に無条件で広げない
  - 体感フローの変更もデグレとして扱い、PC/Android の既定経路は明示的に守る

### 13-68. Android の停止後 0 秒復帰は `seeked` / `canplay` 待ちで先頭動画フレームを描く

- **ファイル**: `src/components/TurtleVideo.tsx`
- **問題**:
  - Android で `動画 -> 画像 -> 動画 -> 画像` のタイムラインを停止して 0 秒へ戻すと、先頭動画を `trimStart` へ戻した直後は `seeking` または `readyState < 2` のままになりやすい
  - その状態で停止経路が即座に `renderFrame(0, false)` すると、キャンバス黒クリアだけが先に走り、先頭動画フレームが未描画のまま次回再生開始へ持ち越される
- **対策**:
  - 停止後の 0 秒描画は `renderPausedPreviewFrameAtTime(0)` に集約し、先頭動画が `seeked` / `loadeddata` / `canplay` を満たすまで paused フレーム描画を待つ
  - `pendingPausedSeekWaitRef` は単純な `seeked` listener 参照ではなく `cleanup` 関数保持に変え、停止・シーク・再開のどの経路からでも確実に待機解除できるようにする
  - `handleStop` では seek 世代と pending wait をクリアしてから 0 秒描画へ入れ、古い seek 待ちが先頭フレーム復帰を邪魔しないようにする
- **注意**:
  - Android / PC / iOS の platform policy 分岐には混ぜず、停止後の paused preview 初期化ロジックとして `TurtleVideo.tsx` 側で閉じる
  - 停止直後の 0 秒描画は「黒クリア優先」ではなく「先頭動画フレーム準備優先」で扱わないと、最初の動画だけ黒いまま再生されやすい

### 13-69. 動画コンテナ音声のフォールバック抽出は無音 gain 経由で real destination へ接続する

- **ファイル**: `src/hooks/useExport.ts`
- **問題**:
  - `decodeAudioData` が動画コンテナ音声の抽出に失敗したときは `extractAudioViaVideoElement()` で `ScriptProcessorNode` にフォールバックする
  - このとき `ScriptProcessorNode` を `MediaStreamDestination` だけへつなぐと、環境によって `onaudioprocess` が発火せず、抽出結果が空になって書き出し音声が無音化しやすい
- **対策**:
  - フォールバック抽出では `ScriptProcessorNode -> silent GainNode -> AudioContext.destination` の経路を使い、実デスティネーション到達でコールバック発火を保証する
  - `GainNode.gain = 0` と `outputBuffer` の無音書き込みを併用し、スピーカーへの漏れを防ぎつつ PCM 抽出だけを維持する
- **注意**:
  - これは Safari 専用分岐ではなく「動画コンテナ音声抽出フォールバック」の共有処理として扱う
  - `MediaStreamDestination` への接続だけで無音化を防ごうとすると、PC / Android / iOS いずれでも抽出失敗を招く可能性がある
### 13-70. 可視復帰では paused preview の待機状態を clear してから settled frame を描く
- **ファイル**: `src/components/TurtleVideo.tsx`
- **背景**:
  - タブ非アクティブ化や `visibilitychange` 復帰の前後で、seek 再開待ちや paused frame wait が残ると、古い `seeked` / `canplay` callback が後から発火して黒フレームや不安定描画を起こしやすい
  - 通常再生中でない復帰では `renderFrame()` を即時実行すると、まだ `readyState < 2` / `seeking` の動画を掴んでしまう
- **対策**:
  - hidden 入りでは `cancelPendingSeekPlaybackPrepare()` と `cancelPendingPausedSeekWait()` を先に流し、stale な preview callback を残さない
  - `blur` が `visibilitychange(hidden)` より先に来る環境でも同じ待機解除を先行し、古い `seeked` / `canplay` callback が復帰直後に割り込まないようにする
  - visible 復帰で停止中なら `renderFrame()` 直描きではなく `renderPausedPreviewFrameAtTime()` を使い、`seeked` / `loadeddata` / `canplay` 完了後に paused frame を再描画する
  - `renderPausedPreviewFrameAtTime()` 側でも `readyState === 0` の動画には `load()` を掛け直してから `syncVideoToTime(..., { force: true })` し、タブ復帰直後の黒画面を避ける
- **注意**:
  - この修正は preview visibility 復帰に閉じ、export strategy や `useExport.ts` には波及させない
### 13-71. 保存失敗は原因分類を保持し、UI から復旧アクションを再実行できるようにする
- **ファイル**: `src/stores/projectStore.ts`, `src/components/modals/SaveLoadModal.tsx`, `src/utils/indexedDB.ts`
- **問題**:
  - 手動保存で `保存に失敗しました` が一度出ると、その後も同じ underlying failure が続いても generic error toast しか出ず、ユーザーからは「何を消せば戻るのか」「DB を初期化すべきか」が分からない
  - `AbortError` / `UnknownError` のような IndexedDB 失敗は容量不足と別経路でも起きるが、従来は監視情報が残らず、復旧手段も auto save 削除しか見えない
- **対策**:
  - `projectStore` で保存失敗時に `lastSaveFailure` を構築し、`reason` / `recoveryAction` / `storageEstimate` を保持する
  - 復旧アクションは `quota / near quota -> delete-auto-and-retry`、`IndexedDB transaction error -> delete-auto-and-retry or reset-database-and-retry`、`素材シリアライズ失敗 -> inspect-media` に分類する
  - `SaveLoadModal` に直近の保存失敗カードを出し、推奨対応を表示する。手動保存失敗後は `lastSaveFailure` を参照して `confirmAutoDeleteForSave` または `confirmResetDbForSave` へ遷移する
  - `resetProjectDatabase()` で保存用 IndexedDB 全体を delete できるようにし、DB 初期化後に同じ編集中データで manual save を再試行できるようにする
  - manual/auto save 成功時、auto save 削除時、DB 初期化時は `lastSaveFailure` を clear し、古いエラー監視状態を持ち越さない
  - `File` 直読みが失敗した素材は object URL fetch へフォールバックし、それでも失敗した場合は `メディア「foo.mp4」` のように素材名付きエラーへ変換して、どの素材が壊れているかを UI / ログから追えるようにする
- **注意**:
  - DB 初期化は保存履歴を消す最終手段であり、現在編集中の state は React/Zustand 側に残っている前提でのみ案内する
  - `inspect-media` は素材 Blob / File 読み出し失敗系を想定しており、DB 初期化では解決しないため別導線に分ける

### 13-72. メディア追加時のファイル名は app 側で rename せず、対応ブラウザでは open file picker を優先する
- **ファイル**: `src/components/TurtleVideo.tsx`, `src/components/sections/ClipsSection.tsx`, `src/utils/platform.ts`
- **問題**:
  - `input[type=file]` 経由のメディア追加では、ブラウザ/OS によっては元ファイル名ではなく数値ベースの一時名が `File.name` として渡ることがある
  - app 側で rename しているように見えやすく、ユーザーが元ファイルとの対応を見失う
- **対策**:
  - クリップ追加ボタンは、`showOpenFilePicker` が使えるブラウザではそちらを優先し、`getFile()` で取得した `File` をそのまま `mediaStore` へ渡す
  - `showOpenFilePicker` 非対応環境だけ従来の hidden file input にフォールバックする
  - 追加後の表示名は引き続き `file.name` をそのまま使い、app 側で別名へ変換しない
- **注意**:
  - `showOpenFilePicker` 非対応ブラウザでは、ブラウザ/OS が返した `File.name` より元の名前を復元できない場合がある
  - この制約は特にモバイルの写真/動画ライブラリ選択で出やすく、app 側だけでは完全には補正できない

### 13-73. iOS Safari preview の複数音源開始は audio-only を先に起動し、通過済み video は止める
- **ファイル**: `src/components/TurtleVideo.tsx`, `src/utils/previewPlatform.ts`, `src/test/previewPlatform.test.ts`
- **問題**:
  - iOS Safari で `動画 + BGM` のような複数可聴ソースを 0 秒から開始すると、動画側が先に `play()` して AudioSession の主導権を取り、BGM が鳴り始めないことがある
  - 逆に、通過済みの video を gain=0 のまま走らせ続けると、`動画 -> 静止画` の境界後も BGM へ周期的な干渉が出ることがある
- **対策**:
  - `preparePreviewAudioNodesForTime()` で「現在時刻の可聴 source 数」「active video の有無」「WebAudio mix 必要性」を返し、`shouldBundlePreviewStartForWebAudioMix()` で bundled start の要否を決める
  - bundled start が必要な場合は、`primePreviewAudioOnlyTracksAtTime()` で BGM / narration の `seeked` / `canplay` を待ちながら先に起動し、active video は最後に開始する
  - iOS preview の prewarm 対象は「現在以降の video」に限定し、render loop 中も通過済み video は pause して future/current video だけを維持する
- **注意**:
  - iOS Safari の無音対策で「全 video を常時走らせる」方向へ戻すと、静止画区間の BGM が揺れやすい
  - ただし future video まで止めると、画像区間から次の video へ入る際に gesture credit を失いやすいので、past video と future video は分けて扱う
  - `動画 -> 静止画` の境界では just-ended video を短い grace だけ prewarm 維持し、実際に pause した直後は `AudioContext.resume()` と `primePreviewAudioOnlyTracksAtTime()` で audio-only を再点火する

### 13-74. iOS Safari preview の future video prewarm は「直近の切替候補」だけに絞る
- **ファイル**: `src/components/TurtleVideo.tsx`, `src/utils/previewPlatform.ts`, `src/test/previewPlatform.test.ts`
- **問題**:
  - iOS Safari で BGM / narration と video を混在再生するとき、future video をすべて gain=0 のまま `play()` すると、遠い将来の video まで AudioSession / デコード資源を消費し、結果として「動画だけ」「BGMだけ」は動くのに、両方同時だとどちらかが不安定になることがある
  - startEngine / seek 再開直後の一括 prewarm は gesture credit を確保しやすい一方で、対象を広げすぎると release 品質の安定性を落とす
- **対策**:
  - `shouldKeepInactiveVideoPrewarmed()` に `timeUntilVideoStartSec` と lead window を追加し、遠い future video は prewarm 維持対象から外す
  - `renderFrame()` の inactive video 制御だけでなく、`startEngine()` / seek 再開時の事前 `play()` ループにも同じ helper を使い、直近の切替候補だけを無音 prewarm する
  - これにより、最小限の gesture credit 維持は残しつつ、複数 video の常時再生による BGM 干渉を抑える
- **注意**:
  - lead window を広げすぎると再び「遠い future video まで走る」状態へ戻り、狭めすぎると画像区間→動画区間の立ち上がりが悪化する
  - iOS Safari preview の安定性を優先する場合は、「すべてを滑らかにする」より「今必要な video だけ確実に鳴らす」方針を維持する

### 13-75. 自動保存の経過判定は『実際に保存を再開できる時刻』を基準にし、export 見送り後は即 catch-up する

- **ファイル**: `src/hooks/useAutoSave.ts`
- **問題**:
  - 自動保存タイマーの tick 時点で export 中だと保存自体は見送るが、その時刻を次回判定基準にしてしまうと、export 終了後も次の1周期が来るまで保存が再開されない
  - Android / PC では長めの export や復帰操作のあとに「1分設定でもいつまでも auto save されない」体感につながりやすい
- **対策**:
  - 自動保存の経過判定は `lastAutoSaveActivityAtRef` のような『実際に保存可能だった最新時刻』で管理し、`skipped-processing` では更新しない
  - `isProcessing` が `true -> false` に戻った直後、かつ保存間隔を超過していれば短い遅延で catch-up save を実行する
  - `visibilitychange` / `focus` / `pageshow` 復帰時も同じ基準で overdue 判定し、hidden 中の見送りを持ち越さない
- **注意**:
  - export 中だけ保存を避け、通常の no-change / empty 判定では基準時刻を更新して次周期までの待機へ戻す
  - iOS Safari preview の再生制御とは分離し、保存再開ロジックだけを `useAutoSave.ts` に閉じる

### 13-76. `OfflineAudioContext` の先行プリレンダリング条件は resolver で iOS Safari に限定する

- **ファイル**: `src/hooks/export-strategies/exportStrategyResolver.ts`, `src/hooks/useExport.ts`, `src/test/exportStrategyResolver.test.ts`
- **問題**:
  - Safari 向け回避策のはずの `OfflineAudioContext` 事前レンダリング条件が `hasAudioSources` だけだと、Android / PC でも常に音声準備待ちが入って export 準備時間が長くなる
  - 条件が hook 本体に散ると、iOS Safari 専用の責務境界が崩れて再発しやすい
- **対策**:
  - `shouldUseOfflineAudioPreRender()` の入力に `isIosSafari` を含め、`isIosSafari && hasAudioSources` のときだけ true を返す
  - `useExport.ts` 側は resolver の結果だけを参照し、Android / PC は従来どおり WebCodecs のリアルタイム音声キャプチャ経路へ進める
  - resolver の pure logic をテストで固定し、非iOSへの漏れを自動検知する
- **注意**:
  - iOS Safari export の音声安定化には必要なため、条件を削るのではなく resolver へ閉じ込めて platform 分岐を明示する
  - preview 側の iOS Safari workaround と混線させず、export strategy の責務として維持する

### 13-77. フェードアウト終端で動画フレームが欠けたら hold より黒クリアを優先する

- **ファイル**: `src/components/TurtleVideo.tsx`, `src/utils/previewPlatform.ts`, `src/test/previewPlatform.test.ts`
- **問題**:
  - Android / PC では、トリミング済み動画のフェードアウト終端でデコーダが最後の `seeked` / `ended` に寄ると、`holdFrame` が直前の可視フレームを保持してしまい「黒へ落ち切る直前に最終フレームが残る」ことがある
  - このとき audio routing や native mute を触ると、過去に対策した Teams 共有時の遅延回避まで壊すリスクがある
- **対策**:
  - `shouldBlackoutVideoFadeTail()` で「fade alpha がほぼ 0 の tail」だけを pure に判定し、その区間でフレーム未確定なら `holdFrame` ではなくキャンバス黒クリアを優先する
  - 修正は `renderFrame()` の描画判定に閉じ、既存の `shouldHoldVideoFrameAtClipEnd()` / audio node / native mute 制御は変更しない
- **注意**:
  - フェード中盤まで黒クリアへ倒すと、正当なフェード途中フレームまで欠けて見えるため、alpha が十分下がった末尾だけに限定する
  - Teams 向けの muted / WebAudio 経路は既存 helper に委ね、描画不具合の修正を音声制御へ波及させない
  - 末尾 tail に入ったら「フレーム欠落時だけ黒、取得できたら描画」にすると黒↔最終フレームが交互に出て点滅しやすい。terminal window に入ったら描画自体を黒へ揃え、終端品質を優先する

### 13-78. export 音声の事前プリレンダリングは全環境で先行実行し、非 iOS はフレーム境界へ揃えて滑らかさを守る

- **ファイル**: `src/hooks/export-strategies/exportStrategyResolver.ts`, `src/hooks/useExport.ts`, `src/test/exportStrategyResolver.test.ts`
- **問題**:
  - 非 iOS を warmup-only + リアルタイム音声キャプチャ優先へ戻した状態では、端末やブラウザ差で export 品質が安定せず、音声も映像も滑らかさが揺れやすい
  - CFR 30fps でエンコードしていても、Canvas 描画側の時刻がフレーム境界に揃っていないと motion が微妙に引っかかって見える
- **対策**:
  - `shouldUseOfflineAudioPreRender()` を `hasAudioSources` ベースへ戻し、Android / PC / iOS すべてで export 前に音声をプリレンダリングする
  - 非 iOS の export ループでは `elapsed` を `1 / FPS` 単位へ切り下げ、`renderFrame()` が CFR の出力フレームと同じ時刻を描くようにする
  - WebCodecs 側の TrackProcessor / ScriptProcessor は OfflineAudioContext 失敗時のフォールバックとして残し、完全撤去はしない
  - resolver テストで「非 iOS も事前プリレンダリングへ戻す」境界を固定する
- **注意**:
  - iOS Safari 固有の MediaRecorder / keep-alive / preview workaround は従来どおり維持し、非 iOS 向けの時刻スナップを iOS 条件へ混ぜない
  - フレーム境界スナップは export のみに適用し、通常 preview のシークや再生の追従性は維持する

### 13-79. export の live audio track は存在有無だけでなく `readyState === 'live'` まで判定する

- **ファイル**: `src/hooks/useExport.ts`, `src/hooks/export-strategies/exportStrategyResolver.ts`, `src/test/exportStrategyResolver.test.ts`
- **問題**:
  - `MediaStreamAudioDestinationNode.stream.getAudioTracks()[0]` が取得できても、環境や直前の録画停止手順によっては track がすでに `ended` のことがある
  - この状態を単なる「audio track あり」とみなして TrackProcessor 高速経路へ進むと、Android / PC でも音声 0 chunk のまま無音 mp4 になり得る
- **対策**:
  - export 開始時に `audioTrack.readyState === 'live'` を `hasLiveAudioTrack` として切り出し、**WebCodecs 音声キャプチャ戦略の判定**と診断ログで共有する
  - live でない track は TrackProcessor 高速経路に使わず、ScriptProcessor / オフライン補完側へ倒す
  - 診断ログにも `audioTrackReadyState` を残し、無音再発時に live/ended のどちらだったか追えるようにする
- **注意**:
  - Android / PC の速度最適化は「track が live な通常ケース」でのみ TrackProcessor を使う
  - iOS 側の事前プリレンダリング条件にはこの判定を混ぜず、platform 条件を分離して保つ

### 13-80. export 尺はタイムライン値ではなく CFR フレーム境界へ切り上げて音声終端も同じ長さへ合わせる

- **ファイル**: `src/hooks/useExport.ts`, `src/utils/exportTimeline.ts`, `src/test/exportTimeline.test.ts`
- **問題**:
  - WebCodecs export は 30fps の CFR で映像フレーム数を離散化するため、`totalDuration` がフレーム境界に乗らない案件では `frameCount / FPS` と音声長が数ms〜十数msずれることがある
  - この差分が小さくても、Teams 側が「音声と動画にズレあり」と見なして再パッケージ時に補正し、わずかな遅延やスロー再生感として再発する場合がある
- **対策**:
  - `alignExportDurationToFrameGrid()` で export 尺を `ceil(totalDuration * FPS) / FPS` へ切り上げ、映像フレーム数とコンテナ上の最終動画時刻を先に確定する
  - `useExport.ts` では `expectedVideoFrames`、`maxAudioTimestampUs`、`OfflineAudioContext` のプリレンダ長、`feedPreRenderedAudio()` の上限長に同じ aligned duration を共有し、動画・音声の終端を必ず一致させる
  - 診断ログにも raw duration と aligned duration を残し、境界ズレの再発を追跡できるようにする
- **注意**:
  - 端数を切り捨てると末尾コンテンツを欠く可能性があるため、必ず切り上げる
  - 修正は export 専用に閉じ、preview 再生の時間進行や iOS Safari MediaRecorder 分岐の責務は変えない

### 13-81. Android export の `画像 -> 動画` 境界は短時間だけ再生開始を抑止し、時刻同期を優先する

- **ファイル**: `src/components/TurtleVideo.tsx`, `src/utils/previewPlatform.ts`, `src/test/previewPlatform.test.ts`
- **問題**:
  - Android で export 中に `画像 -> 動画` へ切り替わる瞬間、動画デコーダの立ち上がりと `play()` 再開が競合し、境界付近で映像が乱れる（プレビュー中は出にくいが書き出し結果で再現しやすい）ことがある
  - このタイミングで通常の再生再開ロジックをそのまま適用すると、同期補正と再生開始が同時に走り、境界フレームが不安定になりやすい
- **対策**:
  - `shouldStabilizeImageToVideoTransitionDuringExport()` を追加し、export かつ `画像 -> 動画` の先頭 120ms だけ安定化モードに入る
  - 安定化モードでは `play()` 再開を抑止し、`currentTime` を目標時刻へ強めに合わせることで、境界直後のフレーム確定を優先する
  - 判定ロジックは utility 化して `previewPlatform` テストで固定し、将来のしきい値変更でも回帰を検知できるようにする
- **注意**:
  - 対策は export 中の境界区間に限定し、通常 preview や動画→動画遷移には適用しない
  - 安定化ウィンドウを広げすぎると動画の立ち上がり体感を損なうため、最小限（120ms）を維持する
  - この安定化は Android export 専用に維持し、PC 非 iOS export には広げない。PC では v4.1.0 比較でコマ飛び要因になりやすいため、通常の同期制御へ戻す

### 13-82. 自動保存は起動/アクティブ復帰で即時トリガーし、定周期 tick では差分有無に関係なく保存を試行する

- **ファイル**: `src/hooks/useAutoSave.ts`, `src/test/useAutoSave.test.tsx`
- **問題**:
  - 自動保存が差分検知と overdue 判定に依存しすぎると、起動直後・復帰直後・設定変更直後に保存が走らず、実運用で「自動保存が止まっている」体感になりやすい
  - 差分なしスキップが続くと、復旧用スナップショットの更新が止まり、万一の破損時に最新寄りの復旧点を失う
- **対策**:
  - `visibilitychange` / `focus` / `pageshow` と初期タイマー開始時に prompt save を必ず発火する
  - `runAutoSave({ force: true })` を定周期 timer / 復帰 catch-up / export 終了後 catch-up に適用し、差分有無に関係なく保存を試行する
  - export 中 (`isProcessing`) だけは従来どおり保存を抑止し、処理終了後に catch-up で再開する
- **注意点**:
  - 強制保存は IndexedDB 書き込み回数が増えるため、将来最適化する場合でも「起動・復帰直後の prompt save」と「export 中のみ抑止」の契約は維持する
  - `runAutoSave` の `force` パラメータを変更する場合は、`useAutoSave.test.tsx` のライフサイクル系テストを必ず更新して回帰を防ぐ

### 13-83. 自動保存の復帰契機は「即時保存固定」ではなく overdue 判定で cadence を守る

- **ファイル**: `src/hooks/useAutoSave.ts`, `src/test/useAutoSave.test.tsx`
- **問題**:
  - `visibilitychange` / `focus` / `pageshow` のたびに prompt save を強制すると、設定間隔（例: 5分）より短い周期で `savedAt` が更新され、保存UIが「たった今」に張り付きやすい
  - 保存自体は成功していても、ユーザーからは「常時保存されているのか」「設定間隔が効いているのか」が判別しづらい
- **対策**:
  - 復帰契機の catch-up は `forcePromptSave` を使わず、`lastAutoSaveActivityAtRef` と設定間隔による overdue 判定でのみ実行する
  - 非アクティブ復帰時は残り時間を維持するタイマー再開（timeout -> interval）を優先し、期限前は保存を走らせない
  - 定周期 tick の `runAutoSave({ force: true })` は維持し、設定間隔どおりの強制保存契約を継続する
- **注意点**:
  - 保存失敗時は `lastAutoSaveActivityAtRef` を更新しないため、復帰イベントで overdue と判定されれば即時再試行が走る（失敗回復優先）
  - 復帰即保存を戻したい場合は UI 表示要件（「n分前」表示）との整合を再定義してから反映する

### 13-84. 保存モーダルの相対時刻は Date.now 基準で計算し、表示中だけ 30 秒ごとに更新する

- **ファイル**: `src/components/modals/SaveLoadModal.tsx`, `src/test/modalHistoryStability.test.tsx`
- **問題**:
  - モーダルを開いたままだと React の再描画契機がなく、`たった今` / `3分前` などの相対時刻表示が固定される
  - 端末時計ズレで `savedAt` が未来時刻になると、負の差分をそのまま扱うと不自然な表示になりやすい
- **対策**:
  - `formatDateTime()` を `Date.now()`（注入可能な `nowMs`）基準で差分計算し、負の差分は `0` に丸めて `たった今` として扱う
  - SaveLoadModal が開いている間だけ `setInterval(30_000)` で相対時刻更新用 state を更新し、閉じたら即 cleanup する
  - テストで「表示中に `たった今` -> `3分前` へ遷移すること」と「未来時刻が `たった今` 表示になること」を固定する
- **注意点**:
  - この更新は表示専用であり、保存タイミングや auto save cadence そのものは変更しない
  - interval はモーダル表示中に限定し、閉じた状態での不要な再描画を発生させない
### 13-85. 非 iOS export は壁時計ベースを維持しつつ、描画時刻の先行を 1 フレームまでに制限する

- **ファイル**: `src/components/TurtleVideo.tsx`, `src/utils/exportTimeline.ts`, `src/test/exportTimeline.test.ts`
- **問題**:
  - `Date.now()` を `1 / FPS` へ切り下げるだけの非 iOS export では、`requestAnimationFrame` が 2 フレーム以上遅れた瞬間に中間フレームを描かずに後ろの時刻へ飛び、PC / Android でコマ飛びのように見えやすい
  - 一方で完全なフレームカウンタ進行へ戻すと、実デコードが追いつかない場面で同一フレームの連続取り込みが増え、別経路のカクつきを再発させやすい
- **対策**:
  - 非 iOS export のループ時刻は壁時計を `1 / FPS` に切り下げた値を基準にしつつ、`lastRenderedExportTimeRef + 1 / FPS` を上限にして 1 ループで 1 フレームまでしか先行させない
  - `lastRenderedExportTimeRef` は実際に Canvas が更新されたときだけ進め、hold frame 中は次ループでも同じ export 時刻を再試行する
  - これにより `v5` の音声・export 経路修正を維持したまま、rAF 遅延起因の中間フレーム欠落だけを抑制する
- **注意点**:
  - iOS Safari の別 export ルートには適用しない
  - export frame 数の基準を `currentTimeRef` へ戻すと再び render 済み時刻とのズレが広がるため、capture 側は引き続き `resolveExportPlaybackTimeSec()` で描画済み時刻を優先する

### 13-86. manual canvas export は 1 poll で同じキャンバスを複数回 encode しない

- **ファイル**: `src/hooks/useExport.ts`, `src/utils/exportTimeline.ts`, `src/test/exportTimeline.test.ts`
- **問題**:
  - PC / Android の WebCodecs export は `VideoFrame(canvas)` を setTimeout poll で取り込むため、render 側が少し遅れたときに pending frame 数だけ同じキャンバスを一気に複製 encode しやすい
  - `v5` では render 側の保護ロジックが増えたぶん、この catch-up burst が `v4.1.0` より起きやすくなり、見た目のカクつきとして表れやすい
- **対策**:
  - manual canvas export では pending frame 数が複数あっても、1 回の poll で encode するのは 1 フレームに制限する
  - これにより encoder が「同じ時点のキャンバス」を連続複製する burst を避け、render loop の追従結果をそのまま CFR 出力へ乗せやすくする
- **注意点**:
  - これは iOS Safari MediaRecorder 経路には適用しない
  - 滑らかさ優先の変更なので、export wall-clock 時間がわずかに伸びても frame burst を再許可しない
### 13-87. iOS Safari preview の future video prewarm は「keep」だけでなく silent prime まで行う

- **ファイル**: `src/components/TurtleVideo.tsx`, `src/utils/previewPlatform.ts`, `src/test/previewPlatform.test.ts`
- **問題**:
  - `shouldKeepInactiveVideoPrewarmed()` だけでは、future video が paused のままでも「prewarm 対象」と判定される。
  - 画像ギャップ中に次動画が paused のままだと、active 化した瞬間の `play()` が iOS Safari の AudioSession を壊し、動画音声と BGM がまとめて無音化することがある。
- **実装**:
  - `shouldAvoidPauseInactiveVideoInPreview()` で、iOS preview 中に AudioNode 済み inactive video の `pause()` を避ける条件を helper 化する。
  - `shouldPrimeFutureInactiveVideoInPreview()` で、prewarm 対象の future video を silent prime すべき条件を helper 化し、`renderFrame()` 側で `currentTime=trimStart` と `play()` を行う。
  - 判定は iOS Safari preview に閉じ、PC / Android / export の既存 pause 制御は変えない。
- **注意**:
  - iOS 無音対策を helper ではなく `TurtleVideo.tsx` の局所条件だけで戻すと、後続の export / non-iOS 調整で再び上書きされやすい。
  - `pause()` 回避と future video の silent prime はセットで扱い、「keep しているのに paused のまま」という中途半端な状態を作らない。
### 13-88. iOS Safari preview の stop -> play 復帰は AudioSession 初期化より先に stopAll を済ませる

- **ファイル**: `src/components/TurtleVideo.tsx`, `src/utils/previewPlatform.ts`, `src/test/previewPlatform.test.ts`
- **問題**:
  - iOS Safari preview では、`AudioContext.resume()` / `suspend()` / `resume()` で音声経路を立て直した直後に `stopAll()` が全メディアを `pause()` すると、作り直した AudioSession を自分で崩して再び無音化することがある。
  - 特に停止ボタン後の再生や先頭再生では、この順序差だけで「初回から無音」「数秒後に BGM だけ復帰」のような不安定さが出やすい。
- **実装**:
  - `shouldStopBeforePreviewAudioRouteInit()` で iOS preview だけ `stopAll()` を audio route 初期化より前へ移す条件を helper 化する。
  - `shouldRecoverAudioOnlyAfterVideoBoundary()` で `video -> image` 境界直後の短い窓だけ audio-only を再 prime する条件を helper 化し、BGM/ナレーションの復帰を早める。
  - Android / PC と iOS export は従来順序を維持し、今回の変更は preview の iOS 条件にだけ閉じる。
- **注意**:
  - `stopAll()` の順序変更を共有経路へ広げると、Android / PC の再生・export 初期化順序まで変わるので避ける。
  - `video -> image` 境界の recovery は短い窓に限定し、通常の audio-only 再生ループを乗っ取らない。
### 13-89. iOS Safari preview 開始直後の `renderFrame(..., false)` は active media を再 pause するので避ける

- **ファイル**: `src/components/TurtleVideo.tsx`
- **問題**:
  - preview 開始処理で active video / BGM / narration を `play()` した直後に `renderFrame(fromTime, false)` を呼ぶと、そのフレーム内の通常 paused-preview 分岐が active media を再度 `pause()` してしまう。
  - iOS Safari ではこの直後の pause -> play 循環が AudioSession を壊しやすく、「停止後の初回再生が無音」「video -> image -> video で次動画が鳴らない」の再発要因になる。
- **実装**:
  - iOS preview (`muteNativeMediaWhenAudioRouted=true`) では、開始直後の同期用 `renderFrame()` も active 扱いで呼び、初回フレームが active media を止めないようにする。
  - `resetInactiveVideos()` も iOS WebAudio 済み video には pause を打たず、paused の要素だけ trimStart へ戻す。
- **注意**:
  - Android / PC の paused-preview 描画フローはそのまま維持し、この回避策を共有経路へ広げない。
  - iOS のみ render/pause 条件を変える場合は、startEngine / seek resume / inactive reset の 3 箇所をセットで確認する。

### 13-90. iOS Safari preview の静止画始まりはループ開始直前に audio-only prime を 1 回だけ再試行する

- **ファイル**: `src/components/TurtleVideo.tsx`, `src/utils/previewPlatform.ts`, `src/test/previewPlatform.test.ts`
- **背景**:
  - 先頭が静止画で BGM / narration だけが鳴るケースでは、preview 開始条件が `primePreviewAudioOnlyTracksAtTime()` の成功に依存する。
  - stop 復帰直後は media element の `readyState` と seek 完了が揃う前に最初の prime が走ることがあり、その 1 回を取りこぼすと静止画区間だけ無音のまま進み、次の動画開始でだけ音が復帰する。
- **実装方針**:
  - `shouldRetryAudioOnlyPrimeAtPreviewStart()` で「iOS Safari preview かつ active video なし、かつ WebAudio 経路あり」のときだけ再 prime する helper を追加する。
  - `startEngine()` では最初の同期描画と seek の settle 待ちが終わった直後、ループ開始前に 1 回だけ `primePreviewAudioOnlyTracksAtTime(fromTime)` を再実行する。
- **注意点**:
  - retry 条件を `previewPlatform.ts` に寄せ、Android / PC / export では必ず `false` になるテストを入れて共有経路への漏れを防ぐ。
  - これは「静止画先頭の audio-only 起動を安定させる」ための補強であり、動画側の start 順や boundary recovery と混ぜて一般化しない。

### 13-91. Android preview の active video が pause/seek 残留した場合は即時リカバリする

- **ファイル**: `src/flavors/standard/preview/usePreviewEngine.ts`, `src/utils/previewPlatform.ts`, `src/test/previewPlatform.test.ts`
- **問題**:
  - Android preview で active video が `paused=true` や `seeking=true` に残留すると、Canvas 側は再生中の想定で進む一方で映像デコーダが追従せず、ブラックアウト・カクつき・音飛びを誘発しやすい。
- **対策**:
  - `shouldRecoverAndroidPreviewVideoPlayback()` を追加し、Android preview かつ active 再生中だけ「pause/seek/readyState不足」を復帰対象として判定する。
  - `usePreviewEngine` の active video 制御で上記判定が true の場合、短い間隔で `load()` / `play()` を再試行してデコーダ停止を自己回復させる。
  - export/iOS/ユーザーseek中には適用しないガードを helper 側に集約する。
- **注意点**:
  - 復帰再試行間隔を短くしすぎると `play()` 連打で逆効果になるため、約 220ms の最小間隔を維持する。
  - Android preview 専用ロジックを共通経路へ広げない。

### 13-92. Android trimmed entry は preseek 完了条件を「hidden play の実進行」まで含めて判定する

- **ファイル**: `src/flavors/standard/preview/usePreviewEngine.ts`
- **問題**:
  - `readyState=4` と trimStart 近傍への seek 完了だけでは、Android 実機で境界直後にデコーダが立ち上がらず、`preseekMiss` / `startLatency` / 大きな drift が残る。
- **対策**:
  - `androidTrimPreseekRef` に `firstAdvancedAtSec` を持たせ、`currentTime` が target から実際に前進した時刻を記録する。
  - `preseek.completed` は `readyState>=3 && !seeking && !paused && drawable && drift<=0.12` に加え、`currentTimeAdvancedMs>=80` を満たした時のみ true にする。
  - start/stop/finalize で boundary 診断状態を明示的にリセットし、`frameGap` などのセッション跨ぎ偽陽性を防ぐ。
- **注意点**:
  - 境界 300ms 以内は clock rebase を抑制し、`drift>400ms` かつ drawable でない破綻時に限定する。
  - drawable かつ再生中 (`readyState>=3 && !paused && !seeking`) の場合は holdFrame を優先しない。

### 13-93. Android trimmed boundary では active/next の warmup 完了を厳格化し、drawable 時の hold を禁止する

- **ファイル**: `src/flavors/standard/preview/usePreviewEngine.ts`
- **問題**:
  - 境界直前まで preseek/warmup を実施していても、active 側で `preseeked=false` 相当の状態が残ると `preseekMiss` と `startLatency` が再発しやすい。
  - drawable (`readyState>=3 && !paused && !seeking && videoWidth/Height>0`) なフレームでも hold を発動すると、境界で瞬停として知覚される。
- **対策**:
  - trimmed entry の `isPreseekReadyEntry` 判定に `activeWarmupState.preseeked` と `decoderWarmupCompleted` を追加し、active 昇格時に warmup 未完了を明確に弾く。
  - `preview.trimmedEntry.preseekMiss` に warmup 実行/完了、active ready/paused/seeking を添えて「未実行か状態喪失か」を切り分け可能にする。
  - 境界前 warmup は `trimStart-0.3s` 起点で hidden muted play を行い、`currentTime` が 80ms 以上前進した実績が確認できた場合のみ `decoderWarmupCompleted=true` にする。
  - drawable 時は `holdFrame=false` を維持し、diagnostic の hold 表示も実際の挙動に一致させる。
- **注意点**:
  - この対策は Android preview 専用で、iOS/PC の共有経路や完了後 freeze の見た目ロジックは変更しない。
  - warmup 状態を trimStart 変更時に reset する際は `warmupStartAtSec` も同時に初期化し、古い進行量を再利用しない。

### 13-94. Android preview 境界では next video を pause/reset せず、再生中の endClear と warmup 警告を抑制する

- **ファイル**: `src/flavors/standard/preview/useInactiveVideoManager.ts`, `src/flavors/standard/preview/usePreviewEngine.ts`, `src/test/standardInactiveVideoManager.test.tsx`
- **問題**:
  - Android preview で next video を inactive reset 時に `pause + trimStart seek` すると、境界時に `activePaused=true` となって start latency が増大し、引っかかりが発生する。
  - 再生中タイムライン途中でも `preview.endClear.executed` が走ると、黒化/瞬停を誘発する。
  - `nextPrerollArmed=false`（warmup 無効）でも `warmup.stateLost` / `preseekMiss` を warn し続けると、真因分析を阻害する。
- **対策**:
  - `useInactiveVideoManager` で Android preview 時は `nextVideoId` と `protectedVideoIds` を preserve 対象にし、pause/reset の両方を回避する。
  - `usePreviewEngine` の endClear 抑制条件を「isActivePlaying かつ active item が存在し、timeline end 前で、`shouldBlackoutFadeTail=false`」へ統一して再生中 clear を禁止する。
  - Android boundary warmup 無効時は `preview.warmup.stateLost` と `preview.trimmedEntry.preseekMiss` の warn を発火させない。
- **注意点**:
  - free-running preroll / hard seek / visual bridge 復活や holdFrame 許容拡大で隠蔽しない。
  - Android preview 専用条件に閉じ、export/iOS/通常 preview の reset 挙動を変えない。

### 13-95. Preview runtime の `usePreviewEngine` 契約は flavor 間で同期する

- **ファイル**: `src/components/turtle-video/usePreviewEngine.ts`, `src/flavors/standard/preview/usePreviewEngine.ts`, `src/components/TurtleVideo.tsx`
- **問題**:
  - standard flavor 側で `setPreviewPlaying` を必須パラメータに追加したあと、ベース runtime 側の `UsePreviewEngineParams` が未更新だと、`PreviewRuntime` の関数型が不一致になり CI の `tsc` が失敗する。
- **対策**:
  - runtime 契約として使っているベース側 `UsePreviewEngineParams` にも同じ `setPreviewPlaying` を追加し、`previewRuntime.usePreviewEngine(...)` の呼び出しオブジェクトと整合させる。
- **注意点**:
  - flavor 実装だけ更新しても型契約が分岐して破綻するため、`usePreviewEngine` の引数追加時はベース/標準の両実装を同時に点検する。

### 13-96. Standard preview の video -> video 境界は free-running preroll ではなく paused prebuffer で準備する

- **ファイル**: `src/flavors/standard/preview/usePreviewEngine.ts`, `src/test/standardPreviewEngine.test.tsx`
- **問題**:
  - standard preview で境界前の next video 準備をすべて止めると、次動画が `preload=metadata` / `readyState=1` のまま active 化し、`play()` までのデコード開始が遅れて数100msのつなぎ目停止として見える。
  - 一方で過去の free-running silent preroll や active 境界直後の hard seek は、trimStart 付き素材で currentTime の先行・seek 残留を起こしやすい。
- **対策**:
  - standard preview かつ直後が video の video -> video 境界だけ、境界 3 秒前から next video を `preload="auto"` に戻し、metadata 取得済みなら paused のまま `trimStart` へ合わせる。
  - `preload="auto"` へ戻しても `readyState=1` のまま止まるブラウザがあるため、境界まで 250ms 以上残っている場合は同一境界で 1 回だけ `load()` と `trimStart` seek を明示し、current frame 取得を開始させる。
  - active 化後の `play()` は `readyState>=1` で要求し、`readyState>=2` 待ちによるデコード開始遅延を避ける。
  - これは paused prebuffer であり、muted play による free-running preroll、visual bridge、active hard seek は復活させない。
- **注意点**:
  - image -> video や image gap を挟む future video へ広げると、画像区間中の不要 seek / load が増えるため、直後の video -> video に限定する。
  - `preload="auto"` にした next video は inactive cleanup で即 `metadata` に戻さず、境界まで current data を保持する。
### 13-97. Preview 終端では final seek ではなく現在の drawable frame を固定する

- **ファイル**: `src/flavors/standard/preview/usePreviewEngine.ts`, `src/test/standardPreviewEngine.test.tsx`
- **問題**:
  - 通常 preview のタイムライン終端で、最後に `duration - 0.001` へ強制 seek すると、再生の最後だけ 1 フレーム飛んだように見えることがある。
  - video -> video 境界の paused prebuffer が効いていても、終端の final seek は別経路なので、境界カクつき解消後も終端だけ違和感が残る。
- **対策**:
  - 非 export の再生中 preview が終端 window に入った場合は、active video を pause し、現在 drawable なフレームをそのまま Canvas に描いて保持する。
  - この経路では final video time への `currentTime` 強制代入を行わない。export / 明示的な停止後描画の終端合わせとは分離する。
  - BGM の終端 mute は `endFinalizedRef` 確定後に限定し、通常 `renderFrame()` の終端直前 fade 値を不用意に 0 へ潰さない。
- **注意点**:
  - video -> video の paused prebuffer、Android recovery seek、trimStart 直後の sync 抑制、image -> video export stabilization は残す。
  - free-running preroll、visual bridge、Android boundary warmup、previous-frame bitmap bridge は復活させない。

### 13-98. Standard preview 開始直後の同期描画は active video を止めない

- **ファイル**: `src/flavors/standard/preview/usePreviewEngine.ts`, `src/test/standardPreviewEngine.test.tsx`
- **問題**:
  - `startEngine()` で active video に `play()` を要求した直後、同期用の `renderFrame(fromTime, false, false)` を呼ぶと paused-preview 分岐が同じ active video を `pause()` する。
  - その結果、単一動画でも `play -> pause -> loop で play 再要求` の周期が入り、開始直後の一時停止や小さなコマ飛びとして見える。
- **対策**:
  - standard preview の開始直後は `renderFrame(fromTime, true, false)` として描画し、loop 中と同じ active 再生扱いにする。
  - active video の実再生開始を待つ追加 timeout や paused 状態に基づく wall clock 補正は入れず、既存の短い 50ms settle と通常 loop に任せる。
  - 回帰テストでは `play()` 後に同じ開始フレーム由来の `pause()` が呼ばれないことを呼び出し順で確認する。
- **注意点**:
  - この対策は preview 開始直後の pause 循環を切るためのもの。video -> video 境界の準備は paused prebuffer / inactive reset 保護の既存方針と分けて扱う。
  - カクつき対策として長い `playing` 待機や startTime 補正を足すと、単一動画の開始ディレイを悪化させるため慎重に評価する。

### 13-99. Android standard preview の境界診断ログは `boundary`/`detailed` モードに限定する

- **ファイル**: `src/flavors/standard/preview/usePreviewEngine.ts`, `src/components/modals/SettingsModal.tsx`, `src/test/standardPreviewEngine.test.tsx`
- **問題**:
  - Android 実機の video -> video 境界原因を切り分けるための `preview.boundary.smoothPlan` / `preview.boundary.judgement` / sample ログを通常再生中にも組み立てると、境界直後のコンソール出力自体が軽い FPS 低下や引っかかり要因になり得る。
- **対策**:
  - 既定の `preview.log.mode=smooth` では Android 境界診断ログを出さず、`boundary` または `detailed` のときだけ active boundary state を生成する。
  - `boundary` モードでは `preview.boundary.sample` に `phase` を載せ、`before-500ms` / `enter` / `after-100ms` / `after-200ms` / `after-300ms` を確認できるようにする。
  - `smoothPlan` には prebuffer の開始時刻・target・lead、boundary/100ms/200ms 状態、hold count、clock absorb、I/O 状態を載せる。visual bridge は standard preview では無効なので `[DIAG-BOUNDARY-VISUAL-BRIDGE]` は disabled として出す。
  - `preview.nextVideo.startLatency` には境界時と 100ms 時点の `currentTime` / target / paused / readyState を載せ、decoder は間に合っているが次動画の実再生開始だけが少し遅いケースを切り分ける。
  - `preview.android.boundary.passive-switch` も Android live preview かつ診断モード時に限定し、export / iOS Safari へ漏らさない。
  - 設定モーダルの「ログモード」で `標準` / `境界診断` / `詳細` の用途を説明し、再生中の変更は停止して再生し直すと次の preview 開始から反映されることを案内する。
- **注意点**:
  - この変更は診断ログの出力条件と内容だけを変える。preroll lead time、hold window、sync threshold、visual bridge、hard seek、export 経路は変更しない。
  - 実機で切り分けるときは設定画面で「境界診断」を選ぶか、再生前に `localStorage.setItem('preview.log.mode', 'boundary')` を設定し、確認後は「標準」または `localStorage.removeItem('preview.log.mode')` で通常の軽いログに戻す。

### 13-100. iOS Safari preview の video -> image -> video は paused prebuffer と微小 native keep-alive で復帰させる

- **ファイル**: `src/flavors/apple-safari/preview/previewPlatform.ts`, `src/flavors/apple-safari/preview/usePreviewEngine.ts`, `src/flavors/apple-safari/preview/usePreviewSeekController.ts`, `src/components/media/MediaResourceLoader.tsx`, `src/test/appleSafariPreviewEngineBoundary.test.tsx`, `src/test/appleSafariFlavorRegression.test.ts`, `src/test/mediaResourceLoader.test.tsx`
- **問題**:
  - video -> image -> video の画像区間中、次動画が `HAVE_METADATA` のまま境界へ入ると、active 化後の `play()` が通っても Canvas に描ける current frame が間に合わず、黒画面または静止画で固まったように見えることがある。
  - 一方で future video を gain=0 / native volume=0 の silent play で prewarm すると、iOS Safari では映像 decode が止まり、過去に「音は流れるのに映像が固まる」退行を起こした。
  - WebAudio 経路で動画音声だけ流れている場合でも、video element 側の native volume が完全に 0 のままだと、画像 -> 動画直後に映像 decode だけが復帰しないことがある。
- **対策**:
  - iOS Safari preview かつ active item が image、次 item が video、次動画が paused / `readyState < HAVE_CURRENT_DATA` の場合だけ、画像区間中に `trimStart + 0.001s` へ小さく seek して current frame 取得を促す。
  - この準備では `play()` を呼ばない。active 化した瞬間の再生開始は既存の境界キックに任せる。
  - active item が video、previous item が image、かつ clip local time が 1.2 秒以内の場合だけ、WebAudio mix は維持しつつ native video volume を `0.001` にして video pipeline を audible 扱いにする。
  - `MediaResourceLoader` の iOS Safari video は `webkit-playsinline` を付け、親 wrapper を `overflow: visible` にして clipped parent 内に閉じ込めない。
  - seek 再開経路に残っていた future video の silent `play()` も止め、gain=0 のまま再生する経路を再導入しない。
- **注意点**:
  - active video になった後の `currentTime` 上書きは iOS Safari で `seeking=true` 残留や映像 freeze を誘発するため、今回の小さな seek は「まだ image 区間で inactive next video」の間だけに限定する。
  - native keep-alive は 0.001 の短時間・画像 -> 動画直後に限定し、通常の WebAudio 音量制御や BGM mix へ広げない。
  - keep-alive の目的は「映像 decode pipeline の維持」であり、ユーザー音量とは独立。`desiredVolume` では分岐させない (mute 動画 / fade-in 先頭フレーム = desiredVolume 0 でも decode 抑止は起こるため、0.001 を当てて decode だけ起こす)。WebAudio 側 gain は別途 desiredVolume に従うので mute/fade の音量挙動は崩れない。
  - video -> video 境界、export、standard/Android preview には広げない。

### 13-101. iOS Safari preview は future video へ gesture credit を audible play→pause で付与する

- **ファイル**: `src/flavors/apple-safari/preview/previewPlatform.ts`, `src/flavors/apple-safari/preview/usePreviewEngine.ts`, `src/test/appleSafariPreviewEngineBoundary.test.tsx`, `src/test/appleSafariFlavorRegression.test.ts`
- **問題**:
  - iOS Safari は「ユーザー操作 (gesture) 内で一度も unmuted `play()` されていない video 要素」の後続 `play()` を拒否することがある。
  - `startEngine` の prewarm では v5.1.14 で silent prewarm play() を全廃したため、`fromTime` 時点の active 動画以外は gesture credit を得られず、画像 -> 動画境界での初回 `play()` (境界キック) が拒否されて paused のまま固まる (黒画面 / 映像かたまり)。
  - これが「初回まとめ追加 (動画→画像→動画) で再現し、2 動画を一度再生してから差し込むと再現しない」差の主因。後者は先のプレビューで credit を獲得済みのため。
  - 13-100 の prebuffer / keep-alive は decode 側を助けるが、gesture credit は復元しない。
- **対策**:
  - `shouldGrantPreviewGestureCreditToFutureVideo()` で「iOS preview かつ非 export かつ future video」を判定する helper を追加する。
  - `startEngine`（gesture 内）の prewarm 直後に future video だけを 1 巡し、native volume を可聴域以下 (`PREVIEW_GESTURE_CREDIT_NATIVE_VOLUME = 0.001`)・`muted=false` にして短く `play()` -> 即 `pause()` し、gesture credit だけ取得する。
  - v5.1.14 で freeze を起こした「gain=0 の持続 silent play」とは異なり、持続再生はしない (オーバービュー 3.3 が示す audible 代案)。位置ずれは画像区間中の prebuffer / 境界 sync が補正する。
- **注意点**:
  - `volume=0` だと iOS が muted 相当と見なし unmuted credit が付かないため、必ず 0.001 (>0) + `muted=false` で play() する。
  - credit 取得 (`play()` 解決) 後は必ず `pause()` で戻す。持続再生させると v5.1.14 の映像 freeze が再発する。
  - export / standard / Android preview には広げない。**実機での最終確認が必要**な領域 (fragile な prewarm play() 経路) のため、回帰時はまずこの pass の有無を疑う。
