import argparse
import pathlib
import zipfile
import zlib


SOURCE_ARCHIVE = pathlib.Path(".cdn/ko/archive-common-full/asset-2.1.0-89-fc81ec70.zip")
WEEK_EVENT_ENTRY = "production/upload/4c/b71440a3399b320dc49a84d6b6cde23f569593"
DEFAULT_OUTPUT = pathlib.Path(".cdn/mods/week-event-unlock.zip")


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
            yield offset, offset + consumed, decoded
            offset += consumed
        else:
            offset += 1


def patch_week_event_table(data: bytes, start_date: str) -> tuple[bytes, int]:
    patched_data = bytearray()
    cursor = 0
    patched_count = 0

    for start, end, decoded in iter_zlib_streams(data):
        try:
            text = decoded.decode("utf-8", "strict")
        except UnicodeDecodeError:
            continue
        fields = text.split(",")
        should_patch = False
        if fields and fields[0].isdigit():
            quest_id = int(fields[0])
            should_patch = 13001 <= quest_id <= 18006

        if should_patch and len(fields) > 4:
            fields[4] = start_date
            next_text = ",".join(fields)
            next_decoded = next_text.encode("utf-8")
            compressed = zlib.compress(next_decoded)
            patched_data.extend(data[cursor:start])
            patched_data.extend(compressed)
            cursor = end
            patched_count += 1

    patched_data.extend(data[cursor:])
    return bytes(patched_data), patched_count


def main():
    parser = argparse.ArgumentParser(
        description="Create a CDN mod that makes Korean week-event labyrinth quests available from the chosen date."
    )
    parser.add_argument("--source", type=pathlib.Path, default=SOURCE_ARCHIVE)
    parser.add_argument("--entry", default=WEEK_EVENT_ENTRY)
    parser.add_argument("--output", type=pathlib.Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--start-date", default="2021-07-24 00:00:00")
    args = parser.parse_args()

    if len(args.start_date) != 19:
        raise ValueError("--start-date must use YYYY-MM-DD HH:MM:SS")

    with zipfile.ZipFile(args.source, "r") as source_zip:
        source_data = source_zip.read(args.entry)

    patched_data, patched_count = patch_week_event_table(source_data, args.start_date)
    if patched_count == 0:
        raise RuntimeError("No week-event quest records were patched.")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(args.output, "w", compression=zipfile.ZIP_DEFLATED) as mod_zip:
        mod_zip.writestr(args.entry, patched_data)

    print(f"Wrote {args.output} with {patched_count} patched week-event quest records.")


if __name__ == "__main__":
    main()
