## PC / Android export のカクつき再調査メモ

- 対象: `src/components/TurtleVideo.tsx`, `src/utils/previewPlatform.ts`, `src/test/previewPlatform.test.ts`
- 背景:
  - `v5` 系で追加した「途中クリップ終端 hold」と「描画済み時刻ベースの非 iOS export pacing」は、黒フレーム抑止には寄与する一方、`holdFrame` が入った瞬間に export 時刻が止まりやすく、PC / Android で中盤のカクつきが増えるケースがあった。
  - 実測では `19.8s〜22.0s` 帯のようなクリップ境界密集区間で freeze が増え、`8dadec...` の旧安定挙動より明らかに品質が落ちていた。
- 対応:
  - 非 iOS export では loop 時刻も `getPlaybackTimeSec` も `currentTimeRef` / 壁時計ベースへ戻し、`lastRenderedExportTimeRef` 依存の pacing は使わない。
  - `shouldHoldVideoFrameAtClipEnd()` は preview と iOS export の既存挙動を維持しつつ、PC / Android export では「最終クリップ終端」だけ hold を許可する。
  - その後、`video -> video` 境界で単発黒フレームが再発したため、PC / Android export の途中クリップでも次クリップが `video` の場合だけ「1 フレーム近傍」の最小 hold を許可した。
  - さらに軽微な 2 フレーム重複が残ったため、`video -> video` 境界の near-end 判定を半フレーム幅まで縮め、黒フレーム防止に必要な最小 hold だけ残した。
- 注意点:
  - iOS Safari export ルートは対象外。
  - 最終クリップ終端の黒フレーム防止、Android の image -> video 境界安定化、Teams 向けの尺合わせは維持する。
