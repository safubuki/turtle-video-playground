# 非アクティブ復帰後の保存失敗メモ

## 現象

- タブ非アクティブ化やフォーカス復帰のあと、手動保存が高確率で失敗することがある。
- UI 上は `保存に失敗しました` となるが、復帰直後だけ偏って起きやすい。

## 原因

- `useAutoSave.ts` は `visibilitychange` / `focus` / `pageshow` 復帰時に catch-up 自動保存を走らせる。
- 一方で `projectStore.ts` の手動保存と自動保存は共有ロックがなく、同時期に並走し得た。
- 以前の IndexedDB 後始末改善は transaction 完了後の不整合には効くが、復帰直後の `auto save` と `manual save` の競合までは防いでいなかった。

## 対策

- `projectStore.ts` に保存専用の直列化キューを追加し、`saveProjectAuto` と `saveProjectManual` の両方を同じキューへ通す。
- これにより、復帰直後に catch-up 自動保存が走っていても、手動保存はその完了後に順番待ちして実行される。
- プレビューやエクスポートの visibility 復帰ロジックには触れず、保存導線だけで閉じる。

## 確認観点

- タブ復帰直後に保存モーダルを開いて `手動保存` しても失敗しないこと。
- 自動保存が走るタイミングでも、最終的に `manual` スロットが保存されること。
- `src/test/stores/projectStoreSave.test.ts` で auto/manual 保存の直列化を固定する。
