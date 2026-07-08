import json
import hashlib
import pathlib
import struct
import zipfile
import zlib


WEEK_EVENT_GROUP_ARCHIVE = pathlib.Path(".cdn/ko/archive-common-full/asset-2.1.0-243-cda31b70.zip")
WEEK_EVENT_GROUP_ENTRY = "production/upload/d9/15af344745e3145bef11b4e626e1c94c2c77ec"
DEFAULT_OUTPUT = pathlib.Path(".generated/event-catalog.json")
EVENT_BANNER_OUTPUT = pathlib.Path(".generated/event-banners.json")
EVENT_BANNER_PUBLIC_DIR = pathlib.Path(".generated/public/event-banners")
CDN_ROOT = pathlib.Path(".cdn/ko")


def iter_zlib_streams(data: bytes):
    offset = 0
    while True:
        offset = data.find(b"\x78", offset)
        if offset < 0:
            return

        if offset + 1 >= len(data) or data[offset + 1] not in (0x01, 0x5E, 0x9C, 0xDA):
            offset += 1
            continue

        decompressor = zlib.decompressobj()
        try:
            decoded = decompressor.decompress(data[offset:])
            decoded += decompressor.flush()
        except zlib.error:
            offset += 1
            continue

        consumed = len(data[offset:]) - len(decompressor.unused_data)
        if consumed > 0:
            yield offset, decoded
            offset += consumed
        else:
            offset += 1


def parse_week_event_group(fields: list[str], offset: int) -> dict | None:
    if len(fields) < 18:
        return None
    if not fields[0].startswith("week_"):
        return None
    if "quest/event/banner/week_event/" not in fields[3]:
        return None

    return {
        "id": fields[0],
        "name": fields[1],
        "eventType": fields[15],
        "bannerPath": fields[3],
        "backgroundPath": fields[5],
        "days": {
            "mon": fields[8] == "true",
            "tue": fields[9] == "true",
            "wed": fields[10] == "true",
            "thu": fields[11] == "true",
            "fri": fields[12] == "true",
            "sat": fields[13] == "true",
            "sun": fields[14] == "true",
        },
        "availableFrom": fields[16],
        "availableUntil": None if fields[17] == "(None)" else fields[17],
        "closeAt": None if fields[18] == "(None)" else fields[18],
        "sourceArchive": str(WEEK_EVENT_GROUP_ARCHIVE).replace("\\", "/"),
        "sourceEntry": WEEK_EVENT_GROUP_ENTRY,
        "sourceOffset": offset,
    }


def read_png_size(header: bytes) -> tuple[int, int] | None:
    if header[:4] not in (b"\x89PNG", b"\x89png"):
        return None
    if header[4:8] != b"\r\n\x1a\n":
        return None
    return struct.unpack(">II", header[16:24])


def iter_archive_roots() -> list[pathlib.Path]:
    return [
        CDN_ROOT / "archive-common-full",
        CDN_ROOT / "archive-android-full",
        CDN_ROOT / "archive-android_medium-full",
        CDN_ROOT / "archive-android_small-full",
    ]


def extract_event_banner_candidates() -> list[dict]:
    EVENT_BANNER_PUBLIC_DIR.mkdir(parents=True, exist_ok=True)
    for existing in EVENT_BANNER_PUBLIC_DIR.glob("*.png"):
        existing.unlink()

    seen: set[str] = set()
    manifest: list[dict] = []

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
                    if size != (1000, 184):
                        continue

                    data = archive.read(info)
                    fixed_png = b"\x89PNG" + data[4:] if data[:4] == b"\x89png" else data
                    digest = hashlib.sha1(fixed_png).hexdigest()
                    if digest in seen:
                        continue
                    seen.add(digest)

                    filename = f"{len(manifest):04d}_{digest[:12]}.png"
                    (EVENT_BANNER_PUBLIC_DIR / filename).write_bytes(fixed_png)

                    manifest.append({
                        "index": len(manifest),
                        "file": f"/generated/event-banners/{filename}",
                        "width": 1000,
                        "height": 184,
                        "sourceArchive": str(archive_path).replace("\\", "/"),
                        "sourceEntry": info.filename,
                        "sha1": digest,
                        "note": "1000x184 Korean event banner candidate extracted from CDN PNG files.",
                    })

    EVENT_BANNER_OUTPUT.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return manifest


def main():
    if not WEEK_EVENT_GROUP_ARCHIVE.exists():
        raise FileNotFoundError(f"Missing CDN archive: {WEEK_EVENT_GROUP_ARCHIVE}")

    events = []
    with zipfile.ZipFile(WEEK_EVENT_GROUP_ARCHIVE, "r") as source_zip:
        data = source_zip.read(WEEK_EVENT_GROUP_ENTRY)

    for offset, decoded in iter_zlib_streams(data):
        try:
            text = decoded.decode("utf-8", "strict")
        except UnicodeDecodeError:
            continue

        event = parse_week_event_group(text.split(","), offset)
        if event is not None:
            events.append(event)

    DEFAULT_OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    DEFAULT_OUTPUT.write_text(json.dumps({
        "source": "cdn-week-event-group-table",
        "eventGroups": events,
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    banners = extract_event_banner_candidates()
    print(f"Wrote {DEFAULT_OUTPUT} with {len(events)} event group rows.")
    print(f"Wrote {EVENT_BANNER_OUTPUT} with {len(banners)} event banner candidates.")


if __name__ == "__main__":
    main()
