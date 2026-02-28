#!/usr/bin/env python3
"""Compatibility wrapper for legacy script name.

Use scripts/dev/analyze-video.py for new workflows.
"""

from __future__ import annotations

import runpy
import sys
from pathlib import Path


def main() -> int:
    target = Path(__file__).with_name("analyze-video.py")
    if not target.exists():
        print(f"analyzer script not found: {target}", file=sys.stderr)
        return 2
    sys.argv[0] = str(target)
    runpy.run_path(str(target), run_name="__main__")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
