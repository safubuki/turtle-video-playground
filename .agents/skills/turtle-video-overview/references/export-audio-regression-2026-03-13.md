# PC エクスポート無音回帰メモ

## 概要

- 発生日: 2026-03-13
- 対象: `src/hooks/useExport.ts`, `src/hooks/export-strategies/exportStrategyResolver.ts`
- 症状: PC でエクスポートした動画が無音になる

## 原因

- Safari 向け処理の切り分けで `OfflineAudioContext` の事前音声レンダリング条件を `isIosSafari && hasAudioSources` に狭めた
- その結果、PC/Android が `TrackProcessor` / `ScriptProcessor` のリアルタイム音声キャプチャへ戻り、PC で無音動画が再発した

## 対応方針

- `shouldUseOfflineAudioPreRender()` は `hasAudioSources` のみで判定し、音声ソースがある限り全環境で `OfflineAudioContext` を優先する
- `offlineAudioDone=true` のときは既存どおり TrackProcessor 音声キャプチャを走らせず、二重エンコードを防ぐ
- UI の `preparing` 表示は音声専用文言にせず、`書き出しを準備中...` のような汎用表現にする

## 教訓

- Safari 専用の見え方の違和感と、共有している non-iOS 音声経路の実装は分離して扱う
- 既存の PC/Android 回避策を戻すときは、エクスポート音声の回帰確認を必須にする
