#!/usr/bin/env python3
"""Package a prebuilt frontend with the Python backend and viewer assets."""

import json
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED


root = Path(__file__).resolve().parent.parent
name = json.loads((root / "plugin.json").read_text())["name"]
required = ["plugin.json", "package.json", "main.py", "phone_input.py", "image_upload.py", "local_library.py", "web_scroll.py", "LICENSE", "README.md", "README.zh-CN.md", "README.en.md", "THIRD_PARTY_NOTICES.md",
            "dist/index.js", "assets/image-viewer.html", "assets/image-viewer.js", "assets/phone-input.html", "assets/web-zoom.js", "assets/web-media.js", "assets/zoom-icons.json"]
for relative in required:
    if not (root / relative).is_file():
        raise SystemExit(f"Missing {relative}; run pnpm build first")
files = [root / relative for relative in required if not relative.startswith(("dist/", "assets/"))]
for directory in ("dist", "assets"):
    files.extend(path for path in (root / directory).rglob("*") if path.is_file())
output = root / "out" / f"{name}.zip"
output.parent.mkdir(exist_ok=True)
with ZipFile(output, "w", ZIP_DEFLATED) as archive:
    for path in sorted(files):
        archive.write(path, f"{name}/{path.relative_to(root).as_posix()}")
print(output)
