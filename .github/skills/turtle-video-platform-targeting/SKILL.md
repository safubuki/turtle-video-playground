---
name: turtle-video-platform-targeting
description: Turtle Video で Android/PC 向けと iPhone/iPad Safari 向けの変更を正しい flavor 境界へ振り分けるスキル。`standard` と `apple-safari` のどちらを触るべきかを判定し、preview・export・save・UI/help・shared schema の影響範囲を整理して安全に修正する。「Android向けに対応して」「iphone向けに対応して」「iPhone向けに対応して」「Safari向けに修正」「standard flavor を直して」「apple-safari flavor を修正」「PC向け対応」「モバイルSafari対応」「platform別に対応」「flavorごとに修正」などで発火。
---

# Turtle Video Platform Targeting Skill

## スキル読み込み通知

このスキルが読み込まれたら、必ず以下の通知をユーザーに表示してください：

> 💡 **Turtle Video Platform Targeting スキルを読み込みました**  
> Turtle Video の platform 指定依頼を `standard` / `apple-safari` の正しい境界へ振り分けます。

## When to Use

- 「Android向けに対応して」「PC向けに直して」のように standard line を対象にした変更依頼が来たとき
- 「iphone向けに対応して」「Safari向けに修正して」のように apple-safari line を対象にした変更依頼が来たとき
- preview / export / save / UI-help のどこを触るべきか切り分けたいとき
- shared utility や schema を触るべきか、それとも flavor-owned runtime 内で閉じるべきか判断したいとき
- 片側の修正で他方へデグレを入れないように進めたいとき

## 概要

このスキルは、Turtle Video の platform 指定依頼を runtime ownership の境界に沿って処理するためのワークフローです。Android / PC は `standard`、iPhone / iPad Safari は `apple-safari` として扱い、preview・export・save・UI/help・shared schema のどこを触るべきかを先に整理してから修正します。

## 手順

### Step 1: Target Flavor を確定する

- `Android` / `PC` / `標準` / `standard` は `standard` flavor として扱う
- `iPhone` / `iPad Safari` / `Safari` / `apple-safari` は `apple-safari` flavor として扱う
- 「iPhone 向け」だけで Safari 以外も含む可能性がある場合は、必要に応じて確認する
- 両系統に効く変更でない限り、shared 側を先に触らない

詳細な対応表は [references/platform-routing.md](references/platform-routing.md) を参照する。

### Step 2: 触る境界を決める

- preview の変更なら、まず対象 flavor の preview runtime と preview modules を確認する
- export の変更なら、対象 flavor の export runtime と strategy order を確認する
- save / load の変更なら、対象 flavor の save runtime と shared persistence adapter のどちらを触るか整理する
- UI / help の変更なら、`appFlavorUi` と flavor-aware help を優先し、shared component への platform 直判定を増やさない
- shared schema や共通 utility の変更は、両 flavor に効くと判断できる場合だけ行う

主な変更対象ファイルは [references/platform-routing.md](references/platform-routing.md) にまとめる。

### Step 3: Flavor-owned boundary を守って実装する

- `standard` 専用修正は `src/flavors/standard/` 配下を優先する
- `apple-safari` 専用修正は `src/flavors/apple-safari/` 配下を優先する
- `TurtleVideo.tsx` や shared UI に platform workaround を戻さない
- `isIosSafari` のような platform 直判定を shared UI / shared runtime に再導入しない
- save 実装差が不要なら shared schema を維持し、runtime 側の注入境界だけ使う

構造の根拠は [references/separation-summary.md](references/separation-summary.md) を参照する。

### Step 4: 対応する回帰テストを更新する

- `standard` 側だけの変更なら standard flavor regression を確認する
- `apple-safari` 側だけの変更なら apple-safari flavor regression を確認する
- shared schema / shared utility を触ったら両 flavor regression と save round-trip を確認する
- 影響に応じて isolation / capability tests も追加または更新する

確認観点は [references/verification-checklist.md](references/verification-checklist.md) を参照する。

### Step 5: 変更内容を報告する

- どの flavor を対象にしたか
- shared へ波及したかどうか
- どの boundary を変更したか
- どの回帰テストで固定したか
- 追加で実機確認が必要かどうか

## 参照ドキュメント

- [references/platform-routing.md](references/platform-routing.md) — platform 指定から flavor / 境界 / 主対象ファイルを引くための対応表
- [references/verification-checklist.md](references/verification-checklist.md) — 変更種別ごとの最小確認手順
- [references/separation-summary.md](references/separation-summary.md) — 今回の分離構造の要点と「完全分離」の定義
- [../turtle-video-overview/references/project-details.md](../turtle-video-overview/references/project-details.md) — プロジェクト全体像と主要ディレクトリ
- [../turtle-video-overview/references/implementation-patterns.md](../turtle-video-overview/references/implementation-patterns.md) — 既存の実装パターンと注意点
- [../../../Docs/2026-04-12_プラットフォーム分離再設計方針.md](../../../Docs/2026-04-12_プラットフォーム分離再設計方針.md) — 分離再設計のフェーズ計画と受け入れ条件