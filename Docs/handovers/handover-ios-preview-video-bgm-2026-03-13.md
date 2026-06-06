# iOS preview: 動画+BGM 無音ハンドオーバー

## 1. ユーザー報告の現況

- 端末: iPhone / Safari
- 事象:
  - `画像 + BGM` は preview で正常
  - `動画 + BGM` は preview で不安定
  - 「先に BGM が鳴る状態」では BGM 側が優先されやすい
  - 「先頭が動画」のときは無音になりやすい

## 2. 再現マトリクス

| ケース | 結果 |
| --- | --- |
| 画像 + BGM | 正常 |
| 動画 + BGM、先頭クリップが動画 | 無音になりやすい |
| 画像開始後に BGM が先に鳴り、その後動画音声が入る | BGM 優先になりやすい |

## 3. ここまでの修正履歴

### 3.1 既存の iOS preview 音声方針

- `src/utils/previewPlatform.ts`
  - iOS Safari preview は「単一音源かつ音量 1 倍」のときだけ native fallback
  - それ以外は WebAudio mix

### 3.2 今回までに入っている対策

- `src/components/TurtleVideo.tsx`
  - preview 開始前に、当該時刻で可聴な動画音声 / BGM / ナレーションを収集
  - `getPreviewAudioRoutingPlan()` で出力モードを先に確定
  - WebAudio が必要な候補だけ `ensureAudioNodeForElement()` で node を先行作成
  - iOS preview 専用に route 再初期化を実行
  - 再生途中で新しい WebAudio node が初回作成された場合も、一度だけ route 再初期化

## 4. 今回新たに切り分けた仮説

### 仮説A: `startEngine()` の動画先行ウォームアップが iOS で悪さをしている

- `src/components/TurtleVideo.tsx` には preview 開始時に active video だけ先に `videoEl.play()` するウォームアップがある
- この処理は「先頭が動画」のときだけ走る
- 一方で BGM は同じタイミングでは prime されず、後段の loop / renderFrame 側に任される
- そのため iOS Safari では
  - 先頭動画が native / autoplay / route の主導権を先に取り
  - 後から BGM 側が WebAudio へ入ろうとして競合
  - 結果として無音、または BGM 優先になっている可能性が高い

## 5. 今回追加した修正

- `src/components/TurtleVideo.tsx`
  - preview 開始位置で `preparePreviewAudioNodesForTime(fromTime)` が `true` になる
    - つまり「iOS preview で WebAudio mix が必要」と判断された場合は
    - 先頭動画だけを単独 `play()` するウォームアップをスキップ
- 期待効果:
  - `動画が先頭` のケースだけ発火していた先行 native 再生を止め、動画+BGM を同一の WebAudio 初期化後に揃える

## 6. まだ残る確認ポイント

- 実機未確認
  - この文書作成時点では iPhone Safari 実機での再検証は未実施
- もしまだ不具合が残る場合の次候補:
  - `HTMLMediaElement.play()` の失敗を現在ほぼ握り潰しているので、iOS preview だけ一時的に失敗ログを詳細化する
  - `startEngine()` で active video だけでなく BGM / narration も同一条件で prime するか検討する
  - `handleMediaRefAssign` で media element 再生成時に Source/Gain 再構築がずれていないかを追う
  - `videoEl.play()` と `applyPreviewAudioOutputState()` の順序を見直し、iOS preview では native mute を先に確定してから play する案を検証する

## 7. 関連ファイル

- `src/components/TurtleVideo.tsx`
- `src/utils/previewPlatform.ts`
- `src/test/previewPlatform.test.ts`
- `.agents/skills/turtle-video-overview/references/ios-preview-audio-prewarm-2026-03-13.md`
- `Docs/reports/ios-safari-audio-export-fix-report.md`

## 8. 検証状況

- 実行済み:
  - `npm.cmd run test:run -- src/test/previewPlatform.test.ts src/test/previewSectionActionButtons.test.tsx src/test/useExport.test.ts src/test/exportStrategyResolver.test.ts`
  - `npm.cmd run build`
- 結果:
  - テスト 35 件通過
  - build 成功
- 注意:
  - これはローカル自動検証のみで、iPhone Safari 実機確認は含まない
