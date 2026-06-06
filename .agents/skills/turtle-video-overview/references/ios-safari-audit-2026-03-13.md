# iOS Safari 分岐監査メモ

## 対象

- `src/utils/platform.ts`
- `src/utils/previewPlatform.ts`
- `src/hooks/useExport.ts`
- `src/hooks/export-strategies/exportStrategyResolver.ts`
- `src/hooks/export-strategies/iosSafariMediaRecorder.ts`
- `src/components/TurtleVideo.tsx`
- `src/components/common/ClipThumbnail.tsx`
- `src/components/ReloadPrompt.tsx`
- `src/components/sections/BgmSection.tsx`
- `src/components/sections/NarrationSection.tsx`
- `src/utils/fileSave.ts`
- `src/components/modals/SaveLoadModal.tsx`

## 確認結果

- Safari 判定の基点は `platform.ts` に集約されている
- preview / export の主要な Safari 差分は `previewPlatform.ts` と export strategy に寄っている
- BGM / ナレーションの `accept` は `getAudioUploadAccept()` 経由で共通化されている
- 動画 / 音声の保存導線は `fileSave.ts` 経由が主経路で、`showSaveFilePicker` の capability 判定も共通化されている
- `ClipThumbnail.tsx` と `ReloadPrompt.tsx` には Safari 固有ワークアラウンドが残るが、どちらも局所的で専用テストがある

## 今回修正した予防点

- `shouldUseOfflineAudioPreRender()` から未使用の `isIosSafari` 引数を削除した
- 実装が全環境向けに変わっているのに API だけ Safari 専用に見える状態を解消し、誤読による再回帰を防いだ

## 残留リスク

- `captureCanvasAsImage()` と設定ログ書き出しは `fileSave.ts` を使わず anchor download を直接使っている
- いずれも現時点で Safari 専用分岐の混在ではないが、将来ダウンロード導線を調整するときの漏れポイントにはなり得る

## 運用メモ

- Safari 専用調整を加えるときは、まず `platform.ts` / `previewPlatform.ts` / export strategy に寄せる
- non-iOS 共有経路の回避策を変更した場合は、PC Edge と Android Chrome の export を最低限確認する
