# Export Preparation Phase Indicator

## Summary

- Export preparation UI uses a short phase counter in the button: `書き出し準備 1/4...`
- Detailed explanatory text is intentionally omitted during preparation to keep the control compact on desktop and mobile

## Implementation Notes

- `useExport` reports preparation phases through `onPreparationStepChange`
- Current phase mapping:
  - `1`: export setup started
  - `2`: audio sources are being scheduled for offline pre-render
  - `3`: `OfflineAudioContext.startRendering()` is running
  - `4`: pre-rendered audio is being fed into `AudioEncoder`
- `TurtleVideo` owns the phase state and passes it to `PreviewSection`
- `PreviewSection` only uses the phase number while the export phase is still `preparing`

## Guardrails

- Keep the button label short; do not place long per-phase descriptions inside the button
- Reset the phase state on export success, export failure, manual stop, and non-export playback start
