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

- **ファイル**: `src/components/TurtleVideo.tsx`, `src/components/turtle-video/usePreviewVisibilityLifecycle.ts`
- **問題**: タブ切り替え後に Canvas が黒画面のまま
- **対策**:
  - `usePreviewVisibilityLifecycle` で `visibilitychange` / `blur` / `focus` / `pagehide` / `pageshow` を一括管理する
  - `document.visibilityState === 'visible'` で `requestAnimationFrame(() => renderFrame(...))` を実行する
  - `readyState < 2` のメディア要素には `element.load()` で再読み込みする
  - `previewPlatform` の recovery policy を hook 内で再利用し、platform 判定と lifecycle 処理を分離する
- **注意**: lifecycle hook には refs と副作用 callback だけを渡し、platform ごとの差分は `previewPlatform` 側へ残す

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

- **ファイル**: `src/components/TurtleVideo.tsx`, `src/components/turtle-video/usePreviewSeekController.ts`
- **問題**: Android でシーク終了（`pointerup`/`touchend`）後に `change` が遅延発火すると、シーク再開準備と競合して `renderFrame(..., false)` が走り、再生のカクつきやブラックアウトが発生する
- **対策**:
  - `usePreviewSeekController` に `handleSeekChange` / `handleSeekEnd` / `syncVideoToTime` / paused frame redraw を集約する
  - `handleSeekChange` は `isSeekingRef.current === false` の場合、再生状態を維持したまま `syncVideoToTime(..., { force: true })` で同期する
  - `cancelPendingSeekPlaybackPrepare()` / `cancelPendingPausedSeekWait()` はアクティブなシークセッション中にのみ実行し、遅延 `change` で再開準備を破壊しない
  - `handleSeekEnd` の再生再開時刻は固定値ではなく `currentTimeRef.current` から再取得し、遅延イベントで更新された最終シーク位置を取りこぼさない
- **注意**: シークセッション外イベントで `renderFrame(..., false)` を実行すると、再生中動画を誤って `pause()` しやすい。seek 復帰待機の cleanup は `cancelSeekPlaybackPrepareRef` と global seek listener の両方から中断できる構造を維持する

### 2-7. standard preview 再生クロック統一

- **ファイル**: `src/flavors/standard/preview/usePreviewEngine.ts`, `src/flavors/standard/preview/usePreviewSeekController.ts`, `src/flavors/standard/preview/playbackClock.ts`
- **問題**: standard preview で再生ループは `performance.now()` 基準なのに、シーク中の `change` とシーク復帰後の再開時刻が `Date.now()` 基準のままだと、Android でシーク後に `startTimeRef` が壊れ、1 秒刻みのようなカクついた再生になりやすい
- **対策**:
  - standard preview の再生ループ・再生開始・シーク復帰で使う現在時刻を `getStandardPreviewNow()` に統一する
  - throttled seek の timeout callback で更新する `lastSeekTimeRef` も `getStandardPreviewNow()` に合わせ、`SEEK_THROTTLE_MS` 判定へ `Date.now()` を混在させない
  - `startTimeRef` を更新する箇所は loop 側と同じ time origin を必ず使い、片側だけ `performance.now()` / `Date.now()` を混在させない
- **注意**: この統一は `standard` flavor の preview 専用。apple-safari 側は別 runtime の前提で `Date.now()` ベースのまま管理しているため、shared helper へ戻さず flavor-owned boundary で閉じる

### 2-8. エクスポート時の画像→動画境界ちらつき対策

- **ファイル**: `src/components/TurtleVideo.tsx`, `src/utils/previewPlatform.ts`
- **問題**: エクスポート中、画像クリップから動画クリップへ切り替わる瞬間だけ黒フレームが一瞬挟まることがある
- **原因**:
  - 次の動画が prewarm 済みだと `holdFrame` 判定時点では `readyState >= 2` に見える
  - しかし直後の export 安定化処理で `currentTime` 補正が入り、そのフレームでは `seeking` になって描画できない
  - `holdFrame=false` のまま先に黒クリアされると、画像→動画境界だけ一瞬ちらつく
- **対策**:
  - `shouldHoldFrameForImageToVideoExportTransition()` で「画像→動画の export 安定化ウィンドウ中に、まだそのフレームは描画不能か」を判定する
  - `renderFrame` の `holdFrame` 判定にこの条件を加え、動画が同期・seek 完了するまで直前の画像フレームを保持する
- **注意**:
  - この保持は `isExporting && previousItemType === 'image'` の短い安定化区間に限定する。動画→動画や通常 preview に広げると、既存の sync / fade tail / blackout 対策へ影響しやすい
  - 画像→動画境界の seek 補正しきい値は `EXPORT_IMAGE_TO_VIDEO_STABILIZATION_SYNC_TOLERANCE_SEC` を single source of truth とし、保持判定と `currentTime` 補正の両方で共有する

### 2-9. standard preview の stop / paused seek 後の再生待機

- **ファイル**: `src/flavors/standard/preview/usePreviewEngine.ts`
- **問題**: standard preview で停止直後や paused seek 直後に再生を押すと、active video がまだ `seeking` / `readyState < 2` のまま `play()` を投げて失敗し、Android で音飛び・映像飛びのままループだけ進みやすい
- **対策**:
  - standard preview の `startEngine()` では、active video の `currentTime` を合わせた直後に `seeked` / `loadeddata` / `canplay` を待ち、描画可能フレームが揃うまで loop 開始を遅らせる
  - 再生開始自体は `requestVideoPlayWithRetry()` で retry 付きにし、stop 後・paused seek 後でも `play()` の一発失敗で置き去りにしない
  - 待機と retry の継続条件には `loopIdRef`・`previewPlaybackAttemptRef`・`isSeekingRef` を使い、古い再生試行が新しい再生を上書きしないようにする
- **注意**: この待機は `standard` flavor の preview start 専用。shared や `apple-safari` 側へ共通化すると flavor ごとの再生ポリシー差分を再び混ぜやすいため、runtime-owned boundary のまま閉じる

### 2-10. standard preview の active seek 中は visibility 復帰で seek cleanup を横取りしない

- **ファイル**: `src/flavors/standard/preview/usePreviewVisibilityLifecycle.ts`, `src/test/standardPreviewVisibilityLifecycle.test.tsx`
- **問題**: Android でシーク中に `visibilitychange` / `focus` / `pageshow` が挟まると、可視復帰側が paused seek の待機解除や paused frame 再描画を先に実行し、`handleSeekEnd` の復帰シーケンスと競合しやすい
- **対策**:
  - standard preview の visibility lifecycle は `isSeekingRef.current === true` の間、可視復帰で `cancelPendingSeekPlaybackPrepare()` / `cancelPendingPausedSeekWait()` / paused frame 再描画を実行しない
  - seek セッション完了後の `handleSeekEnd` / `handleSeekChange` に最終フレーム同期を委ね、visibility 復帰は必要な resync フラグだけ保持する
- **注意**: このガードは Android/PC 向け `standard` preview 専用。shared 側で一律に paused frame 再描画を止めるのではなく、flavor-owned lifecycle hook で seek 中だけ defer する

### 2-11. standard preview の image → trimStart あり video 開始直後の hold 強化

- **ファイル**: `src/flavors/standard/preview/usePreviewEngine.ts`, `src/test/standardPreviewEngine.test.tsx`
- **問題**: Android preview で `video -> image -> trimmed video` の境界に入った直後、trimStart 付き動画の先頭フレームがまだ安定しておらず、開始 0.2 秒だけカクつきやすい
- **対策**:
  - `renderFrame` で `previousItem?.type === 'image'` かつ `activeItem.trimStart > 0` の short window（`localTime <= 0.25`）だけ専用ガードを有効にする
  - その間は `currentTime` を `trimStart + localTime` へ 0.03 秒精度で強めに合わせ、補正したフレームは `holdFrame` + `shouldSkipAndroidPreviewActiveDraw` で描画を止める
  - `readyState < 2` / `seeking` / `videoWidth|videoHeight <= 0` でまだ描画不能なら、動画を無理に出さず直前フレーム保持を優先する
- **注意**: この安定化は Android/PC 向け `standard` preview のみ。audio / export / seek / visibility へ波及させず、`image -> trimmed video` の開始 0.2 秒だけに閉じる

### 2-12. standard preview の image 終端 0.5 秒 preseek + trimmed video 先頭 0.2 秒 hold

- **ファイル**: `src/flavors/standard/preview/usePreviewEngine.ts`, `src/test/standardPreviewEngine.test.tsx`
- **問題**: Android preview の `video -> image -> trimmed video` で、trimmed video 側に入ってから補正すると境界の 1 フレーム目だけカクつきや停止感が残りやすい
- **対策**:
  - 画像クリップ再生中、残り 0.5 秒以内に次が `trimStart > 0` の video なら、次 video 要素を `trimStart` へ先に寄せる
  - trimmed video がアクティブ化した直後も、先頭 0.2 秒だけ `trimStart + localTime` に安定するまで `holdFrame` + `shouldSkipAndroidPreviewActiveDraw` で描画を止める
  - 補正は `readyState >= 1 && !seeking` のときだけ行い、audio / export / seek / visibility の別経路は変更しない
- **注意**: この対策は Android/PC 向け `standard` preview の image 境界専用。一般の video prewarm や iOS Safari runtime に広げない

### 2-13. standard preview の video 境界 0.6 秒 preseek + trimmed head 0.25 秒 hold + BGM soft sync

- **ファイル**: `src/flavors/standard/preview/usePreviewEngine.ts`, `src/flavors/standard/preview/usePreviewAudioSession.ts`, `src/test/standardPreviewEngine.test.tsx`
- **問題**: Android preview で同一動画を複数クリップに分けると、`video -> video` 境界や `trimStart > 0` の clip 先頭で seek が遅れ、固まり・黒フレームが出やすい。さらに BGM 追加時は BGM 側の同期準備が active video の再生開始と競合し、一部 clip が paused / ready 不足のまま進みやすい
- **対策**:
  - active clip の終了 0.6 秒前から、次の `video` clip を `nextItem.trimStart || 0` へ preseek する。`image -> video` だけでなく `video -> video` も対象にする
  - `trimStart > 0` の active video は clip 先頭 0.25 秒だけ `trimStart + localTime` に十分近づくまで `holdFrame` + `shouldSkipAndroidPreviewActiveDraw` で保持する
  - Android standard preview の BGM は `play()` / `currentTime` を soft sync するだけに留め、readyState や失敗を理由に active video の描画・再生開始を止めない
  - preview start の audio-only prime も WebAudio node 前提にせず、native `<audio>` 要素が存在すれば BGM / narration を個別に頭出しできるようにする
- **注意**:
  - 対策は `standard` flavor の Android preview 再生中かつ非 export / 非 seek に限定する
  - iOS Safari、export、seek controller、visibility lifecycle には広げない
  - BGM soft sync では active video 用の WebAudio 準備や待機条件を増やさず、失敗時も fire-and-forget を維持する

### 2-14. standard preview の Android inactive reset は next video 1 本だけ seek する

- **ファイル**: `src/flavors/standard/preview/useInactiveVideoManager.ts`, `src/flavors/standard/preview/usePreviewEngine.ts`, `src/test/standardInactiveVideoManager.test.tsx`, `src/test/standardPreviewEngine.test.tsx`
- **問題**: Android preview で動画数が 3〜4 本に増えると、inactive video 全体へ `pause()` + `currentTime` reset を繰り返してデコーダ負荷が上がり、active video が固まってシークバーだけ進みやすい
- **対策**:
  - `resetInactiveVideos()` は Android preview 時だけ `{ nextVideoId, isAndroidPreview }` を受け取り、active でも next でもない inactive video には `pause()` だけを行う
  - `usePreviewEngine` は active clip 以降で最初に来る `video` だけを `nextVideoId` として渡し、image gap を挟んでも遠い future video まで seek しない
  - Android preview の next video preseek は直近 1 本だけに留め、BGM 側の prime 失敗や待機で active video 開始を止めない既存方針を維持する
- **注意**:
  - この制限は `standard` flavor の Android preview 専用。`apple-safari`、export、seek controller、visibility lifecycle へ波及させない
  - inactive video の `currentTime` を戻してよいのは active clip の次に来る video 1 本だけで、過去 clip や 2 本以上先の future video は pause-only を保つ

### 2-15. 編集操作の直前で shared preview loop を止める

- **ファイル**: `src/components/TurtleVideo.tsx`, `src/components/modals/SaveLoadModal.tsx`
- **問題**: Android standard preview は再生中にメディア構成や trim / caption / BGM / narration を変えると、`currentTime`・`readyState`・timeline 再計算が競合して、シークバーだけ進む / 動画が固まる / 黒画面になる再現が残りやすい
- **対策**:
  - shared `TurtleVideo.tsx` に `pausePreviewBeforeEdit(reason)` を置き、再生中の編集操作直前に `pause()`、`isPlayingRef.current = false`、`requestAnimationFrame` の cancel だけを行う
  - メディア追加/削除/並び替え、trim、duration、scale / position、volume / mute / fade、BGM・ナレーション・キャプション編集、プロジェクト読み込みの直前でこのガードを呼ぶ
  - `SaveLoadModal` の読み込み確定直前にも callback を挟み、project load が shared preview loop と競合しないようにする
- **注意**:
  - 自動 resume はしない。再開はユーザーの再生操作に委ねる
  - `usePreviewEngine` / `usePreviewSeekController` / `apple-safari` runtime には処理を戻さず、shared UI 層の編集導線で止める
  - export 中は既存処理を優先し、このガードだけで export フローを止めない

### 2-16. standard preview の timeline 終端は totalDuration 基準で media を同時停止する

- **ファイル**: `src/flavors/standard/preview/usePreviewEngine.ts`, `src/test/standardPreviewEngine.test.tsx`
- **問題**: standard preview で最後の映像 clip の終端調整を待ってから停止すると、timeline は終端に見えても `bgm` / `narration:*` の `<audio>` が 0.5〜1 秒ほど流れ続けることがある
- **対策**:
  - preview loop の終了判定は最後の clip 状態ではなく `totalDurationRef.current` を単一基準にし、`totalDuration - 0.03` 以降は終端到達として扱う
  - 終端到達時は `currentTimeRef.current` と UI の currentTime を `totalDuration` に clamp してから `renderFrame(totalDuration, false, false)` を実行する
  - その直後に `mediaElementsRef.current` 内の `VIDEO` / `AUDIO` を一括 `pause()` し、`bgm` と `narration:*` も例外なく同時停止する
  - 停止後は `isPlayingRef.current = false`、`pause()`、`cancelAnimationFrame(reqIdRef.current)` を行い、次の preview loop を予約しない
- **注意**:
  - この終端停止は `standard` flavor の preview 専用。`apple-safari`、export、seek controller、visibility lifecycle には広げない
  - BGM の fadeOut 設定や音源自体の長さは変更せず、preview timeline の終端だけを source of truth にする

### 2-17. standard preview の BGM fade は renderFrame で毎フレーム上書きする

- **ファイル**: `src/flavors/standard/preview/usePreviewEngine.ts`, `src/test/standardPreviewEngine.test.tsx`
- **問題**: standard preview では BGM が native `<audio>` 再生に残る経路があり、終端停止だけを追加すると fadeIn / fadeOut の計算結果が毎フレーム `bgm.volume` に反映されず、動画終端前に音量が下がらないことがある
- **対策**:
  - `renderFrame` 内で preview 中だけ `computePreviewBgmVolume()` を使い、`bgm.delay` 基準の fadeIn と `totalDurationRef.current` 基準の fadeOut を毎フレーム再計算する
  - 計算結果は `mediaElementsRef.current.bgm.volume` と `gainNodesRef.current.bgm.gain` の両方へ反映し、native / WebAudio のどちらでも同じ fade カーブに揃える
  - `stopAll()` では BGM を pause する前に volume / gain を 0 に落とし、timeline 終端で BGM だけ残留しないようにする
- **注意**:
  - fadeOut の基準は BGM ファイル終端ではなく preview timeline の `totalDuration`
  - export と `apple-safari` runtime には広げず、`standard` preview の render loop 内だけで閉じる

---

### 2-18. export 完了 UI は exportUrl を残したまま processing/loading を先に戻す

- **ファイル**: `src/flavors/standard/preview/usePreviewEngine.ts`, `src/components/sections/PreviewSection.tsx`, `src/hooks/useExport.ts`, `src/test/previewSectionActionButtons.test.tsx`
- **問題**: standard export 完了時に `exportUrl` が入っても `processing/loading` の解除が遅れると、PreviewSection の action area が「作成中」のまま残り、download ボタンが出ないことがある
- **対策**:
  - standard preview の export 完了/失敗 callback では `setProcessing(false)` と `setLoading(false)` を必ず行い、`setExportPreparationStep(null)` で準備表示も解除する
  - PreviewSection の download ボタンは `!isProcessing && exportUrl` 条件でのみ描画し、export 完了後に安定して通常ボタンから切り替える
  - shared offline audio export の BGM / narration scheduling は `track.volume` を `0..2.5` に clamp して、UI slider の上限を超える異常値を export gain に流さない
- **注意**:
  - `exportUrl` は成功時に保持し、編集操作や明示 stop 以外では直後に消さない
  - この UI 復旧は shared preview/export facade と standard preview callback の範囲に留め、iOS Safari runtime や save/load 導線には広げない

---

### 2-19. standard preview の BGM / narration 100%超は GainNode を source of truth にする

- **ファイル**: `src/flavors/standard/preview/usePreviewAudioSession.ts`, `src/flavors/standard/preview/usePreviewEngine.ts`, `src/test/standardPreviewEngine.test.tsx`
- **問題**: `HTMLAudioElement.volume` は 1.0 を超えて増幅できないため、standard preview で BGM / narration の 250% 指定が 100% と同じ音量に聞こえることがある
- **対策**:
  - standard preview の audio-only track は BGM / narration ともに `ensureAudioNodeForElement()` で GainNode を確保し、実音量は gain に反映する
  - `<audio>` 要素の native volume は常に 1 を維持し、0..2.5 の UI 値と BGM fadeIn / fadeOut は GainNode 側で計算する
  - Android preview の BGM soft sync は `play()` / `currentTime` のみ従来どおり使い、増幅経路だけを GainNode に寄せる
- **注意**:
  - この増幅は `standard` flavor preview 専用で、`apple-safari` runtime や export pipeline には広げない
  - narration volume も 0..2.5 に clamp し、1.0 上限で切り捨てない

---

### 2-20. export 完了コールバックは session 一致時だけ UI を更新する

- **ファイル**: `src/flavors/standard/preview/usePreviewEngine.ts`, `src/components/sections/PreviewSection.tsx`, `src/test/previewSectionActionButtons.test.tsx`
- **問題**: export 完了直後に古い callback や長い準備表示が重なると、初回 export で download ボタンが消えたり、`3/10` のまま止まって見えることがある
- **対策**:
  - standard preview の export 開始ごとに session id を払い出し、成功 / 失敗 callback は現在の session と一致した場合だけ `exportUrl` / `processing` / `loading` / `exportPreparationStep` を更新する
  - PreviewSection の準備表示は内部 step 数を直接見せず、4〜5 段階の文言 + 経過秒数 + 補足説明に変換して表示する
- **注意**:
  - 古い export 結果の破棄は開始時の `clearExport()` に限定し、成功 callback 後に `exportUrl` を消さない
  - 経過秒数表示は UI だけの変更で、export pipeline の分割や中断条件は変更しない

---

### 2-21. Android standard preview は single preview cache video を優先する（**無効化済み**）

- **ファイル**: `src/components/TurtleVideo.tsx`, `src/components/sections/PreviewSection.tsx`, `src/flavors/standard/preview/androidPreviewCache.ts`, `src/flavors/standard/preview/usePreviewEngine.ts`
- **問題**: Android Chrome / WebView 相当で複数 video timeline を live 切り替えすると、初回 2 本目の遅延や video-to-video 境界の引っかかりが残りやすい
- **対策（現在は無効化）**:
  - Android + video 2 本以上 + 非 export の standard preview では timeline から preview cache key を作り、cache miss 時は preview 専用の仮合成動画を先に生成していた
  - cache 生成完了後は hidden preview cache `<video>` 1 本だけを再生し、loop / seek / paused redraw もその `currentTime` を source of truth にしていた
- **無効化理由 (2026-05)**: Android 実機で preview 用動画生成中および生成物にブラックアウトが発生した。プレビュー前に重い WebCodecs/OfflineAudioContext/Muxer エクスポート処理が走ることで体感が悪化するため、`ENABLE_ANDROID_PREVIEW_CACHE = false` で完全無効化し live preview 方式へ戻した。
- **注意**:
  - `shouldUseAndroidPreviewCache` は `ENABLE_ANDROID_PREVIEW_CACHE = false` により常に `false` を返す。再度有効化する場合はこの定数を `true` に戻し、実機で十分にテストすること
  - **絶対に守ること**: `preview.cache.start / preview.cache.ready / preview.cache.play` が通常プレビューで出ないこと。`startPreviewCacheExport` / `startWebCodecsExport` を preview 開始時に呼ばないこと
  - live fallback 側の境界安定化は 2-22 (Android next-video preroll) と 2-23 (time-based visual blend + clock absorb) で対応する

### 2-22. Android standard preview の次動画 450ms preroll で境界 warm-up（preroll 開始位置修正済み）

- **ファイル**: `src/flavors/standard/preview/usePreviewEngine.ts`, `src/test/standardPreviewEngine.test.tsx`
- **問題**: Android preview で `video -> video` の即時切替を行うと、境界直後に次動画が `readyState=1 / seeking=true` のまま 100〜250ms 立ち上がらず、`currentTime` も進まないため stutter が見えやすい。さらに pre-roll lead 分だけ先行した `currentTime` が境界で描画され、補正や seek が入ってカクつき・巻き戻り感が出る問題もあった。
- **対策**:
  - `standard` flavor の Android preview / 非 export / 非 seek / active 再生中かつ **即次の `video -> video` 境界** だけで `timeUntilNextBoundary <= 0.45s` の next video を preroll 対象にする。image gap や iOS Safari には広げない
  - preroll 開始位置は `trimStart` ではなく `max(0, trimStart - prerollLeadSec)` とする。これにより境界到達時に `currentTime ≒ trimStart` になり、先行描画とその後の補正起因のカクつきが解消される
  - `armAndroidNextVideoPreroll()` で next video に `muted=true`, `playsInline=true`, `preload='auto'` を付け、`trimStart - prerollLeadSec` へ **1 回だけ** 合わせてから `seeked` / `canplay` / `loadeddata` を待ち、silent `play()` のまま hidden/inactive で維持する
  - preroll 済みの next video は境界直前に `pause()` / `currentTime` 再設定をしない。active 化直後も 300ms は `currentTime` 補正を抑止し、cold seek のやり直しに戻さない
  - `preview.preflight.ready`, `preview.timeline.tick`, `preview.boundary.smoothPlan` で preroll 状態と境界メトリクスを記録する
- **注意**:
  - preroll を active clip の「次に来る 1 本」へ限定する方針は 2-14 の inactive reset 制限とセットで維持する
  - preroll を shared / apple-safari / export へ広げると runtime ownership が崩れるため、`src/flavors/standard/preview/` のまま閉じる
  - 境界直前の再 seek を戻すと decoder が再び cold start しやすいので禁止
  - `trimStart = 0` の場合は `max(0, 0 - 0.45) = 0` となり従来と同じ挙動（trimStart が 0 の動画は影響なし）

### 2-23. Android standard preview は active video の soft draw を優先して hold を長引かせない

- **ファイル**: `src/flavors/standard/preview/usePreviewEngine.ts`, `src/flavors/standard/preview/previewPlatform.ts`, `src/test/standardPreviewEngine.test.tsx`, `src/test/previewPlatform.test.ts`
- **問題**: Android Chrome では preroll 後でも境界直後の 1〜2 フレームだけ `readyState=1` / `seeking=true` / `currentTimeAdvanced<20ms` が残ることがあり、単純 hold だけでは「前フレームで一瞬止まる」見え方になる
- **対策**:
  - Android `standard` preview の非 export / 非 seek 再生中は、`videoWidth|videoHeight > 0`・`paused === false`・`|currentTime - targetTime| < 0.25s` を満たす active video を soft drawable とみなし、`readyState` / `seeking` だけでは hold しない
  - `video -> video` 境界では last drawable frame を `ImageBitmap` として保持し、0〜80ms は前フレーム 100%、80〜180ms は前フレーム alpha を 1→0 に落とす短い visual blend を使う。active video が draw 可能なら下に描いて reveal する
  - それでも次動画が `targetTime` より 80ms 以上遅れ、`readyState < 2` または `seeking=true` の場合だけ、`startTimeRef` を 1 boundary あたり最大 120ms まで後ろへずらして preview clock を吸収する
  - 各境界ごとに `preview.boundary.smoothPlan` を 1 回だけ出し、`currentTimeAdvancedAt100ms`, `usedVisualBlend`, `visualBlendMs`, `clockAbsorbMs` を確認できるようにする
- **注意**:
  - visual blend は Android `standard` preview の live draw 専用で、最長 180ms を超えて前フレームを固定しない
  - `drawImage` 失敗時は前フレーム fallback を許容するが、長時間 hold や shared workaround に戻さない
  - active video の hard resync は grace 窓の後にだけ許可し、境界直後の `currentTime` 書き戻しを増やさない

### 2-24. Android standard preview の video 境界は canDrawVideo + safe seek で commit する

- **ファイル**: `src/flavors/standard/preview/usePreviewEngine.ts`, `src/test/standardPreviewEngine.test.tsx`
- **問題**: Android Chrome の live preview で `readyState=1` や `seeking=true` の次動画を境界直後に draw すると、瞬停・黒画面・2 本目の立ち上がり遅延が残りやすかった。`clockAbsorbMs` や soft draw / force draw のような ms 調整系 workaround は端末性能依存で不安定だった。
- **対策**:
  - `canDrawVideo()` を source of truth にして、`readyState >= HAVE_CURRENT_DATA`・`!seeking`・`videoWidth/Height > 0` を満たす video だけを canvas に描画する
  - Android `standard` preview の `video -> video` 境界では `AndroidBoundaryState` を持ち、`canCommit` が成立するまでは active draw を止めて前回の stable frame を維持する
  - 境界中のズレ補正は `requestSafeSeek()` 1 本に寄せ、`seekInFlight` 中の追加 seek と `clockAbsorbMs` による preview clock 歪みを止める
- **注意**:
  - `readyState < 2` または `seeking=true` の video を draw する workaround を戻さない
  - 境界直後の sync 補正は `canCommit` 判定を優先し、毎フレーム `currentTime` を書き戻さない
  - この制御は Android / PC 系の `standard` preview 専用で、`apple-safari` runtime や export pipeline には広げない

### 2-25. Android standard preview は境界 smoothing を止めて passive 再生へ戻す

- **ファイル**: `src/flavors/standard/preview/usePreviewEngine.ts`, `src/flavors/standard/preview/useInactiveVideoManager.ts`, `src/test/standardPreviewEngine.test.tsx`, `src/test/standardInactiveVideoManager.test.tsx`
- **問題**: Android preview で preroll / warmup / safe seek / trimmed entry hold / active drift 補正が複数経路で競合し、active video が `seeking=true` / `readyState=1` に張り付いて動画区間の大半が holdFrame に潰れていた
- **対策**:
  - Android `standard` preview の通常再生では `preview.boundary.smoothPlan` 系の境界 smoothing を使わず、境界では active segment の切替と描画対象の選択だけを行う
  - 非アクティブ next video の preroll / muted play / prewarm / preseek は行わず、`currentTime` 補正は再生開始・ユーザー seek・停止中 preview を除いて禁止する
  - 再生中の recovery seek は `drift >= 0.8s`、前回 seek から 1000ms 以上、境界通過後 500ms 超、1 segment 1 回までに制限し、実行時だけ `preview.android.seek-assignment` を出す
  - 境界通過時は `preview.android.boundary.passive-switch` を出し、描画不能時の last stable frame 保持も先頭 200ms 以内に限定する
  - Android preview の inactive reset は active / previous / next を `protectedVideoIds` で保護し、warmup のための事前再生はしない
- **注意**:
  - この回復方針は Android / PC 系の `standard` preview 専用で、`apple-safari` runtime、export、shared UI へ広げない
  - 2-22〜2-24 の smoothing 系 workaround は再有効化せず、まず「最後まで普通に見られる」状態を優先する
  - `preview.android.seek-assignment` が通常再生で連発する場合は、細かい drift 補正を戻さず recovery 条件の逸脱を疑う

### 2-26. Android standard preview の drawable paused active video は draw を先に行い、その後で play を要求する

- **ファイル**: `src/flavors/standard/preview/usePreviewEngine.ts`, `src/test/standardPreviewEngine.test.tsx`
- **問題**: Android Chrome では video 境界直後に次動画が `readyState>=2`・`!seeking`・`videoWidth/Height>0`・`currentTime` 整合済みでも `paused=true` の瞬間があり、draw 前に `play()` を優先すると切替直後の黒化が見えやすかった
- **対策**:
  - Android `standard` preview の active video が `canDrawVideo()`（`readyState >= 2`、`!seeking`、`videoWidth/Height > 0`）を満たす drawable 条件なら、`paused === true` を描画禁止条件にしない
  - 同条件の active video に対する `play()` 要求は render loop 前半の制御分岐では即時実行せず、`drawImage(activeEl)` 成功後に 1 本化して要求する
  - 既存の passive-switch 方針は維持し、`preview.boundary.smoothPlan`・`canCommit false → drawLastStableFrame`・追加 seek workaround は復活させない
- **注意**:
  - この順序変更は `src/flavors/standard/preview/` の Android standard preview だけに閉じる。`apple-safari` runtime / export / save runtime には広げない
  - drawable 条件は `readyState >= 2`、`!seeking`、`videoWidth/Height > 0` を維持し、未準備 video の force draw へ戻さない
  - draw 後の `play()` は再生開始要求の順序変更であり、固定 ms 遅延・preroll・hard seek の再導入ではない

### 2-27. standard preview の fadeOut/fadeIn は black-tail guard を無効にして globalAlpha のみで描画する

- **ファイル**: `src/flavors/standard/preview/previewPlatform.ts`, `src/test/standardPreviewEngine.test.tsx`
- **問題**: `shouldBlackoutVideoFadeTail()` が fadeOut 終端付近（最大 0.5 秒）で `true` を返すと、`shouldSkipVideoDrawForFadeTail = true` になり active video の `drawImage` がスキップされて突然黒画面になる。`ctx.globalAlpha` による滑らかなフェードが実行されない
- **対策**:
  - standard preview 向けの `shouldBlackoutVideoFadeTail` を常に `false` を返すよう変更（方針B）
  - 黒背景は `shouldClearCanvas` の通常経路で描かれるため、1.「黒で canvas clear」→ 2.「active media を globalAlpha 付きで drawImage」の順序で自然なフェードが実現される
  - `shouldBlackoutFadeTail = false` 固定により `shouldSkipVideoDrawForFadeTail` も常に `false` となり、drawImage スキップは発生しない
- **注意**:
  - `isInFadeOutRegion` による `holdFrame` ガード（fadeOut 中は `!isInFadeOutRegion = false` → holdFrame が設定されない）は引き続き機能しており、videoが描画可能な場合は必ず描画される
  - apple-safari flavor の `shouldBlackoutVideoFadeTail` は変更しない（flavor 分離）
  - 黒残り問題が再発する場合は drawImage スキップではなく `alpha < 0.001` の後段で処理すること

---

## 3. AudioContext 管理

### 3-0. iOS Safari プレビュー BGM 経路安定化

- **ファイル**: `src/components/TurtleVideo.tsx`（`handleMediaRefAssign`, `renderFrame`, `refreshPreviewAudioRoute`, `startEngine`, `stopAll`, シーク復帰部）, `src/utils/previewPlatform.ts`
- **問題**: iOS Safari のプレビューで BGM（audio-only 要素）が画像区間で鳴らない、動画区間でも任意のタイミングで途切れる、動画→画像遷移で無音化する
- **原因（Phase 1）**: BGM まで `native fallback`（`audibleSourceCount <= 1` 時の単一音源ネイティブ再生）に入り、`native` と `WebAudio` の経路が画像⇔動画境界で揺れていた。加えて、ノードの遅延作成が `requestPreviewAudioRouteRefresh`（`suspend/resume`）を発動し、再生中の全音源が中断されていた
- **原因（Phase 2）**: iOS Safari の `play()` がユーザージェスチャーのクレジット失効後（`requestAnimationFrame` コールバック内）に呼ばれると AudioSession を破壊し、AudioContext が `interrupted` 状態に遷移する。非アクティブビデオの `pause()` → アクティブ化時の `play()` サイクルがクリップ境界（画像→動画）で発生し、BGM の WebAudio 経路ごと断絶していた
- **対策**:
  - **Phase 1 対策（維持）**:
    - **audio-only ノードの即時作成**: `handleMediaRefAssign` で `<audio>` 要素が割り当てられた時点で `ensureAudioNodeForElement` を呼び、WebAudio ノードを即座に作成する。`renderFrame` 内の遅延作成 → route refresh を排除
    - **audio-only の route refresh 除外**: `processAudioTrack`（BGM）と `processNarrationClip` で `ensureAudioNodeForElement` が呼ばれた場合でも `requestPreviewAudioRouteRefreshRef.current()` を呼ばない
    - **BGM/ナレーション追加時のビデオノード事前作成**: `useEffect` で `preparePreviewAudioNodesForTime` + `preparePreviewAudioNodesForUpcomingVideos` を呼び、全ビデオのノードを先行作成
    - **route refresh の安全化**: ① 旧 native 要素を即座に mute、② `resume()` 試行、③ 必要時のみ `suspend/resume`、④ GainNode 再接続、⑤ `audioResumeWaitFramesRef` 非設定
  - **Phase 2 対策（追加）**:
    - **ビデオ要素のジェスチャー内事前 play()**: `startEngine` 内（ユーザージェスチャーのクレジットあり）で全ビデオ要素を GainNode=0 の状態で `play()` する。`renderFrame` 内での `play()` 呼び出しが不要になり、AudioSession 破壊を回避
    - **非アクティブビデオの avoidPausePlay**: WebAudio ノードを持つ非アクティブビデオは再生中 `pause()` しない。GainNode=0 で無音のまま再生を維持し、アクティブ化時に gain を上げるだけで済む
    - **AudioContext statechange 回復ハンドラ**: `startEngine` で `ctx.onstatechange` を設定し、AudioContext が `interrupted` に遷移した場合に自動 `resume()` を試みる。`stopAll` でクリア
    - **renderFrame レベルの AudioContext 健全性チェック**: BGM 処理の直前に AudioContext の state を確認し、`running` でなければ `resume()` を fire-and-forget で呼ぶ
    - **シーク復帰時のビデオ事前 play()**: `proceedWithPlayback`（シーク完了後の再生再開）でも `resetInactiveVideos()` の後に全ビデオ要素を事前 `play()` する（シーク操作はジェスチャーなのでクレジットあり）
- **合格条件**: 途中BGM追加直後、画像区間へシーク、動画区間へシークの 3 ケースで無音・遅延・二重経路がなく、可聴な native は動画区間で 1 系統以下、画像区間で 0 系統
- **注意**:
  - 可視復帰時の route refresh（`visibilitychange` 経由）は引き続き有効
  - `avoidPausePlay` パターン（WebAudio 接続済み audio-only 要素の `pause()/play()` サイクル回避）は維持。ビデオ要素にも同パターンを適用
  - `startEngine` 冒頭の初回 `suspend/resume` は変更なし
  - ビデオの事前 play() は GainNode=0 かつ native volume=0 で行うため、可聴出力への影響なし
  - 非アクティブビデオは再生を継続するが、アクティブ化時の sync ロジック (`currentTime` 補正) で位置が修正される
  - **Phase 3 対策（v5.x デグレ修正）**:
    - **原因**: `getPreviewAudioOutputMode` で `audibleSourceCount <= 1` 時に `native` を返す変更（commit `3b45e79`）が iOS Safari にも適用され、`detachAudioNode` で `createMediaElementSource()` 済みのノードが破棄されていた。一度切り離すと再接続不可のため動画音声が永久に失われた
    - **対策**: `getPreviewAudioOutputMode` で `hasAudioNode=true` 時の `native` 復帰を iOS Safari (`muteNativeMediaWhenAudioRouted`) では無効化。iOS では常に `webaudio` を返す
    - **重要な設計制約**: `startEngine` の事前 play() で遠い将来のビデオまで play() してはならない。ソース終端に到達して ended/paused 状態になると、アクティブ化時の rAF 内 `play()` が pause→play サイクルとなり AudioSession を破壊する。`shouldKeepInactiveVideoPrewarmed` の距離制限は意図的な設計であり、cold-start play()（初回 play()）は rAF 内でも問題ない
    - **PC/Android への影響**: なし。`muteNativeMediaWhenAudioRouted`（iOS Safari のみ true）で分岐しており、PC/Android の再生・エクスポート経路は変更されない

### 3-0a. AudioSession / InactiveVideoManager の分離継続

- **ファイル**: `src/components/turtle-video/usePreviewAudioSession.ts`, `src/components/turtle-video/useInactiveVideoManager.ts`, `src/components/TurtleVideo.tsx`
- **問題**: `TurtleVideo.tsx` に audio node 管理、route refresh、audio-only prime、非アクティブ video reset が残ると、Phase 2b の flavor 分離前に iOS Safari 回帰を再混入させやすい
- **対策**:
  - `usePreviewAudioSession` へ `detachAudioNode`, `ensureAudioNodeForElement`, `preparePreviewAudioNodesForTime`, `preparePreviewAudioNodesForUpcomingVideos`, `primePreviewAudioOnlyTracksAtTime`, `handleMediaRefAssign` を移した
  - `requestPreviewAudioRouteRefreshRef` と `primePreviewAudioOnlyTracksAtTimeRef` の更新も hook 側へ集約し、render loop/startEngine からの呼び出し契約だけを残した
  - `useInactiveVideoManager` へ `resetInactiveVideos` を移し、seek/startEngine 復帰と inactive reset の契約を明示化した
- **注意**:
  - `renderFrame` / `startEngine` の実行順序は変えない。今回の段階では責務移動のみで、prewarm 判定ロジック自体は shared loop に残す
  - iOS Safari の one-shot `createMediaElementSource()` 制約があるため、hook 化後も DOM 要素差し替え時以外に `detachAudioNode` を増やさない

### 3-0b. PreviewEngine の抽出完了

- **ファイル**: `src/components/turtle-video/usePreviewEngine.ts`, `src/components/TurtleVideo.tsx`
- **問題**: `TurtleVideo.tsx` に `renderFrame`, metadata wait, export preload, `startEngine`, `loop`, `stopAll` が残ると、Phase 2b の flavor 分離時に shared UI 層と preview runtime 層が再結合し、Safari 向け修正の影響範囲が広いままになる
- **対策**:
  - `usePreviewEngine` へ `handleMediaElementLoaded`, `handleSeeked`, `handleVideoLoadedData`, `renderFrame`, `stopAll`, `loop`, `startEngine` を移した
  - `usePreviewEngine` には policy, refs, audio session/inactive manager 契約だけを注入し、`TurtleVideo.tsx` では hook の戻り値を wiring する形に戻した
  - metadata wait と export preload を含む start-up/shutdown 経路も hook 側へ閉じ込め、Phase 2b では runtime flavor ごとの差し替え対象を `usePreviewEngine` 周辺へ限定できるようにした
- **注意**:
  - `usePreviewEngine` の呼び出し位置は `usePreviewVisibilityLifecycle` と `usePreviewSeekController` より前に置き、`renderFrame` / `loop` / `startEngine` を downstream hooks へ注入する順序を維持する
  - shared の policy (`previewPlatform.ts`) はそのまま入力に使い、Phase 2a では挙動変更ではなく責務移動に留める

### 3-0c. Preview runtime 注入境界の追加

- **ファイル**: `src/components/turtle-video/previewRuntime.ts`, `src/flavors/standard/standardPreviewRuntime.ts`, `src/flavors/apple-safari/appleSafariPreviewRuntime.ts`, `src/flavors/standard/StandardApp.tsx`, `src/flavors/apple-safari/AppleSafariApp.tsx`
- **問題**: Phase 2a 完了後も `TurtleVideo.tsx` が preview hook の import 元を固定していると、Phase 2b で flavor ごとの preview 実装へ差し替える際に shared 側を再度大きく編集する必要がある
- **対策**:
  - `PreviewRuntime` インターフェースを追加し、preview policy と preview hooks 一式を flavor 側から注入する構造へ変えた
  - `StandardApp` と `AppleSafariApp` はそれぞれ `standardPreviewRuntime` / `appleSafariPreviewRuntime` を `TurtleVideo` へ渡すだけの薄い adapter にした
  - 現段階では両 flavor とも shared 実装を再利用し、挙動変更なしで差し替え境界だけを先に固定した
- **注意**:
  - ここでは runtime 注入境界の追加だけに留め、Safari 専用の preview 実装差し替えは次段で行う
  - `previewRuntime.usePreviewEngine(...)` などの hook 呼び出し順は flavor ごとに変えず、shared wiring 層の呼び出し順だけを契約として維持する

### 3-0d. Preview capability 解決の runtime 側移管

- **ファイル**: `src/components/TurtleVideo.tsx`, `src/components/turtle-video/previewRuntime.ts`, `src/flavors/standard/standardPreviewRuntime.ts`, `src/flavors/apple-safari/appleSafariPreviewRuntime.ts`, `src/test/previewRuntimeCapabilities.test.ts`
- **問題**: preview hook の注入境界だけでは、shared の `TurtleVideo.tsx` がまだ `getPlatformCapabilities()` を直接呼んでおり、preview branch の根拠が shared 側に残っていた
- **対策**:
  - `PreviewRuntime` に `getPlatformCapabilities()` を追加し、`TurtleVideo.tsx` は runtime が返す capability だけを見る構造へ変更した
  - `standardPreviewRuntime` は `isIosSafari=false` / `audioContextMayInterrupt=false` に正規化し、standard line が Apple Safari 分岐へ入らないことを明示した
  - `appleSafariPreviewRuntime` は `isIosSafari=true` / `audioContextMayInterrupt=true` / `isAndroid=false` に正規化し、Apple line が preview の Safari 分岐を必ず選ぶようにした
  - `previewRuntimeCapabilities.test.ts` を追加し、両 flavor の capability 正規化を固定した
- **注意**:
  - ここで分けたのは capability 解決までで、`usePreviewEngine` / `usePreviewAudioSession` の中身自体はまだ shared 実装である
  - flavor の capability 正規化は preview 分岐の固定が目的であり、保存 API 対応などの実環境 capability は base capability の値を維持する

### 3-0e. Preview runtime 実体の flavor 側移設完了

- **ファイル**: `src/flavors/standard/preview/usePreviewEngine.ts`, `src/flavors/standard/preview/usePreviewAudioSession.ts`, `src/flavors/standard/preview/usePreviewSeekController.ts`, `src/flavors/standard/preview/usePreviewVisibilityLifecycle.ts`, `src/flavors/standard/preview/useInactiveVideoManager.ts`, `src/flavors/standard/preview/previewPlatform.ts`, `src/flavors/apple-safari/preview/usePreviewEngine.ts`, `src/flavors/apple-safari/preview/usePreviewAudioSession.ts`, `src/flavors/apple-safari/preview/usePreviewSeekController.ts`, `src/flavors/apple-safari/preview/usePreviewVisibilityLifecycle.ts`, `src/flavors/apple-safari/preview/useInactiveVideoManager.ts`, `src/flavors/apple-safari/preview/previewPlatform.ts`, `src/flavors/apple-safari/preview/iosSafariAudio.ts`, `src/flavors/standard/standardPreviewRuntime.ts`, `src/flavors/apple-safari/appleSafariPreviewRuntime.ts`, `src/test/previewRuntimeIsolation.test.ts`
- **問題**: capability 解決まで runtime 側へ寄せても、active runtime が shared preview hooks / shared preview policy を import し続ける限り、Safari preview 修正は standard preview の実装変更と分離できない
- **対策**:
  - standard / apple-safari の両 flavor 配下に preview hook 群、preview policy、`iosSafariAudio` helper を複製し、`standardPreviewRuntime` / `appleSafariPreviewRuntime` がそれぞれ自系統の modules を参照するように切り替えた
  - `previewRuntimeIsolation.test.ts` を追加し、両 runtime が shared preview hooks と shared preview policy factory を参照しないこと、および standard と apple-safari が別々の module identity を持つことを固定した
- **注意**:
  - Phase 2b 完了以降、preview 関連の修正は原則として `src/flavors/standard/preview/` または `src/flavors/apple-safari/preview/` のどちらかに入れる。`src/components/turtle-video/` 側の preview hooks は Phase 2a の抽出基準として残るが、active runtime の実体ではない
  - 次段の Phase 3 では、この flavor-owned preview audio 実装を起点に AudioContext 回避策と one-shot `createMediaElementSource()` 制約を apple-safari line へさらに閉じ込める

### 3-0f. standard preview audio から Safari workaround を退避

- **ファイル**: `src/flavors/standard/preview/previewPlatform.ts`, `src/flavors/standard/preview/usePreviewAudioSession.ts`, `src/flavors/standard/preview/iosSafariAudio.ts`（削除）, `src/test/previewRuntimeIsolation.test.ts`
- **問題**: Phase 2b 完了直後の standard preview audio 実装は flavor-owned file になっていても、Safari 向け mixed-audio helper、future-video probe、route refresh 依存をまだ保持しており、Phase 3 の境界が曖昧だった
- **対策**:
  - standard 側 `previewPlatform.ts` では `iosSafariAudio` helper 依存を外し、preview の mixed video 出力・future-video probe・route reinitialize 判定を standard 前提の簡素な方針へ置き換えた
  - standard 側 `usePreviewAudioSession.ts` では route refresh ref を no-op にし、Safari 専用の mixed-audio logging と future-video probe scheduling を削除した
  - standard 側 `previewPlatform.ts` で visibility 復帰時の AudioContext resume、resume retry、audio resume wait frame を無効化し、これらの回復経路を apple-safari 側だけへ残した
  - standard 側 `iosSafariAudio.ts` を削除し、one-shot `createMediaElementSource()` 制約を参照する helper を apple-safari preview 内部へ閉じ込めた
  - `previewRuntimeIsolation.test.ts` に standard と apple-safari の audio policy divergence を追加し、出力方針・probe・visibility resume・resume retry・route refresh 判定の差を回帰テストで固定した
- **注意**:
  - `createMediaElementSource()` の one-shot 制約や AudioContext workaround は引き続き apple-safari 側で扱う。standard 側へ再流入させない
  - 将来 standard 側で prewarm や route refresh が必要になっても、apple-safari helper を流用せず standard 要件として明示的に設計し直す

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

### 4-5. Android picker 由来メディアの保存スナップショット

- **ファイル**: `src/utils/media.ts`, `src/stores/mediaStore.ts`, `src/stores/projectStore.ts`, `src/types/index.ts`
- **問題**: Android の picker 経由 `File` は後段の手動保存 / 自動保存時に再読込できず、`blob:` URL fetch も失敗することがある
- **対策**:
  - メディア追加直後に `file.arrayBuffer()` を読み、アプリ管理の `File` と `ObjectURL` を作成して `MediaItem.fileData` に保持する
  - `serializeMediaItem()` は `item.fileData` を最優先で使い、未保持時だけ `file/url` fallback を使う
  - `deserializeMediaItem()` でも `fileData` を `MediaItem` に戻し、保存済みプロジェクトの再保存で再読込に依存しない
- **注意**: 新たに `createObjectURL` する URL は既存の `remove/clear/restore` 経路で解放される前提を崩さない

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

- **ファイル**: `src/stores/projectPersistence.ts`, `src/stores/projectStore.ts`, `src/utils/indexedDB.ts`
- **対策**:
  - `src/utils/indexedDB.ts` は Promise ベースの永続化ラッパーとして維持し、`'auto'` / `'manual'` の 2 スロット方式を提供する
  - `src/stores/projectPersistence.ts` で `ProjectPersistenceAdapter` を定義し、`projectStore` は direct import ではなく adapter 経由で save / load / delete / info / file byte conversion を呼ぶ
  - flavor は `src/components/turtle-video/saveRuntime.ts` から projectStore へ adapter を登録する
- **注意**:
  - いまの standard / apple-safari は同じ IndexedDB adapter を再利用するが、将来要件差が出ても shared UI や schema を触らずに差し替える
  - `request.onerror` と `request.onsuccess` の両方ハンドリングが必要。トランザクション後に `db.close()`

### 8-2. メディアファイルのシリアライズ

- **ファイル**: `src/stores/projectStore.ts`, `src/utils/indexedDB.ts`
- **問題**: `File` オブジェクトや Blob URL はそのまま IndexedDB に保存できない
- **対策**: 保存時 `File → ArrayBuffer`、復元時 `ArrayBuffer → File → URL.createObjectURL()`
- **注意**: ArrayBuffer は大容量になり得る。`getStorageEstimate()` で容量確認可能

### 8-3. 自動保存（変更検知付き）

- **ファイル**: `src/hooks/useAutoSave.ts`, `src/flavors/standard/StandardApp.tsx`, `src/flavors/apple-safari/AppleSafariApp.tsx`
- **対策**: メディア ID・音量・トリム値等を連結したハッシュで変更検知。空データ時とエクスポート中はスキップ
- **注意**:
  - エクスポート中（`isProcessing`）は保存をスキップ（動画品質保護）
  - AppShell は flavor app 側に内包し、save runtime による projectStore adapter 登録後に autosave が開始される順序を維持する

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

- **ファイル**: `src/components/turtle-video/exportRuntime.ts`, `src/hooks/useExport.ts`, `src/hooks/export-strategies/exportStrategyResolver.ts`, `src/flavors/standard/export/useExport.ts`, `src/flavors/standard/standardExportRuntime.ts`, `src/flavors/apple-safari/export/useExport.ts`, `src/flavors/apple-safari/export/iosSafariMediaRecorder.ts`, `src/flavors/apple-safari/appleSafariExportRuntime.ts`, `src/test/exportStrategyResolver.test.ts`, `src/test/exportRuntimeIsolation.test.ts`, `src/test/exportRuntimeCapabilities.test.ts`, `src/test/iosSafariMediaRecorder.test.ts`, `src/test/useExport.test.ts`
- **問題**: `useExport.ts` に iOS Safari MediaRecorder 経路と標準 WebCodecs 経路の選択・実装が混在し続けると、Safari 固有ワークアラウンドを standard line へ再混入させやすく、Phase 4 の「runtime 二系統化」が export だけ未完了になる
- **対策**:
  - `src/components/turtle-video/exportRuntime.ts` を注入境界とし、`StandardApp` / `AppleSafariApp` から `standardExportRuntime` / `appleSafariExportRuntime` を `TurtleVideo.tsx` へ渡す
  - shared の `src/hooks/useExport.ts` は `createUseExport()` facade に縮退させ、WebCodecs MP4 本体、offline audio pre-render、AudioEncoder/muxer/duration 整合の共通 core だけを持つ
  - strategy order と capability 正規化は `src/flavors/standard/export/useExport.ts` / `src/flavors/apple-safari/export/useExport.ts` が所有し、standard は `webcodecs-mp4` 固定、apple-safari は `ios-safari-mediarecorder -> webcodecs-mp4` 順を返す
  - iOS Safari の MediaRecorder 経路は `src/flavors/apple-safari/export/iosSafariMediaRecorder.ts` に閉じ込め、keep-alive 音声、visibility pause/resume、requestData 後 stop 遅延は standard line から完全に分離する
  - `shouldUseOfflineAudioPreRender()` は Safari 専用処理へ戻さず、`shared export pre-render strategy` として残す。resolver は offline rendered / TrackProcessor / ScriptProcessor の純粋分岐だけを担当する
  - `src/test/exportRuntimeIsolation.test.ts` と `src/test/exportRuntimeCapabilities.test.ts` で flavor-owned export hook と capability divergence を固定し、`src/test/iosSafariMediaRecorder.test.ts` / `src/test/useExport.test.ts` で strategy/hook 契約を継続検証する
- **注意**:
  - iOS 固有の録画回避策を追加する場合は shared core や `TurtleVideo.tsx` に直接条件を戻さず、まず apple-safari export runtime / strategy に寄せる
  - `shouldUseOfflineAudioPreRender()` は現時点では quality 目的の shared 契約であり、Safari 専用に戻す場合は非 Safari export 品質への影響を先に検証する
  - WebCodecs 側の CFR、AudioEncoder 終端クランプ、TrackProcessor / ScriptProcessor fallback の順序は既存どおり維持する

### 9-11. Capability ベースの保存/ダウンロード経路統一

- **ファイル**: `src/utils/fileSave.ts`, `src/app/appFlavorUi.ts`, `src/components/Header.tsx`, `src/components/TurtleVideo.tsx`, `src/components/sections/PreviewSection.tsx`, `src/components/modals/SettingsModal.tsx`, `src/components/modals/SaveLoadModal.tsx`, `src/components/modals/SectionHelpModal.tsx`, `src/components/turtle-video/saveRuntime.ts`, `src/flavors/standard/standardSaveRuntime.ts`, `src/flavors/apple-safari/appleSafariSaveRuntime.ts`, `src/flavors/standard/StandardApp.tsx`, `src/flavors/apple-safari/AppleSafariApp.tsx`, `src/constants/sectionHelp.ts`, `src/test/fileSave.test.ts`, `src/test/previewSectionActionButtons.test.tsx`, `src/test/modalHistoryStability.test.tsx`, `src/test/headerFlavorBadgePlacement.test.tsx`
- **問題**: エクスポート動画、AI ナレーション保存、生成画像保存で `showSaveFilePicker` と `a[download]` の分岐が重複し、iOS Safari 向けの保存導線や完了メッセージを調整するたびに複数箇所を直す必要があった。ヘルプ文言も iPhone を一律非対応扱いのままで、現状の保存方針とずれていた
- **対策**:
  - `src/utils/fileSave.ts` に `file-picker` / `anchor-download` の resolver と保存 helper を追加し、caller 側はファイル名・MIME・通知文言だけを持つ
  - `TurtleVideo.tsx` の動画ダウンロードとナレーション保存は shared helper を直接使い、`SaveLoadModal.tsx` の生成画像保存と capability 判定は save runtime 経由へ寄せる
  - `src/app/appFlavorUi.ts` に flavor badge / support summary / download guidance / preview notice / save guidance を集約し、shared UI の copy 生成を single source of truth 化する
  - `StandardApp.tsx` / `AppleSafariApp.tsx` から `appFlavor` を shared UI へ注入し、`PreviewSection.tsx` / `SettingsModal.tsx` / `SaveLoadModal.tsx` / `SectionHelpModal.tsx` は platform 直判定ではなく `appFlavor` と capability を受けて描画する
  - グローバルヘッダー `Header.tsx` のタイトル表示は従来どおり維持し、flavor badge は設定モーダルの履歴ボタン右へ移して環境表示を局所化する
  - `src/test/fileSave.test.ts` で strategy 選択、object URL 保存、blob 保存の回帰を自動検証する
  - `sectionHelp.ts` は `getSectionHelpContent(context)` で flavor-aware に生成し、SaveLoadModal の help と合わせて iPhone / iPad Safari を「安定動作優先の検証モード」として案内し、保存ダイアログ対応の有無で挙動が分かれること、手動保存 / 自動保存 / 読込の確認観点を明示する
  - `src/test/previewSectionActionButtons.test.tsx` と `src/test/modalHistoryStability.test.tsx` で Safari 向け preview/save guidance が UI 上に出ることを固定する
- **注意**:
  - 保存データ本体は引き続き IndexedDB の共通経路を使い、iOS Safari 向けの保存領域 fork は実機不具合が出るまで追加しない
  - 保存 UI から platform capability や `fileSave.ts` の import を直接増やさず、saveRuntime に寄せて flavor-owned boundary を維持する
  - ヘルプやバッジの文言を増やすときは `appFlavorUi.ts` と `getSectionHelpContent(context)` を先に更新し、shared component 内で `isIosSafari` を再導入しない
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

### 9-13. Teams 向け export 総尺は `resolveExportDuration()` を唯一の決定元にする

- **ファイル**: `src/hooks/useExport.ts`, `src/utils/exportTimeline.ts`, `src/utils/mp4Duration.ts`, `src/test/exportTimeline.test.ts`, `src/test/mp4Duration.test.ts`
- **問題**:
  - export 終端の決定が映像フレーム数、音声クランプ、mux 後確認で分散すると、Teams 投稿後に audio / video / container の尺ずれが再発しやすい
  - 中間フレームの duration を触ると CFR が崩れ、Android / PC の既存安定処理まで巻き込みやすい
- **対策**:
  - `resolveExportDuration()` を最終 `exportDuration` の唯一の決定元にし、`useExport.ts` ではその値だけを映像終端・音声終端・mux 後検査へ渡す
  - 映像は `getExportFrameTiming()` で CFR を維持し、端数調整は最後のフレーム duration だけに閉じる
  - 音声は `feedPreRenderedAudio()` で最終尺超過を clamp し、`finalizeAudioForExport()` で不足分を無音 pad してから `AudioEncoder.flush()` する
  - `inspectMp4Durations()` で mux 後の container / video / audio duration を再検査し、差分が 1ms を超えたら失敗扱いにする
- **注意**:
  - この整合処理は export finalize / encode / mux に閉じ込め、iOS Safari preview、WebAudio ルーティング、無音対策、通常プレビュー処理へ共通化しない
  - Teams 対策と iOS Safari 対策を同じ分岐で混ぜず、iOS MediaRecorder strategy には持ち込まない

### 9-14. Flavor 単位の回帰テストで preview/export と schema 互換を固定する

- **ファイル**: `src/test/standardFlavorRegression.test.ts`, `src/test/appleSafariFlavorRegression.test.ts`, `src/test/stores/projectStoreSave.test.ts`, `src/test/previewRuntimeIsolation.test.ts`, `src/test/exportRuntimeIsolation.test.ts`, `src/test/previewRuntimeCapabilities.test.ts`, `src/test/exportRuntimeCapabilities.test.ts`
- **問題**: runtime 分離後も shared helper だけをテストしていると、Android/PC 修正で apple-safari line が壊れても検知が遅れる。逆に Safari fix が standard line を巻き込んでも、hook identity や capability 正規化だけではユーザーシナリオの差分を捕まえきれない
- **対策**:
  - `standardFlavorRegression.test.ts` で standard preview の image gap 後の第2動画到達、BGM routing、visibility 復帰方針、WebCodecs audio capture path を固定する
  - `appleSafariFlavorRegression.test.ts` で apple-safari preview の video -> image -> video、BGM mixed routing、future probe、visibility hide/show、seek 復帰、MediaRecorder 優先 export path を固定する
  - `projectStoreSave.test.ts` で shared project schema round-trip と legacy narration compatibility を検証し、runtime を分けても保存データ互換が崩れないことを固定する
  - runtime identity/capability テスト (`previewRuntimeIsolation` / `exportRuntimeIsolation` / `previewRuntimeCapabilities` / `exportRuntimeCapabilities`) は境界監視として維持し、新規の flavor regression tests と役割分担する
- **注意**:
  - 新しい preview/export workaround を追加するときは、shared helper 単体テストだけで済ませず、必ず standard か apple-safari のどちらに属する回帰テストへ追加する
  - shared schema の変更時は store/save 系テストで round-trip と後方互換の両方を確認し、片方だけ通っても完了扱いにしない

### 9-15. standard preview/export の BGM 200%+ と export 完了 UI は state/gain を分離して扱う

- **ファイル**: `src/flavors/standard/preview/usePreviewAudioSession.ts`, `src/flavors/standard/preview/usePreviewEngine.ts`, `src/hooks/useExport.ts`, `src/components/TurtleVideo.tsx`, `src/components/sections/PreviewSection.tsx`, `src/hooks/export-strategies/types.ts`
- **問題**:
  - standard preview で BGM の `HTMLAudioElement.volume` だけを見ると 1.0 が上限のため、200% 以上の設定差が消える
  - export 完了後も preview 再生や stop 操作で `exportUrl` を消すと、ダウンロードボタンが現れない/消える
  - OfflineAudioContext や mux finalize が長いと UI 上は「100% / 保存ファイル作成中」のままでも、成功 state へ戻らず download ボタンが出ないことがある
- **対策**:
  - standard preview の BGM 実効音量は `resolvePreviewBgmGain()` で 0..2.5 に統一し、WebAudio gain があるときは gain 側へ直接反映、`HTMLAudioElement.volume` は gain node が無い場合の 0..1 fallback に限定する
  - shared export は `clampAudioTrackVolume()` の 0..2.5 を BGM scheduling と fade の基準に使い、`ExportPreparationStep` は 10 段階へ拡張して decode / mix / encode / finalize の前後で更新する
  - `clearExport()` は新しい export 開始時だけ実行し、export 成功後は `setExportUrl()` を優先して保持する。shared の `TurtleVideo.tsx` でも `exportUrl` 監視で `processing/loading/preparation` を確実に解除し、active runtime の callback 差分を吸収する
  - `useExport.ts` の成功経路は object URL 生成完了後に `onRecordingStop(url, ext)` を 1 回だけ呼ぶ。`PreviewSection` は `exportUrl` を `isProcessing` より優先表示し、100% 到達後に URL 未生成なら「保存ファイルを作成中...」へ切り替える
  - MP4 finalize は `Blob.size > 0` / `URL.createObjectURL(blob)` / `onRecordingStop(url, ext)` の完了まで成功扱いにしない。どこかで失敗した場合は `export finalize failed` をログし、error callback で UI をエラーへ戻す
  - shared の `TurtleVideo.tsx` は `exportUrl` 到達時だけでなく `isProcessing` が false に戻った時点でも `loading` と `exportPreparationStep` を解除し、runtime ごとの差分で「保存ファイルを作成中...」が残り続けないようにする
  - `PreviewSection` のユーザー向け文言は `書き出し準備中...` / `映像を書き出し中... {percent}%` / `保存ファイルを作成中...` に統一し、`フレーム待機中` は内部状態に留めて UI へ出さない
  - export セッション中の動画音声 decode は `file.name:size:lastModified:type` key の cache で再利用し、同一動画を複数 clip に分けても `decodeAudioData` / `<video>` fallback を毎回やり直さない
  - `PreviewSection` の finalizing timeout は「100% 到達後に 30 秒以上 URL が出ない」ケースだけを監視し、timeout 時は `stopExport({ silent: true })` と `processing/loading/preparation` の解除、エラーメッセージ表示を同時に行う
- **注意**:
  - 100% 超の preview 音量差は standard flavor 専用の WebAudio gain で実現し、apple-safari runtime や shared UI に platform 直判定を戻さない
  - export 完了後の `exportUrl` は stop/preview 再開では消さず、timeout やユーザー停止で export を中断するときも silent abort を使って不要な「中断されました」エラーで上書きしない

### 9-16. export finalize 成功後は Blob probe と UI 成功遷移を最優先し、timeout は警告だけに留める

- **ファイル**: `src/hooks/useExport.ts`, `src/components/TurtleVideo.tsx`, `src/components/sections/PreviewSection.tsx`
- **問題**:
  - `Muxer finalize 完了` と `エクスポート完了 最終結果` まで到達しても、Blob URL / `exportUrl` の受け渡しが遅れると緑のダウンロードボタンが出ない
  - finalizing 中の UI timeout が stop/abort を呼ぶと、完成済み MP4 の success callback が後段で潰れる
- **対策**:
  - `useExport.ts` は `Blob.size > 0` を確認した後に Object URL を作成し、`[DIAG-BLOB]` で blob size/type と metadata probe を記録してから `onRecordingStop(url, 'mp4')` を 1 回だけ呼ぶ
  - shared の `TurtleVideo.tsx` は `exportUrl` 到達時に `[DIAG-UI] export complete callback received` を記録し、`processing/loading/exportPreparationStep` を必ず解除する
  - finalizing 30 秒超過は `showToast('保存ファイルの作成に時間がかかっています...')` の警告に留め、成功済み export を abort しない
  - `PreviewSection` の action button は `exportUrl ? Download : isProcessing ? Processing : Create` の優先順を固定する
- **注意**:
  - finalizing 完了前に user cancel した場合だけ success callback を抑止し、自然終端や finalize 済みセッションでは callback を落とさない
  - Blob metadata probe は診断専用で、失敗しても export 自体は成功扱いを維持する。失敗扱いにするのは `Blob.size <= 0` の場合だけ

### 9-17. export cancel reason は user / superseded / unmount を分離し、成功 URL は user cancel 以外で潰さない

- **ファイル**: `src/hooks/useExport.ts`, `src/components/TurtleVideo.tsx`, `src/components/sections/PreviewSection.tsx`
- **問題**:
  - Blob / Object URL 作成後でも、自然終端や後続 cleanup の stop が user cancel 扱いになると `onRecordingStop(url, ext)` が抑止され、download ボタンへ遷移できない
  - Preview UI 側が `exportUrl` より `isProcessing` を先に見続けると、成功 URL が届いても finalizing 表示が残りやすい
- **対策**:
  - shared export は boolean の `userCancelled` ではなく `ExportCancelReason = 'none' | 'user' | 'superseded' | 'unmount'` を持ち、停止ボタン経由だけ `reason: 'user'` を設定する
  - Object URL 生成後は `cancelReason === 'user'` のときだけ success callback を抑止し、その場で URL を revoke する。`superseded` / `unmount` / 自然終端では callback を通して UI 成功遷移を優先する
  - `TurtleVideo.tsx` は `exportUrl` 到達時の UI 解除を helper に集約し、`processing/loading/exportPreparationStep` の解除と `[DIAG-UI] export complete callback received` を同じ成功経路で扱う
  - `PreviewSection` は `Boolean(exportUrl)` を単一の優先フラグとして action button / finalizing timer の両方で使い、success URL がある間は download ボタンを最優先表示する
- **注意**:
  - `stopExport()` のデフォルト理由は system cleanup 側 (`superseded`) として扱い、明示キャンセルだけ呼び出し側から `reason: 'user'` を渡す
  - success callback を抑止したセッションでは、生成済み Object URL を必ず revoke してダウンロード導線だけが残る中途半端な state を作らない

### 9-18. natural end へ入った export は後段 stop を user cancel に昇格させず、timeout は UI エラー表示だけに留める

- **ファイル**: `src/hooks/useExport.ts`, `src/components/TurtleVideo.tsx`, `src/components/sections/PreviewSection.tsx`, `src/test/useExport.test.ts`
- **問題**:
  - standard preview/export の cleanup が natural end 後に `stopExport({ reason: 'user' })` を重ねると、Blob / Object URL 作成成功後の callback が誤って user cancel 扱いになる
  - finalizing timeout が強い停止処理へ繋がると、成功済み export の download 導線まで巻き込んで壊しやすい
- **対策**:
  - shared export core は `completionRequestedRef` / `finalizeRequestedRef` / `exportPhaseRef === 'finalizing'` を見て、natural end 進行中の user stop を no-op にし、abort や cancelReason 上書きをさせない
  - `[EXPORT-FSM] transition` は export session 単位で `exportSessionId` を付与し、`export start` / `natural end reached` / `cancel requested` / `callback invoked|suppressed` / `failed` などの遷移だけを記録する
  - shared の `TurtleVideo.tsx` は finalizing timeout で `stopExport()` を呼ばず、`setError('保存ファイルの作成に時間がかかっています。ログを確認してください。')` だけを出して成功 URL の到着余地を残す
- **注意**:
  - natural end に入った後は、後段の cleanup が `reason: 'user'` を投げても成功 callback を潰さないことを優先する
  - timeout 文言は UI 側のエラー表示に留め、成功 URL の revoke や `exportCompletedRef` の巻き戻しをしない

### 9-19. export ループの終端では stopAll() ではなく completeWebCodecsExport() を呼ぶ

- **ファイル**: `src/flavors/standard/preview/usePreviewEngine.ts`, `src/components/turtle-video/usePreviewEngine.ts`, `src/components/TurtleVideo.tsx`, `src/hooks/useExport.ts`
- **問題**:
  - export モードで `clampedElapsed >= totalDuration` になるとループが `stopAll()` を呼ぶ
  - `stopAll()` は外部 `recorderRef`（TurtleVideo.tsx の `useRef<MediaRecorder | null>(null)`）を確認するが、WebCodecs export 中はこの ref が null のため `stopWebCodecsExport({ reason: 'user' })` ルートへ入る
  - `cancelReason` が `'user'` に汚染され、その後 blob/URL が正常生成されても `callback suppressed by explicit user cancel` で `onRecordingStop` が抑止される
  - UI 側の `exportUrl` / `exportFinalizing` が更新されず、ダウンロードボタンへの遷移が起きない
- **対策**:
  - `UseExportReturn['completeExport']` を `completeWebCodecsExport` として両 `usePreviewEngine` の props に追加
  - `TurtleVideo.tsx` で `completeExport` を抽出して渡す
  - ループの `clampedElapsed >= totalDuration` 分岐で `isExportMode` の場合は `completeWebCodecsExport()` を呼ぶ（`stopAll()` を呼ばない）
  - 保険として `useExport.ts` の最終化部分に安全網を追加: `cancelReasonAtUrl === 'user'` でも `blob.size > 0` なら `cancelReason` を `'none'` に復旧してコールバックを通す
- **注意**:
  - `recorderRef` は TurtleVideo.tsx（外部）と useExport.ts（内部）で **別々の ref**。`stopAll()` が参照するのは外部のもの。WebCodecs export では外部 ref は常に null なので `stopAll()` を export 終端で呼ぶと必ず `stopExport({ reason: 'user' })` ルートへ入る
  - `completeWebCodecsExport()` は `completionRequestedRef` / `finalizeRequestedRef` / `exportFinalizingRef` を立て、エンコード pipeline に正常終了を通知する
  - 成功コールバック（`onRecordingStop`）内で `stopAll()` を呼ぶことは問題ない。その時点では `exportPhaseRef === 'completed'` のため `stopExport` は早期 return する

### 9-20. 停止・再生・編集操作で生成済み exportUrl を破棄してダウンロードボタンを消す

- **ファイル**: `src/components/TurtleVideo.tsx`
- **問題**:
  - エクスポート完了後にダウンロードボタンが表示された後、停止ボタンや再生ボタンを押しても `exportUrl` が残り続け、ダウンロードボタンが消えない
  - 編集操作（メディア追加・削除・並び替え、トリム変更、音量変更、BGM変更、ナレーション変更など）でも古いダウンロードボタンが残る
- **対策**:
  - `TurtleVideo.tsx` に `clearGeneratedExport(reason)` 共通ヘルパーを追加。`clearExport()` を呼んで `exportUrl/exportExt` を削除し、`exportCompletedRef` / `exportFinalizingUiRef` / `exportFinalizeWarningShownRef` をリセットする
  - `handleStop` の非 processing パスで先頭に `clearGeneratedExport('stop-button')` を呼ぶ
  - `togglePlay` のデバウンスチェック通過後に `clearGeneratedExport('play-toggle')` を呼ぶ
  - `pausePreviewBeforeEdit` の先頭（`isProcessing || !isPlayingRef.current` ガードの前）に `clearGeneratedExport('edit:${reason}')` を呼ぶ。再生中でなくても編集操作であればクリアする
  - `isProcessing === true` のとき `clearGeneratedExport` は何もしない（エクスポート中断は既存の `stopWebCodecsExport` ルートに任せる）
  - ダウンロードボタン押下では `clearExport()` しない（同じ生成結果を再ダウンロードできる）
- **注意**:
  - `clearExport()` を直接呼ばず必ず `clearGeneratedExport()` 経由を使うこと。Blob URL の revoke と exportExt のクリアが clearExport に集約されているため
  - 既存の編集ハンドラ（addMediaItems, setBgm, addNarration など）が直接 `clearExport()` を呼んでいる箇所は redundant になるが削除不要（`pausePreviewBeforeEdit` → `clearGeneratedExport` → `clearExport` の後で exportUrl が null なので idempotent）
  - 9-15 の「export 完了後の `exportUrl` は stop/preview 再開では消さず」という旧方針は、今回の変更で撤回済み



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

### 13-39. Clipsヘルプ文言の整理（表示区間 / 位置・サイズ / 折りたたみ案内）

- **Files**: `src/constants/sectionHelp.ts`
- **Issue**:
  - 動画・画像ヘルプで「表示時間・位置・サイズ」の粒度が広く、動画トリミングと画像表示時間の違いが伝わりにくい
  - 「黒帯除去」が独立項目のため、実UIの「位置・サイズ調整」パネルとの対応が分かりにくい
  - 「位置・サイズ調整」「音量・フェード設定」が折りたたみ表示であることがヘルプ本文に明示されていなかった
- **Pattern**:
  - 項目名を `表示区間（動画：トリミング・画像：表示時間）` に統一し、動画は開始/終了トリミング、画像は常時表示時間調整を明記
  - `黒帯除去` を `位置・サイズ調整` に統合し、黒帯除去・拡大縮小・位置調整を1項目で説明
  - `位置・サイズ調整` と `音量・フェード設定` の説明文に「折りたたみ表示のため開いて使う」旨を追記
- **Note**: ヘルプ文言は `sectionHelp.ts` を単一ソースとして更新し、UIの開閉仕様と常に同期する。

### 13-40. Clipsヘルプの表記統一とリセットアイコン説明の明確化

- **Files**: `src/constants/sectionHelp.ts`
- **Issue**:
  - 表示区間タイトルの区切り表記を `／` に統一したい
  - 黒帯除去の目的（微細な上下隙間を目立ちにくくする）がヘルプで弱く、必要性が伝わりにくい
  - 拡大縮小/位置/音量にある「くるくる」アイコンの意味（デフォルト値へ戻す）が項目ごとに明確でない
- **Pattern**:
  - タイトルを `表示区間（動画：トリミング／画像：表示時間）` に更新
  - 位置・サイズ調整の説明に、黒帯除去の目的とスライダー調整可能である旨を追記
  - 位置・サイズ調整に `reset_button` 視覚トークンを追加し、くるくるアイコンでデフォルト値へ戻せることを明記
  - 音量・フェード設定も「くるくるアイコンでデフォルト値に戻す」表現へ統一
- **Note**: ヘルプ文言とアイコン説明は、実UIラベル・実アイコン挙動（デフォルト値復帰）と常に一致させる。

### 13-41. ヘルプの閉じる `×` ボタン視認性を軽微に向上

- **Files**: `src/components/modals/SectionHelpModal.tsx`, `src/components/modals/AiModal.tsx`, `src/components/modals/SaveLoadModal.tsx`, `src/components/modals/SettingsModal.tsx`
- **Issue**:
  - セクションヘルプや各モーダル内ヘルプの `×` ボタンが小さく、視認しづらい
- **Pattern**:
  - ヘルプ `×` ボタンの余白をわずかに拡大し、アイコンを `18px` に統一
  - 背景と細い境界線を追加して、ヘルプカード配色を保ったままコントラストを上げる
  - クリックハンドラと文言は変えず、見た目クラスのみ調整する
- **Note**: 通常モーダル本体の閉じるボタンには影響させず、ヘルプ機能の `×` のみを対象にする。

### 13-42. 保存・素材 / 設定モーダルの本体 `×` をヘルプ同系に統一

- **Files**: `src/components/modals/SaveLoadModal.tsx`, `src/components/modals/SettingsModal.tsx`
- **Issue**:
  - モーダル本体ヘッダーの `×` がプレーン表示で、ヘルプ側の `×` と視認性・見た目の統一感が不足していた
- **Pattern**:
  - `SaveLoadModal` と `SettingsModal` の本体 `×` に、ヘルプ同系の枠付き・背景付きスタイルを適用
  - アイコンサイズを `18px` に統一し、`title` / `aria-label` を付与して操作意図を明確化
  - 閉じる処理（`onClose`）は変更せず、表示スタイルのみ調整
- **Note**: 本体モーダルの閉じる導線をヘルプ系UIと揃えることで、視認性を上げつつ学習コストを下げる。

### 13-43. BGMヘルプ表記の明確化とフェード秒数プリセットの統一案内

- **Files**: `src/constants/sectionHelp.ts`
- **Issue**:
  - BGM項目で「遅延」という単語だけだと、タイムライン上の開始タイミング調整であることが伝わりにくい
  - フェード秒数の選択肢（0.5秒/1秒/2秒）がヘルプ本文から分かりにくい
- **Pattern**:
  - BGM項目名を `開始位置・開始タイミング（遅延）` に変更し、説明文も同表記へ統一
  - BGMのフェード説明に `0.5秒・1秒・2秒の3つ` を明記
  - 動画・画像（clips）とキャプションのフェード説明にも同じ3段階プリセットを明記し、横断的な理解を揃える
- **Note**: フェード秒数の仕様変更があった場合は、`sectionHelp.ts` の該当3セクション（clips/bgm/caption）を同時更新する。

### 13-44. ナレーションヘルプ文言の実運用寄り強化（AI生成/複数管理/トリミング）

- **Files**: `src/constants/sectionHelp.ts`, `src/components/sections/NarrationSection.tsx`
- **Issue**:
  - ナレーションヘルプの `AI / 追加` 説明が短く、AI生成の用途やファイル追加との使い分けが伝わりにくい
  - 複数ナレーションを重ねて運用できる点、AI生成音声の保存先（PC/スマホ）が明示されていなかった
  - `現在位置ボタン` の説明が抽象的で、プレビュー現在位置への反映であることが伝わりにくい
  - 実UIの `切り出し設定` とヘルプ側の意図を合わせるため、`トリミング設定` に統一したい
- **Pattern**:
  - ナレーションの subtitle と `AI / 追加` 説明を、`AIで好みのナレーション生成 + 事前音声追加 + 複数設定可能` が伝わる文章へ更新
  - `並び替え・編集・削除・保存` 説明に、AI生成ナレーションをPC/スマホへ保存できることを追記
  - `開始位置` 説明を `プレビューの現在位置に設定` と明記
  - 実UIラベル（`NarrationSection.tsx`）とヘルプ項目名（`sectionHelp.ts`）を `トリミング設定` に統一し、開始/終了ラベルも `トリミング開始/終了` に揃える
  - トリミング説明に、長いナレーションを複数に分割してタイミング調整や声質合わせに使える旨を追記
- **Note**: 実UIラベル変更時はヘルプ文言も同時更新し、項目名の不一致を作らない。

### 13-45. キャプション表示アイコン説明の明確化と現在位置文言の統一

- **Files**: `src/constants/sectionHelp.ts`
- **Issue**:
  - キャプションの `表示アイコン / 鍵アイコン` 表現だと、目アイコンの意味を直感的に伝えづらい
  - 表示アイコンをOFFにしたときの影響（プレビュー/出力動画の非表示）がヘルプで明示されていなかった
  - `現在位置ボタンでも設定` の表現が曖昧で、どの現在位置か分かりづらい
- **Pattern**:
  - 項目名を `表示アイコン（目のマークのアイコン）` に変更
  - 説明に「OFF時はキャプションがすべて非表示になり、出力動画にも表示されない」挙動を明記
  - `表示時間` の説明を `現在位置ボタンでプレビューの現在位置に設定` へ統一
- **Note**: `現在位置` を使う説明は、ナレーション/キャプションで同じ言い回しを使って理解負荷を下げる。

### 13-46. キャプションヘルプの再編（一括設定と個別設定の役割明確化）

- **Files**: `src/constants/sectionHelp.ts`
- **Issue**:
  - キャプションヘルプで「一括設定」と「個別設定」の役割が分散し、どこで何を設定するか把握しづらい
  - 既存の `位置・サイズ調整` と `フェード設定` が、上位説明と重複していた
  - 各行の歯車・鉛筆アイコンでできる操作（個別設定・本文編集）が十分に説明されていなかった
- **Pattern**:
  - 項目3として `スタイル・フェードの一括設定` を追加し、サイズ/字体/位置/ぼかし + フェード（0.5秒・1秒・2秒）をまとめて説明
  - 一括設定項目に `slider_demo` を追加して、スライド操作イメージを表示
  - `各キャプションの操作` に、歯車での個別設定（サイズ/字体/位置/フェード）と一括設定からの個別上書き可を明記
  - `各キャプションの操作` に、鉛筆ボタンで本文編集できる説明を追加し、`slider_demo` も追加
  - 重複する `位置・サイズ調整` / `フェード設定` 項目は削除して構成を整理
- **Note**: キャプション設定の説明変更時は、「一括設定」「各キャプションの操作」「表示時間」の3項目の関係を同時に確認する。

### 13-47. キャプション項目順の再整理（操作と個別設定の分離）

- **Files**: `src/constants/sectionHelp.ts`
- **Issue**:
  - `各キャプションの操作` に個別設定説明が混在し、項目の役割が分かりにくかった
  - キャプション項目の並びを `4:各キャプションの操作 / 5:個別設定 / 6:表示時間` にしたい要望があった
  - 一括設定説明で位置は `X/Y` ではなく `位置` の表現に統一したい
- **Pattern**:
  - `各キャプションの操作` は移動・削除・鉛筆編集に限定し、歯車説明を分離
  - 新規項目 `個別設定（歯車マーク）` を追加し、サイズ/字体/位置/フェードの個別調整と一括設定からの上書きを明記
  - `個別設定（歯車マーク）` に `slider_demo` を追加し、個別設定でもスライド操作できることを可視化
  - 項目順を `1追加 / 2表示アイコン / 3一括設定 / 4各キャプションの操作 / 5個別設定 / 6表示時間` に整理
- **Note**: キャプションヘルプは「一括設定」と「個別設定」を別項目として維持し、説明の重複を避ける。

### 13-48. プレビューヘルプの順序調整と作成中注意文の明確化

- **Files**: `src/constants/sectionHelp.ts`
- **Issue**:
  - プレビューヘルプで `一括クリア` の優先度を下げたい要望があり、4番目へ移動が必要
  - `動画ファイルを作成` 中のタブ切り替え/非アクティブ化で作成不良になり得る注意点が未記載
  - `作成後のダウンロード` の説明で、戻る先ボタン名をより丁寧に明示したい
- **Pattern**:
  - プレビュー項目順を `停止・再生・キャプチャ` → `動画ファイルを作成` → `作成後のダウンロード` → `一括クリア` に変更
  - `動画ファイルを作成` 説明に「作成中のタブ切り替え/非アクティブ化で正しく作成できない場合がある」を追記
  - `作成後のダウンロード` 説明を「停止/再生を押すと動画ファイルを作成ボタンに戻り」へ更新
- **Note**: プレビュー導線の文言変更時は、実ボタンラベル（`動画ファイルを作成`）との一致を優先する。

### 13-49. プレビューヘルプ文言の断定化と表記統一

- **Files**: `src/constants/sectionHelp.ts`
- **Issue**:
  - 作成中のタブ切り替え/非アクティブ化の注意文が「場合があります」で弱く、禁止意図が伝わりにくい
  - 戻る先ボタン名を文中で明示する際に、ラベルとしての視認性を上げたい
  - 一括クリア説明を、対象列挙ではなく「動画作成状態のクリア + 全初期化」の意味で伝えたい
- **Pattern**:
  - 注意文を「正しく作成できません」と断定表現へ変更
  - 戻る先を「停止/再生を押すと『動画ファイルを作成』ボタンに戻り」と鍵括弧付きで表記
  - 一括クリア説明を「動画作成状態をクリアしてすべて初期状態に戻せます」に更新
- **Note**: 強い注意文にする項目は、実際に失敗し得る操作条件に限定して記載する。

### 13-50. ヘッダー右側に全体ヘルプ導線を追加（PCモーダル / スマホ下スライド）

- **Files**: `src/components/Header.tsx`, `src/components/TurtleVideo.tsx`, `src/constants/sectionHelp.ts`, `src/components/modals/SectionHelpModal.tsx`
- **Issue**:
  - セクション別ヘルプはあるが、アプリ全体の概要・使い方をまとめて確認する導線がヘッダーに無かった
  - 初見ユーザー向けに、機能概要/5ステップ手順/動作確認機種/注意点を一箇所で案内したい
- **Pattern**:
  - ヘッダーの歯車（設定）右側に、既存ヘルプと同系スタイルの `?` ボタンを追加（モバイル/PC両方）
  - クリック時は `SectionHelpModal` を `app` セクションで開き、既存同様に PC は中央モーダル、スマホは下からスライドで表示
  - `sectionHelp.ts` に `app` セクションを追加し、以下を順に掲載:
    - ソフト概要（端的説明）
    - 主要機能（箇条書き）
    - 使い方5ステップ
    - 動作確認機種（Pixel 6a / Ryzen 5 5500 + RTX3060 12GB、注記付き）
    - 全体注意点（適宜保存・自動保存活用）
    - 使い方のコツ（追加案内）
  - 説明文で改行を使えるよう、`SectionHelpModal` の本文を `whitespace-pre-line` 表示に対応
- **Note**: 全体ヘルプはセクション操作説明と役割が異なるため、ヘッダー導線として独立管理する。

### 13-51. 全体ヘルプ「使い方（5ステップ）」をセクション配色に合わせた視覚ガイドへ強化

- **Files**: `src/constants/sectionHelp.ts`, `src/components/modals/SectionHelpModal.tsx`
- **Issue**:
  - 全体ヘルプの5ステップがテキスト列挙のみで、実際のセクション配色（青/紫/藍/黄/緑）との対応が直感的に伝わりにくかった
  - ステップ説明をもう少し丁寧で自然な文章にしたい要望があった
- **Pattern**:
  - `SectionHelpVisualId` に `app_step_*`（clips/bgm/narration/caption/preview）を追加し、全体ヘルプの5ステップを visual token で描画
  - `sectionHelp.ts` の「使い方（5ステップ）」は導入文 + `visuals` 指定へ変更し、本文の行番号リスト依存を解消
  - `SectionHelpModal` 側で各 `app_step_*` をフル幅カードとして描画し、番号バッジとタイトル色をセクション見出し色に統一
  - 各ステップ文言を、追加→調整→確認→作成/ダウンロードの流れが伝わる文に更新
- **Note**: 5ステップ文言を更新する際は、`sectionHelp.ts` と `SectionHelpModal.tsx` の `app_step_*` 描画を同時に見直し、表示順と色対応を崩さない。

### 13-52. 全体ヘルプの概要文を実利用シーン寄りに校正し、5ステップ説明文の文字サイズを統一

- **Files**: `src/constants/sectionHelp.ts`, `src/components/modals/SectionHelpModal.tsx`
- **Issue**:
  - 全体ヘルプ「使い方（5ステップ）」の説明文が他項目より小さく、読みづらい
  - 概要文を、モバイル利用/PWA/オフライン利用/OSS活用まで含めた案内へ改善したい
- **Pattern**:
  - `SectionHelpModal` の `app_step_*` 説明文クラスを `text-xs md:text-sm` に変更し、ヘルプ本文の標準サイズへ統一
  - `sectionHelp.ts` の `app > 概要` を複数文に再構成し、実際の利用シーンと価値（レスポンシブ、PWA、AI活用、GPLv3）を自然な流れで記載
- **Note**: 全体ヘルプ本文は `whitespace-pre-line` 表示を前提に、長文は改行で段落分けして可読性を維持する。

### 13-53. 全体ヘルプのライセンス案内を拡張し、OSSライセンス一覧をアコーディオン化

- **Files**: `src/constants/sectionHelp.ts`, `src/components/modals/SectionHelpModal.tsx`
- **Issue**:
  - 全体ヘルプ内でライセンス説明を独立項目として示したい
  - 使用OSSとライセンス形態を、折りたたみで見やすく提示したい
- **Pattern**:
  - `SectionHelpItem` に `accordions`（title + items）を追加し、任意項目で折りたたみデータを保持できる構造に拡張
  - `SectionHelpModal` 側で `details/summary` によるアコーディオン描画を追加し、一覧表示を省スペース化
  - `app` セクションに `ライセンス` 項目を追加し、GPLv3の概要を簡潔に案内
  - 同項目内に「本番依存（直接）」「開発依存（直接）」「間接依存を含む集計」の3アコーディオンを配置
  - 直接依存のライセンスは `package.json` + `node_modules/<pkg>/package.json` を参照し、集計値は `node_modules` 全体のユニークパッケージで算出
- **Note**: 依存パッケージ更新時は、`ライセンス` 項目の直接依存一覧と集計値を同期して更新する。

### 13-54. ライセンス説明を「改変しやすさ重視」の表現へ調整

- **Files**: `src/constants/sectionHelp.ts`
- **Issue**:
  - GPLv3説明が義務寄りの印象になり、個人/社内の改変利用を後押しするメッセージが弱かった
- **Pattern**:
  - `ライセンス` 説明に「個人や社内で再頒布を伴わない場合は自由に改変して利用可能」を明記
  - AI活用で自分好みに改変することを推奨する文章を追加
  - 一方で、外部配布時のみGPLv3条件（ソース公開・同ライセンス継承等）が必要である点は簡潔に維持
- **Note**: 法的な厳密判断は README / LICENSE を正本とし、ヘルプ文言は運用上の分かりやすさを優先する。

### 13-55. 保存・素材ヘルプを「保存」と「素材」に分割し、IndexedDB保存仕様を明記

- **Files**: `src/components/modals/SaveLoadModal.tsx`
- **Issue**:
  - 「保存・素材の使い方」が単一リストで、保存機能と素材生成機能の説明が混在していた
  - 保存先（ブラウザ上のIndexedDB）や保存保持条件、定期上書きの意図が明確でなかった
- **Pattern**:
  - ヘルプ本文を `保存` と `素材` の2セクションへ分割し、間に区切り線を配置
  - `保存` セクションに以下を明記:
    - 保存先はブラウザ上の `IndexedDB`
    - ブラウザ/アプリを閉じても保持される
    - 自動保存は定期上書きで、保存データが増え続けにくい（ローカル領域を圧迫しにくい）
  - `素材` セクションには黒/白画像生成と用途を簡潔に記載
- **Note**: 保存仕様が変わった場合は、ヘルプ文の「保存先」「保持条件」「上書き動作」を同時更新する。

### 13-56. 設定ヘルプに Google AI Studio の利用上限注意（※）を追記

- **Files**: `src/components/modals/SettingsModal.tsx`
- **Issue**:
  - 設定ヘルプに、Google AI Studio / Gemini API の利用上限超過時の挙動（一定時間待機）が明記されていなかった
- **Pattern**:
  - 設定ヘルプの説明リスト直下に、`※` 付きの補足文を追加
  - 文言は「レート制限・日次上限などに到達すると一時的に利用できなくなり、一定時間待って再試行が必要」を簡潔に案内
- **Note**: 上限仕様は提供元側で更新され得るため、必要に応じてヘルプ文言を最新仕様に合わせて更新する。

### 13-57. READMEをヘルプ仕様に同期し、公開URLを `turtle-video-playground` へ更新

- **Files**: `README.md`
- **Issue**:
  - READMEの機能説明が最新のヘルプ内容（各セクションの操作項目・注意事項）と一部乖離していた
  - 公開URLを新しいパスへ更新する必要があった
- **Pattern**:
  - `機能` セクションを、動画・画像/BGM/ナレーション/キャプション/プレビュー/保存・素材/設定 の最新ヘルプ項目に合わせて再構成
  - `使い方（ヘルプ準拠）` を追加し、5ステップ導線と注意事項を明記
  - `すぐに使う（GitHub Pages）` の公開URLを `https://safubuki.github.io/turtle-video-playground/` に更新
  - 動作確認機種と iPhone 非対応注記を、全体ヘルプ表記に合わせて統一
- **Note**: ヘルプ文言を更新した場合は、README の機能説明と使い方セクションも同時に同期する。

### 13-58. READMEのスキル導入手順を環境別ディレクトリ運用へ再編し、スクリプト一覧を最小化

- **Files**: `README.md`
- **Issue**:
  - スキル導入説明が長く、環境ごとの保存先差分（`.github/.agents/.agent`）が直感的に把握しづらかった
  - 「よく使うスクリプト」が詳細寄りで、日常利用の最小セットを素早く参照しづらかった
  - プロジェクト構造が実フォルダ（特に Agent Skills の3系統）を十分に反映できていなかった
- **Pattern**:
  - `## 導入手順` を新設し、Step 1 として環境別セットアップを整理
  - GitHub Copilot / GPT Codex / Google Gemini の利用ディレクトリと自動認識条件を明示
  - `.agents`（Codex）と `.agent`（Gemini）の差異を `NOTE` で注意喚起
  - `よく使うスクリプト` を `dev/build/test:run/preview` の最小セットへ簡略化
  - `プロジェクト構造` をトップレベル起点の最新構成（`.github/skills`, `.agents/skills`, `.agent/skills` 含む）へ更新
- **Note**: Agent Skills の運用先を変更した場合は、READMEの導入手順・プロジェクト構造・関連ドキュメントを同時更新する。

### 13-59. Gemini APIキー転送の堅牢化（クエリ文字列→ヘッダー）

- **対象ファイル**: `src/components/TurtleVideo.tsx`, `src/hooks/useAiNarration.ts`
- **問題**:
  - Gemini API 呼び出しでリクエスト URL に `?key=...` を付与していたため、URL 経由でAPIキーが意図せず露出するリスクがあった。
- **対応パターン**:
  - エンドポイント形式は `${GEMINI_API_BASE_URL}/{model}:generateContent`（クエリキーなし）を維持する。
  - APIキーは `x-goog-api-key` リクエストヘッダーで送信する。
  - 外部 Gemini 呼び出しに `referrerPolicy: 'no-referrer'` を設定する。
  - 動作・パフォーマンスのリグレッションを避けるため、リクエストボディのスキーマとフォールバックフローは変更しない。
- **注意**: 今後 Gemini を統合する際は、APIキーをクエリパラメータに含めないこと。

### 13-60. Playgroundリポジトリへの手動同期ワークフロー（コピーベース・履歴マージなし）

- **対象ファイル**: `.github/workflows/manual-sync-from-dev.yml`
- **問題**:
  - 公開 Playground リポジトリでは、アップストリームのコミット履歴を公開先に露出させずに「最新の開発ファイル」だけを反映させたい場合がある。
  - 通常の merge/rebase 同期では意図しないコミットグラフが漏洩し、リポジトリ固有ファイルのコンフリクトリスクも高まる。
- **対応パターン**:
  - `workflow_dispatch` のみ使用し、メンテナーが任意のタイミングで手動実行する。
  - ソースを `--depth=1` でクローンし、`rsync -a --delete` でファイルをコピー同期する（git 履歴同期ではない）。
  - `--delete` 実行時に同期ワークフロー自身が削除されないよう `--exclude '.github/workflows/manual-sync-from-dev.yml'` を指定する。
  - ステージング済み変更がある場合のみコミットし、差分がない場合は空コミットを作らずに終了する。
  - コミットメッセージのタイムスタンプには `TZ=Asia/Tokyo` を使用し、同期コミットメッセージに `JTC` ラベルを付与する。
  - 同期プッシュ後、GitHub Actions API 経由で `deploy.yml` をディスパッチし、手動同期直後にデプロイを自動実行する。
- **注意**:
  - Playground 専用ファイル（例: `CNAME`、リポジトリ固有のワークフロー）が存在する場合は、`--delete` を有効にする前に明示的な `--exclude` エントリを追加すること。

### 13-61. AIレビューでは防御コードだけで仕様変更を断定しない

- **対象ファイル**: `AGENTS.md`, `Docs/review/README.md`, `Docs/review/functional-review-checklist.md`, `Docs/review/non-functional-and-regression-checklist.md`
- **問題**:
  - `??`, optional chaining, null guard などの防御コードだけを見ると、実際には必須前提のデータまで optional 仕様だと誤読しやすい。
  - その結果、型・テスト・スキーマが示す現行契約とずれた仮説ベースの指摘が高優先度で出ることがある。
- **対応パターン**:
  - レビュー時は PR本文、Issue、`spec.md`、差分に加え、型・スキーマ・保存/読込コード・既存テストから現行契約を確認する。
  - 到達可能性が確認できないケースは、断定指摘ではなく前提付きの open question として扱う。
  - findings が 1 件だけでも、要件充足・デグレ・非機能の主要観点を確認した結果を短く添える。
- **注意**:
  - `Docs/review/` は詳細基準であり、入口としてルート `AGENTS.md` から明示参照する。
  - `Docs/review/` を置くだけでは、Codex が常に自動参照する前提ではない。

### 13-62. 設定モーダルの履歴導線は「表示条件」と「状態遷移」を両方ガードする

- **対象ファイル**: `src/components/modals/SettingsModal.tsx`
- **問題**:
  - `version.json` に `history` が無いビルドで履歴ボタンを表示したままだと、押下しても何も出ない一方で、内部状態だけが `history` へ進んで戻る操作を 1 回余分に消費し得る。
- **対応パターン**:
  - `history` が無い場合は履歴ボタン自体を表示しない。
  - あわせて、情報パネル切り替えロジック側でも `history` への遷移を拒否し、UI 表示条件と内部状態を一致させる。
  - 状態遷移は小さな純関数に切り出して、履歴あり/なしの両方をユニットテストで確認する。
- **注意**:
  - `popstate` による戻る操作は、見えていない履歴パネルを閉じるだけの無駄な遷移を挟まないこと。

### 13-63. モーダルの領域外クリック挙動は用途で分ける（AIのみ閉じない）

- **対象ファイル**: `src/components/modals/AiModal.tsx`, `src/components/modals/SettingsModal.tsx`, `src/components/modals/SaveLoadModal.tsx`, `src/components/modals/SectionHelpModal.tsx`, `src/components/modals/CaptionSettingsModal.tsx`
- **問題**:
  - モーダルごとに backdrop クリック/タップ時の挙動が揺れると、誤操作時の期待が崩れる。
  - 特に AIナレーションは文字入力の途中内容を失いやすく、領域外クリックで閉じると事故コストが高い。
- **対応パターン**:
  - `AiModal` は領域外クリック/タップでは閉じない。
  - `SettingsModal`、`SectionHelpModal`、`SaveLoadModal`、`CaptionSettingsModal` は領域外クリック/タップで閉じる。
  - 閉じるモーダルは backdrop 側で `onClose`、本体側で `stopPropagation()` を明示し、意図しないバブリングを防ぐ。
- **注意**:
  - 入力途中の破壊コストが高いモーダルだけは「閉じない」を選び、その他は操作の軽さを優先する。
  - 新しいモーダルを追加する際は、入力破壊リスクの有無を基準に backdrop 方針を先に決める。

### 13-64. iOS Safari preview 音声は単一音源なら native fallback を使う

- **ファイル**: `src/components/TurtleVideo.tsx`, `src/utils/previewPlatform.ts`, `src/test/previewPlatform.test.ts`
- **問題**:
  - iOS Safari で attach 時に全音源を一律 `muted` 化すると、単一音源の preview でも無音になるケースがある
  - 一方で動画音声 + BGM + ナレーションの同時再生では、従来どおり WebAudio mix が必要
- **対策**:
  - `getPreviewAudioOutputMode()` で iOS Safari の preview 音声出力モードを判定する
  - preview 中の可聴音源が 1 つだけなら native 出力へ逃がし、GainNode 側は 0 にする
  - 複数同時再生または export では従来どおり WebAudio mix を使い、native 側を mute する
  - `stopAll()` と media attach 時には native の `muted` / `volume` を初期状態へ戻す
- **注意**:
  - iOS Safari preview の無音修正は `handleMediaRefAssign` の一律 mute へ戻さず、必ず output mode helper 経由で調整する
  - 単一音源 preview の音量は native `HTMLMediaElement.volume` に寄せるため、Safari 専用の preview 回避は export 音声経路へ混ぜない

### 13-65. 自動保存失敗時は catch-up 再試行の基準時刻を進めない

- **対象ファイル**: `src/hooks/useAutoSave.ts`, `src/test/useAutoSave.test.tsx`
- **問題**:
  - `saveProjectAuto()` が失敗しても `lastAutoSaveActivityAtRef` を更新すると、タブ復帰直後やエクスポート終了直後の catch-up 保存が次の保存間隔まで抑止される
- **対応パターン**:
  - `failed` は `skipped-processing` と同じく「活動なし」とみなし、`lastAutoSaveActivityAtRef` を更新しない
  - `focus` / `visibilitychange` / `pageshow` を契機にした catch-up 保存テストで、失敗直後でも同内容を即再試行できることを維持する
- **注意**:
  - 自動保存結果の種類を増やす場合は、変更検知ハッシュを進めるかだけでなく、catch-up 判定用の活動時刻を進めるかも必ずセットで決める

### 13-66. `pagehide` 先行時の export は入力メディアを即 pause しない

- **対象ファイル**: `src/components/TurtleVideo.tsx`, `src/utils/previewPlatform.ts`, `src/test/previewPlatform.test.ts`
- **問題**:
  - 環境によっては `pagehide` が `visibilitychange(hidden)` より先に発火する
  - この瞬間に export 中でも `pauseAllMediaElements()` を実行すると、export ループが hidden 側で止まる前に入力動画/音声だけ pause され、出力ファイルへ黒フレームや無音区間が混入しうる
- **対応パターン**:
  - `pagehide` では通常 preview だけ入力メディアを pause し、export 中は hidden 側の停止契機へ委ねる
  - 判定は `getPageHidePausePlan()` に切り出し、pure helper として回帰テストで固定する
- **注意**:
  - `visibilitychange(hidden)` 側の停止・復帰契約は維持し、`pagehide` だけを別扱いして race を潰す

### 13-67. 非 iOS export のフレーム供給時刻は「描画済みフレーム」を基準にする

- **対象ファイル**: `src/components/TurtleVideo.tsx`, `src/utils/exportTimeline.ts`, `src/test/exportTimeline.test.ts`
- **問題**:
  - Canvas 直接 `VideoFrame` 化の export 経路では、エンコーダー側の目標フレーム数が `currentTimeRef` を参照している
  - その値が `renderFrame()` 完了前に進むと、次フレームとしてまだ描画されていない古い Canvas を拾い、重複フレームと取りこぼしが混在して元動画よりカクついて見える
- **対応パターン**:
  - export ループでは `renderFrame()` の戻り値で Canvas 更新有無を受け取り、`holdFrame` などで描画内容を維持したフレームでは `lastRenderedExportTimeRef` を進めない
  - 非 iOS の WebCodecs export では、その描画済み時刻を `getPlaybackTimeSec()` の優先値として使う
  - iOS Safari は既存 MediaRecorder strategy との責務分離を維持し、従来どおり `currentTime` 基準を残す
  - 時刻選択ロジックは `resolveExportPlaybackTimeSec(currentTime, lastRenderedTime, preferRenderedTime)` に切り出し、pure test で platform 分岐と fallback を固定する
- **注意**:
  - export 進行時刻を publish する ref と、実際に Canvas へ描画済みの時刻は同一とは限らないため、Canvas 直接エンコードでは「描画完了後の時刻」を参照する
  - preview 再生や iOS export まで同じ ref に統一すると既存経路へ副作用が出やすいので、適用範囲は非 iOS export のみに留める

### 13-68. 自動保存タイマーは復帰時に再アームし、間隔変更でも経過時間を捨てない

- **対象ファイル**: `src/hooks/useAutoSave.ts`, `src/test/useAutoSave.test.tsx`
- **問題**:
  - タブ非アクティブ化や BFCache 復帰の環境では、`setInterval` が停止したまま戻ることがあり、その後の自動保存が再開されないことがある
  - 自動保存間隔を 5 分→1 分などへ短く変更した時に、タイマー再生成で `lastAutoSaveActivityAtRef` を現在時刻へ戻すと、新しい間隔で既に overdue でも保存が先送りされる

### 13-69. PWA 更新適用は多重実行を防ぎ、意図的な reload では beforeunload を出さない

- **対象ファイル**: `src/stores/updateStore.ts`, `src/components/ReloadPrompt.tsx`, `src/components/modals/SettingsModal.tsx`, `src/hooks/usePreventUnload.ts`, `src/test/stores/updateStore.test.ts`, `src/test/usePreventUnload.test.tsx`
- **問題**:
  - `vite-plugin-pwa` の prompt モードでは、waiting service worker への `skipWaiting` 後に `controlling` を契機として reload が走る
  - この時に更新適用ボタンを連続で押せると reload 要求が多重化し、編集中データに対する `beforeunload` 確認も重なって見えやすい
- **対応パターン**:
  - `updateStore` に `isApplyingUpdate` を持たせ、更新適用は store の単一ラッパー経由で 1 回だけ通す
  - 更新適用開始時に `needRefresh` を閉じ、`ReloadPrompt` と `SettingsModal` の更新ボタンは `isApplyingUpdate` 中に無効化する
  - `usePreventUnload` は通常の編集中離脱では従来どおり警告するが、PWA 更新適用中だけは警告を出さず、意図した reload を素通しする
- **注意**:
  - 手動更新導線を増やしても、service worker 更新適用は UI から直接 hook を呼ばず store ラッパーへ集約する
  - 更新適用中の状態は reload 成功時に自然終了する前提なので、失敗時だけ再試行できるよう `needRefresh` を戻す
- **対応パターン**:
  - 復帰契機（`visibilitychange` / `focus` / `pageshow`）では catch-up 判定の前に、hidden/pagehide をまたいだ時だけ interval を再アームする
  - 再アーム時は「今から丸ごと1周期」ではなく、`lastAutoSaveActivityAtRef` から見た残り時間だけ待ってから通常 cadence へ戻す
  - 復帰時点で既に期限超過なら残り待ち時間は 0 とみなし、catch-up 保存で即座に追いついたうえで通常 cadence を再開する
  - interval の再生成や保存間隔変更では `lastAutoSaveActivityAtRef` をリセットせず、最後に保存できた時刻を保持したまま overdue 判定する
  - 自動保存実行直前の export 判定は `useUIStore.getState().isProcessing` で最新値を参照し、エクスポート中保存を確実に抑止する
- **注意**:
  - 復帰のたびに無条件で interval を張り直すと、通常の `focus` でも次回保存時刻を後ろ倒ししやすい。hidden / pagehide を経た時だけ再アームする
  - export 中に interval を再アームしても保存自体は走らない契約を維持し、resume 後の catch-up 保存と競合させない

### 13-69. 自動保存のクリップロック検知は `mediaStore.isClipsLocked` を唯一の正状態として読む

- **対象ファイル**: `src/hooks/useAutoSave.ts`, `src/stores/mediaStore.ts`, `src/test/useAutoSave.test.tsx`
- **問題**:
  - 以前の実装では `mediaStore` に旧 save/restore 契約との互換用 alias `isLocked` が残っており、通常操作の `toggleClipsLock()` では `isClipsLocked` だけが更新されていた
  - 自動保存が alias 側を読んでいたため、クリップセクションロックの変更がハッシュにも保存データにも反映されず、編集中の変更なのに `skipped-nochange` 扱いで autosave が止まっていた
- **対応パターン**:
  - クリップセクションロックの参照元は `useMediaStore((s) => s.isClipsLocked)` に統一した
  - `mediaStore` 側では `toggleClipsLock()` / `clearAllMedia()` / `restoreFromSave()` で alias `isLocked` も同期し、旧参照が残っても状態が乖離しないようにした
  - テストは `setState({ isClipsLocked: ... })` で実ストア契約に合わせ、ロック切り替え後に autosave が再度走ることを明示的に固定した
- **注意**:
  - `MediaItem.isLocked`（個別クリップロック）と `mediaStore.isClipsLocked`（セクションロック）は別概念なので混同しない
  - Zustand テストで存在しない state key を直接差し込むと、今回のような selector typo を見逃すため、実ストアの state shape に合わせる

### 13-70. 自動保存表示は「前回成功保存時刻」ではなく「最後に autosave cadence が進んだ時刻」を基準にする

### 13-71. App 入口で runtime flavor を一度だけ解決する

- **ファイル**: `src/App.tsx`, `src/app/resolveAppFlavor.ts`, `src/app/AppShell.tsx`, `src/flavors/standard/StandardApp.tsx`, `src/flavors/apple-safari/AppleSafariApp.tsx`
- **問題**: `TurtleVideo.tsx` のような下位実装へ platform 判定が流れ込むと、iOS Safari 向け回避策が Android/PC の既定経路へ混ざりやすい
- **対策**:
  - App 入口で `resolveAppFlavor()` により runtime flavor を一度だけ決定する
  - 選択した flavor だけを `React.lazy()` で読み込み、未使用 flavor を初期ロードしない
  - Phase 1 では両 flavor とも `TurtleVideo` を adapter として共有し、以後のフェーズで runtime を段階的に分離する
- **注意**:
  - 下位 shared モジュールで `isIosSafari` の直参照を増やさず、flavor 境界は App 入口に保つ
  - `AppShell` のような共通ラッパーへ残すのは、ErrorBoundary、自動保存、orientation lock など platform 非依存の責務に限定する

- **対象ファイル**: `src/hooks/useAutoSave.ts`, `src/stores/projectStore.ts`, `src/components/modals/SaveLoadModal.tsx`, `src/test/useAutoSave.test.tsx`, `src/test/modalHistoryStability.test.tsx`
- **問題**:
  - autosave が `skipped-nochange` / `skipped-empty` で正常に1周期進んでいても、UI が `projectStore.lastAutoSave`（最後に実保存できた時刻）だけを見ていると、5分設定でも「7分前」などと表示され、停止と見分けがつかない
  - アプリ起動直後に IndexedDB 上の前回 autosave が既に期限超過していても、in-memory timer を現在時刻で初期化すると catch-up 保存が先送りされる
- **対応パターン**:
  - `projectStore` に `lastAutoSaveActivityAt` / `autoSaveRuntimeStatus` / `autoSaveRestartToken` を持たせ、autosave hook から「最後に cadence が進んだ時刻」と実行状態を更新する
  - 起動直後は、まだ runtime 側で autosave 実績がない場合に限って `lastAutoSave` を活動基準へ同期し、既に期限超過なら catch-up 保存を速やかに走らせる
  - 保存モーダルの主表示は `lastAutoSaveActivityAt` を使い、`lastAutoSave` は「前回保存日時」として別行に分ける。活動時刻が interval を超過したら「要確認」と再始動ボタンを表示する
- **注意**:
  - `refreshSaveInfo()` は保存先 DB の最終保存時刻しか知らないため、`skipped-nochange` などで進んだ runtime 活動時刻を上書きしない
  - 手動保存で autosave cadence の基準をリセットする場合も、正確な「前回 auto 保存日時」は `lastAutoSave` 側で保持し続ける
  - 手動保存直後の `autoSaveRuntimeStatus` は autosave 成功扱いにせず、待機状態へ戻して「直近の自動保存が完了した」と誤表示しない

### 13-72. preview/export の再生時刻計測は `performance.now()` を優先し、コマ落ち体感を抑える

- **対象ファイル**: `src/flavors/standard/preview/usePreviewEngine.ts`, `src/flavors/apple-safari/preview/usePreviewEngine.ts`
- **問題**:
  - 再生ループが `Date.now()` 基準だと、端末やブラウザ負荷時の時刻分解能・ドリフトの影響で描画間隔が粗くなり、「パラパラ漫画」のように見えるケースがある。
  - apple-safari は preview ループがそのまま real-time canvas capture (MediaRecorder) の描画も駆動するため、time base の揺れが書き出し動画の微小カクツキにも乗る。
- **対応パターン**:
  - loop 時刻計測と `startTimeRef` 初期化を `performance.now()` 優先へ変更する（fallback は `Date.now()`）。loop の `now` と `startTimeRef` は必ず同じ time base で揃える。
  - monotonic な高精度時刻を使い、フレーム進行の微小な揺れを減らす。
- **経緯 / 注意**:
  - 当初は standard のみに適用し apple-safari は「Safari 経路の挙動非変更を維持」のため見送っていたが、iOS Safari export のカクツキ低減要望を受けて apple-safari にも同一パターンを適用した。
  - `performance.now()` は iOS Safari でも古くから利用可能で monotonic なため、`Date.now()` からの置換は挙動安全。loop と `startTimeRef` の time base を必ず一致させること（混在すると elapsed 計算が壊れる）。
  - 各 flavor の recovery/throttle 用 `Date.now()`（`videoRecoveryAttemptsRef` 等）は対象外。time base 計測のみ置換する。

### 13-73. Android の動画・画像追加は `showOpenFilePicker()` より hidden file input を優先する

- **対象ファイル**: `src/components/TurtleVideo.tsx`, `src/components/sections/ClipsSection.tsx`
- **問題**:
  - Android Chrome で `showOpenFilePicker()` を使うと Files / ダウンロード寄りの一覧 UI になりやすく、写真・動画のサムネイル picker を開きたい要件と相性が悪い。
- **対応パターン**:
  - 動画・画像追加ボタンの picker 分岐は shared capability を見て決めつつ、Android では `showOpenFilePicker()` を無効化して既存の hidden `<input type="file" accept="image/*,video/*" multiple>` を使う。
  - PC など Android 以外では既存の `showOpenFilePicker()` 経路を維持し、音声追加や保存/読み込み picker には波及させない。
- **注意**:
  - Android 判定は shared UI 側で直接増やさず、runtime から渡された capability をもとに `TurtleVideo.tsx` 側で経路を決める。
  - `capture` は付けず、OS / Chrome / 端末設定によって picker 表示が変わる前提で「サムネイル一覧が出やすい経路」を優先する。

### 13-74. Promise の resolve ハンドラ保持は `null` より `undefined + 明示型` で固定する

- **対象ファイル**: `src/test/useExport.test.ts`
- **問題**:
  - Vitest の `mockImplementation` 内で `new Promise<boolean>((resolve) => ...)` の `resolve` を外側変数へ退避する際、`null` union のまま扱うと TypeScript の制御フロー解析で呼び出し地点が `never` 扱いになり、`This expression is not callable` を起こすことがある。
- **対応パターン**:
  - 退避変数を `((handled: boolean) => void) | undefined` とし、利用前ガード後に `const strategyResolver: (handled: boolean) => void = resolveStrategy` のように明示型で受ける。
- **注意**:
  - Promise の `resolve` は `boolean | PromiseLike<boolean>` を受けられるため、テスト意図が boolean 解決で固定されている場合は受け側関数型を明示しておく。

### 13-75. export 時の caption 判定時刻は「エンコード対象フレーム timestamp」に固定する

- **対象ファイル**: `src/flavors/standard/preview/usePreviewEngine.ts`, `src/flavors/apple-safari/preview/usePreviewEngine.ts`, `src/utils/captionTimeline.ts`, `src/test/exportTimeline.test.ts`
- **問題**:
  - export ループが壁時計由来の `elapsed` をそのまま caption 判定へ流すと、エンコーダーへ渡す `VideoFrame.timestamp` と表示判定時刻が一致せず、字幕だけ 0.1〜0.3 秒遅れて見えることがある。
- **対応パターン**:
  - standard export の `renderFrame()` には `getExportFrameTiming(resolveExportDuration(...), FPS, frameIndex)` から算出した `timestampUs / 1e6` を渡し、Canvas 描画時刻を encoded timestamp と一致させる。
  - caption の表示判定は `isCaptionActiveAtTime()` helper に統一し、preview / export の双方で同じ `[start, end)` 判定を使う。
  - export 診断ログ `[DIAG-CAPTION-EXPORT-TIMING]` では frame timestamp・caption 境界・isActive を同一レコードへ出力し、時刻基準の不一致を早期検出する。
- **注意**:
  - caption 用の固定オフセット補正（±0.2s など）は導入しない。素材依存で逆効果になるため、まず timestamp 基準の一致を優先する。
  - iOS Safari export 経路は既存戦略を維持し、今回の時刻固定は standard runtime の export ループへ限定する。

### 13-76. iOS Safari は再生中のシークで一時停止し、自動再開せず UI の再生状態も揃える

- **対象ファイル**: `src/components/TurtleVideo.tsx`（`handleSeekStart`）
- **問題**:
  - seek controller は本来「スクラブ後に自動再開」する設計（`wasPlayingBeforeSeekRef` を見て seek end で `proceedWithPlayback()`）。PC/Android では機能するが、iOS Safari では seek end の再開が prepare 待ち後の非同期 `video.play()` になり、ユーザージェスチャー文脈を外れて reject されるため、実際には一時停止のまま。
  - 一方で UI ストアの `isPlaying` は seek ライフサイクル中 `true` のままなので、「実際は一時停止なのにボタンは再生中(⏸)表示」という不整合になり、再生/一時停止ボタンを 2 回押さないと再生できない退行に見える。
- **対応パターン**:
  - iOS Safari (`platformCapabilities.isIosSafari`) では、`handleSeekStart` で `handleLiveSeekStart()` 実行後に「seek 開始時点で再生中だったか」を `wasPlayingBeforeSeekRef.current` で判定し、再生中だったら UI ストアの `pause()` を呼んでボタンを「再生(▶)」表示へ揃える。
  - 同じ `handleSeekStart` 内で `wasPlayingBeforeSeekRef.current = false` を立て、controller の自動再開分岐（`handleSeekEnd` 内 `wasPlaying` 判定）を無効化する。これで seek end が「一時停止フレーム描画」パスへ落ち、手動再開（再生ボタン押下 → `togglePlay` → `startEngine`）に統一される。
- **注意**:
  - 自動再開の抑止は必ず **seek start** 側で行う。seek end には slider 由来 (`onPointerUp` 等) と window グローバルリスナー (`attachGlobalSeekEndListeners` → `handleSeekEndCallbackRef` 経由で controller の `handleSeekEnd` を直接呼ぶ) の 2 経路があり、seek end 側だけで倒すとグローバル経路で再開が漏れる。
  - 本変更は iOS Safari 限定。standard (PC/Android) はスクラブ後の自動再開が正常動作しているため挙動を変えない。preview cache 経路（Android）も対象外。

### 13-77. iOS Safari MediaRecorder の映像取り込みは captureStream(0)+requestFrame 単一供給にする

- **対象ファイル**: `src/flavors/apple-safari/export/iosSafariMediaRecorder.ts`, `src/test/iosSafariMediaRecorder.test.ts`
- **問題**:
  - iOS Safari export (MediaRecorder 経路) で `canvas.captureStream(fps)` の自動供給に加えて `setInterval(requestFrame)` を併用しており、フレームが二重供給されていた。
  - CFR ではない MediaRecorder では取り込みフレーム間隔が不揃いになり、「動画のデコードは正常（`getVideoPlaybackQuality().droppedVideoFrames` の増分がほぼ 0 ＝ 原因②）」なのに**書き出し映像だけカクつく**。実機診断で原因②（キャプチャ/エンコード側）と確定。BGM ありで OfflineAudioContext プリレンダー経路に入ると顕在化しやすい。
- **対応パターン**:
  - `requestFrame` が使える環境では `canvas.captureStream(0)` の手動モードへ切替え、自動供給を止めて frame pump 単一供給に統一する（WebCodecs 経路の 13-13 と同じ方針を MediaRecorder 経路にも適用）。
  - 静止画区間でも pump がフレームを供給するため尺ズレは起きない。`requestFrame` 非対応環境は従来どおり `captureStream(fps)` 自動供給へフォールバック。
  - 起動ログに `canvasCaptureMode`（`manual-requestFrame` / `auto-fps`）を出して現場診断可能にする。
- **注意**:
  - manual モードのときだけ pump (`setInterval(requestFrame)`) を回す。auto-fps フォールバック時は pump を回さない（再度の二重供給防止）。
  - abort / visibility / start 時の単発 `requestFrame` フラッシュは両モードで維持してよい（連続供給ではないため二重供給にならない）。

### 13-78. プレビュー未再生のままエクスポートする場合、export 開始ジェスチャーで future video に gesture credit を与える

- **対象ファイル**: `src/flavors/apple-safari/preview/usePreviewEngine.ts`（`startEngine` の `isExportMode` 分岐）
- **問題**:
  - iOS Safari は「ユーザージェスチャー内で一度も unmuted `play()` されていない video 要素」の後続 `play()` を拒否する。
  - 一度もプレビュー再生せずに（動画→画像→動画を読み込んで即）エクスポートすると、2 本目以降（画像→動画境界で初めて active になる video）の `play()` が拒否され、**映像が固まったまま音声だけ流れる**。プレビューを一度再生すると preview 側 credit pass（`shouldGrantPreviewGestureCreditToFutureVideo`）で credit 取得済みになるため再現しない。
  - 既存 credit pass は preview 分岐 (`isExporting:false`) にしか無く、export 分岐には無かった。
- **対応パターン**:
  - `startEngine` の `isExportMode` 分岐で、最初の `await`（音声プリロード）より**前**に future video を `muted=false / volume=PREVIEW_GESTURE_CREDIT_NATIVE_VOLUME(0.001)` で短く `play()`→即 `pause()` し、gesture credit だけ取得する（preview 経路と同手法）。
  - `handleExport → startEngine(0, true)` は同期的に呼ばれるため、await 前で実行すればジェスチャー起点として credit を得られる。
- **注意**:
  - credit pass は iOS (`muteNativeMediaWhenAudioRouted`) 限定。録画される音声はプリレンダー buffer 側で、native 要素音声は recorder ストリームに含まれないため 0.001 の native 音量は書き出しに混入しない。
  - credit play で進んだ currentTime は画像区間中の prebuffer / 境界 sync が補正するので別途巻き戻し不要。