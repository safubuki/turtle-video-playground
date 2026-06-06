# iPhone/iPad Safari 正式対応完了 実装計画

作成日: 2026-04-14

対象バージョン: v5.1.0

対象 flavor: apple-safari を主対象とし、shared contract と save schema は必要時のみ変更する

ステータス: In Progress

最終更新: 2026-04-26

## 0. 進捗更新

### 2026-04-14 時点

この更新では、Phase 1 と Phase 4 の基盤実装完了分、および Phase 3 / Phase 6 の先行着手分を反映します。

完了済み:

- save runtime の module import 時副作用を廃止し、`TurtleVideo.tsx` での明示初期化へ移行した
- apple-safari 向けの save health snapshot を追加し、`persistent | best-effort | unavailable`、launch context、storage estimate、warnings を取得できるようにした
- `SaveLoadModal` に保存領域診断カードを追加し、private browsing 非サポートを明示した
- preview / export / save-load に diagnostic session ID / operation ID を追加し、Safari 調査時のログ相関を取りやすくした
- apple-safari export に `MediaRecorder` probe と audio source resolver を追加した
- 関連テストを追加・更新し、`npm run test:run`、`npm run build`、`npm run quality:gate` を通過した

未完了:

- Phase 0 の support scope と adapter contract の最終確定
- Phase 2 / Phase 3 の AudioContext handoff contract と export coordinator の再設計
- 実機受け入れと正式対応表記への切り替え

### 2026-04-26 時点

この更新では、実機なしで閉じられる診断・保存耐障害化の残件を追加で反映します。

完了済み:

- `decodeAudioData` probe utility を追加し、ファイル名、MIME、拡張子、バッファサイズ、成功/失敗理由を export session ID と相関できるようにした
- apple-safari export runtime の起動時診断として WebCodecs fallback 可否をログへ残すようにした
- 保存失敗を `storage-quota | indexeddb-open | indexeddb-transaction | media-serialization | unknown` に分類し、ログと保存モーダルに表示するようにした
- 上記に対応する unit test を追加し、回帰検出できるようにした

引き続き未完了:

- Phase 2 / Phase 3 の AudioContext handoff contract と export coordinator の本格再設計
- iPhone / iPad Safari 実機での preview / export / save 受け入れ
- 実機ゲート通過後の README / UI の正式対応表記への切り替え

## 1. 結論

iPhone/iPad Safari 対応を完了させることは可能です。

ただし、完了の意味は「Safari の不安定さを場当たり的にさらに回避する」ことではなく、次を満たした状態を指します。

- apple-safari runtime の preview, export, save がそれぞれ責務境界の中で安定する
- standard runtime に Safari workaround を戻さない
- Safari のブラウザ仕様として受け入れる制約と、アプリ側で解消すべき問題を切り分ける
- 自動テストと実機確認の両方で受け入れ条件を満たす
- README とアプリ内ヘルプの表記を「検証中」から「正式対応」へ切り替えられる

この計画は、その状態まで到達するための実装順序、変更境界、受け入れ条件、実機ゲートを定義するものです。

## 2. 対応方針

### 2.1 基本方針

- preview, export, save の実行責務は引き続き apple-safari runtime が所有する
- shared 側には schema, contract, pure utility, 共通 UI だけを残す
- shared UI や shared runtime に platform 直判定を再導入しない
- Safari 対応の完了条件は、コード変更完了ではなく「実機受け入れ完了」とする

### 2.2 この計画で正式サポート対象にする範囲

- 正式サポート対象:
  - iPhone Safari
  - iPad Safari
  - iOS/iPadOS の current major と previous major
  - 通常タブ起動
  - ホーム画面追加からの起動
- 初期リリースでは正式サポート対象外:
  - macOS Safari
  - プライベートブラウズ
  - iOS 上の Safari 以外のブラウザ

対象範囲をここで固定しないと、保存領域、ダウンロード UX、再現確認の条件がぶれ続けます。

加えて、current major / previous major の具体的な OS バージョンは Phase 0 で固定し、WebCodecs のサポート下限が iOS/iPadOS 16.4 であることを前提に export fallback の保証範囲も同時に確定します。previous major がこの下限を下回る場合、WebCodecs fallback は正式サポート要件に含めず、MediaRecorder 主経路の成功を必須にします。

## 3. 現状の未解決点

### 3.1 ユーザー向け制約がまだ残っている

- README は iPhone/iPad Safari をまだ「正式対応に向けて検証中」と案内している
- アプリ内 UI も「Apple Safari 検証モード」の文言を保持している
- 保存は Safari の通常タブ、ホーム画面追加、プライベートブラウズで領域が分かれる可能性を案内している
- ダウンロードは file picker ではなく共有メニューまたは標準ダウンロード導線に依存している

### 3.2 preview は workaround 依存が強い

- video + BGM の preview 安定性は改善済みだが、過去文書では先頭動画ケースの無音と実機未確認が残っている
- apple-safari preview は future video prewarm, AudioContext resume/retry, route reinitialize, caption blur fallback に依存している
- つまり Safari preview は単純経路で安定しているのではなく、Safari 専用ポリシーで成立している

### 3.3 export は Safari 固有 pipeline の強化余地が残る

- MediaRecorder profile 不可、live audio track 不在、construct/start 失敗時の fallback は実装済みだが、これは裏返すと Safari export が複数の代替経路に依存していることを意味する
- requestFrame ポンプ、keep-alive 微小音、visibility pause/resume も Safari 専用安定化処理である
- `exportSessionId`, `mediaRecorderProbe`, `audioSourceResolver` は追加済みで、失敗相関は追いやすくなった
- preview の AudioSession と export の AudioContext 利用契約がまだ暗黙であり、`preview 後すぐ export` シナリオでどの state を引き継ぐべきかが明文化されていない
- 実装は存在するが、どこまでを正式サポート対象として保証するかがまだ閉じていない

### 3.4 save/load は境界はあるが Safari 専用の耐障害化が未完了

- save runtime 境界は確保済みで、module import 時の即時 `configure*ProjectStore()` は撤去済みである
- `SaveRuntime` と `projectStore` に save health 契約を追加し、storage estimate, persist 結果, launch context, warnings を観測できるようになった
- `SaveLoadModal` には persistence mode, launch context, 推定使用量, warnings を表示する診断 UI を追加済みである
- `lastSaveFailure` には `operationId`, `persistenceMode`, `launchContext` を持たせたが、launch context の save metadata 保存や adapter contract の最終形は未確定である
- Safari の best-effort storage, proactive eviction, home screen 起動差異については、実機での durability 検証がまだ残っている

### 3.5 スコープ上の保留がまだ残っている

- macOS Safari を同じ flavor に含めるかが未確定
- Safari でどこまで機能 parity を求めるかが未確定
- 保存実装を shared IndexedDB のまま維持するか、apple-safari adapter を拡張するかが未確定

## 4. 外部仕様の前提

この計画は、既存コードだけでなく Web の一次情報も前提にします。

### 4.1 MediaRecorder

- `MediaRecorder.isTypeSupported()` により MIME type を実行時判定する必要がある
- `start(timeslice)` を使うと chunk 分割で `dataavailable` を受け取れる
- `requestData()`, `pause()`, `resume()`, `stop()` は正式 API であり、Safari の録画制御でも利用可能
- したがって apple-safari export では、UA 決め打ちではなく capability probe と録画 state machine を使うべきである

### 4.2 decodeAudioData

- `decodeAudioData()` は complete file data に対して非同期デコードする API であり、断片データを前提にしない
- デコード結果は `AudioContext` の sample rate に再サンプリングされる
- したがって Safari export の音声前処理は「完了したファイルを decode できるケース」と「video element 経由で抽出すべきケース」を明示的に分ける必要がある

#### 4.2.1 音声ソース分類の初期ルール

Phase 0 で次の初期分類表を成果物として固定し、Phase 1 で probe utility により実測結果を追加します。

| 入力種別 | 初期方針 | 備考 |
| --- | --- | --- |
| `video/*` または `.mov/.mp4/.m4v/.webm` の動画クリップ | `video element` 経由抽出を第一候補 | Safari では video container 音声の `decodeAudioData()` 成否が不安定なため |
| `audio/*` かつ `.mp3/.m4a/.aac/.wav/.flac/.ogg/.oga/.opus/.caf/.aif/.aiff` | `decodeAudioData()` probe を先行し、失敗時に fallback | complete file data を前提とする |
| MIME 不明、拡張子不明、または `decodeAudioData()` が `unknown content type` で失敗 | `HTMLMediaElement.canPlayType()` を併用した media element 経路へ降格 | element 経路も不可なら明示的に unsupported error |

この分類は hard-coded final answer ではなく、Phase 1 の probe 結果で補正します。

### 4.3 AudioContext.resume

- `resume()` は Promise を返し、closed 済みコンテキストでは失敗しうる
- よって Safari preview の AudioContext 復帰は同期処理として扱わず、再試行可能な非同期回復として扱う必要がある

#### 4.3.1 preview/export 間の AudioContext handoff 契約

Phase 2 の成果物として、preview と export の間で次の handoff 契約を明文化します。

- preview は export へ `AudioContext` を暗黙に渡さない
- preview 停止時または export 開始要求時に、`running | suspended | closed` の state と source node 所有状況を snapshot 化する
- export はその snapshot を見て「reuse 可能」「新規 export session を作るべき」「unsafe なので preview cleanup を待つ」の 3 択で判断する
- `keepAliveOscillator`, recorder clone track, export 用 `masterDest` は export 側の所有物として必ず teardown する
- Phase 3 の設計は、この contract を前提に coordinator を組む

### 4.4 iOS Safari の video policy

- 音声付き `video.play()` は user gesture に直接結びついていないと拒否されうる
- `playsinline` がない video は iPhone で fullscreen 強制になりうる
- muted または音声トラックなしの video は autoplay/play 条件が緩和される
- `play()` は Promise を返し、条件を満たさない場合に reject されうる
- したがって preview の動画 prime と再開は、user gesture credit を消費する順序と playsinline 前提を厳密に管理する必要がある

### 4.5 ブラウザ保存領域

- ブラウザ保存は基本的に origin 単位だが、private browsing は別挙動になりうる
- best-effort storage は quota 超過や eviction の対象になりうる
- Safari は積極的な eviction 条件を持つため、IndexedDB 保存は「書ければ永続」と仮定しない方が安全である
- `navigator.storage.estimate()` は推定値であり、精度に限界がある前提で扱うべきである
- `navigator.storage.persist()` は Safari/iOS Safari 15.2+ でサポートされるが、`false` は正常な戻り値であり、異常ではなく best-effort mode として扱うべきである
- よって `navigator.storage.estimate()` と `navigator.storage.persist()` は health signal ではあるが、単独で fail 判定に使わない

### 4.6 WebCodecs のサポート下限

- `VideoEncoder` と `VideoDecoder` は Safari / iOS Safari 16.4 以降が基準である
- したがって export の WebCodecs fallback は「current major / previous major が 16.4 以上」の場合だけ正式サポート経路に含める
- それ未満を support scope に含める場合は、WebCodecs fallback を補助経路として扱い、MediaRecorder 主経路の成功を必須にする

## 5. 完了条件

正式対応完了は、次のすべてを満たした時点と定義します。

| ID | 完了条件 | 判定方法 |
| --- | --- | --- |
| D1 | iPhone/iPad Safari で preview が主要シナリオすべて安定 | 実機テスト + regression test |
| D2 | iPhone/iPad Safari で export が主要シナリオすべて成功 | 実機テスト + 出力確認 |
| D3 | manual save, auto save, load, browser restart 後復元が安定 | 実機テスト + adapter test |
| D4 | hidden/visible, seek, stop/play, 連続 export で P0/P1 不具合がない | 実機テスト + targeted test |
| D5 | standard line にデグレがない | `npm run quality:gate` + flavor regression |
| D6 | 実機ゲート通過後に README と UI の「検証中」表記が正式対応へ更新されている | Docs/UI 更新 |
| D7 | 未サポート条件が明文化されている | README + help + plan |

## 6. 要件一覧

| # | 要件 | 優先度 | 説明 |
| --- | --- | --- | --- |
| R1 | runtime ownership 維持 | 必須 | Safari 修正は apple-safari 配下に閉じる |
| R2 | preview 安定化 | 必須 | video only, image only, video + BGM, narration, seek, visibility 復帰を正式サポートする |
| R3 | export 安定化 | 必須 | audio 付き MP4 export を主要シナリオで安定させる |
| R4 | save/load 耐障害化 | 必須 | save, load, restart 復元, quota/error handling を明示的に設計する |
| R5 | capability ベース導線 | 必須 | download/save action は capability probe で切り替える |
| R6 | observability 追加 | 必須 | Safari 実機で failure point を特定できる structured log を追加する |
| R7 | regression test 拡張 | 必須 | apple-safari flavor regression と save/export 周辺テストを拡張し、実機で得た再現パターンを可能な範囲で test 化する |
| R8 | standard 非デグレ | 必須 | standard line を shared workaround で汚染しない |
| R9 | support scope 固定 | 必須 | macOS Safari, private browsing, non-Safari iOS browser を明示的に扱う |
| R10 | support 表記更新 | 必須 | 完了後に README, help, appFlavorUi を正式対応表記へ更新する |
| R11 | release gate | 必須 | 実機 pass なしでは support status を切り替えない |
| R12 | fallback の明文化 | 推奨 | MediaRecorder, pre-render, save durability の fallback order をコードと Docs で一致させる |
| R13 | preview/export AudioContext 契約 | 必須 | preview 停止から export 開始までの AudioContext handoff を明文化する |

## 7. 変更境界

### 7.1 apple-safari preview で触る場所

- `src/flavors/apple-safari/appleSafariPreviewRuntime.ts`
- `src/flavors/apple-safari/preview/previewPlatform.ts`
- `src/flavors/apple-safari/preview/usePreviewEngine.ts`
- `src/flavors/apple-safari/preview/usePreviewAudioSession.ts`
- `src/flavors/apple-safari/preview/usePreviewSeekController.ts`
- 必要なら `src/flavors/apple-safari/preview/` 配下に AudioSession state machine 用の新規 module を追加

### 7.2 apple-safari export で触る場所

- `src/flavors/apple-safari/export/useExport.ts`
- `src/flavors/apple-safari/appleSafariExportRuntime.ts`
- `src/flavors/apple-safari/export/iosSafariMediaRecorder.ts`
- 必要なら `src/flavors/apple-safari/export/` 配下に capability probe, recorder session, artifact validation 用 module を追加
- shared の `src/hooks/useExport.ts` と `src/components/turtle-video/exportRuntime.ts` は `createUseExport()` contract/core 変更が必要な場合だけ触る

### 7.3 apple-safari save で触る場所

- `src/components/turtle-video/saveRuntime.ts`
- `src/flavors/apple-safari/appleSafariSaveRuntime.ts`
- `src/flavors/standard/standardSaveRuntime.ts`（初期化契約をそろえる必要がある場合のみ）
- `src/stores/projectPersistence.ts`
- `src/stores/projectStore.ts`
- `src/utils/indexedDB.ts`
- `src/utils/fileSave.ts`
- 必要なら Safari persistence health check 用 utility を追加

### 7.4 UI/help で触る場所

- `src/app/appFlavorUi.ts`
- `src/constants/sectionHelp.ts`
- `src/components/sections/PreviewSection.tsx`
- `src/components/modals/SaveLoadModal.tsx`
- `src/components/modals/SettingsModal.tsx`
- `README.md`

### 7.5 shared を触る時のルール

- shared contract を変える必要がある場合だけ変更する
- shared 変更時は standard と apple-safari の両 regression を必ず更新する
- `TurtleVideo.tsx` や shared UI に `isIosSafari` を戻さない

## 8. 実装計画

Phase 1 完了後は、次の 2 トラックを並行実行可能とします。

- Track A: Phase 2 → Phase 3
- Track B: Phase 4

Phase 5 は Track A と Track B の完了を待って開始します。これにより save と preview/export の責務を分離したまま、全体リードタイムを短縮します。

## Phase 0: サポート契約の凍結 (0.5日 - 1日)

**目標**: 正式サポート対象と未サポート対象を凍結し、以後の実装判断をぶらさない

**前提条件**: なし

タスク:
- [ ] iPhone/iPad Safari の対象 OS バージョンを current major と previous major に固定する
- [ ] previous major が WebCodecs 下限 (16.4) を満たすか確認し、export fallback の保証範囲を確定する
- [ ] macOS Safari を今回の正式サポート対象外に固定する
- [ ] private browsing を対象外に固定し、UI/Docs に明記する
- [ ] ホーム画面追加起動を正式サポートに含めるか、検証完了後に含めるかを決定する
- [ ] `ProjectPersistenceAdapter` を拡張するか、apple-safari 側の wrapper interface で吸収するかを決定する
- [ ] 旧 `spec.md` の未完了タスクを棚卸しし、新計画の Phase へ対応付ける
- [ ] `decodeAudioData` 対象素材と `video element` 抽出対象素材の初期分類表を確定する
- [ ] DoD, P0, P1 の定義を本書どおり確定する

**成果物**:
- 本書の確定版
- 旧 `spec.md` 未完了タスク対応表
- decode source classification table
- 必要に応じて `README.md` のサポート範囲案メモ

**完了条件**:
- [ ] 対象デバイスと対象起動形態が固定されている
- [ ] adapter 拡張方針と home screen 起動の扱いが決まっている
- [ ] 旧計画の残タスクが新計画のどこで扱われるか明文化されている
- [ ] 実装中に「どこまでやれば完了か」が議論不要になっている

---

## Phase 1: Safari 診断基盤の整備 (1日 - 2日)

**目標**: preview/export/save の failure point を Safari 実機で追えるようにする

**前提条件**: Phase 0 完了

タスク:
- [x] apple-safari preview に structured log ID を追加する
- [x] apple-safari export に probe result, chosen strategy, recorder state, chunk count, final blob size を残す
- [x] save/load に storage estimate, persist result, quota failure, adapter failure のログを追加する
- [x] `decodeAudioData` probe utility を追加し、MIME / extension / probe result の観測を可能にする
- [x] WebCodecs support floor を launch 時にログへ残し、fallback 可能性を明示する
- [x] `persist() === false` と `persist() unavailable` を異常ではなく capability result として記録する
- [x] Settings のログ export だけで再現調査に必要な情報が揃う形へ整える
- [ ] 既存 `scripts/dev/analyze-video.py` 系で export artifact を再確認できるフローを定義する

進捗メモ:
- `previewDiagnostics.ts`, `mediaRecorderProbe.ts`, `audioSourceResolver.ts`, `diagnostics.ts` を追加し、preview/export/save の相関 ID と probe 情報を導入済み
- `useExport.ts`, `iosSafariMediaRecorder.ts`, `usePreviewEngine.ts`, `usePreviewAudioSession.ts`, `usePreviewVisibilityLifecycle.ts`, `projectStore.ts` に診断ログを接続済み
- `decodeAudioProbe.ts`, `webCodecsSupport.ts` を追加し、decodeAudioData と WebCodecs fallback の可否をログ export で追跡可能にした

**対象ファイル**:
- `src/flavors/apple-safari/preview/**`
- `src/flavors/apple-safari/export/**`
- `src/flavors/apple-safari/appleSafariSaveRuntime.ts`
- `src/stores/logStore.ts`
- `Docs/` 配下の検証手順書

**自動確認**:
- [x] logging 周辺 test の追加または更新
- [x] `npm run test:run`
- [x] `npm run build`

**完了条件**:
- [ ] Safari 実機で preview/export/save の失敗箇所をログだけで特定できる
- [x] decodeAudioData / WebCodecs / persist の可否が実機ログで確認できる
- [ ] 失敗しても standard line に影響がない

---

## Phase 2: apple-safari preview 音声セッションの再設計 (2日 - 4日)

**目標**: video + BGM, image gap, seek, visibility 復帰を「偶然動く」ではなく state machine ベースで安定させる

**前提条件**: Phase 1 完了

タスク:
- [ ] apple-safari preview の AudioSession 状態を明示化する
- [ ] user gesture 内で許可される `play()` と、非同期復帰で許可される `resume()` の責務を分ける
- [ ] preview 停止時と export 開始要求時の AudioContext handoff contract を定義する
- [ ] `future video prewarm` の適用条件を state machine として固定する
- [ ] inactive video の pause/play 禁止条件を state machine に統合する
- [ ] `video + BGM`、`image -> video`、`video -> image -> video` を同じ規則で扱う
- [ ] visibility 復帰と seek 復帰の再開順序を明文化し、1本の経路に寄せる
- [ ] caption blur fallback の性能と描画品質を確認し、Safari 専用描画経路として固定する

**対象ファイル**:
- `src/flavors/apple-safari/preview/previewPlatform.ts`
- `src/flavors/apple-safari/preview/usePreviewAudioSession.ts`
- `src/flavors/apple-safari/preview/usePreviewEngine.ts`
- `src/flavors/apple-safari/preview/usePreviewSeekController.ts`
- 新規: `src/flavors/apple-safari/audioSessionContract.ts` など
- 新規: `src/flavors/apple-safari/preview/audioSessionState.ts` など

**自動確認**:
- [ ] `src/test/appleSafariFlavorRegression.test.ts` 拡張
- [ ] preview policy unit test 拡張
- [ ] `npm run test:run -- src/test/appleSafariFlavorRegression.test.ts`
- [ ] `npm run build`

**実機確認**:
- [ ] 動画のみ
- [ ] 画像のみ
- [ ] 動画 + BGM 先頭動画
- [ ] 画像開始後に BGM が先に鳴るケース
- [ ] video -> image -> video
- [ ] 途中 seek 復帰
- [ ] hidden -> visible 復帰
- [ ] stop -> play 再開

**完了条件**:
- [ ] 先頭動画 + BGM の無音再発がない
- [ ] image gap をまたいでも audio route が壊れない
- [ ] visibility 復帰後の無音が再現しない
- [ ] Phase 3 が参照できる AudioContext handoff contract が定義済みである
- [ ] preview 修正で standard runtime を変更していない

---

## Phase 3: apple-safari export pipeline の state machine 化 (2日 - 4日)

**目標**: MediaRecorder 主経路と fallback 経路を明示し、export 成否を deterministic にする

**前提条件**: Phase 2 完了

タスク:
- [ ] MediaRecorder capability probe を constructor/start/requestData まで含めて前段で明示化する
- [ ] Phase 2 の AudioContext handoff contract を export coordinator に取り込む
- [ ] `iosSafariMediaRecorder.ts` を coordinator と submodule に分け、track ownership, frame pump, chunk flush, visibility handling を責務分離する
- [ ] pre-rendered audio 経路と live audio clone 経路を明示的に分ける
- [ ] Phase 1 の probe utility を使い、`decodeAudioData` と `video element` 抽出の判定基準をコード化する
- [ ] WebCodecs fallback は support floor を満たす環境だけを正式経路として扱い、それ未満では best-effort または非保証経路として明示する
- [ ] recorder fail 時の WebCodecs fallback entry condition をログとテストで固定する
- [ ] export 終了条件を `blob size > 0`, `duration acceptable`, `audio present` の観点で検証可能にする

進捗メモ:
- `mediaRecorderProbe.ts` と `audioSourceResolver.ts` を先行実装し、`useExport.ts` と `iosSafariMediaRecorder.ts` に接続済み
- ただし export coordinator 分離、AudioContext handoff contract、artifact 検証は未着手である

**対象ファイル**:
- `src/flavors/apple-safari/export/useExport.ts`
- `src/flavors/apple-safari/export/iosSafariMediaRecorder.ts`
- `src/flavors/apple-safari/appleSafariExportRuntime.ts`
- `src/hooks/useExport.ts` または shared export core（`createUseExport()` contract 変更が必要な場合のみ）
- 新規: `src/flavors/apple-safari/export/mediaRecorderProbe.ts`
- 新規: `src/flavors/apple-safari/export/recorderSession.ts`
- 新規: `src/flavors/apple-safari/export/audioSourceResolver.ts`

**自動確認**:
- [ ] `src/test/appleSafariFlavorRegression.test.ts`
- [ ] `src/test/iosSafariMediaRecorder.test.ts`
- [ ] `src/test/useExport.test.ts`
- [ ] `src/test/exportRuntimeCapabilities.test.ts`
- [ ] `npm run test:run`
- [ ] `npm run build`

**実機確認**:
- [ ] 静止画 + BGM
- [ ] 動画のみ
- [ ] 動画 + BGM
- [ ] 動画 + narration
- [ ] video -> image
- [ ] image -> video
- [ ] 連続 2 回 export
- [ ] preview 後すぐ export

**完了条件**:
- [ ] 音声欠落、尺短縮、先頭フレーム混入が再現しない
- [ ] `preview 後すぐ export` が AudioContext state 競合なしで成功する
- [ ] failure 時は必ずどの経路で落ちたかログに残る
- [ ] fallback の順序がコードと Docs で一致している

---

## Phase 4: apple-safari save/load の耐久化 (1日 - 3日)

**目標**: Safari の storage 特性を前提に、save/load を「注意喚起のみ」から「観測・回復可能」へ引き上げる

**前提条件**: Phase 1 完了

**工数メモ**: Phase 0 で `ProjectPersistenceAdapter` の shared contract 拡張を選んだ場合は、standard 側のデフォルト実装と test 調整が増えるため、+0.5日 - 1日を見込む

タスク:
- [ ] Phase 0 の決定に従い、`ProjectPersistenceAdapter` 拡張または apple-safari 専用 wrapper のどちらかで health contract を実装する
- [x] `navigator.storage.estimate()` を利用して保存余地を観測する
- [x] `navigator.storage.persist()` を試行し、その結果を `persistent | best-effort | unavailable` として記録する
- [x] `persist() === false` を異常扱いせず、Safari の既知制約として UI と health check に反映する
- [x] QuotaExceeded, transaction failure, open failure を UI とログで区別する
- [x] save runtime のモジュールロード時即時 `configure*ProjectStore()` を見直し、lazy initialization または明示初期化パターンへ移行する
- [ ] Phase 0 でホーム画面追加を正式サポートに含めた場合は、save metadata に launch context を持たせ、通常タブ/ホーム画面追加の混在時に診断しやすくする
- [ ] Phase 0 でホーム画面追加を正式サポートに含めない場合は、standalone 起動を検出して非サポートまたは限定サポートの案内を出す
- [x] 起動時 save health check を追加し、明らかな save 不整合を UI に通知する
- [x] private browsing の場合は正式サポート対象外として明示する

進捗メモ:
- `SaveRuntime#getPersistenceHealth()` を追加し、apple-safari は実装、standard は `null` を返すデフォルト実装を持つ
- `TurtleVideo.tsx` で `configureProjectStore()` と `refreshSaveHealth()` を明示実行する形へ変更済み
- `SaveLoadModal` で save health の取得結果とエラーを表示できるようにした

**対象ファイル**:
- `src/components/turtle-video/saveRuntime.ts`
- `src/flavors/apple-safari/appleSafariSaveRuntime.ts`
- `src/flavors/standard/standardSaveRuntime.ts`（初期化契約をそろえる場合）
- `src/stores/projectPersistence.ts`
- `src/stores/projectStore.ts`
- `src/utils/indexedDB.ts`
- 新規: `src/flavors/apple-safari/save/persistenceHealth.ts`

**自動確認**:
- [x] `src/test/stores/projectStoreSave.test.ts`
- [x] `src/test/saveRuntimeIsolation.test.ts`
- [x] quota/error path の test 追加
- [x] `npm run test:run`
- [x] `npm run build`

**実機確認**:
- [ ] manual save -> load 同一タブ
- [ ] auto save -> reload 復元
- [ ] browser 完全再起動後の復元
- [ ] ホーム画面追加起動での save/load（Phase 0 で正式サポートに含めた場合）
- [ ] 保存失敗時の recovery message

**完了条件**:
- [ ] save/load failure が silent failure にならない
- [ ] 通常運用の save/load が再現性を持って成功する
- [x] import 順序や test 環境によって adapter 設定が壊れない
- [x] private browsing は対象外として明確に扱われる

---

## Phase 5: export 後の保存導線と UX の確定 (1日 - 2日)

**目標**: export 完了後にユーザーが迷わず成果物を取得できるようにする

**前提条件**: Phase 3 と Phase 4 完了

タスク:
- [ ] Safari で利用可能な保存導線を capability ベースで整理する
- [ ] export 後の primary action を Safari 向けに最適化する
- [ ] completion message を「作成完了」だけでなく「次に何を押すか」が分かる形へ変更する
- [ ] ダウンロードできなかった場合の retry path を追加する
- [ ] 保存導線の説明を PreviewSection と SaveLoadModal と help で一致させる

**対象ファイル**:
- `src/utils/fileSave.ts`
- `src/app/appFlavorUi.ts`
- `src/components/sections/PreviewSection.tsx`
- `src/components/modals/SaveLoadModal.tsx`

**自動確認**:
- [ ] `src/test/fileSave.test.ts`
- [ ] `src/test/previewSectionActionButtons.test.tsx`
- [ ] `src/test/modalHistoryStability.test.tsx`

**実機確認**:
- [ ] 通常タブから export -> 保存導線
- [ ] ホーム画面追加起動から export -> 保存導線（Phase 0 で正式サポートに含めた場合）
- [ ] retry 導線

**完了条件**:
- [ ] Safari ユーザーが export 後に迷わない
- [ ] completion UI と実際の保存導線が一致している

---

## Phase 6: 自動テストと品質ゲートの強化 (1日 - 2日)

**目標**: Safari 修正を将来の変更で壊しにくい状態にする

**前提条件**: Phase 5 完了

タスク:
- [ ] apple-safari regression に preview/export/save の受け入れ観点を追加する
- [ ] save runtime, export fallback, visibility recovery, quota handling の unit test を追加する
- [ ] 既存 test suite を優先的に拡張し、重複した Safari 専用 test file を増やしすぎない
- [ ] export artifact の簡易自動検証フローを scripts/dev に追加する
- [ ] `quality:gate` の通過を release blocker にする

進捗メモ:
- save runtime 境界、save health、export audio source resolver については回帰テストを前倒しで追加済み
- 2026-04-14 時点で `npm run quality:gate` は通過済みだが、Phase 6 完了とは見なさず、今後の追加実装後も継続確認する

**対象ファイル**:
- `src/test/appleSafariFlavorRegression.test.ts`
- `src/test/stores/projectStoreSave.test.ts`
- `src/test/usePreventUnload.test.tsx` ほか関連 test
- `scripts/dev/**`

**完了条件**:
- [ ] `npm run quality:gate` が安定通過する
- [ ] Safari regression の主要観点が自動検知できる

---

## Phase 7: 実機受け入れとテスト反復 (2日 - 3日)

**目標**: 実機確認で問題を洗い出し、可能な範囲で自動テストへ還元しながら受け入れを完了させる

**前提条件**: Phase 6 完了

タスク:
- [ ] iPhone current major で全シナリオ実行
- [ ] iPhone previous major で全シナリオ実行
- [ ] iPad で全シナリオ実行
- [ ] 通常タブとホーム画面追加の両方で save/export を確認する（Phase 0 で正式サポートに含めた場合）
- [ ] 連続利用時の save durability と export 再実行を確認する
- [ ] 実機で見つかった再現パターンを可能な範囲で unit/integration test へ反映する
- [ ] フィードバック反映のたびに `npm run quality:gate` を再実行する
- [ ] P0/P1 残件を 0 にする


**リリースゲート**:
- [ ] D1-D5 と D7 を満たす
- [ ] P0 なし
- [ ] P1 なし
- [ ] standard regression pass

**完了条件**:
- [ ] 実機結果と自動テストの間に明確なギャップが残っていない
- [ ] 正式対応可否の判定に必要な実機根拠がそろう

---

## Phase 8: サポート表記更新とリリース判定 (0.5日 - 1日)

**目標**: 実機ゲート通過後にのみ support status を切り替え、正式リリース可否を確定する

**前提条件**: Phase 7 完了

タスク:
- [ ] `appFlavorUi.ts` の Safari 文言を正式対応用に切り替える
- [ ] `sectionHelp.ts` の Safari 向け文言を更新する
- [ ] `README.md` の Safari 記述を更新する
- [ ] 未サポート条件を README とアプリ内ヘルプの両方へ明記する
- [ ] Settings または help 内に「サポート範囲」を出す

**リリースゲート**:
- [ ] D1-D7 を満たす
- [ ] P0 なし
- [ ] P1 なし
- [ ] standard regression pass
- [ ] README/help 更新済み

**完了条件**:
- [ ] 「正式対応」と宣言できるだけの根拠が揃う
- [ ] 「検証中」の表記変更を rollback せずに済む
- [ ] 残課題がある場合は正式対応を延期し、その理由を明文化する

## 9. 実機テストマトリクス

| 領域 | シナリオ | 判定 |
| --- | --- | --- |
| Preview | 動画のみ | 映像/音声ともに正常 |
| Preview | 画像のみ | 黒画面・停止なし |
| Preview | 動画 + BGM | 両方が継続再生 |
| Preview | 動画 + narration | narration が欠落しない |
| Preview | video -> image -> video | 音切れ・無音・黒画面なし |
| Preview | 先頭動画 + BGM | 初回再生時に無音化しない |
| Preview | hidden -> visible | 復帰後に音が出る |
| Preview | seek | 再開位置と音声が一致 |
| Export | 動画のみ | 尺と音声が正しい |
| Export | 静止画 + BGM | BGM が出る |
| Export | 動画 + BGM | 両音声が保持される |
| Export | narration あり | narration が欠落しない |
| Export | 連続 2 回 | 2 回目も成功 |
| Save | manual save/load | 同一内容に復元 |
| Save | auto save/reload | 最新状態が復元 |
| Save | browser restart | 復元可能 |
| Save | home screen launch | Phase 0 で正式サポートに含めた場合のみ復元可能。含めない場合は非サポート表示 |
| Download | export 後導線 | ユーザーが保存に成功できる |

## 10. リスクと対策

| リスク | 影響 | 対策 |
| --- | --- | --- |
| Safari の user gesture 制約 | preview 再開失敗 | preview state machine で `play()` と `resume()` の責務を分ける |
| MediaRecorder の挙動差 | export 失敗 | capability probe と fallback order を明示する |
| preview/export の AudioContext 契約不備 | preview 後 export 失敗 | Phase 2 で handoff contract を定義し、Phase 3 で coordinator に反映する |
| best-effort storage eviction | save 消失 | estimate/persist, health check, recovery messaging を追加する |
| `persist()` が false を返す | 誤警告 | `false` を best-effort mode として扱い、異常扱いしない |
| save runtime の即時初期化 side effect | test/import 順序破綻 | Phase 4 で lazy initialization または明示初期化へ移行する |
| private browsing 差異 | 保存保証不可 | 正式サポート対象外にし、UI で明示する |
| WebCodecs 下限未満の OS を含める | fallback 設計破綻 | Phase 0 で support floor を固定し、保証経路を切り分ける |
| shared 側への逆流 | standard デグレ | change boundary を phase ごとに固定し、regression test を必須化する |
| 実機不足 | 完了判定不可 | current/previous major の iPhone + iPad を release gate に含める |

## 11. 推奨実行順

優先度は次の順です。

1. Phase 0 と Phase 1 で、完了条件と診断基盤を先に固定する
2. Phase 1 完了後、Track A と Track B を並行で進める
3. Track A では Phase 2 で preview を閉じ、Phase 3 で export を閉じる
4. Track B では Phase 4 で save/load を閉じる
5. Track A と Track B の完了後に Phase 5 で download UX を閉じる
6. Phase 6 で quality gate を強化する
7. Phase 7 で実機受け入れと test 反復を行う
8. Phase 8 で最後に表記を更新して正式対応へ切り替える

この順番により、save と preview/export の責務分離を維持したまま、全体のリードタイムを短縮できます。

## 12. 旧 `spec.md` 未完了タスクとの対応

旧 `spec.md` に残っている未完了タスクは drop しません。新計画では次のように吸収します。

| 旧 `spec.md` の未完了タスク | 新計画での扱い |
| --- | --- |
| `renderFrame` から export 専用制御を切り離す | Phase 2 で preview AudioSession/state ownership を整理し、Phase 3 で export coordinator 側へ明示的に移す |
| 標準 WebCodecs 経路を strategy 化する | apple-safari 完了対応の blocker ではないため、Phase 0 で「今回やるか別件化するか」を明示決定する。shared `createUseExport()` 契約変更が必要なら Phase 3 に含める |
| 正式対応表記へ更新 | Phase 8 へ移動し、実機ゲート通過後にのみ実施する |

## 13. 今回の計画で明示的にやらないこと

- macOS Safari を同時に正式サポート化すること
- standard runtime に Safari workaround を戻すこと
- shared UI に platform 判定を戻すこと
- private browsing の保存耐久性を正式保証すること
- 100% コード複製で別アプリ化すること

## 14. 参照資料

### リポジトリ内

- `Docs/reports/2026-03-11_report_ios.md`
- `Docs/handovers/handover-ios-preview-video-bgm-2026-03-13.md`
- `Docs/reports/ios-safari-audio-export-fix-report.md`
- `Docs/specs/2026-04-12_プラットフォーム分離再設計方針.md`
- `Docs/architecture/2026-04-12_プラットフォーム分離構造概要.md`
- `spec.md`

### Web 参照

- MDN: MediaRecorder
  - https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder
- MDN: BaseAudioContext.decodeAudioData
  - https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/decodeAudioData
- MDN: AudioContext.resume
  - https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/resume
- MDN: Storage quotas and eviction criteria
  - https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria
- MDN: StorageManager.persist
  - https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist
- MDN: VideoEncoder
  - https://developer.mozilla.org/en-US/docs/Web/API/VideoEncoder
- MDN: VideoDecoder
  - https://developer.mozilla.org/en-US/docs/Web/API/VideoDecoder
- WebKit Blog: New video policies for iOS
  - https://webkit.org/blog/6784/new-video-policies-for-ios/

## 15. 最終判断

この計画どおりに進めれば、iPhone/iPad Safari 対応に終止符を打つことは可能です。

ただし、最後の 1 歩はコードではなく実機受け入れです。そこを release gate に含めない限り、Safari 対応はまた「改善したが正式対応とは言い切れない」状態に戻ります。

したがって、この計画の最重要ポイントは次の 2 つです。

- Safari 修正を apple-safari runtime の責務として閉じること
- 実機 pass をもって正式対応へ切り替えること
