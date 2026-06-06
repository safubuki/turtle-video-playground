# Export Startup Status Unification

## Summary

- Export status keeps showing `書き出し準備 n/4...` during the first small `currentTime` movements after export starts
- This avoids showing `映像を生成中... 0%` or `フレーム待機中...` while the export loop is still stabilizing from a paused non-zero position

## Implementation Notes

- `PreviewSection` treats a rewind from a paused position back to `0` as export initialization, not as progress
- Export UI does not switch from `preparing` to `rendering` until playback time passes a small startup threshold
- The startup threshold is capped to a quarter second and scales down for very short exports

## Guardrails

- Keep the startup threshold in UI logic only; do not change actual export timing or WebCodecs scheduling for this display fix
- If a future platform-specific startup workaround is needed, isolate it outside `PreviewSection` and keep iOS / Android / PC conditions explicit
