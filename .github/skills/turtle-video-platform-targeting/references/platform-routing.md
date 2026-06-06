# Platform Routing Reference

## 基本マッピング

| ユーザーの言い方 | 扱い | 主対象 |
| --- | --- | --- |
| Android向け / PC向け / 標準モード / standard | `standard` flavor | `src/flavors/standard/` |
| iPhone向け / iPad Safari向け / Safari向け / apple-safari | `apple-safari` flavor | `src/flavors/apple-safari/` |
| 両方対応 / 共通化 / shared にしたい | shared + 両 flavor 確認 | contract, schema, utility, UI shell |

## 境界ごとの主な変更先

### Preview

- `src/flavors/standard/standardPreviewRuntime.ts`
- `src/flavors/apple-safari/appleSafariPreviewRuntime.ts`
- `src/flavors/standard/preview/`
- `src/flavors/apple-safari/preview/`
- shared contract: `src/components/turtle-video/previewRuntime.ts`

### Export

- `src/flavors/standard/standardExportRuntime.ts`
- `src/flavors/apple-safari/appleSafariExportRuntime.ts`
- `src/flavors/standard/export/`
- `src/flavors/apple-safari/export/`
- shared contract/core: `src/components/turtle-video/exportRuntime.ts`, `src/hooks/useExport.ts`

### Save / Load

- `src/flavors/standard/standardSaveRuntime.ts`
- `src/flavors/apple-safari/appleSafariSaveRuntime.ts`
- shared boundary: `src/components/turtle-video/saveRuntime.ts`
- shared persistence/schema: `src/stores/projectPersistence.ts`, `src/stores/projectStore.ts`

### UI / Help

- `src/app/appFlavorUi.ts`
- `src/constants/sectionHelp.ts`
- `src/components/Header.tsx`
- `src/components/sections/PreviewSection.tsx`
- `src/components/modals/SaveLoadModal.tsx`
- `src/components/modals/SectionHelpModal.tsx`

## 依頼文の推奨形

```text
{standard | apple-safari | shared} の {preview | export | save | UI-help | schema} を対象に、
{目的} を対応して。shared を触る必要がある場合だけ触って、関連テストも更新して。
```

## 例

- `standard の preview だけ修正して。Android / PC 向けで、apple-safari line は触らないで。`
- `apple-safari の export を安定化して。iPhone Safari の MediaRecorder 経路だけ見直して。`
- `shared schema を拡張して。standard / apple-safari の save round-trip test も更新して。`

## 避ける表現

- `iPhone向けに対応して` だけで終える
- `Android向けに最適化して` だけで preview / export / save の境界を指定しない
- `Safariのバグを直して` と言いながら shared workaround を許容するかを示さない
