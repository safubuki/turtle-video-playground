# 引き継ぎ書: 画像クリップ尺ズレ（エクスポート）

作成日: 2026-02-18  
対象プロジェクト: `turtle-video`

## 1. 事象

- ユーザー報告: **「画像だけが設定より短くエクスポートされる」**
- 体感として画像区間ごとに 1 秒前後ずつ短く、後半でAVタイミングがズレる
- 音声と動画クリップは比較的正常、静止画区間で違和感が強い

## 2. 実測データ（これまで）

1. `turtle_video_1771440387143.mp4`
- 映像: 38.83s（1165f / 30fps）
- 音声: 41.00s
- 備考: 映像が短い（画像短縮症状）

2. `turtle_video_1771442725784.mp4`
- 映像: 46.40s（1392f / 30fps）
- 音声: 41.00s
- 備考: 逆に映像が長い（前修正で悪化）

## 3. 原因仮説（現時点）

- 単一原因ではなく、以下が複合している可能性が高い
1. `captureStream` / TrackProcessor のフレーム供給が環境差で不安定
2. `requestFrame` 併用時の二重供給（映像伸長）
3. エクスポート再生ループ（`Date.now` ベース）とフレーム抽出の非同期ズレ
4. 静止画区間ではCanvas変化が少ないため、供給遅延の影響が顕在化しやすい

## 4. 実施済み対策

### 4-1. 音声側
- `OfflineAudioContext` を全環境優先
- 音声長を `totalDuration` に厳密合わせ
- 音声フォールバック経路も終端打ち切り

### 4-2. 映像側
- `captureStream(FPS)` と `requestFrame` の併用回避
- `getPlaybackTimeSec` を導入し、目標フレーム数をタイムライン基準で制御
- 停止要求後の不足フレーム補完処理を追加
- **暫定**: TrackProcessor経路を止め、Canvas直接フレーム経路に固定

## 5. 現在のコード状態（主要差分）

- `src/hooks/useExport.ts`
  - `ExportAudioSources` に `getPlaybackTimeSec` を追加
  - フレーム供給同期ロジックを追加
  - `useManualCanvasFrames = true`（暫定固定）
- `src/components/TurtleVideo.tsx`
  - `startWebCodecsExport` 呼び出しで `getPlaybackTimeSec: () => currentTimeRef.current` を渡す
- `src/components/sections/PreviewSection.tsx`
  - エクスポート中ボタン文言を段階表示に変更（準備中 / 生成中 / 待機中）

## 6. ユーザー要求（未収束）

- 画像尺ズレがまだ解消しない報告あり
- 「ぐるぐる中に何をしているか分かる文言が必要」へのUI対応は実装済み

## 7. 次担当AIへの推奨アクション

1. **最新出力動画**を再取得し、映像長/音声長を必ず実測
2. `RENDER` ログで以下を確認
- `captureMode`
- `expectedVideoFrames`
- `映像不足フレームを末尾補完` の発生有無
3. 画像短縮が続く場合、`TurtleVideo.tsx` のエクスポート時間進行を
- `Date.now` ベースから `frameIndex / FPS` ベースへ寄せる検討
4. 可能なら **エクスポート専用の決定論的レンダーループ**（time-step固定）を導入して、
   プレビュー再生ループと切り離す

## 8. 参考コマンド

```powershell
npm run test:run
npm run build
```

動画実測（ffmpeg）は `.venv-media-analysis` のバイナリを使用:

```powershell
$ffmpeg='C:\git_home\turtle-video\.venv-media-analysis\Lib\site-packages\imageio_ffmpeg\binaries\ffmpeg-win-x86_64-v7.1.exe'
& $ffmpeg -hide_banner -i <video.mp4>
& $ffmpeg -hide_banner -i <video.mp4> -map 0:v:0 -f null NUL
& $ffmpeg -hide_banner -i <video.mp4> -map 0:a:0 -f null NUL
```

## 9. 補足

- ワークツリーには本件以外の変更（`src/components/media/ClipItem.tsx`, `src/components/sections/ClipsSection.tsx`）が混在しているため、作業時に注意。
- `tmp/` 配下の一時解析ファイルが削除できない環境があり、`git status` で未追跡として残るケースがある。
