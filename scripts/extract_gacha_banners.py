import hashlib
import json
import struct
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CDN_ROOT = ROOT / ".cdn" / "ko"
OUTPUT_ROOT = ROOT / ".generated"
PUBLIC_OUTPUT = OUTPUT_ROOT / "public" / "gacha-banners"
MANIFEST_PATH = OUTPUT_ROOT / "gacha-banners.json"


def read_png_size(header: bytes) -> tuple[int, int] | None:
    if header[:4] not in (b"\x89PNG", b"\x89png"):
        return None
    if header[4:8] != b"\r\n\x1a\n":
        return None
    return struct.unpack(">II", header[16:24])


def is_gacha_banner_candidate(width: int, height: int) -> bool:
    # The in-game gacha carousel banners are 510x180 in the Korean CDN.
    return width == 510 and height == 180


def iter_archive_roots() -> list[Path]:
    return [
        CDN_ROOT / "archive-common-full",
        CDN_ROOT / "archive-android-full",
        CDN_ROOT / "archive-android_medium-full",
        CDN_ROOT / "archive-android_small-full",
    ]


def main() -> None:
    PUBLIC_OUTPUT.mkdir(parents=True, exist_ok=True)
    seen: set[str] = set()
    manifest: list[dict[str, object]] = []

    for archive_root in iter_archive_roots():
        if not archive_root.is_dir():
            continue

        for archive_path in sorted(archive_root.glob("*.zip")):
            with zipfile.ZipFile(archive_path) as archive:
                for info in archive.infolist():
                    if info.is_dir() or info.file_size < 256:
                        continue

                    with archive.open(info) as file:
                        header = file.read(32)

                    size = read_png_size(header)
                    if size is None:
                        continue

                    width, height = size
                    if not is_gacha_banner_candidate(width, height):
                        continue

                    data = archive.read(info)
                    fixed_png = b"\x89PNG" + data[4:] if data[:4] == b"\x89png" else data
                    digest = hashlib.sha1(fixed_png).hexdigest()
                    if digest in seen:
                        continue
                    seen.add(digest)

                    filename = f"{len(manifest):04d}_{digest[:12]}.png"
                    output_path = PUBLIC_OUTPUT / filename
                    output_path.write_bytes(fixed_png)

                    manifest.append({
                        "index": len(manifest),
                        "file": f"/generated/gacha-banners/{filename}",
                        "width": width,
                        "height": height,
                        "sourceArchive": archive_path.name,
                        "sourceEntry": info.filename,
                        "sha1": digest,
                        "note": "Candidate extracted from CDN path dynamic/gacha_banner/*; ID mapping requires manual verification.",
                    })

    MANIFEST_PATH.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Extracted {len(manifest)} gacha banner candidates.")
    print(f"Manifest: {MANIFEST_PATH}")
    print(f"Images: {PUBLIC_OUTPUT}")


if __name__ == "__main__":
    main()
