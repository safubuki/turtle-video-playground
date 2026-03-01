# Turtle Video 実装パターン・注意点リファレンス

本プロジェクトに組み込まれている実装パターン・ワークアラウンド・注意すべきポイントを網羅的にまとめたドキュメントです。新機能の追加や既存コードの変更時に必ず確認してください。

---

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
- **対策**: メディア ID・音量・トリム値等を連結したハッシュで変更検知。空データ時とエクスポート中はスキップ
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
- **注意**:
  - クリップ切替直後のみ厳密同期（0.05 秒）を維持し、それ以外は過剰なシークを避ける
  - `OfflineAudioContext` はリアルタイムではなく最大速度でレンダリングするため、メインスレッド負荷の影響を受けない
  - `decodeAudioData` が失敗した音声ソース（画像アイテム、音声トラックなし等）は自動的にスキップ（各ソースのデコード成否をログ出力）
  - フェード時間の重複（短いクリップ）は按分で自動クランプ
  - BGM/ナレーションのフェードアウトはプロジェクト終端からの相対位置で計算

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
- **UI**: PreviewSectionの再生コントロール横にCameraアイコンボタンを配置
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
| **下部モーダル** | 下から開くモーダルは `history.pushState` + `popstate` で戻るキー閉じを実装し、モバイルでは `scrollTop=0` かつ縦下スワイプ（72px超）で閉じる。クリーンアップ時は自分の履歴 state が先頭のときのみ `history.back()` する |
| **AIナレーション(TTS)** | 声の調子は先頭に `（スタイル指示）` として付与し、TTS 指示で「括弧内は発話しない」を明示する。実際に読ませる本文は括弧の後ろのみ |
| **AIナレーション(原稿文量)** | 原稿生成は長さモードを秒数目安で統一する。`短め=約5秒（20〜35文字）` / `中くらい=約10秒（35〜60文字）` / `長め=約20秒（100〜140文字）` をプロンプトで明示し、過剰な長文化を防ぐ |
| **自動保存タイマー** | `setInterval` は最新状態Refを参照して固定周期で実行し、編集状態の変化でタイマーを再生成しない。`visibilitychange/focus/pageshow` 復帰時に経過時間超過なら追いつき保存を実行し、保存間隔変更は custom event + `storage` で即時反映する |
| **ヘッダーモーダル遷移** | 設定/保存ボタン押下でモーダルを開く前に、通常プレビュー再生中なら `stopAll() + pause()` で明示一時停止する。再生継続のまま開くとモバイルでタップ競合し、モーダルが瞬時に閉じる誤動作を誘発しやすい |
| **先頭フレーム描画** | `time <= 0.05` の先頭付近は、`エクスポート中` または `非再生時` に限ってキャンバスを強制クリアし、終端フレーム残像（終端キャプション）との重なりを防ぐ。通常再生開始時は保持ロジックを優先して黒フラッシュを回避する |
| **モバイル** | スライダー誤操作を `useSwipeProtectedValue` で防止。`playsInline` 必須 |
| **レスポンシブ** | モバイル既存スタイルは変更禁止。`md:` / `lg:` バリアントのみ追加で対応 |
| **IndexedDB** | `File → ArrayBuffer → File` のラウンドトリップが必要。大容量データに注意。容量不足時は`auto`を自動削除せず、確認後のみ削除リトライする |
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

### 13-33. Narration clip trimStart/trimEnd support

- **Files**: `src/types/index.ts`, `src/stores/audioStore.ts`, `src/components/sections/NarrationSection.tsx`, `src/components/TurtleVideo.tsx`, `src/hooks/useExport.ts`, `src/stores/projectStore.ts`, `src/hooks/useAutoSave.ts`
- **Issue**: Long narration reuse needs per-clip in/out trim without implementing waveform split.
- **Pattern**:
  - Add `trimStart` / `trimEnd` to `NarrationClip` and initialize on clip creation.
  - Normalize and clamp in store updates (`updateNarrationTrim`) with a minimum gap to avoid invalid ranges.
  - In preview playback and visibility resync, map timeline time to source time with `sourceTime = trimStart + clipTime`.
  - In export scheduling, use `source.start(clipStart, trimStart, playDuration)` where `playDuration` is computed from trimmed duration and timeline remainder.
  - Persist trim fields in project save/load with backward-compatible defaults for legacy data.
  - Include trim fields in auto-save change detection hash.
  - In narration UI, expose trim sliders/inputs and show duration based on trimmed range.
- **Note**: Loading the same narration source multiple times with per-clip trim is a practical substitute for dedicated split functionality.

### 13-34. Narration trim controls as collapsed accordion (default closed)

- **Files**: `src/components/sections/NarrationSection.tsx`
- **Issue**: Narration card became visually dense when trim controls were always visible.
- **Pattern**:
  - Keep `startTime` and `volume` controls always visible for primary operation.
  - Move `trimStart` / `trimEnd` controls into a per-clip accordion (`openTrimMap`) and default it to closed.
  - Reuse chevron-style toggle pattern consistent with clip settings panels.
- **Note**: This keeps the common workflow simple while preserving advanced trim editing on demand.

### 13-35. Narration help content sync with trim-accordion UI

- **Files**: `src/constants/sectionHelp.ts`
- **Issue**: Help modal text lagged behind narration UI after trim controls became collapsible.
- **Pattern**:
  - Remove stale help visuals (e.g., narration `settings_button`) that no longer exist in the actual row controls.
  - Add explicit help item for trim controls being inside a collapsed section.
  - Clarify that `startTime` and `volume` are always visible for normal workflow.
- **Note**: Keep help descriptions aligned with current UI to reduce onboarding confusion and false bug reports.

### 13-36. Narration per-clip mute (preview/export/save)

- **Files**: `src/types/index.ts`, `src/stores/audioStore.ts`, `src/components/sections/NarrationSection.tsx`, `src/components/TurtleVideo.tsx`, `src/hooks/useExport.ts`, `src/stores/projectStore.ts`, `src/utils/indexedDB.ts`, `src/hooks/useAutoSave.ts`
- **Issue**: Narration card mute button existed visually but did not mute playback/export output.
- **Pattern**:
  - Add `isMuted` to `NarrationClip` and normalize with backward-compatible default (`false`).
  - Add store action `toggleNarrationMute` and wire it to narration card speaker button.
  - In preview playback, use effective volume `clip.isMuted ? 0 : clip.volume`.
  - In export audio scheduling, skip muted narration clips to prevent mixed output.
  - Persist `isMuted` in project save/load and include it in auto-save change hash.
- **Note**: Keep slider value while muted so unmute restores previous level.

### 13-37. Unified volume range 0-250% for video/BGM/narration

- **Files**: `src/components/media/ClipItem.tsx`, `src/components/sections/BgmSection.tsx`, `src/components/sections/NarrationSection.tsx`, `src/stores/mediaStore.ts`, `src/stores/audioStore.ts`, `src/stores/projectStore.ts`, `src/hooks/useExport.ts`
- **Issue**: Volume control upper bound was inconsistent (some paths capped at 200%).
- **Pattern**:
  - Standardize max gain to `2.5` (250%) across UI sliders, store clamps, restore path, and export mix path.
  - Keep default volume at `1.0` and percentage label as `Math.round(volume * 100)`.
  - Ensure tests verify clamping at `2.5` for BGM and narration.
- **Note**: Perceived loudness is logarithmic; 200% amplitude (~+6 dB) is not perceived as "twice as loud".

### 13-38. Narration save UX improvement for Android/fallback download

- **Files**: `src/components/TurtleVideo.tsx`, `src/components/sections/NarrationSection.tsx`
- **Issue**: On Android fallback download, first save had no clear result dialog and second save could show confusing overwrite prompt.
- **Pattern**:
  - Replace direct `<a download>` in narration card with delegated save handler.
  - Generate unique timestamped filename per save to avoid overwrite-confirm confusion.
  - Use `showSaveFilePicker` when available; otherwise fallback to anchor download.
  - Show explicit user feedback (`alert` + toast) after save start/completion/cancel.
- **Note**: Fallback path cannot detect actual OS-level completion reliably; communicate "save started" clearly.

### 13-39. Gemini API key transport hardening (query string -> header)

- **Files**: `src/components/TurtleVideo.tsx`, `src/hooks/useAiNarration.ts`
- **Issue**: Gemini API calls appended `?key=...` to request URLs, which increases accidental exposure risk through URL surfaces.
- **Pattern**:
  - Keep endpoint format as `${GEMINI_API_BASE_URL}/{model}:generateContent` (no query key).
  - Send API key via `x-goog-api-key` request header.
  - Set `referrerPolicy: 'no-referrer'` on external Gemini calls.
  - Keep request body schema and fallback flow unchanged to avoid behavior/performance regressions.
- **Note**: Future Gemini integrations should never place API keys in query parameters.

### 13-40. Caption help position chip label should avoid strict XY implication

- **Files**: `src/components/modals/SectionHelpModal.tsx`
- **Issue**: Caption help chip label showed `位置X/Y`, but actual caption positioning is not intended as strict XY coordinate control in user guidance.
- **Pattern**:
  - Use `位置` as the help chip label for caption style guidance.
  - Keep the move icon for visual association, but avoid over-specific coordinate wording.
- **Note**: Help labels should describe practical operation granularity, not internal parameter semantics.

### 13-41. App help "main features" should include swipe-misoperation guard summary

- **Files**: `src/constants/sectionHelp.ts`
- **Issue**: The top-level help summary did not mention mobile slider misoperation protection, making accidental value-reset behavior look unexpected.
- **Pattern**:
  - Add one bullet under `主要な機能` that explains the guard in user terms.
  - Describe detection by swipe direction and touch duration, and clarify that mistaken slider changes are restored automatically.
- **Note**: Keep this sentence aligned with `useSwipeProtectedValue` behavior to avoid overpromising.
