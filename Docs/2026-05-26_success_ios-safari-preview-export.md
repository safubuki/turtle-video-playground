# 2026-05-26 Success: iOS Safari Preview And Export

## Status

2026-05-26 時点で、iOS Safari でもプレビューとエクスポートが成功する状態を確認済み。

成功条件は次の通り。

- iOS Safari でプレビュー再生が崩れない。
- iOS Safari でエクスポート完了後、青い「作成中」状態に残らず、緑のダウンロードボタンへ遷移する。
- 緑のダウンロードボタンは、Blob URL と拡張子が確定し、保存可能な Blob サイズが確認できてから表示する。
- Android と PC の標準 WebCodecs ルート、Android のプレビューキャッシュには影響させない。

## Current iOS Safari Export Flow

1. `src/flavors/apple-safari/AppleSafariApp.tsx` が Apple Safari runtime を `TurtleVideo` に渡す。
2. `src/flavors/apple-safari/export/useExport.ts` が iOS Safari 用の export runtime を作る。
3. `src/hooks/useExport.ts` が iOS Safari では `ios-safari-mediarecorder` strategy を優先する。
4. `src/flavors/apple-safari/export/iosSafariMediaRecorder.ts` が MediaRecorder でチャンクを蓄積する。
5. `src/components/TurtleVideo.tsx` は main export hook から返る `recorderRef` を `previewRuntime.usePreviewEngine()` に渡す。
6. export 再生が自然終端に達すると、iOS Safari preview engine がその `recorderRef.current` に対して `requestData()` と `stop()` を実行する。
7. MediaRecorder の `onstop` で Blob を組み立て、Blob URL と拡張子、`blobSizeBytes`、`signalAborted` を `useExport` へ通知する。
8. `useExport` は `url`、`ext`、正の `blobSizeBytes`、自然終端または非 abort を確認してから UI callback を通す。
9. UI store の `exportUrl` / `exportExt` が設定され、`isProcessing` が false になり、`PreviewSection` が緑のダウンロードボタンを表示する。

## Critical Fix Point

今回の最重要点は `recorderRef` の配線。

`TurtleVideo` 内で独自に作った空の `recorderRef` を preview engine に渡すと、iOS Safari の自然終了時に実際の MediaRecorder を停止できない。その場合、Blob URL が UI へ届かず、ボタンは青い「作成中」のまま残る。

必ず main export hook の戻り値を使う。

```ts
const {
  recorderRef,
  startExport: startWebCodecsExport,
  stopExport: stopWebCodecsExport,
  completeExport: completeWebCodecsExport,
} = exportRuntime.useExport();
```

この `recorderRef` を `previewRuntime.usePreviewEngine({ recorderRef, ... })` に渡す。

Android プレビューキャッシュ用の 2 回目の `exportRuntime.useExport()` から返る ref と取り違えないこと。

## Guard Rails

- `ExportRecordingResult` の `blobSizeBytes` が正でない場合、ダウンロードボタンを出さない。
- `signalAborted === true` のユーザー停止結果は、Blob が来ても通常は UI callback を通さない。
- 自然終端または MediaRecorder 側で非 abort が確認できる場合だけ、古い cancel state から復旧して UI callback を通す。
- iOS Safari preview の表示品質を守るため、preview 再生ロジックそのものには不要な変更を入れない。
- Android の preview cache は別の export hook を使う。iOS Safari export 完了処理と混線させない。

## Regression Tests

この成功状態を守る主なテスト。

- `src/test/turtleVideoExportWiring.test.tsx`
  - main export hook の `recorderRef` が preview engine に渡ることを確認する。
  - preview cache export hook の `recorderRef` と取り違えないことを確認する。
- `src/test/useExport.test.ts`
  - Blob URL、拡張子、Blob サイズ、abort 状態に基づく UI callback 制御を確認する。
- `src/test/iosSafariMediaRecorder.test.ts`
  - iOS Safari MediaRecorder strategy の completion metadata を確認する。
- `src/test/previewSectionActionButtons.test.tsx`
  - `exportUrl` があり `isProcessing === false` の時だけ download ボタンを表示することを確認する。
- `src/test/appleSafariPreviewEngineBoundary.test.tsx`
  - iOS Safari preview engine の終端処理と boundary behavior を確認する。

## Recovery Checklist

iOS Safari で再び緑のダウンロードボタンが出なくなった場合は、次の順に確認する。

1. `TurtleVideo` が main export hook の `recorderRef` を preview engine に渡しているか。
2. 自然終端時に `recorderRef.current.requestData()` と `recorderRef.current.stop()` が呼ばれるか。
3. `iosSafariMediaRecorder.ts` の `onstop` が Blob URL を作成しているか。
4. `blobSizeBytes > 0` が通知されているか。
5. `signalAborted` が自然終了なのに true になっていないか。
6. `useExport` の completion guard が UI callback を抑止していないか。
7. UI store に `exportUrl` と `exportExt` が設定され、`isProcessing` が false に戻っているか。
8. `PreviewSection` が `exportUrl && !isProcessing` の download 状態に入っているか。

## Related Overview

- `.agents/skills/turtle-video-overview/references/implementation-patterns.md`
- Section: `0-13. iOS Safari export completion UI trusts only confirmed downloadable results`
