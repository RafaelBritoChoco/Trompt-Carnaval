#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import sys
import zipfile
from pathlib import Path
import xml.etree.ElementTree as ET

from import_repertoire import fingering


TRAINING_IDS = [
    "baile-de-favela",
    "meu-jeito-de-amar",
    "rap-da-felicidade",
    "malandramente",
    "vai-malandra",
    "lambafunk",
    "vira-de-ladinho",
    "rap-das-armas",
    "eu-vou-pro-baile-da-gaiola",
    "cheguei",
    "fala-mal-de-mim",
    "morto-muito-louco",
]


def read_xml(path: Path) -> ET.Element:
    if path.suffix.lower() == ".mxl":
        with zipfile.ZipFile(path) as archive:
            member = next(
                name
                for name in archive.namelist()
                if name.lower().endswith((".xml", ".musicxml")) and not name.startswith("META-INF/")
            )
            return ET.fromstring(archive.read(member))
    return ET.fromstring(path.read_bytes())


def pitch_name(note: ET.Element) -> str | None:
    pitch = note.find("pitch")
    if pitch is None:
        return None
    step = pitch.findtext("step") or "C"
    alter = int(float(pitch.findtext("alter") or 0))
    octave = int(pitch.findtext("octave") or 4)
    accidental = {-2: "bb", -1: "b", 0: "", 1: "#", 2: "##"}.get(alter, "")
    return f"{step}{accidental}{octave}"


def select_part(root: ET.Element) -> ET.Element:
    names = {
        part.get("id", ""): " ".join(filter(None, [part.findtext("part-name"), part.findtext("part-abbreviation")]))
        for part in root.findall("./part-list/score-part")
    }
    parts = root.findall("part")
    for part in parts:
        if re.search(r"trumpet|tpt|trompete", names.get(part.get("id", ""), ""), re.I):
            return part
    if len(parts) == 1:
        return parts[0]
    raise ValueError("trumpet part not found")


def parse_musicxml(path: Path) -> dict:
    root = read_xml(path)
    part = select_part(root)
    divisions = 1
    beats = 4
    beat_type = 4
    absolute_measure_start = 0.0
    notes: list[dict] = []
    signatures: list[str] = []

    for measure_index, measure in enumerate(part.findall("measure"), start=1):
        attributes = measure.find("attributes")
        if attributes is not None:
            divisions = int(attributes.findtext("divisions") or divisions)
            time = attributes.find("time")
            if time is not None:
                beats = int(time.findtext("beats") or beats)
                beat_type = int(time.findtext("beat-type") or beat_type)
        signature = f"{beats}/{beat_type}"
        if not signatures or signatures[-1] != signature:
            signatures.append(signature)

        expected_duration = beats * 4.0 / beat_type
        cursor = 0.0
        max_cursor = 0.0
        previous_note_start = 0.0
        for child in measure:
            if child.tag == "backup":
                cursor -= float(child.findtext("duration") or 0) / divisions
                continue
            if child.tag == "forward":
                cursor += float(child.findtext("duration") or 0) / divisions
                max_cursor = max(max_cursor, cursor)
                continue
            if child.tag != "note":
                continue

            duration = float(child.findtext("duration") or 0) / divisions
            is_chord = child.find("chord") is not None
            start = previous_note_start if is_chord else cursor
            if not is_chord:
                previous_note_start = start
            written = pitch_name(child)
            if written and child.find("grace") is None:
                ties = [tie.get("type") for tie in child.findall("tie") if tie.get("type")]
                notes.append(
                    {
                        "measure": int(re.match(r"\d+", measure.get("number", str(measure_index))).group(0)),
                        "beat": round(start + 1, 4),
                        "absBeat": round(absolute_measure_start + start, 4),
                        "durationBeats": round(duration, 4),
                        "written": written,
                        "ties": ties,
                    }
                )
            if not is_chord:
                cursor += duration
                max_cursor = max(max_cursor, cursor)

        implicit = measure.get("implicit") == "yes"
        measure_duration = max_cursor if implicit and max_cursor > 0 else max(expected_duration, max_cursor)
        absolute_measure_start += measure_duration

    tempos = []
    for sound in root.findall(".//sound"):
        value = sound.get("tempo")
        if value:
            tempos.append(float(value))
    for per_minute in root.findall(".//per-minute"):
        if per_minute.text:
            tempos.append(float(per_minute.text))

    return {
        "notes": notes,
        "totalBeats": round(absolute_measure_start, 4),
        "tempos": list(dict.fromkeys(round(value, 2) for value in tempos)),
        "signatures": signatures,
    }


def expected_fingering(written: str) -> list[str] | None:
    match = re.fullmatch(r"([A-G])(bb|##|b|#)?(-?\d+)", written)
    if not match:
        return None
    step, accidental, octave = match.groups()
    alter = {"bb": -2, "b": -1, None: 0, "#": 1, "##": 2}[accidental]
    return fingering(step, alter, int(octave))


def audit_song(public_dir: Path, song_id: str) -> dict:
    data_path = public_dir / "data" / "songs" / f"{song_id}.json"
    data = json.loads(data_path.read_text(encoding="utf-8-sig"))
    notes = data.get("notes", [])
    result = {
        "id": song_id,
        "status": data.get("status"),
        "bpm": data.get("defaultBpm"),
        "measures": data.get("totalMeasures"),
        "beats": data.get("totalBeats"),
        "notes": len(notes),
    }
    if not notes:
        result["source"] = data.get("sourcePdf") or data.get("sourceImage") or "missing"
        return result

    first = notes[0]
    last = notes[-1]
    result.update(
        {
            "first": f"c{first['measure']} t{first['beat']} {first['written']} abs={first['absBeat']}",
            "lastEnd": round(last["absBeat"] + last["durationBeats"], 4),
            "leadingRest": first["absBeat"],
            "maxGap": round(
                max(
                    [
                        max(0.0, current["absBeat"] - (previous["absBeat"] + previous["durationBeats"]))
                        for previous, current in zip(notes, notes[1:])
                    ]
                    or [0.0]
                ),
                4,
            ),
            "badFingerings": sum(
                1 for note in notes if expected_fingering(note["written"]) not in (None, note.get("fingering"))
            ),
            "nonMonotonic": sum(1 for previous, current in zip(notes, notes[1:]) if current["absBeat"] < previous["absBeat"]),
            "badDuration": sum(1 for note in notes if note["durationBeats"] <= 0),
        }
    )

    musicxml = data.get("musicxml")
    if musicxml:
        parsed = parse_musicxml(public_dir / musicxml)
        xml_notes = parsed["notes"]
        mismatches = []
        for index, (json_note, xml_note) in enumerate(zip(notes, xml_notes)):
            if (
                json_note["written"] != xml_note["written"]
                or abs(json_note["absBeat"] - xml_note["absBeat"]) > 0.001
                or abs(json_note["durationBeats"] - xml_note["durationBeats"]) > 0.001
            ):
                mismatches.append(index)
        result.update(
            {
                "xmlNotes": len(xml_notes),
                "xmlBeats": parsed["totalBeats"],
                "xmlTempos": parsed["tempos"],
                "time": parsed["signatures"],
                "xmlMismatches": len(mismatches) + abs(len(notes) - len(xml_notes)),
                "firstMismatch": mismatches[0] if mismatches else None,
            }
        )
    return result


def main() -> int:
    public_dir = Path(__file__).resolve().parents[1] / "public"
    failed = False
    for song_id in TRAINING_IDS:
        result = audit_song(public_dir, song_id)
        print(json.dumps(result, ensure_ascii=False, sort_keys=True))
        if result.get("status") == "ready" and any(
            result.get(key, 0) for key in ("badFingerings", "nonMonotonic", "badDuration", "xmlMismatches")
        ):
            failed = True
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
