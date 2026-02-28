#!/usr/bin/env python3
"""Prefetch faster-whisper model files into local cache."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Download and cache faster-whisper model weights in advance."
    )
    parser.add_argument(
        "--models",
        nargs="+",
        required=True,
        help="Model names to prefetch. Example: tiny small",
    )
    parser.add_argument(
        "--device",
        default="auto",
        help="Inference device used for initialization. Default: auto",
    )
    parser.add_argument(
        "--compute-type",
        default="int8",
        help="Compute type for faster-whisper model init. Default: int8",
    )
    parser.add_argument(
        "--output",
        default="",
        help="Optional output JSON path.",
    )
    return parser.parse_args()


def prefetch_model(model_name: str, device: str, compute_type: str) -> dict[str, Any]:
    from faster_whisper import WhisperModel

    WhisperModel(model_name, device=device, compute_type=compute_type)
    return {
        "model": model_name,
        "status": "ok",
    }


def main() -> int:
    args = parse_args()
    results: list[dict[str, Any]] = []
    has_error = False

    for model_name in args.models:
        try:
            result = prefetch_model(model_name, args.device, args.compute_type)
        except Exception as exc:  # noqa: BLE001
            has_error = True
            result = {
                "model": model_name,
                "status": "error",
                "error": str(exc),
            }
        results.append(result)

    output = {
        "mode": "prefetch-whisper-models",
        "device": args.device,
        "compute_type": args.compute_type,
        "results": results,
    }
    output_json = json.dumps(output, ensure_ascii=False, indent=2)
    print(output_json)

    if args.output:
        out_path = Path(args.output)
        if not out_path.is_absolute():
            out_path = Path.cwd() / out_path
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(output_json + "\n", encoding="utf-8")

    return 2 if has_error else 0


if __name__ == "__main__":
    raise SystemExit(main())
