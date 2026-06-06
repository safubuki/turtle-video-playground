# 一時停止時のフレーム表示不具合修正

**対応バージョン**: v1.4.1
**対応日**: 2026年1月31日

---

## 現象
動画再生中に一時停止（Pause）を行った際、特に動画から動画への切り替わり後に一時停止すると、現在の動画フレームではなく、前の動画（または画像）の最終フレームが表示されてしまう。

- **発生パターン**: 動画1 → 動画2 と遷移し、動画2の途中で一時停止した際、画面が動画1の最終フレームに戻る。
- **ユーザ報告**: "動画２で初回一時停止したときに、どの位置でも、動画１の最終フレームが表示されてしまいます"

## 原因
`renderFrame`関数が一時停止時に呼び出される際、参照している時刻情報（`currentTimeRef.current`）が古いため。

1. **再生ループの仕様**:
   - `loop`関数内でアニメーションフレームごとに`setCurrentTime(elapsed)`を呼び出し、ReactのStateを更新してUI（シークバー）を描画していた。
   - しかし、`currentTimeRef.current`（Ref）の更新がループ内で行われていなかった。
   - `currentTimeRef`は、シーク操作時や再生開始時（`startEngine`）にのみ更新されていた。

2. **一時停止時の挙動**:
   - ユーザーが一時停止ボタンを押すと、再生ループが停止し、`isPlaying`が`false`になる。
   - `TurtleVideo.tsx`内の`useEffect`（pause状態を監視）が発火し、`renderFrame(currentTimeRef.current)`を実行する。
   - この時、`currentTimeRef.current`は「再生開始時」または「最後にシークした時」の値（例えば動画1の開始時点）のまま更新されていない。
   - 結果として、動画2を再生中であっても、`renderFrame`には動画1の時刻が渡され、動画1が描画されてしまう。

## 対応
`src/components/TurtleVideo.tsx`の再生ループ（`loop`関数）内で、フレームごとに`currentTimeRef.current`を最新の経過時間（`elapsed`）で更新するように変更。

```typescript
// src/components/TurtleVideo.tsx

const loop = useCallback((isExportMode: boolean, myLoopId: number) => {
  // ...
  setCurrentTime(elapsed);
  currentTimeRef.current = elapsed; // 追加: Refを常に最新時刻に同期
  renderFrame(elapsed, true, isExportMode);
  // ...
}, ...);
```

## 効果
- 一時停止時に、その瞬間の正確な時刻が`renderFrame`に渡されるようになった。
- どのタイミングで停止しても、現在表示されているフレームがそのまま維持される（リアルタイム性の確保）。
- 前の動画に戻る現象が解消された。
