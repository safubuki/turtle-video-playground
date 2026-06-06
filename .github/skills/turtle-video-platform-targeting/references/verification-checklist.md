# Verification Checklist

## standard flavor のみを触ったとき

- `src/test/standardFlavorRegression.test.ts` で standard line の期待値を確認する
- preview 変更なら preview runtime / capability 関連テストの追加が要るか確認する
- export 変更なら export runtime / strategy 関連テストの追加が要るか確認する
- Safari workaround を shared 側へ戻していないか確認する

## apple-safari flavor のみを触ったとき

- `src/test/appleSafariFlavorRegression.test.ts` で iPhone / iPad Safari line の期待値を確認する
- preview 変更なら video → image → video、BGM mixed routing、visibility 復帰、seek 復帰を確認する
- export 変更なら MediaRecorder 優先経路と fallback 経路を確認する
- standard line を誤って巻き込んでいないか確認する

## shared schema / shared utility を触ったとき

- `src/test/standardFlavorRegression.test.ts`
- `src/test/appleSafariFlavorRegression.test.ts`
- `src/test/stores/projectStoreSave.test.ts`
- 必要に応じて isolation / capability tests
- 可能なら `npm run quality:gate`

## UI / Help を触ったとき

- `src/app/appFlavorUi.ts` を source of truth として使っているか確認する
- shared component に platform 直判定を再導入していないか確認する
- flavor ごとの案内差分が test で固定されているか確認する
