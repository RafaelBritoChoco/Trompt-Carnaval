import type { ScoreNote, Song, SongData } from "./types";

export type EditorEvent = {
  id: string;
  kind: "note" | "rest";
  written?: string;
  durationBeats: number;
};

export type UserSongDraft = {
  schemaVersion: 1;
  id: string;
  title: string;
  defaultBpm: number;
  beatsPerMeasure: 2 | 3 | 4;
  events: EditorEvent[];
  createdAt: string;
  updatedAt: string;
};

export const editorStorageKey = "bloco-user-songs-v1";

export const editorPitches = [
  { value: "C", label: "Do" },
  { value: "C#", label: "Do#" },
  { value: "D", label: "Re" },
  { value: "Eb", label: "Mib" },
  { value: "E", label: "Mi" },
  { value: "F", label: "Fa" },
  { value: "F#", label: "Fa#" },
  { value: "G", label: "Sol" },
  { value: "Ab", label: "Lab" },
  { value: "A", label: "La" },
  { value: "Bb", label: "Sib" },
  { value: "B", label: "Si" },
] as const;

export const editorDurations = [
  { value: 0.25, label: "1/4", name: "semicolcheia" },
  { value: 0.5, label: "1/2", name: "colcheia" },
  { value: 1, label: "1", name: "semínima" },
  { value: 2, label: "2", name: "mínima" },
  { value: 4, label: "4", name: "semibreve" },
] as const;

const pitchSemitones: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const fingeringChart: Record<number, string[]> = {
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
};

function makeId(prefix: string) {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  return `${prefix}-${random}`;
}

export function createEditorEvent(kind: "note" | "rest", written = "C5", durationBeats = 1): EditorEvent {
  return { id: makeId("evento"), kind, written: kind === "note" ? written : undefined, durationBeats };
}

export function createEmptyDraft(): UserSongDraft {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    id: makeId("minha-musica"),
    title: "Minha música",
    defaultBpm: 100,
    beatsPerMeasure: 4,
    events: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function cloneDraft(draft: UserSongDraft): UserSongDraft {
  return {
    ...draft,
    events: draft.events.map((event) => ({ ...event })),
  };
}

export function readUserSongs(): UserSongDraft[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(editorStorageKey) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isUserSongDraft).map(cloneDraft);
  } catch {
    return [];
  }
}

export function writeUserSongs(songs: UserSongDraft[]) {
  localStorage.setItem(editorStorageKey, JSON.stringify(songs));
}

function isUserSongDraft(value: unknown): value is UserSongDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<UserSongDraft>;
  return (
    draft.schemaVersion === 1 &&
    typeof draft.id === "string" &&
    typeof draft.title === "string" &&
    typeof draft.defaultBpm === "number" &&
    (draft.beatsPerMeasure === 2 || draft.beatsPerMeasure === 3 || draft.beatsPerMeasure === 4) &&
    Array.isArray(draft.events)
  );
}

export function parseEditorPitch(written: string) {
  const match = /^([A-G])([#b]?)(-?\d+)$/.exec(written);
  if (!match) return null;
  const [, step, accidental, octaveText] = match;
  const alter = accidental === "#" ? 1 : accidental === "b" ? -1 : 0;
  const octave = Number(octaveText);
  const midi = (octave + 1) * 12 + pitchSemitones[step] + alter;
  return { step, accidental, alter, octave, midi, pitchClass: `${step}${accidental}` };
}

export function editorPitchLabel(written: string) {
  const pitch = parseEditorPitch(written);
  if (!pitch) return written;
  const match = editorPitches.find((item) => item.value === pitch.pitchClass);
  return `${match?.label ?? pitch.pitchClass}${pitch.octave}`;
}

export function editorFingering(written: string) {
  const pitch = parseEditorPitch(written);
  if (!pitch) return ["-"];
  return fingeringChart[pitch.midi] ?? ["fora"];
}

export function withEditorOctave(written: string, octave: number) {
  const pitch = parseEditorPitch(written);
  return pitch ? `${pitch.pitchClass}${octave}` : `C${octave}`;
}

export function withEditorPitchClass(written: string, pitchClass: string) {
  const pitch = parseEditorPitch(written);
  return `${pitchClass}${pitch?.octave ?? 5}`;
}

export function eventStartBeat(events: EditorEvent[], eventId: string) {
  let beat = 0;
  for (const event of events) {
    if (event.id === eventId) return beat;
    beat += event.durationBeats;
  }
  return beat;
}

export function eventMeasure(events: EditorEvent[], eventId: string, beatsPerMeasure: number) {
  return Math.floor(eventStartBeat(events, eventId) / beatsPerMeasure) + 1;
}

type RenderSegment = {
  event: EditorEvent;
  measure: number;
  beat: number;
  absBeat: number;
  durationBeats: number;
  noteSegmentIndex: number;
  noteSegmentCount: number;
};

const notatableDurations = [4, 3, 2, 1.5, 1, 0.75, 0.5, 0.25];

function splitNotatable(duration: number) {
  const chunks: number[] = [];
  let remaining = Math.round(duration * 4) / 4;
  while (remaining > 0.001) {
    const chunk = notatableDurations.find((candidate) => candidate <= remaining + 0.001) ?? 0.25;
    chunks.push(chunk);
    remaining = Math.round((remaining - chunk) * 4) / 4;
  }
  return chunks;
}

function buildSegments(draft: UserSongDraft) {
  const segments: RenderSegment[] = [];
  let cursor = 0;
  draft.events.forEach((event) => {
    const eventPieces: Omit<RenderSegment, "noteSegmentIndex" | "noteSegmentCount">[] = [];
    let remaining = Math.max(0.25, Math.round(event.durationBeats * 4) / 4);
    while (remaining > 0.001) {
      const beatInMeasure = cursor % draft.beatsPerMeasure;
      const space = draft.beatsPerMeasure - beatInMeasure || draft.beatsPerMeasure;
      const withinMeasure = Math.min(remaining, space);
      splitNotatable(withinMeasure).forEach((durationBeats) => {
        eventPieces.push({
          event,
          measure: Math.floor(cursor / draft.beatsPerMeasure) + 1,
          beat: (cursor % draft.beatsPerMeasure) + 1,
          absBeat: cursor,
          durationBeats,
        });
        cursor += durationBeats;
      });
      remaining = Math.round((remaining - withinMeasure) * 4) / 4;
    }
    eventPieces.forEach((piece, index) => {
      segments.push({ ...piece, noteSegmentIndex: index, noteSegmentCount: eventPieces.length });
    });
  });
  return segments;
}

function xmlEscape(value: string) {
  return value.replace(/[<>&"']/g, (character) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[character] ?? character);
}

function notationForDuration(durationBeats: number) {
  const map: Record<string, { type: string; dot?: boolean }> = {
    "4": { type: "whole" },
    "3": { type: "half", dot: true },
    "2": { type: "half" },
    "1.5": { type: "quarter", dot: true },
    "1": { type: "quarter" },
    "0.75": { type: "eighth", dot: true },
    "0.5": { type: "eighth" },
    "0.25": { type: "16th" },
  };
  return map[String(durationBeats)] ?? { type: "quarter" };
}

function segmentTie(segment: RenderSegment): ScoreNote["tie"] {
  if (segment.event.kind !== "note" || segment.noteSegmentCount === 1) return null;
  if (segment.noteSegmentIndex === 0) return "start";
  if (segment.noteSegmentIndex === segment.noteSegmentCount - 1) return "stop";
  return "continue";
}

function segmentXml(segment: RenderSegment) {
  const divisions = Math.round(segment.durationBeats * 4);
  const notation = notationForDuration(segment.durationBeats);
  const tie = segmentTie(segment);
  if (segment.event.kind === "rest") {
    return `<note><rest/><duration>${divisions}</duration><voice>1</voice><type>${notation.type}</type>${notation.dot ? "<dot/>" : ""}<staff>1</staff></note>`;
  }
  const pitch = parseEditorPitch(segment.event.written ?? "C5") ?? parseEditorPitch("C5")!;
  const tieSound = tie === "start" ? '<tie type="start"/>' : tie === "stop" ? '<tie type="stop"/>' : tie === "continue" ? '<tie type="stop"/><tie type="start"/>' : "";
  const tieNotation = tie === "start" ? '<notations><tied type="start"/></notations>' : tie === "stop" ? '<notations><tied type="stop"/></notations>' : tie === "continue" ? '<notations><tied type="stop"/><tied type="start"/></notations>' : "";
  return `<note><pitch><step>${pitch.step}</step>${pitch.alter ? `<alter>${pitch.alter}</alter>` : ""}<octave>${pitch.octave}</octave></pitch><duration>${divisions}</duration>${tieSound}<voice>1</voice><type>${notation.type}</type>${notation.dot ? "<dot/>" : ""}${pitch.alter ? `<accidental>${pitch.alter > 0 ? "sharp" : "flat"}</accidental>` : ""}<staff>1</staff>${tieNotation}</note>`;
}

export function draftToSongData(draft: UserSongDraft): SongData {
  const segments = buildSegments(draft);
  const occupiedBeats = draft.events.reduce((total, event) => total + event.durationBeats, 0);
  const totalMeasures = Math.max(1, Math.ceil(occupiedBeats / draft.beatsPerMeasure));
  const totalBeats = totalMeasures * draft.beatsPerMeasure;
  const paddedSegments = [...segments];
  let padCursor = occupiedBeats;
  let restNumber = 0;
  splitNotatable(Math.max(0, totalBeats - occupiedBeats)).forEach((durationBeats) => {
    const event = createEditorEvent("rest", "C5", durationBeats);
    event.id = `padding-${restNumber++}`;
    paddedSegments.push({
      event,
      measure: Math.floor(padCursor / draft.beatsPerMeasure) + 1,
      beat: (padCursor % draft.beatsPerMeasure) + 1,
      absBeat: padCursor,
      durationBeats,
      noteSegmentIndex: 0,
      noteSegmentCount: 1,
    });
    padCursor += durationBeats;
  });

  const notes: ScoreNote[] = segments
    .filter((segment) => segment.event.kind === "note")
    .map((segment, index) => {
      const written = segment.event.written ?? "C5";
      return {
        index,
        measure: segment.measure,
        beat: segment.beat,
        absBeat: segment.absBeat,
        durationBeats: segment.durationBeats,
        written,
        labelPt: editorPitchLabel(written),
        fingering: editorFingering(written),
        tie: segmentTie(segment),
        eventId: segment.event.id,
      };
    });

  const measures = Array.from({ length: totalMeasures }, (_, index) => index + 1).map((measure) => {
    const content = paddedSegments.filter((segment) => segment.measure === measure).map(segmentXml).join("");
    const attributes = measure === 1
      ? `<attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>${draft.beatsPerMeasure}</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${draft.defaultBpm}</per-minute></metronome></direction-type><sound tempo="${draft.defaultBpm}"/></direction>`
      : "";
    return `<measure number="${measure}">${attributes}${content}</measure>`;
  }).join("");

  const musicxmlText = `<?xml version="1.0" encoding="UTF-8" standalone="no"?><score-partwise version="4.0"><work><work-title>${xmlEscape(draft.title)}</work-title></work><part-list><score-part id="P1"><part-name>Trompete em Sib</part-name><score-instrument id="P1-I1"><instrument-name>Trumpet</instrument-name></score-instrument><midi-instrument id="P1-I1"><midi-channel>1</midi-channel><midi-program>57</midi-program></midi-instrument></score-part></part-list><part id="P1">${measures}</part></score-partwise>`;

  return {
    id: draft.id,
    title: draft.title.trim() || "Minha música",
    folder: "Minhas músicas",
    status: "ready",
    data: `local:${draft.id}`,
    defaultBpm: draft.defaultBpm,
    trumpetPart: "Trompete em Sib",
    totalMeasures,
    totalBeats,
    notesCount: notes.length,
    notes,
    musicxmlText,
    userCreated: true,
  };
}

export function userSongSummary(draft: UserSongDraft): Song {
  const data = draftToSongData(draft);
  const { notes: _notes, musicxmlText: _musicxmlText, ...summary } = data;
  return summary;
}

function appendRestEvents(target: EditorEvent[], beats: number) {
  let remaining = Math.round(beats * 4) / 4;
  while (remaining > 0.001) {
    const duration = editorDurations.map((item) => item.value).reverse().find((value) => value <= remaining + 0.001) ?? 0.25;
    target.push(createEditorEvent("rest", "C5", duration));
    remaining = Math.round((remaining - duration) * 4) / 4;
  }
}

export function draftFromSongData(song: SongData): UserSongDraft {
  const draft = createEmptyDraft();
  const events: EditorEvent[] = [];
  const sorted = [...song.notes].sort((a, b) => a.absBeat - b.absBeat || a.index - b.index);
  let cursor = 0;
  sorted.forEach((note) => {
    if (note.absBeat > cursor + 0.001) appendRestEvents(events, note.absBeat - cursor);
    const previous = events[events.length - 1];
    const continuesPrevious =
      previous?.kind === "note" &&
      previous.written === note.written &&
      note.absBeat <= cursor + 0.001 &&
      (note.tie === "stop" || note.tie === "continue");
    if (continuesPrevious) previous.durationBeats += note.durationBeats;
    else if (note.absBeat >= cursor - 0.001) events.push(createEditorEvent("note", note.written, note.durationBeats));
    cursor = Math.max(cursor, note.absBeat + note.durationBeats);
  });
  if (song.totalBeats > cursor + 0.001) appendRestEvents(events, song.totalBeats - cursor);
  const now = new Date().toISOString();
  return {
    ...draft,
    title: `${song.title} - edição`,
    defaultBpm: Math.min(240, Math.max(30, Math.round(song.defaultBpm))),
    events,
    createdAt: now,
    updatedAt: now,
  };
}

export function downloadDraftMusicXml(draft: UserSongDraft) {
  const xml = draftToSongData(draft).musicxmlText ?? "";
  const blob = new Blob([xml], { type: "application/vnd.recordare.musicxml+xml;charset=utf-8" });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = `${(draft.title.trim() || "minha-musica").replace(/[^a-zA-Z0-9-_]+/g, "-")}.musicxml`;
  anchor.click();
  URL.revokeObjectURL(href);
}
