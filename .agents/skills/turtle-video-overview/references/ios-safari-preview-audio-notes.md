# iOS Safari Preview Audio Notes

## 1. Single-video native fallback is only for video clips

- `getPreviewAudioOutputMode()` already allows `native` output for preview when:
  - iOS Safari
  - only one audible source
  - desired volume is `1`
  - no existing `AudioNode`
- This fallback is important for video clips because Safari can fail to start clip audio reliably if a single video is forced through WebAudio unnecessarily.
- Audio-only tracks such as BGM and narration should stay on WebAudio in preview so they do not flap between native and WebAudio at image/video boundaries.

## 2. Do not eagerly attach `AudioNode` to every future video

- A previous approach attached `AudioNode` to all video elements at `startEngine()`.
- That made later single-video clips lose the `native fallback` path before they became active.
- Symptom on iOS Safari:
  - image -> video transition starts with silent video
  - audio may begin later without user input, or remain silent
  - seek / slider interaction restarts playback with audio

## 3. Current routing policy

- `preparePreviewAudioNodesForTime(fromTime)` still prepares the current playback point.
- Audio-only tracks (`<audio>`) stay on WebAudio for iOS Safari preview even when they are the only audible source.
- Future warm-up is now limited to `getFutureVideoAudioProbeTimes()`:
  - only future video clip start points
  - slightly after clip start, not every frame
  - preserves single-video `native` fallback
- Mixed-audio starts such as `video + BGM` can still be prewarmed into WebAudio before the clip becomes active.

## 4. Regression guard

- If someone reintroduces "attach nodes for all videos" on iOS Safari, re-check:
  - image -> video -> image timeline
  - no BGM / narration case
  - video audio starts immediately on transition
  - no delayed audio start after idle waiting
- Also re-check BGM on:
  - image-only sections before the first video
  - image -> video transitions
  - video -> image transitions
