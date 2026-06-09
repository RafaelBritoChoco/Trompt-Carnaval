#!/usr/bin/env python3
from __future__ import annotations

import argparse
import copy
import json
import re
import shutil
import unicodedata
import zipfile
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
import xml.etree.ElementTree as ET

STEP_PC = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
PT_NAMES = {
    ("C", 0): "Do",
    ("C", 1): "Do#",
    ("D", -1): "Reb",
    ("D", 0): "Re",
    ("D", 1): "Re#",
    ("E", -1): "Mib",
    ("E", 0): "Mi",
    ("F", 0): "Fa",
    ("F", 1): "Fa#",
    ("G", -1): "Solb",
    ("G", 0): "Sol",
    ("G", 1): "Sol#",
    ("A", -1): "Lab",
    ("A", 0): "La",
    ("A", 1): "La#",
    ("B", -1): "Sib",
    ("B", 0): "Si",
}


def slugify(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value)
    ascii_value = normalized.encode("ascii", "ignore").decode("ascii")
    cleaned = re.sub(r"[^a-zA-Z0-9]+", "-", ascii_value).strip("-").lower()
    return cleaned or "score"


def midi_number(step: str, alter: int, octave: int) -> int:
    return (octave + 1) * 12 + STEP_PC[step] + alter


def fingering(step: str, alter: int, octave: int) -> list[str]:
    chart = {
        54: ["1", "2", "3"],
        55: ["1", "3"],
        56: ["2", "3"],
        57: ["1", "2"],
        58: ["1"],
        59: ["2"],
        60: ["0"],
        61: ["1", "2", "3"],
        62: ["1", "3"],
        63: ["2", "3"],
        64: ["1", "2"],
        65: ["1"],
        66: ["2"],
        67: ["0"],
        68: ["2", "3"],
        69: ["1", "2"],
        70: ["1"],
        71: ["2"],
        72: ["0"],
        73: ["1", "2"],
        74: ["1"],
        75: ["2"],
        76: ["0"],
        77: ["1"],
        78: ["2"],
        79: ["0"],
        80: ["2", "3"],
        81: ["1", "2"],
        82: ["1"],
        83: ["2"],
        84: ["0"],
    }
    midi = midi_number(step, alter, octave)
    if midi in chart:
        return chart[midi]
    pc_chart = {
        0: ["0"],
        1: ["1", "2"],
        2: ["1"],
        3: ["2"],
        4: ["0"],
        5: ["1"],
        6: ["2"],
        7: ["0"],
        8: ["2", "3"],
        9: ["1", "2"],
        10: ["1"],
        11: ["2"],
    }
    return pc_chart[midi % 12]


def written_name(step: str, alter: int, octave: int) -> str:
    acc = {-2: "bb", -1: "b", 0: "", 1: "#", 2: "##"}.get(alter, "")
    return f"{step}{acc}{octave}"


def label_pt(step: str, alter: int, octave: int) -> str:
    return f"{PT_NAMES.get((step, alter), written_name(step, alter, octave)[:-1])}{octave}"


def midi_to_sharp_spelling(midi: int) -> tuple[str, int, int]:
    names = [
        ("C", 0),
        ("C", 1),
        ("D", 0),
        ("D", 1),
        ("E", 0),
        ("F", 0),
        ("F", 1),
        ("G", 0),
        ("G", 1),
        ("A", 0),
        ("A", 1),
        ("B", 0),
    ]
    step, alter = names[midi % 12]
    return step, alter, midi // 12 - 1


def tpc_to_step_alter(tpc: int) -> tuple[str, int]:
    base_steps = ["C", "G", "D", "A", "E", "B", "F"]
    fifths = tpc - 14
    step = base_steps[fifths % 7]
    alter = (fifths + 1) // 7 if fifths >= 0 else -((-fifths + 5) // 7)
    return step, alter


def duration_type_beats(duration_type: str) -> float:
    values = {
        "measure": 4.0,
        "whole": 4.0,
        "half": 2.0,
        "quarter": 1.0,
        "eighth": 0.5,
        "16th": 0.25,
        "32nd": 0.125,
    }
    return values.get(duration_type, 1.0)


def duration_type_name(beats: float) -> str:
    if beats >= 4:
        return "whole"
    if beats >= 2:
        return "half"
    if beats >= 1:
        return "quarter"
    if beats >= 0.5:
        return "eighth"
    if beats >= 0.25:
        return "16th"
    return "32nd"


def read_musicxml(path: Path) -> tuple[ET.Element, str]:
    if path.suffix.lower() == ".mxl":
        with zipfile.ZipFile(path) as zf:
            score_name = next(
                (n for n in zf.namelist() if n.lower().endswith((".xml", ".musicxml")) and not n.startswith("META-INF/")),
                None,
            )
            if not score_name:
                raise ValueError(f"No MusicXML in {path}")
            raw = zf.read(score_name).decode("utf-8")
            return ET.fromstring(raw), raw
    raw = path.read_text(encoding="utf-8")
    return ET.fromstring(raw), raw


def read_mscz(path: Path) -> ET.Element:
    with zipfile.ZipFile(path) as zf:
        score_name = next((n for n in zf.namelist() if n.lower().endswith(".mscx")), None)
        if not score_name:
            raise ValueError(f"No MuseScore XML in {path}")
        raw = zf.read(score_name).decode("utf-8")
        return ET.fromstring(raw)


def part_names(root: ET.Element) -> dict[str, str]:
    names: dict[str, str] = {}
    part_list = root.find("part-list")
    if part_list is None:
        return names
    for score_part in part_list.findall("score-part"):
        pid = score_part.get("id")
        if not pid:
            continue
        name = score_part.findtext("part-name") or ""
        abbr = score_part.findtext("part-abbreviation") or ""
        names[pid] = f"{name} {abbr}".strip()
    return names


def select_trumpet_part(root: ET.Element) -> tuple[ET.Element, str]:
    names = part_names(root)
    parts = root.findall("part")
    for part in root.findall("part"):
        pid = part.get("id", "")
        name = names.get(pid, pid)
        if re.search(r"trumpet|tpt", name, re.I):
            return part, name
    if len(parts) == 1:
        part = parts[0]
        pid = part.get("id", "")
        return part, names.get(pid, pid) or "Trumpet"
    raise ValueError("No trumpet part found")


def trumpet_only_musicxml(root: ET.Element, part_id: str) -> str:
    filtered = copy.deepcopy(root)
    part_list = filtered.find("part-list")
    if part_list is not None:
        for child in list(part_list):
            if child.tag == "score-part" and child.get("id") != part_id:
                part_list.remove(child)
            elif child.tag == "part-group":
                part_list.remove(child)
    for part in list(filtered.findall("part")):
        if part.get("id") != part_id:
            filtered.remove(part)
    return "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n" + ET.tostring(filtered, encoding="unicode")


def extract_notes(part: ET.Element) -> tuple[list[dict], int, float]:
    notes: list[dict] = []
    divisions = 1
    abs_measure_start = 0.0
    total_measures = 0
    index = 0

    for measure in part.findall("measure"):
        total_measures += 1
        measure_number = int(re.match(r"\d+", measure.get("number", str(total_measures))).group(0))
        attrs = measure.find("attributes")
        if attrs is not None and attrs.findtext("divisions"):
            divisions = int(attrs.findtext("divisions") or divisions)
        cursor = 0.0
        max_cursor = 0.0
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
            duration_beats = float(child.findtext("duration") or 0) / divisions
            pitch = child.find("pitch")
            if pitch is not None:
                step = pitch.findtext("step") or "C"
                alter = int(pitch.findtext("alter") or 0)
                octave = int(pitch.findtext("octave") or 4)
                tie_el = child.find("tie")
                tie = tie_el.get("type") if tie_el is not None else None
                notes.append(
                    {
                        "index": index,
                        "measure": measure_number,
                        "beat": round(cursor + 1, 4),
                        "absBeat": round(abs_measure_start + cursor, 4),
                        "durationBeats": round(duration_beats, 4),
                        "written": written_name(step, alter, octave),
                        "labelPt": label_pt(step, alter, octave),
                        "fingering": fingering(step, alter, octave),
                        "tie": tie,
                    }
                )
                index += 1
            cursor += duration_beats
            max_cursor = max(max_cursor, cursor)
        abs_measure_start += max(max_cursor, 4.0)

    return notes, total_measures, abs_measure_start


def mscz_work_title(root: ET.Element) -> str:
    score = root.find("Score")
    if score is None:
        return ""
    for meta in score.findall("metaTag"):
        if meta.get("name") == "workTitle":
            return meta.text or ""
    return ""


def mscz_trumpet_staff(root: ET.Element) -> tuple[ET.Element, str]:
    score = root.find("Score")
    if score is None:
        raise ValueError("No Score element in MuseScore XML")
    for part in score.findall("Part"):
        track_name = part.findtext("trackName") or ""
        instrument_id = part.find("Instrument").get("id", "") if part.find("Instrument") is not None else ""
        if re.search(r"trumpet|trompete|bb-trumpet", f"{track_name} {instrument_id}", re.I):
            staff_ref = part.find("Staff")
            if staff_ref is None or not staff_ref.get("id"):
                break
            staff_id = staff_ref.get("id")
            staff = next((item for item in score.findall("Staff") if item.get("id") == staff_id), None)
            if staff is not None:
                return staff, track_name
    raise ValueError("No trumpet staff found in MuseScore XML")


def mscz_duration_beats(element: ET.Element) -> float:
    beats = duration_type_beats(element.findtext("durationType") or "quarter")
    dots_text = element.findtext("dots")
    dots = int(dots_text) if dots_text and dots_text.isdigit() else 0
    add = beats / 2
    for _ in range(dots):
        beats += add
        add /= 2
    return beats


def mscz_written_pitch(note: ET.Element) -> tuple[str, int, int]:
    # MuseScore stores sounding pitch for transposing instruments here. Trumpet in Bb written pitch is +2 semitones.
    sounding_midi = int(note.findtext("pitch") or 60)
    return midi_to_sharp_spelling(sounding_midi + 2)


def mscz_measure_events(staff: ET.Element) -> tuple[list[list[dict]], list[dict], int, float]:
    measures: list[list[dict]] = []
    notes: list[dict] = []
    abs_measure_start = 0.0
    note_index = 0

    for measure_number, measure in enumerate(staff.findall("Measure"), start=1):
        cursor = 0.0
        max_cursor = 0.0
        events: list[dict] = []
        voice = measure.find("voice")
        if voice is None:
            measures.append(events)
            abs_measure_start += 4.0
            continue
        for child in voice:
            if child.tag not in {"Chord", "Rest"}:
                continue
            duration_beats = mscz_duration_beats(child)
            if child.tag == "Chord":
                source_note = child.find("Note")
                if source_note is not None:
                    step, alter, octave = mscz_written_pitch(source_note)
                    note_data = {
                        "index": note_index,
                        "measure": measure_number,
                        "beat": round(cursor + 1, 4),
                        "absBeat": round(abs_measure_start + cursor, 4),
                        "durationBeats": round(duration_beats, 4),
                        "written": written_name(step, alter, octave),
                        "labelPt": label_pt(step, alter, octave),
                        "fingering": fingering(step, alter, octave),
                        "tie": None,
                    }
                    notes.append(note_data)
                    events.append({"kind": "note", "step": step, "alter": alter, "octave": octave, "durationBeats": duration_beats})
                    note_index += 1
            else:
                events.append({"kind": "rest", "durationBeats": duration_beats})
            cursor += duration_beats
            max_cursor = max(max_cursor, cursor)
        measures.append(events)
        abs_measure_start += max_cursor or 4.0

    return measures, notes, len(measures), abs_measure_start


def mscz_events_to_musicxml(title: str, measures: list[list[dict]]) -> str:
    score = ET.Element("score-partwise", version="3.1")
    work = ET.SubElement(score, "work")
    ET.SubElement(work, "work-title").text = title
    part_list = ET.SubElement(score, "part-list")
    score_part = ET.SubElement(part_list, "score-part", id="P1")
    ET.SubElement(score_part, "part-name").text = "Trumpet in Bb"
    ET.SubElement(score_part, "part-abbreviation").text = "Tpt. in Bb"
    part = ET.SubElement(score, "part", id="P1")
    divisions = 4

    for index, events in enumerate(measures, start=1):
        measure = ET.SubElement(part, "measure", number=str(index))
        if index == 1:
            attrs = ET.SubElement(measure, "attributes")
            ET.SubElement(attrs, "divisions").text = str(divisions)
            key = ET.SubElement(attrs, "key")
            ET.SubElement(key, "fifths").text = "0"
            time = ET.SubElement(attrs, "time")
            ET.SubElement(time, "beats").text = "4"
            ET.SubElement(time, "beat-type").text = "4"
            clef = ET.SubElement(attrs, "clef")
            ET.SubElement(clef, "sign").text = "G"
            ET.SubElement(clef, "line").text = "2"

        for event in events:
            note = ET.SubElement(measure, "note")
            if event["kind"] == "rest":
                ET.SubElement(note, "rest")
            else:
                pitch = ET.SubElement(note, "pitch")
                ET.SubElement(pitch, "step").text = event["step"]
                if event["alter"]:
                    ET.SubElement(pitch, "alter").text = str(event["alter"])
                ET.SubElement(pitch, "octave").text = str(event["octave"])
            duration = max(1, int(round(event["durationBeats"] * divisions)))
            ET.SubElement(note, "duration").text = str(duration)
            ET.SubElement(note, "type").text = duration_type_name(event["durationBeats"])

    return "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n" + ET.tostring(score, encoding="unicode")


def first_file(folder: Path, extensions: tuple[str, ...]) -> Path | None:
    for path in sorted(folder.iterdir()):
        if path.is_file() and path.suffix.lower() in extensions:
            return path
    return None


def preferred_file(folder: Path, extensions: tuple[str, ...], pattern: str) -> Path | None:
    candidates = sorted([path for path in folder.iterdir() if path.is_file() and path.suffix.lower() in extensions], key=lambda p: p.name.casefold())
    for path in candidates:
        if re.search(pattern, path.name, re.I):
            return path
    return candidates[0] if candidates else None


def unique_copy(src: Path, dest_dir: Path, name: str) -> str:
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / name
    shutil.copy2(src, dest)
    return dest.name


def import_repertoire(root_dir: Path, app_public: Path) -> dict:
    scores_dir = app_public / "scores"
    audio_dir = app_public / "audio"
    fingerings_dir = app_public / "fingerings"
    sources_dir = app_public / "sources"
    data_dir = app_public / "data" / "songs"
    for directory in (scores_dir, audio_dir, fingerings_dir, sources_dir, data_dir):
        directory.mkdir(parents=True, exist_ok=True)

    fingerings_source = root_dir / "Trompete com Fingerings"
    songs = []
    pending = []

    ignored_folders = {"Trompete com Fingerings", "Leitor de Partituras"}
    for folder in sorted([p for p in root_dir.iterdir() if p.is_dir() and p.name not in ignored_folders], key=lambda p: p.name.casefold()):
        song_id = slugify(folder.name)
        pdf = first_file(folder, (".pdf",))
        mxl = first_file(folder, (".mxl", ".musicxml", ".xml"))
        mscz = first_file(folder, (".mscz",))
        visual_pdf = preferred_file(folder, (".pdf",), r"trumpet|trompete|tompete|tpt|bb|sib")
        visual_image = preferred_file(folder, (".png", ".jpg", ".jpeg", ".webp"), r"trumpet|trompete|tompete|tpt|bb|sib")
        audio = first_file(folder, (".wav", ".mp3", ".m4a"))
        if not pdf or not mxl:
            source_image_rel = None
            source_pdf_rel = None
            if visual_image:
                image_name = unique_copy(visual_image, sources_dir, f"{song_id}{visual_image.suffix.lower()}")
                source_image_rel = f"sources/{image_name}"
            if visual_pdf:
                pdf_name = unique_copy(visual_pdf, sources_dir, f"{song_id}{visual_pdf.suffix.lower()}")
                source_pdf_rel = f"sources/{pdf_name}"

            audio_rel = None
            if audio:
                audio_name = unique_copy(audio, audio_dir, f"{song_id}{audio.suffix.lower()}")
                audio_rel = f"audio/{audio_name}"

            if mscz:
                try:
                    mscz_root = read_mscz(mscz)
                    work_title = mscz_work_title(mscz_root)
                    if slugify(work_title) == song_id:
                        staff, part_name = mscz_trumpet_staff(mscz_root)
                        measure_events, notes, total_measures, total_beats = mscz_measure_events(staff)
                        score_name = f"{song_id}.musicxml"
                        (scores_dir / score_name).write_text(mscz_events_to_musicxml(folder.name, measure_events), encoding="utf-8")
                        song_data = {
                            "id": song_id,
                            "title": folder.name,
                            "folder": folder.name,
                            "status": "ready",
                            "musicxml": f"scores/{score_name}",
                            "audio": audio_rel,
                            "fingeringsPdf": None,
                            "sourceImage": source_image_rel,
                            "sourcePdf": source_pdf_rel,
                            "data": f"data/songs/{song_id}.json",
                            "defaultBpm": 100,
                            "trumpetPart": part_name,
                            "totalMeasures": total_measures,
                            "totalBeats": round(total_beats, 4),
                            "notesCount": len(notes),
                            "notes": notes,
                        }
                        (data_dir / f"{song_id}.json").write_text(json.dumps(song_data, ensure_ascii=False, indent=2), encoding="utf-8")
                        catalog_entry = {k: v for k, v in song_data.items() if k != "notes"}
                        songs.append(catalog_entry)
                        continue
                except Exception as error:
                    print(f"mscz_skip={folder.name}: {error}")

            reason = "needs_musicxml_export" if mscz else ("needs_transcription" if source_image_rel or source_pdf_rel else "missing_source")
            status = "needs_transcription" if source_image_rel or source_pdf_rel or mscz else "missing_source"
            song_data = {
                "id": song_id,
                "title": folder.name,
                "folder": folder.name,
                "status": status,
                "reason": reason,
                "musicxml": None,
                "audio": audio_rel,
                "fingeringsPdf": None,
                "sourceImage": source_image_rel,
                "sourcePdf": source_pdf_rel,
                "data": f"data/songs/{song_id}.json",
                "defaultBpm": 100,
                "trumpetPart": "",
                "totalMeasures": 0,
                "totalBeats": 0,
                "notesCount": 0,
                "notes": [],
            }
            (data_dir / f"{song_id}.json").write_text(json.dumps(song_data, ensure_ascii=False, indent=2), encoding="utf-8")
            catalog_entry = {k: v for k, v in song_data.items() if k != "notes"}
            songs.append(catalog_entry)
            if status != "needs_transcription":
                pending.append(catalog_entry)
            continue

        root, raw_xml = read_musicxml(mxl)
        part, part_name = select_trumpet_part(root)
        notes, total_measures, total_beats = extract_notes(part)
        score_name = f"{song_id}.musicxml"
        (scores_dir / score_name).write_text(trumpet_only_musicxml(root, part.get("id", "")), encoding="utf-8")

        audio_rel = None
        if audio:
            audio_name = unique_copy(audio, audio_dir, f"{song_id}{audio.suffix.lower()}")
            audio_rel = f"audio/{audio_name}"

        fingering_rel = None
        fingering_pdf = fingerings_source / f"{folder.name} - Trompete com Fingerings.pdf"
        if fingering_pdf.exists():
            fingering_name = unique_copy(fingering_pdf, fingerings_dir, f"{song_id}-trompete-fingerings.pdf")
            fingering_rel = f"fingerings/{fingering_name}"

        song_data = {
            "id": song_id,
            "title": folder.name,
            "folder": folder.name,
            "status": "ready",
            "musicxml": f"scores/{score_name}",
            "audio": audio_rel,
            "fingeringsPdf": fingering_rel,
            "data": f"data/songs/{song_id}.json",
            "defaultBpm": 100,
            "trumpetPart": part_name,
            "totalMeasures": total_measures,
            "totalBeats": round(total_beats, 4),
            "notesCount": len(notes),
            "notes": notes,
        }
        (data_dir / f"{song_id}.json").write_text(json.dumps(song_data, ensure_ascii=False, indent=2), encoding="utf-8")
        catalog_entry = {k: v for k, v in song_data.items() if k != "notes"}
        songs.append(catalog_entry)

    catalog = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "sourceRoot": str(root_dir),
        "songs": songs,
        "pending": pending,
    }
    (app_public / "data").mkdir(parents=True, exist_ok=True)
    (app_public / "data" / "catalog.json").write_text(json.dumps(catalog, ensure_ascii=False, indent=2), encoding="utf-8")
    return catalog


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default=r"C:\Users\rafae\OneDrive\Desktop\Bloco de Carnaval")
    parser.add_argument("--public", default=str(Path(__file__).resolve().parents[1] / "public"))
    args = parser.parse_args()
    catalog = import_repertoire(Path(args.root), Path(args.public))
    counts = Counter(song["status"] for song in catalog["songs"])
    print(f"ready={counts.get('ready', 0)}")
    print(f"needs_transcription={counts.get('needs_transcription', 0)}")
    print(f"visual_only={counts.get('visual_only', 0)}")
    print(f"missing_source={counts.get('missing_source', 0)}")
    print(f"pending={len(catalog['pending'])}")


if __name__ == "__main__":
    main()
