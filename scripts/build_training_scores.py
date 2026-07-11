#!/usr/bin/env python3
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
import xml.etree.ElementTree as ET

from import_repertoire import (
    DEFAULT_BPMS,
    extract_notes,
    midi_number,
    midi_to_sharp_spelling,
    mscz_events_to_musicxml,
    mscz_measure_events,
    mscz_trumpet_staff,
    read_mscz,
    read_musicxml,
    select_trumpet_part,
    trumpet_only_musicxml,
)


ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
SONG_DIR = PUBLIC / "data" / "songs"
SCORE_DIR = PUBLIC / "scores"
SOURCE_DIR = ROOT / "scripts" / "transcription-sources"

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


def load_song(song_id: str) -> dict:
    return json.loads((SONG_DIR / f"{song_id}.json").read_text(encoding="utf-8-sig"))


def write_song(song: dict) -> None:
    (SONG_DIR / f"{song['id']}.json").write_text(
        json.dumps(song, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def set_tempo(root: ET.Element, bpm: int) -> None:
    changed = False
    for sound in root.findall(".//sound"):
        if sound.get("tempo") is not None:
            sound.set("tempo", str(bpm))
            changed = True
    for value in root.findall(".//per-minute"):
        value.text = str(bpm)
        changed = True
    if changed:
        return

    part = root.find("part")
    measure = part.find("measure") if part is not None else None
    if measure is None:
        return
    direction = ET.Element("direction", placement="above")
    direction_type = ET.SubElement(direction, "direction-type")
    metronome = ET.SubElement(direction_type, "metronome")
    ET.SubElement(metronome, "beat-unit").text = "quarter"
    ET.SubElement(metronome, "per-minute").text = str(bpm)
    ET.SubElement(direction, "sound", tempo=str(bpm))
    insert_at = 1 if measure.find("attributes") is not None else 0
    measure.insert(insert_at, direction)


def set_part_name(root: ET.Element) -> None:
    for score_part in root.findall("./part-list/score-part"):
        name = score_part.find("part-name")
        if name is None:
            name = ET.SubElement(score_part, "part-name")
        name.text = "Trumpet in Bb"
        abbreviation = score_part.find("part-abbreviation")
        if abbreviation is None:
            abbreviation = ET.SubElement(score_part, "part-abbreviation")
        abbreviation.text = "Tpt. in Bb"


def transpose_part(part: ET.Element, semitones: int) -> None:
    if not semitones:
        return
    for pitch in part.findall(".//pitch"):
        step = pitch.findtext("step") or "C"
        alter = int(float(pitch.findtext("alter") or 0))
        octave = int(pitch.findtext("octave") or 4)
        next_step, next_alter, next_octave = midi_to_sharp_spelling(midi_number(step, alter, octave) + semitones)
        pitch.find("step").text = next_step
        alter_element = pitch.find("alter")
        if next_alter:
            if alter_element is None:
                alter_element = ET.SubElement(pitch, "alter")
            alter_element.text = str(next_alter)
        elif alter_element is not None:
            pitch.remove(alter_element)
        pitch.find("octave").text = str(next_octave)


def import_musicxml(song_id: str, source_name: str, semitones: int = 0, key_fifths: int | None = None) -> None:
    song = load_song(song_id)
    bpm = DEFAULT_BPMS[song_id]
    root, _ = read_musicxml(SOURCE_DIR / source_name)
    part, _ = select_trumpet_part(root)
    transpose_part(part, semitones)
    if key_fifths is not None:
        fifths = part.find("./measure/attributes/key/fifths")
        if fifths is not None:
            fifths.text = str(key_fifths)
    set_part_name(root)
    set_tempo(root, bpm)
    notes, total_measures, total_beats = extract_notes(part)
    score_name = f"{song_id}.musicxml"
    score_root = ET.fromstring(trumpet_only_musicxml(root, part.get("id", "")))
    ET.indent(score_root, space="  ")
    (SCORE_DIR / score_name).write_text(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n" + ET.tostring(score_root, encoding="unicode") + "\n",
        encoding="utf-8",
    )
    song.update(
        {
            "status": "ready",
            "musicxml": f"scores/{score_name}",
            "defaultBpm": bpm,
            "trumpetPart": "Trumpet in Bb",
            "totalMeasures": total_measures,
            "totalBeats": round(total_beats, 4),
            "notesCount": len(notes),
            "notes": notes,
        }
    )
    song.pop("reason", None)
    write_song(song)


def import_mscz(song_id: str, source_name: str) -> None:
    song = load_song(song_id)
    bpm = DEFAULT_BPMS[song_id]
    root = read_mscz(SOURCE_DIR / source_name)
    staff, _ = mscz_trumpet_staff(root)
    events, notes, total_measures, total_beats = mscz_measure_events(staff)
    score_name = f"{song_id}.musicxml"
    (SCORE_DIR / score_name).write_text(
        mscz_events_to_musicxml(song["title"], events, bpm),
        encoding="utf-8",
    )
    song.update(
        {
            "status": "ready",
            "musicxml": f"scores/{score_name}",
            "defaultBpm": bpm,
            "trumpetPart": "Trumpet in Bb",
            "totalMeasures": total_measures,
            "totalBeats": round(total_beats, 4),
            "notesCount": len(notes),
            "notes": notes,
        }
    )
    song.pop("reason", None)
    write_song(song)


def update_ready_tempos() -> None:
    for song_id in TRAINING_IDS:
        song = load_song(song_id)
        bpm = DEFAULT_BPMS[song_id]
        song["defaultBpm"] = bpm
        write_song(song)
        if song.get("status") != "ready" or not song.get("musicxml"):
            continue
        score_path = PUBLIC / song["musicxml"]
        root = ET.fromstring(score_path.read_bytes())
        set_tempo(root, bpm)
        score_path.write_text(
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n" + ET.tostring(root, encoding="unicode"),
            encoding="utf-8",
        )


def rebuild_catalog() -> None:
    catalog_path = PUBLIC / "data" / "catalog.json"
    catalog = json.loads(catalog_path.read_text(encoding="utf-8-sig"))
    replacements = {song_id: load_song(song_id) for song_id in TRAINING_IDS}
    songs = []
    for entry in catalog["songs"]:
        source = replacements.get(entry["id"])
        songs.append({key: value for key, value in (source or entry).items() if key != "notes"})
    catalog["songs"] = songs
    catalog["pending"] = [song for song in songs if song.get("status") not in {"ready", "needs_transcription"}]
    catalog["generatedAt"] = datetime.now(timezone.utc).isoformat()
    catalog_path.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    # Alto sax in E-flat to B-flat trumpet: transpose written notes down a perfect fifth.
    import_musicxml("malandramente", "malandramente-sax-alto.mxl", semitones=-7, key_fifths=3)
    import_musicxml("morto-muito-louco", "morto-muito-louco.mxl")
    import_mscz("vira-de-ladinho", "vira-de-ladinho.mscz")
    import_mscz("cheguei", "cheguei.mscz")
    update_ready_tempos()
    rebuild_catalog()
    print("training scores rebuilt")


if __name__ == "__main__":
    main()
