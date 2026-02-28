# GitHub Issue 運用ガイド（CLI + テンプレート）

このリポジトリでは、次の2系統でIssue運用できます。

1. リポジトリ単位の Issue Form（`.github/ISSUE_TEMPLATE/*.yml`）
2. CLIによる構造化Issue作成（`npm run issue:create`）

## 1. Issue Form（日本語）

設定済みフォーム:

- `01-bug-report.yml`
- `02-feature-request.yml`
- `03-documentation.yml`
- `04-maintenance.yml`

テンプレート設定:

- `.github/ISSUE_TEMPLATE/config.yml`
- `blank_issues_enabled: false`（空Issueを禁止）

## 2. CLIで概要からIssue作成

対話式:

```powershell
npm run issue:create
```

このコマンドは以下を対話で受け取り、構造化本文を自動生成して `gh issue create` を実行します。

- 種別（バグ / 改善 / ドキュメント / メンテ）
- 概要
- 手順、背景、受け入れ条件など

## 3. 非対話の例

内容確認のみ:

```powershell
npm run issue:create -- --type バグ --summary "iOSで書き出し失敗" --dry-run
```

Issue作成（追加ラベル付き）:

```powershell
npm run issue:create -- --type 改善 --summary "タイムライン吸着を追加" --labels "ui,priority:high"
```

別リポジトリへ作成:

```powershell
npm run issue:create -- --type docs --summary "セットアップ手順を更新" --repo owner/repo
```

## 4. 他リポジトリへ展開（Agent Skill）

Issue専門スキル:

- `.github/skills/issue-specialist/SKILL.md`

テンプレート + CLI を他リポジトリへ導入:

```powershell
node .github/skills/issue-specialist/scripts/setup-issue-specialist.mjs --target "C:\path\repo" --with-cli
```

## 5. 前提

- GitHub CLI（`gh`）の導入と認証が必要
- 導入: https://cli.github.com/
- 補足: このリポジトリでは `scripts/create-github-issue.mjs` が `PATH` 上の `gh` を優先し、見つからない場合は `.tools/gh/bin/gh.exe` を自動で利用します（Windows）
- 認証例:

```powershell
gh auth login
```

## 6. トークンについて

Issue 作成には認証が必要です。未認証だと `gh issue create` は失敗します。

- 対話ログイン: `gh auth login`（推奨）
- トークン利用: `GH_TOKEN` 環境変数を設定

必要な権限の目安:

- 公開リポジトリ（Classic PAT）: `public_repo`
- 非公開リポジトリ（Classic PAT）: `repo`
- Fine-grained PAT: 対象リポジトリの `Issues: Read and write`

補足:

- 環境によっては `read:org` も要求されるため、Classic PAT では `repo + read:org`（公開のみなら `public_repo + read:org`）での発行を推奨

## 7. ポータブル運用（最短手順）

`gh` をシステムインストールせず、このリポジトリ同梱の `.tools/gh/bin/gh.exe` を使う手順です。

### 7.1 最短ログイン（対話）

```powershell
cd C:\git_home\turtle-video
$env:GH_CONFIG_DIR="$PWD\.tools\gh\config"
.\.tools\gh\bin\gh.exe auth login --hostname github.com
```

### 7.2 認証確認

```powershell
.\.tools\gh\bin\gh.exe auth status
```

### 7.3 Issue作成

```powershell
# 内容確認のみ
npm run issue:create -- --type docs --summary "手順確認" --dry-run

# 実作成
npm run issue:create -- --type docs --summary "手順確認"
```

### 7.4 毎回短く打つ（任意）

```powershell
cd C:\git_home\turtle-video
function gh { & "$PWD\.tools\gh\bin\gh.exe" @args }
gh auth status
```
