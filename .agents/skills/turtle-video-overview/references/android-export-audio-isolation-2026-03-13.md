# Android Export Audio Isolation

## Problem

- Android export could leak audio to the device speaker while the file was being rendered
- The previous preview/export audio policy only treated iOS Safari as a platform that must mute native media output

## Fix

- Added explicit Android detection in platform capability resolution
- Split native media muting into:
  - preview-time muting for iOS Safari
  - export-time muting for iOS Safari and Android
- Changed `extractAudioViaVideoElement()` to terminate its temporary graph at `MediaStreamDestination` instead of `AudioContext.destination`

## Guardrails

- Do not share iOS Safari mute assumptions with Android implicitly
- Export-time audio isolation must be decided by platform capability flags, not by reusing preview-only policy
