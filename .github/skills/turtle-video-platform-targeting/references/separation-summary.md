# Separation Summary

## 要点

- App 入口で `resolveAppFlavor()` を 1 回だけ評価し、`standard` / `apple-safari` を切り替える
- active runtime の preview / export / save ownership は flavor ごとに分かれている
- UI / Help は `appFlavor` と flavor-aware helper で出し分ける
- shared に残しているのは schema、contract、pure utility、共通 UI、shared quality strategy

## 「完全分離」の定義

このプロジェクトでいう完全分離は、`standard` と `apple-safari` が runtime ownership を共有しない状態を指す。コードをすべて複製する意味ではない。

次を満たす状態を完了とみなす。

- standard 修正で apple-safari runtime を直接触らなくてよい
- apple-safari 修正で standard runtime を直接触らなくてよい
- shared contract を変えたときだけ両 flavor に影響確認が必要

## 詳細ドキュメント

- `Docs/2026-04-12_プラットフォーム分離構造概要.md`
- `Docs/2026-04-12_プラットフォーム分離再設計方針.md`
