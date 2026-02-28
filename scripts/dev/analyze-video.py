#!/usr/bin/env python3
"""Generic video analyzer for local bug investigations."""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Analyze video metrics for debugging and behavior verification."
    )
    parser.add_argument("--input", required=True, help="Path to input video file.")
    parser.add_argument(
        "--mode",
        default="summary",
        choices=(
            "summary",
            "black-segments",
            "freeze-segments",
            "transcribe",
            # backward-compatible aliases:
            "tail-black",
            "full-black",
        ),
        help="Analysis mode. Default: summary",
    )
    parser.add_argument(
        "--scope",
        default="full",
        choices=("full", "tail"),
        help="Scope for segment analysis modes. Default: full",
    )
    parser.add_argument(
        "--tail-seconds",
        type=float,
        default=2.0,
        help="Tail duration used when --scope tail. Default: 2.0",
    )
    parser.add_argument(
        "--black-threshold",
        type=float,
        default=8.0,
        help="Luma threshold (0-255) for black frame detection. Default: 8.0",
    )
    parser.add_argument(
        "--freeze-threshold",
        type=float,
        default=0.8,
        help="Mean frame-diff threshold (0-255) for freeze detection. Default: 0.8",
    )
    parser.add_argument(
        "--min-segment-frames",
        type=int,
        default=3,
        help="Minimum contiguous frames for a detected segment. Default: 3",
    )
    parser.add_argument(
        "--stt-provider",
        default="auto",
        choices=("auto", "faster-whisper", "openai-whisper"),
        help="Whisper provider for transcribe mode. Default: auto",
    )
    parser.add_argument(
        "--stt-model",
        default="small",
        help="Whisper model name for transcribe mode. Default: small",
    )
    parser.add_argument(
        "--stt-language",
        default="ja",
        help="Language code for transcribe mode (or auto). Default: ja",
    )
    parser.add_argument(
        "--stt-device",
        default="auto",
        help="Inference device for transcribe mode. Example: auto/cpu/cuda",
    )
    parser.add_argument(
        "--stt-compute-type",
        default="int8",
        help="Compute type for faster-whisper. Default: int8",
    )
    parser.add_argument(
        "--stt-beam-size",
        type=int,
        default=5,
        help="Beam size for transcribe mode. Default: 5",
    )
    parser.add_argument(
        "--output",
        default="",
        help="Optional path to save JSON report.",
    )
    return parser.parse_args()


def compute_luma(frame: Any) -> float:
    # Local import so --help works even when dependencies are missing.
    import numpy as np

    arr = np.asarray(frame)
    if arr.ndim == 3:
        arr = arr[..., :3]
    return float(arr.mean())


def compute_frame_diff(prev_frame: Any, curr_frame: Any) -> float:
    import numpy as np

    prev_arr = np.asarray(prev_frame, dtype=np.float32)
    curr_arr = np.asarray(curr_frame, dtype=np.float32)
    if prev_arr.ndim == 3:
        prev_arr = prev_arr[..., :3]
    if curr_arr.ndim == 3:
        curr_arr = curr_arr[..., :3]
    diff = np.abs(curr_arr - prev_arr)
    return float(diff.mean())


def percentile(sorted_values: list[float], p: float) -> float:
    if not sorted_values:
        return math.nan
    if p <= 0:
        return sorted_values[0]
    if p >= 100:
        return sorted_values[-1]
    pos = (len(sorted_values) - 1) * (p / 100.0)
    lo = int(math.floor(pos))
    hi = int(math.ceil(pos))
    if lo == hi:
        return sorted_values[lo]
    w = pos - lo
    return sorted_values[lo] * (1.0 - w) + sorted_values[hi] * w


def load_metrics(video_path: Path) -> tuple[float, list[float], list[float | None]]:
    try:
        import imageio.v2 as imageio
    except ModuleNotFoundError as exc:
        raise RuntimeError("imageio was not found. Run `npm run dev:media:setup` first.") from exc

    reader = imageio.get_reader(str(video_path), format="ffmpeg")
    try:
        meta = reader.get_meta_data() or {}
        fps = float(meta.get("fps") or 30.0)
        if fps <= 0:
            fps = 30.0

        luma_values: list[float] = []
        motion_values: list[float | None] = []
        prev_frame: Any | None = None

        for frame in reader:
            luma_values.append(compute_luma(frame))
            if prev_frame is None:
                motion_values.append(None)
            else:
                motion_values.append(compute_frame_diff(prev_frame, frame))
            prev_frame = frame
    finally:
        reader.close()

    if not luma_values:
        raise RuntimeError("No video frames could be decoded.")

    return fps, luma_values, motion_values


def detect_segments(
    values: list[float | None],
    threshold: float,
    min_frames: int,
    index_start: int,
    index_end: int,
) -> list[dict[str, int]]:
    segments: list[dict[str, int]] = []
    seg_start: int | None = None
    seg_end: int | None = None

    for idx in range(index_start, index_end):
        value = values[idx]
        if value is not None and value <= threshold:
            if seg_start is None:
                seg_start = idx
            seg_end = idx
            continue

        if seg_start is not None and seg_end is not None:
            frame_count = seg_end - seg_start + 1
            if frame_count >= min_frames:
                segments.append(
                    {
                        "start_frame_index": seg_start,
                        "end_frame_index": seg_end,
                        "frame_count": frame_count,
                    }
                )
            seg_start = None
            seg_end = None

    if seg_start is not None and seg_end is not None:
        frame_count = seg_end - seg_start + 1
        if frame_count >= min_frames:
            segments.append(
                {
                    "start_frame_index": seg_start,
                    "end_frame_index": seg_end,
                    "frame_count": frame_count,
                }
            )

    return segments


def enrich_segments_with_time(segments: list[dict[str, int]], fps: float) -> list[dict[str, float | int]]:
    enriched: list[dict[str, float | int]] = []
    for seg in segments:
        start_idx = seg["start_frame_index"]
        end_idx = seg["end_frame_index"]
        frame_count = seg["frame_count"]
        enriched.append(
            {
                "start_frame_index": start_idx,
                "end_frame_index": end_idx,
                "start_time_sec": start_idx / fps,
                "end_time_sec": end_idx / fps,
                "frame_count": frame_count,
                "duration_sec": frame_count / fps,
            }
        )
    return enriched


def get_scope_indices(total_frames: int, scope: str, tail_seconds: float, fps: float) -> tuple[int, int]:
    if total_frames <= 0:
        return 0, 0
    if scope == "full":
        return 0, total_frames
    if tail_seconds <= 0:
        raise ValueError("--tail-seconds must be > 0 when --scope tail")
    tail_frames = max(1, int(round(tail_seconds * fps)))
    start = max(0, total_frames - tail_frames)
    return start, total_frames


def analyze_summary(
    video_path: Path,
    fps: float,
    luma_values: list[float],
    motion_values: list[float | None],
    black_threshold: float,
) -> dict[str, Any]:
    total = len(luma_values)
    sorted_luma = sorted(luma_values)
    valid_motion = [v for v in motion_values if v is not None]
    sorted_motion = sorted(valid_motion)
    black_count = sum(1 for v in luma_values if v <= black_threshold)

    return {
        "mode": "summary",
        "input_path": str(video_path),
        "fps": fps,
        "total_frames": total,
        "duration_sec_estimate": total / fps,
        "black_threshold": black_threshold,
        "luma_stats": {
            "min": min(luma_values),
            "max": max(luma_values),
            "mean": sum(luma_values) / total,
            "p05": percentile(sorted_luma, 5),
            "p50": percentile(sorted_luma, 50),
            "p95": percentile(sorted_luma, 95),
        },
        "motion_stats": {
            "sample_count": len(valid_motion),
            "min": min(valid_motion) if valid_motion else math.nan,
            "max": max(valid_motion) if valid_motion else math.nan,
            "mean": (sum(valid_motion) / len(valid_motion)) if valid_motion else math.nan,
            "p05": percentile(sorted_motion, 5) if valid_motion else math.nan,
            "p50": percentile(sorted_motion, 50) if valid_motion else math.nan,
            "p95": percentile(sorted_motion, 95) if valid_motion else math.nan,
        },
        "black_frame_count": black_count,
        "black_frame_ratio": black_count / total,
    }


def analyze_black_segments(
    video_path: Path,
    fps: float,
    luma_values: list[float],
    scope: str,
    tail_seconds: float,
    black_threshold: float,
    min_segment_frames: int,
) -> dict[str, Any]:
    total = len(luma_values)
    start, end = get_scope_indices(total, scope, tail_seconds, fps)
    black_flags: list[float | None] = [v for v in luma_values]
    segments_raw = detect_segments(
        values=black_flags,
        threshold=black_threshold,
        min_frames=min_segment_frames,
        index_start=start,
        index_end=end,
    )
    segments = enrich_segments_with_time(segments_raw, fps)
    scoped_count = end - start
    black_count = sum(1 for idx in range(start, end) if luma_values[idx] <= black_threshold)
    last_idx = total - 1
    has_black_at_end = bool(segments and segments[-1]["end_frame_index"] >= last_idx)

    return {
        "mode": "black-segments",
        "input_path": str(video_path),
        "fps": fps,
        "total_frames": total,
        "duration_sec_estimate": total / fps,
        "scope": scope,
        "tail_seconds": tail_seconds if scope == "tail" else None,
        "scope_start_frame": start,
        "scope_end_frame_exclusive": end,
        "black_threshold": black_threshold,
        "min_segment_frames": min_segment_frames,
        "black_frame_count_in_scope": black_count,
        "black_frame_ratio_in_scope": (black_count / scoped_count) if scoped_count > 0 else 0.0,
        "has_black_at_video_end": has_black_at_end,
        "segment_count": len(segments),
        "segments": segments,
    }


def analyze_freeze_segments(
    video_path: Path,
    fps: float,
    motion_values: list[float | None],
    scope: str,
    tail_seconds: float,
    freeze_threshold: float,
    min_segment_frames: int,
) -> dict[str, Any]:
    total = len(motion_values)
    start, end = get_scope_indices(total, scope, tail_seconds, fps)
    # Frame 0 has no motion value.
    start = max(start, 1)
    segments_raw = detect_segments(
        values=motion_values,
        threshold=freeze_threshold,
        min_frames=min_segment_frames,
        index_start=start,
        index_end=end,
    )
    segments = enrich_segments_with_time(segments_raw, fps)
    scoped_count = max(0, end - start)
    freeze_count = sum(
        1
        for idx in range(start, end)
        if motion_values[idx] is not None and motion_values[idx] <= freeze_threshold
    )
    last_idx = total - 1
    has_freeze_at_end = bool(segments and segments[-1]["end_frame_index"] >= last_idx)

    return {
        "mode": "freeze-segments",
        "input_path": str(video_path),
        "fps": fps,
        "total_frames": total,
        "duration_sec_estimate": total / fps,
        "scope": scope,
        "tail_seconds": tail_seconds if scope == "tail" else None,
        "scope_start_frame": start,
        "scope_end_frame_exclusive": end,
        "freeze_threshold": freeze_threshold,
        "min_segment_frames": min_segment_frames,
        "freeze_frame_count_in_scope": freeze_count,
        "freeze_frame_ratio_in_scope": (freeze_count / scoped_count) if scoped_count > 0 else 0.0,
        "has_freeze_at_video_end": has_freeze_at_end,
        "segment_count": len(segments),
        "segments": segments,
    }


def normalize_stt_language(value: str) -> str | None:
    normalized = value.strip()
    if not normalized:
        return None
    lowered = normalized.lower()
    if lowered in {"auto", "none"}:
        return None
    return normalized


def prepend_imageio_ffmpeg_to_path() -> None:
    # openai-whisper may require ffmpeg command discovery on PATH.
    try:
        import imageio_ffmpeg
    except ModuleNotFoundError:
        return

    ffmpeg_path = Path(imageio_ffmpeg.get_ffmpeg_exe())
    ffmpeg_dir = str(ffmpeg_path.parent)
    path_value = os.environ.get("PATH", "")
    path_parts = path_value.split(os.pathsep) if path_value else []
    if ffmpeg_dir not in path_parts:
        os.environ["PATH"] = ffmpeg_dir + os.pathsep + path_value


def analyze_transcribe_faster_whisper(video_path: Path, args: argparse.Namespace) -> dict[str, Any]:
    try:
        from faster_whisper import WhisperModel
    except ModuleNotFoundError as exc:
        raise ModuleNotFoundError(
            "faster-whisper is not installed. Run `npm run dev:media:setup -- -WithStt`."
        ) from exc

    language = normalize_stt_language(args.stt_language)
    model = WhisperModel(
        args.stt_model,
        device=args.stt_device,
        compute_type=args.stt_compute_type,
    )
    segments_iter, info = model.transcribe(
        str(video_path),
        language=language,
        beam_size=args.stt_beam_size,
    )

    segments: list[dict[str, Any]] = []
    for idx, segment in enumerate(segments_iter):
        text = str(getattr(segment, "text", "")).strip()
        segments.append(
            {
                "segment_index": idx,
                "start_time_sec": float(getattr(segment, "start", 0.0)),
                "end_time_sec": float(getattr(segment, "end", 0.0)),
                "text": text,
            }
        )

    full_text = " ".join(seg["text"] for seg in segments if seg["text"]).strip()
    detected_language = getattr(info, "language", None)
    detected_probability = getattr(info, "language_probability", None)

    return {
        "mode": "transcribe",
        "provider": "faster-whisper",
        "input_path": str(video_path),
        "model": args.stt_model,
        "language": language,
        "detected_language": detected_language,
        "detected_language_probability": (
            float(detected_probability) if detected_probability is not None else None
        ),
        "segment_count": len(segments),
        "segments": segments,
        "text": full_text,
    }


def analyze_transcribe_openai_whisper(video_path: Path, args: argparse.Namespace) -> dict[str, Any]:
    try:
        import whisper
    except ModuleNotFoundError as exc:
        raise ModuleNotFoundError(
            "openai-whisper is not installed. Run `npm run dev:media:setup -- -WithStt`."
        ) from exc

    prepend_imageio_ffmpeg_to_path()
    language = normalize_stt_language(args.stt_language)
    device = None if args.stt_device == "auto" else args.stt_device
    model = whisper.load_model(args.stt_model, device=device)

    transcribe_kwargs: dict[str, Any] = {
        "beam_size": args.stt_beam_size,
        "verbose": False,
    }
    if language is not None:
        transcribe_kwargs["language"] = language
    if args.stt_device != "cuda":
        transcribe_kwargs["fp16"] = False

    result = model.transcribe(str(video_path), **transcribe_kwargs)
    raw_segments = result.get("segments") or []
    segments: list[dict[str, Any]] = []
    for idx, segment in enumerate(raw_segments):
        text = str(segment.get("text", "")).strip()
        segments.append(
            {
                "segment_index": idx,
                "start_time_sec": float(segment.get("start", 0.0)),
                "end_time_sec": float(segment.get("end", 0.0)),
                "text": text,
            }
        )

    full_text = " ".join(seg["text"] for seg in segments if seg["text"]).strip()
    if not full_text:
        full_text = str(result.get("text", "")).strip()

    return {
        "mode": "transcribe",
        "provider": "openai-whisper",
        "input_path": str(video_path),
        "model": args.stt_model,
        "language": language,
        "detected_language": result.get("language"),
        "detected_language_probability": None,
        "segment_count": len(segments),
        "segments": segments,
        "text": full_text,
    }


def analyze_transcribe(video_path: Path, args: argparse.Namespace) -> dict[str, Any]:
    providers = (
        ["faster-whisper", "openai-whisper"] if args.stt_provider == "auto" else [args.stt_provider]
    )
    missing_errors: dict[str, str] = {}

    for provider in providers:
        try:
            if provider == "faster-whisper":
                return analyze_transcribe_faster_whisper(video_path, args)
            if provider == "openai-whisper":
                return analyze_transcribe_openai_whisper(video_path, args)
        except ModuleNotFoundError as exc:
            missing_errors[provider] = str(exc)
            continue

    if missing_errors:
        detail = " / ".join(f"{name}: {message}" for name, message in missing_errors.items())
        raise RuntimeError(
            "No Whisper STT backend is available in this venv. "
            "Run `npm run dev:media:setup -- -WithStt`. "
            f"Details: {detail}"
        )

    raise ValueError(f"unsupported stt provider: {args.stt_provider}")


def normalize_mode_scope(mode: str, scope: str) -> tuple[str, str]:
    # Backward compatibility with old blackout-specific mode names.
    if mode == "tail-black":
        return "black-segments", "tail"
    if mode == "full-black":
        return "black-segments", "full"
    return mode, scope


def run_analysis(args: argparse.Namespace) -> dict[str, Any]:
    input_path = Path(args.input).expanduser()
    if not input_path.exists():
        raise FileNotFoundError(f"input video not found: {input_path}")
    if args.min_segment_frames <= 0:
        raise ValueError("--min-segment-frames must be > 0")
    if args.black_threshold < 0:
        raise ValueError("--black-threshold must be >= 0")
    if args.freeze_threshold < 0:
        raise ValueError("--freeze-threshold must be >= 0")
    if args.stt_beam_size <= 0:
        raise ValueError("--stt-beam-size must be > 0")

    mode, scope = normalize_mode_scope(args.mode, args.scope)
    if mode == "transcribe":
        return analyze_transcribe(video_path=input_path, args=args)

    fps, luma_values, motion_values = load_metrics(input_path)

    if mode == "summary":
        return analyze_summary(
            video_path=input_path,
            fps=fps,
            luma_values=luma_values,
            motion_values=motion_values,
            black_threshold=args.black_threshold,
        )
    if mode == "black-segments":
        return analyze_black_segments(
            video_path=input_path,
            fps=fps,
            luma_values=luma_values,
            scope=scope,
            tail_seconds=args.tail_seconds,
            black_threshold=args.black_threshold,
            min_segment_frames=args.min_segment_frames,
        )
    if mode == "freeze-segments":
        return analyze_freeze_segments(
            video_path=input_path,
            fps=fps,
            motion_values=motion_values,
            scope=scope,
            tail_seconds=args.tail_seconds,
            freeze_threshold=args.freeze_threshold,
            min_segment_frames=args.min_segment_frames,
        )
    raise ValueError(f"unsupported mode: {mode}")


def main() -> int:
    args = parse_args()
    try:
        result = run_analysis(args)
    except Exception as exc:  # noqa: BLE001
        print(str(exc), file=sys.stderr)
        return 2

    output_json = json.dumps(result, indent=2, ensure_ascii=False)
    print(output_json)

    if args.output:
        out_path = Path(args.output)
        if not out_path.is_absolute():
            out_path = Path.cwd() / out_path
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(output_json + "\n", encoding="utf-8")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
