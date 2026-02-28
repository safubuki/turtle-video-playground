# 開発者ガイド（汎用動画解析）

このガイドは、開発者向けの動画解析環境（`scripts/dev` 配下）をローカルで構築して使う手順を説明します。

## 1. 設計方針

- このワークスペース直下に `.venv-media-analysis` を作成します。
- 解析用依存はこの仮想環境にだけインストールします。
- 生成物は Git 管理対象外です。
- 本手順は開発者向けであり、通常のアプリ利用者には不要です。

## 2. 主要ファイル

- `scripts/dev/setup-media-analysis-env.ps1`: 仮想環境作成と依存導入
- `scripts/dev/run-media-analysis.ps1`: 解析スクリプト実行ラッパー
- `scripts/dev/analyze-video.py`: 汎用動画解析ロジック
- `scripts/dev/analyze-end-blackout.py`: 旧名称互換ラッパー
- `scripts/dev/requirements-media-analysis.txt`: 解析依存
- `scripts/dev/requirements-media-analysis-stt.txt`: STT 依存
- `scripts/dev/prefetch-whisper-models.py`: Whisper モデル事前取得
- `scripts/dev/cleanup-media-analysis-artifacts.ps1`: 解析生成物のクリーンアップ

### スクリプト一覧の集約先

- 実行コマンドの正本: `package.json` の `scripts`
- 使い方の詳細: `Docs/developer_guide.md`

## 3. 初期セットアップ

プロジェクトルートで実行します。

```powershell
npm run dev:media:setup
```

必要に応じて `pip` を更新:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\dev\setup-media-analysis-env.ps1 -UpgradePip
```

## 4. 解析を実行する

例:

```powershell
npm run dev:media:analyze -- -InputPath "C:\Users\kamep\Downloads\VID_20260215_070608.mp4"
```

JSON 出力を保存する例:

```powershell
npm run dev:media:analyze -- -InputPath "C:\Users\kamep\Downloads\VID_20260215_070608.mp4" -OutputPath ".media-analysis-output\latest.json"
```

主なオプション:

- `-Mode` (`summary` | `black-segments` | `freeze-segments` | `tail-black` | `full-black`, 既定: `summary`)
- `-Scope` (`full` | `tail`, 既定: `full`)
- `-TailSeconds` (既定: `2.0`)
- `-BlackThreshold` (既定: `8.0`)
- `-FreezeThreshold` (既定: `0.8`)
- `-MinSegmentFrames` (既定: `3`)
- `-OutputPath`（任意）

末尾ブラックセグメント検出:

```powershell
npm run dev:media:analyze -- -InputPath "C:\path\capture.mp4" -Mode black-segments -Scope tail -TailSeconds 2
```

フリーズセグメント検出:

```powershell
npm run dev:media:analyze -- -InputPath "C:\path\capture.mp4" -Mode freeze-segments -Scope full -FreezeThreshold 0.8 -MinSegmentFrames 3
```

サマリー取得:

```powershell
npm run dev:media:analyze -- -InputPath "C:\path\capture.mp4" -Mode summary
```

## 4.1 STT（Whisper）セットアップとモデル事前取得

まず STT ランタイム（`faster-whisper`）を導入します。

```powershell
npm run dev:media:setup:stt
```

`tiny` と `small` をまとめて事前取得（推奨）:

```powershell
npm run dev:media:setup:stt:models
```

`tiny` のみ事前取得:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\dev\setup-media-analysis-env.ps1 -WithStt -PrefetchSttModels -SttModels tiny
```

`small` のみ事前取得:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\dev\setup-media-analysis-env.ps1 -WithStt -PrefetchSttModels -SttModels small
```

文字起こし実行例:

```powershell
# tiny
npm run dev:media:analyze -- -InputPath "C:\path\capture.mp4" -Mode transcribe -SttModel tiny -SttLanguage ja

# small
npm run dev:media:analyze -- -InputPath "C:\path\capture.mp4" -Mode transcribe -SttModel small -SttLanguage ja
```

補足:

- `setup-media-analysis-env.ps1` は `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` にある `127.0.0.1:9` などの無効なループバックプロキシを検出すると、インストール中のみ一時的に無効化します。
- 有効な社内プロキシ設定は変更しません（上記パターンに一致した場合のみ回避）。

## 5. 出力の見方

主なキー:

- `mode`: 実行モード
- `duration_sec_estimate`: 推定動画長
- `segments`: 検出セグメント（セグメント系モード）
- `luma_stats` / `motion_stats`: サマリー統計

## 6. クリーンアップ

```powershell
# 解析生成物を全削除（推奨）
npm run dev:media:cleanup

# JSONレポートだけ残して他を削除
npm run dev:media:cleanup:keep-json

# 完全に環境を作り直したい場合のみ
Remove-Item -Recurse -Force .\.venv-media-analysis
```

### 6.1 解析後に残すべきファイル

通常は以下だけ確認すれば十分です。

- `analysis-*.json`（例: `analysis-summary.json`, `analysis-transcribe-small.json`）
- 必要に応じてフレーム画像（説明資料に使う場合）

`audio.wav` や一時フレーム、再実行で再生成できる中間生成物は不要なら削除して問題ありません。

### 6.2 よくあるフォルダの要不要

- `.venv-media-analysis`: 動画解析を再実行するなら保持。不要なら削除可（次回 `dev:media:setup` が必要）
- `.venv-media-analysis-test`: 検証用の一時 venv。通常運用では不要なため削除可
- `.media-analysis-output`: 解析出力の置き場。証跡不要なら削除可
- `tmp/video-analysis`: 一時生成物。証跡不要なら削除可
- `.tools/gh`: ローカル同梱の GitHub CLI（`gh`）。システムに `gh` が無い場合の代替として利用
- `.tools/gh/LICENSE`: `.tools/gh` を保持する場合は一緒に保持（同梱バイナリのライセンス）

## 7. 注意事項

- 本フローは開発者向けです。
- 依存導入や初回モデル取得にはネットワーク接続が必要です。
- 仮想環境が壊れた場合は `.venv-media-analysis` を削除して再セットアップしてください。
- Windows では `py -3` を優先して venv を作成します（MSYS Python の問題回避）。

## 8. GitHub Issue 運用（開発者向け）

この章は開発者向けです。通常のアプリ利用者（仕様確認のみ）には不要です。

### 8.1 最短セットアップ（ポータブル `gh`）

システムに `gh` が無い場合でも、このリポジトリ同梱の `.\.tools\gh\bin\gh.exe` を利用できます。

```powershell
cd C:\git_home\turtle-video
$env:GH_CONFIG_DIR="$PWD\.tools\gh\config"
.\.tools\gh\bin\gh.exe auth login --hostname github.com
.\.tools\gh\bin\gh.exe auth status
```

### 8.2 Issue 作成（CLI）

```powershell
# 内容確認のみ
npm run issue:create -- --type docs --summary "手順確認" --dry-run

# 実作成
npm run issue:create -- --type docs --summary "手順確認"
```

### 8.3 トークン権限の目安

- 公開リポジトリ（Classic PAT）: `public_repo`
- 非公開リポジトリ（Classic PAT）: `repo`
- 補足: 環境によって `read:org` が必要になるため、Classic PAT は `public_repo + read:org` または `repo + read:org` を推奨
- Fine-grained PAT: 対象リポジトリの `Issues: Read and write`

詳細手順は `Docs/github_issue_workflow.md` を参照してください。
