import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { CursorType, OpenSheetMusicDisplay } from "opensheetmusicdisplay";
import {
  Download,
  FileMusic,
  FolderPlus,
  Gauge,
  Repeat,
  ListMusic,
  Maximize2,
  Music2,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Search,
  SkipBack,
  SkipForward,
  Trash2,
  Upload,
  Volume2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { Catalog, ScoreNote, Setlist, Song, SongData } from "./types";

const catalogUrl = "/data/catalog.json";
const setlistKey = "bloco-setlists-v1";
const trainingSequence = [
  { id: "baile-de-favela", label: "Baile de favela" },
  { id: "meu-jeito-de-amar", label: "Meu Jeito de Amar" },
  { id: "rap-da-felicidade", label: "Rap da Felicidade" },
  { id: "malandramente", label: "Malandramente" },
  { id: "vai-malandra", label: "Vai Malandra" },
  { id: "lambafunk", label: "Lamba Funk" },
  { id: "vira-de-ladinho", label: "Vira de Ladinho" },
  { id: "rap-das-armas", label: "Rap das Armas" },
  { id: "eu-vou-pro-baile-da-gaiola", label: "Baile da Gaiola" },
  { id: "cheguei", label: "Cheguei" },
  { id: "fala-mal-de-mim", label: "Fala Mal de Mim" },
  { id: "morto-muito-louco", label: "Morto Muito Louco" },
] as const;

type ViewMode = "both" | "score" | "notes";

function readSetlists(): Setlist[] {
  try {
    const raw = localStorage.getItem(setlistKey);
    return raw ? (JSON.parse(raw) as Setlist[]) : [];
  } catch {
    return [];
  }
}

function saveSetlists(setlists: Setlist[]) {
  localStorage.setItem(setlistKey, JSON.stringify(setlists));
}

function lastNoteAtBeat(notes: ScoreNote[], beat: number) {
  if (!notes.length) return null;
  let current = notes[0];
  for (const note of notes) {
    if (note.absBeat <= beat) current = note;
    if (note.absBeat > beat) break;
  }
  return current;
}

function activeNotesForBeat(notes: ScoreNote[], beat: number) {
  return notes.filter((note) => note.absBeat <= beat + 0.001 && beat < note.absBeat + note.durationBeats - 0.001);
}

function parseWrittenPitch(written: string) {
  const match = /^([A-G])([#b]?)(-?\d+)$/.exec(written);
  if (!match) return null;
  const semitones: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const [, letter, accidental, octaveText] = match;
  const accidentalOffset = accidental === "#" ? 1 : accidental === "b" ? -1 : 0;
  const midi = (Number(octaveText) + 1) * 12 + semitones[letter] + accidentalOffset;
  return { letter, accidental, octave: Number(octaveText), midi };
}

function writtenWithOctaveShift(written: string, octaveShift = 0) {
  const pitch = parseWrittenPitch(written);
  if (!pitch) return written;
  return `${pitch.letter}${pitch.accidental}${pitch.octave + octaveShift}`;
}

function labelPtForWritten(written: string) {
  const pitch = parseWrittenPitch(written);
  if (!pitch) return written;
  const names: Record<string, string> = {
    C: "Do",
    "C#": "Do#",
    Db: "Reb",
    D: "Re",
    "D#": "Re#",
    Eb: "Mib",
    E: "Mi",
    F: "Fa",
    "F#": "Fa#",
    Gb: "Solb",
    G: "Sol",
    "G#": "Sol#",
    Ab: "Lab",
    A: "La",
    "A#": "La#",
    Bb: "Sib",
    B: "Si",
  };
  return `${names[`${pitch.letter}${pitch.accidental}`] ?? `${pitch.letter}${pitch.accidental}`}${pitch.octave}`;
}

function labelPtWithOctaveShift(note: ScoreNote, octaveShift = 0) {
  return labelPtForWritten(writtenWithOctaveShift(note.written, octaveShift));
}

function fingeringForWritten(written: string, fallback: string[]) {
  const pitch = parseWrittenPitch(written);
  if (!pitch) return fallback;
  const chart: Record<number, string[]> = {
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
  const pitchClassChart: Record<number, string[]> = {
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
  };
  return chart[pitch.midi] ?? pitchClassChart[pitch.midi % 12] ?? fallback;
}

function fingeringForNote(note: ScoreNote, octaveShift = 0) {
  return fingeringForWritten(writtenWithOctaveShift(note.written, octaveShift), note.fingering);
}

function fingeringText(notes: ScoreNote[], octaveShift = 0) {
  return notes.length ? notes.map((note) => fingeringForNote(note, octaveShift).join("/")).join(" | ") : "-";
}

function pressedValves(notes: ScoreNote[], octaveShift = 0) {
  const valves = new Set<number>();
  notes.forEach((note) => {
    fingeringForNote(note, octaveShift).forEach((entry) => {
      entry.match(/[123]/g)?.forEach((value) => valves.add(Number(value)));
    });
  });
  return valves;
}

function noteLabels(notes: ScoreNote[], field: "labelPt" | "written", octaveShift = 0) {
  if (!notes.length) return "-";
  return notes
    .map((note) => (field === "written" ? writtenWithOctaveShift(note.written, octaveShift) : labelPtWithOctaveShift(note, octaveShift)))
    .join(" + ");
}

function octaveShiftLabel(value: number) {
  if (value === 0) return "normal";
  return value > 0 ? `+${value}` : String(value);
}

function noteFrequency(written: string) {
  const pitch = parseWrittenPitch(written);
  return pitch ? 440 * 2 ** ((pitch.midi - 69) / 12) : null;
}

function measureStartBeat(notes: ScoreNote[], measure: number) {
  return notes.find((note) => note.measure >= measure)?.absBeat ?? 0;
}

function measureForBeat(notes: ScoreNote[], beat: number) {
  return lastNoteAtBeat(notes, beat)?.measure ?? 1;
}

function firstNoteIndexAtOrAfter(notes: ScoreNote[], beat: number) {
  const index = notes.findIndex((note) => note.absBeat >= beat - 0.001);
  return index === -1 ? notes.length : index;
}

function firstPlayableBeat(notes: ScoreNote[]) {
  return notes[0]?.absBeat ?? 0;
}

function clampNumber(value: number, min: number, max: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function scalePercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function SizeSlider({
  label,
  value,
  min,
  max,
  step = 0.05,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="size-slider">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
      <strong>{scalePercent(value)}</strong>
    </label>
  );
}

type FingeringMarker = {
  id: string;
  label: string;
  note: ScoreNote;
  x: number;
  y: number;
};

function musicXmlPitchedSlots(xml: string) {
  try {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    return Array.from(doc.getElementsByTagName("note"))
      .filter((note) => !note.getElementsByTagName("grace").length)
      .map((note) => note.getElementsByTagName("pitch").length > 0);
  } catch {
    return [];
  }
}

function buildFingeringMarkers(song: SongData, scoreElement: HTMLElement, octaveShift = 0, pitchedSlots: boolean[] = []): FingeringMarker[] {
  const wrap = scoreElement.parentElement;
  const svg = scoreElement.querySelector("svg");
  if (!wrap || !svg || !song.notes.length) return [];

  const wrapRect = wrap.getBoundingClientRect();
  const svgRect = svg.getBoundingClientRect();
  const viewBox = svg.viewBox.baseVal;
  const scaleX = svgRect.width / viewBox.width;
  const scaleY = svgRect.height / viewBox.height;
  const allNoteheadElements = Array.from(svg.querySelectorAll<SVGGraphicsElement>(".vf-stavenote .vf-notehead"));
  const noteheadElements =
    pitchedSlots.length === allNoteheadElements.length
      ? allNoteheadElements.filter((_, index) => pitchedSlots[index])
      : allNoteheadElements.slice(0, song.notes.length);

  return song.notes.flatMap((note, index) => {
    const notehead = noteheadElements[index];
    if (!notehead) return [];
    const box = notehead.getBBox();
    return [{
      id: `${song.id}-${note.index}`,
      label: fingeringForNote(note, octaveShift).join("/"),
      note,
      x: svgRect.left - wrapRect.left + (box.x + box.width / 2) * scaleX,
      y: Math.max(2, svgRect.top - wrapRect.top + box.y * scaleY - 26),
    }];
  });
}

function songStatusText(song: Song) {
  if (song.status === "ready") return `${song.notesCount} notas | toca melodia`;
  if (song.status === "needs_transcription") return song.sourceImage || song.sourcePdf ? "visual | transcrever notas" : "MSCZ | exportar MusicXML";
  if (song.status === "visual_only") return "visual";
  return "sem fonte";
}

function songStatusClass(song: Song) {
  if (song.status === "ready") return "ready";
  if (song.status === "needs_transcription" || song.status === "visual_only") return "visual";
  return "missing";
}

function useCatalog() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetch(catalogUrl)
      .then((res) => {
        if (!res.ok) throw new Error(`Falha ao carregar catálogo: ${res.status}`);
        return res.json();
      })
      .then(setCatalog)
      .catch((err) => setError(String(err)));
  }, []);
  return { catalog, error };
}

function ScoreView({
  song,
  zoom,
  currentBeat = null,
  highlight = false,
  showFingerings = true,
  fingeringScale = 1,
  fingeringOctaveShift = 0,
  onCursorMove,
  onReady,
  onNoteClick,
}: {
  song: SongData;
  zoom: number;
  currentBeat?: number | null;
  highlight?: boolean;
  showFingerings?: boolean;
  fingeringScale?: number;
  fingeringOctaveShift?: number;
  onCursorMove?: (cursorElement: HTMLElement | null) => void;
  onReady?: (ready: boolean) => void;
  onNoteClick?: (note: ScoreNote) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null);
  const coloredNotesRef = useRef<Array<{ setColor: (color: string, options: Record<string, boolean>) => void }>>([]);
  const [scoreReady, setScoreReady] = useState(false);
  const [fingeringMarkers, setFingeringMarkers] = useState<FingeringMarker[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function renderScore() {
      if (!containerRef.current || !song.musicxml) return;
      setScoreReady(false);
      setFingeringMarkers([]);
      onReady?.(false);
      containerRef.current.innerHTML = "";
      const osmd = new OpenSheetMusicDisplay(containerRef.current, {
        autoResize: true,
        cursorsOptions: [{ type: CursorType.Standard, color: "#10a64a", alpha: 0.55, follow: false }],
        drawPartAbbreviations: false,
        drawPartNames: false,
        drawTitle: false,
        drawSubtitle: false,
        followCursor: false,
        drawingParameters: "default",
      });
      osmdRef.current = osmd;
      const xml = await fetch(`/${song.musicxml}`).then((res) => res.text());
      const pitchedSlots = musicXmlPitchedSlots(xml);
      if (cancelled) return;
      await osmd.load(xml);
      osmd.zoom = zoom;
      await osmd.render();
      if (cancelled) return;
      if (showFingerings && containerRef.current) setFingeringMarkers(buildFingeringMarkers(song, containerRef.current, fingeringOctaveShift, pitchedSlots));
      if (highlight) osmd.cursor?.show();
      else osmd.cursor?.hide();
      osmd.cursor?.reset();
      osmd.cursor?.update();
      setScoreReady(true);
      onReady?.(true);
    }
    renderScore().catch((error) => {
      if (!cancelled) {
        setScoreReady(false);
        onReady?.(false);
      }
      console.error(error);
    });
    return () => {
      cancelled = true;
    };
  }, [song, song.id, song.musicxml, zoom, showFingerings, highlight, fingeringOctaveShift, onReady]);

  useEffect(() => {
    if (!scoreReady || !highlight || !osmdRef.current) return;
    const coloringOptions = {
      applyToBeams: true,
      applyToFlag: true,
      applyToLedgerLines: true,
      applyToModifiers: true,
      applyToNoteheads: true,
      applyToStem: true,
      applyToTies: true,
    };
    coloredNotesRef.current.forEach((note) => note.setColor("#000000", coloringOptions));
    coloredNotesRef.current = [];

    const cursor = osmdRef.current.cursor;
    if (!cursor) return;
    if (currentBeat === null) {
      cursor.hide();
      return;
    }

    cursor.show();
    cursor.reset();
    let guard = 0;
    while (!cursor.Iterator.EndReached && cursor.Iterator.currentTimeStamp.RealValue * 4 < currentBeat - 0.001 && guard < 2000) {
      cursor.next();
      guard += 1;
    }
    cursor.update();
    const graphicalNotes = cursor.GNotesUnderCursor() as Array<{ setColor: (color: string, options: Record<string, boolean>) => void }>;
    graphicalNotes.forEach((note) => note.setColor("#10a64a", coloringOptions));
    coloredNotesRef.current = graphicalNotes;
    onCursorMove?.(cursor.cursorElement ?? null);
  }, [scoreReady, highlight, currentBeat, onCursorMove]);

  return (
    <div className="score-canvas-wrap" style={{ "--fingering-scale": fingeringScale } as CSSProperties}>
      <div className="score-canvas" ref={containerRef} />
      {showFingerings && (
        <div className="fingering-overlay">
          {fingeringMarkers.map((marker) => (
            <button
              aria-label={`Ir para ${labelPtWithOctaveShift(marker.note, fingeringOctaveShift)} no compasso ${marker.note.measure}`}
              className="fingering-marker"
              key={marker.id}
              onClick={() => onNoteClick?.(marker.note)}
              style={{ left: marker.x, top: marker.y }}
              type="button"
            >
              {marker.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function NoteRail({
  notes,
  currentIndex,
  activeIndices,
  octaveShift,
  railScale = 1,
  onNoteClick,
}: {
  notes: ScoreNote[];
  currentIndex: number;
  activeIndices: number[];
  octaveShift: number;
  railScale?: number;
  onNoteClick?: (note: ScoreNote) => void;
}) {
  return (
    <div className="note-rail" style={{ "--rail-scale": railScale } as CSSProperties}>
      {notes.slice(Math.max(0, currentIndex - 8), currentIndex + 24).map((note) => (
        <button className={`note-chip ${activeIndices.includes(note.index) ? "current" : ""}`} key={note.index} onClick={() => onNoteClick?.(note)} type="button">
          <span className="fingering">{fingeringForNote(note, octaveShift).join("/")}</span>
          <span className="note-name">{labelPtWithOctaveShift(note, octaveShift)}</span>
          <span className="measure">c.{note.measure}</span>
        </button>
      ))}
    </div>
  );
}

function ValveIndicator({ notes, octaveShift = 0 }: { notes: ScoreNote[]; octaveShift?: number }) {
  const valves = pressedValves(notes, octaveShift);
  const label = fingeringText(notes, octaveShift);
  const caption = notes.length ? (valves.size ? `pressionar ${label}` : "aberto 0") : "-";

  return (
    <div className="valve-panel" aria-label={`Pistos: ${caption}`}>
      <div className="valve-row">
        {[1, 2, 3].map((valve) => (
          <div className={`valve-dot ${valves.has(valve) ? "pressed" : ""}`} key={valve}>
            {valve}
          </div>
        ))}
      </div>
      <span className="valve-caption">{caption}</span>
    </div>
  );
}

function FullNoteGuide({
  notes,
  currentBeat = null,
  octaveShift = 0,
  guideScale = 1,
  onNoteClick,
}: {
  notes: ScoreNote[];
  currentBeat?: number | null;
  octaveShift?: number;
  guideScale?: number;
  onNoteClick?: (note: ScoreNote) => void;
}) {
  return (
    <section className="full-note-guide" aria-label="Notas e pistos da musica completa" style={{ "--guide-scale": guideScale } as CSSProperties}>
      <div className="guide-header">
        <div>
          <h3>Notas e pistos</h3>
          <span>{notes.length} notas na musica completa</span>
        </div>
        <strong>Oitava {octaveShiftLabel(octaveShift)}</strong>
      </div>
      <div className="guide-grid">
        {notes.map((note) => {
          const active =
            currentBeat !== null && note.absBeat <= currentBeat + 0.001 && currentBeat < note.absBeat + note.durationBeats - 0.001;
          return (
            <button className={`guide-note ${active ? "active" : ""}`} key={note.index} onClick={() => onNoteClick?.(note)} type="button">
              <span className="guide-fingering">{fingeringForNote(note, octaveShift).join("/")}</span>
              <strong>{labelPtWithOctaveShift(note, octaveShift)}</strong>
              <small>
                {writtenWithOctaveShift(note.written, octaveShift)} · c.{note.measure}
              </small>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function VisualScore({ song, zoom }: { song: SongData; zoom: number }) {
  const visualWidth = `${Math.round(Math.max(1, zoom) * 100)}%`;
  if (song.sourceImage) {
    return (
      <div className="visual-score-panel">
        <img
          alt={`Partitura de ${song.title}`}
          className="visual-score-image"
          src={`/${song.sourceImage}`}
          style={{ width: visualWidth }}
        />
        <div className="transcription-note">Partitura visual. Ainda precisa transcrever para mostrar notas, pistos e tocar melodia.</div>
      </div>
    );
  }
  if (song.sourcePdf) {
    return (
      <div className="visual-score-panel">
        <iframe
          className="visual-score-pdf"
          src={`/${song.sourcePdf}`}
          style={{ width: visualWidth }}
          title={`Partitura de ${song.title}`}
        />
        <div className="transcription-note">PDF visual. Ainda precisa transcrever para mostrar notas, pistos e tocar melodia.</div>
      </div>
    );
  }
  return <div className="transcription-note">Fonte ainda nao encontrada para esta musica.</div>;
}

function MelodyPlayer({
  song,
  onBeatChange,
  octaveShift,
  onOctaveShiftChange,
  seekRequest,
}: {
  song: SongData;
  onBeatChange: (beat: number, playing: boolean) => void;
  octaveShift: number;
  onOctaveShiftChange: (value: number) => void;
  seekRequest?: { beat: number; nonce: number } | null;
}) {
  const audioContextRef = useRef<AudioContext | null>(null);
  const playbackStartTimeRef = useRef(0);
  const playbackStartBeatRef = useRef(0);
  const nextNoteIndexRef = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [starting, setStarting] = useState(false);
  const [positionBeat, setPositionBeat] = useState(0);
  const [bpm, setBpm] = useState(clampNumber(song.defaultBpm, 30, 240, 100));
  const [bpmInput, setBpmInput] = useState(String(clampNumber(song.defaultBpm, 30, 240, 100)));
  const [noteSound, setNoteSound] = useState(true);
  const safeBpm = clampNumber(bpm, 30, 240, clampNumber(song.defaultBpm, 30, 240, 100));
  const startBeat = firstPlayableBeat(song.notes);
  const currentNotes = activeNotesForBeat(song.notes, positionBeat);
  const progressPercent = song.totalBeats ? Math.min(100, Math.max(0, (positionBeat / song.totalBeats) * 100)) : 0;
  const canPlay = song.notes.length > 0 && song.totalBeats > 0;

  function getAudioContext() {
    if (!audioContextRef.current) audioContextRef.current = new AudioContext();
    return audioContextRef.current;
  }

  async function prepareAudio() {
    const ctx = getAudioContext();
    await ctx.resume();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    osc.frequency.value = 440;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.02);
    await new Promise((resolve) => window.setTimeout(resolve, 30));
  }

  function playNote(note: ScoreNote) {
    if (!noteSound) return;
    const frequency = noteFrequency(note.written);
    if (!frequency) return;
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    const duration = Math.max(0.08, (note.durationBeats * 60 * 0.9) / safeBpm);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.value = frequency * 2 ** octaveShift;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.14, now + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration + 0.03);
  }

  useEffect(() => {
    const defaultBpm = clampNumber(song.defaultBpm, 30, 240, 100);
    setPlaying(false);
    setStarting(false);
    setPositionBeat(startBeat);
    setBpm(defaultBpm);
    setBpmInput(String(defaultBpm));
    onOctaveShiftChange(0);
    playbackStartTimeRef.current = 0;
    playbackStartBeatRef.current = startBeat;
    nextNoteIndexRef.current = firstNoteIndexAtOrAfter(song.notes, startBeat);
  }, [onOctaveShiftChange, song.id, song.defaultBpm, song.notes, startBeat]);

  useEffect(() => {
    if (!seekRequest) return;
    const nextBeat = clampNumber(seekRequest.beat, startBeat, song.totalBeats, startBeat);
    playbackStartBeatRef.current = nextBeat;
    playbackStartTimeRef.current = performance.now();
    nextNoteIndexRef.current = firstNoteIndexAtOrAfter(song.notes, nextBeat);
    setPositionBeat(nextBeat);
  }, [seekRequest, song.notes, song.totalBeats, startBeat]);

  function seekToBeat(value: number) {
    const nextBeat = clampNumber(value, startBeat, song.totalBeats, positionBeat);
    playbackStartBeatRef.current = nextBeat;
    playbackStartTimeRef.current = performance.now();
    nextNoteIndexRef.current = firstNoteIndexAtOrAfter(song.notes, nextBeat);
    setPositionBeat(nextBeat);
  }

  useEffect(() => {
    onBeatChange(positionBeat, playing);
  }, [onBeatChange, playing, positionBeat]);

  useEffect(() => {
    if (!playing) return;
    playbackStartBeatRef.current = positionBeat;
    playbackStartTimeRef.current = performance.now();
    nextNoteIndexRef.current = firstNoteIndexAtOrAfter(song.notes, positionBeat);
  }, [safeBpm]);

  useEffect(() => {
    if (!playing || !canPlay) return;
    let raf = 0;
    const tick = () => {
      const elapsedSeconds = (performance.now() - playbackStartTimeRef.current) / 1000;
      const nextBeat = playbackStartBeatRef.current + elapsedSeconds * (safeBpm / 60);
      let index = nextNoteIndexRef.current;
      while (index < song.notes.length && song.notes[index].absBeat <= nextBeat + 0.001) {
        playNote(song.notes[index]);
        index += 1;
      }
      nextNoteIndexRef.current = index;
      setPositionBeat(nextBeat);
      if (nextBeat >= song.totalBeats) {
        setPlaying(false);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [canPlay, noteSound, octaveShift, playing, safeBpm, song.notes, song.totalBeats]);

  function updateBpmInput(value: string) {
    setBpmInput(value);
    if (!value.trim()) return;
    const next = Number(value);
    if (!Number.isFinite(next)) return;
    setBpm(clampNumber(next, 30, 240, safeBpm));
  }

  function commitBpmInput() {
    const next = Number(bpmInput);
    const committed = clampNumber(next, 30, 240, safeBpm);
    setBpm(committed);
    setBpmInput(String(Math.round(committed)));
  }

  async function playPause() {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (!canPlay || starting) return;
    setStarting(true);
    try {
      await prepareAudio();
      const nextStartBeat = positionBeat >= song.totalBeats || positionBeat < startBeat ? startBeat : positionBeat;
      playbackStartBeatRef.current = nextStartBeat;
      playbackStartTimeRef.current = performance.now();
      nextNoteIndexRef.current = firstNoteIndexAtOrAfter(song.notes, nextStartBeat);
      setPositionBeat(nextStartBeat);
      setPlaying(true);
    } finally {
      setStarting(false);
    }
  }

  function reset() {
    setPlaying(false);
    playbackStartBeatRef.current = startBeat;
    playbackStartTimeRef.current = 0;
    nextNoteIndexRef.current = firstNoteIndexAtOrAfter(song.notes, startBeat);
    setPositionBeat(startBeat);
  }

  return (
    <section className="melody-player">
      <div className="melody-actions">
        <button className="primary" disabled={!canPlay || starting} onClick={() => void playPause()}>
          {playing ? <Pause size={17} /> : <Play size={17} />}
          {playing ? "Pausar melodia" : starting ? "Preparando" : "Tocar melodia"}
        </button>
        <button disabled={!canPlay} onClick={reset}>
          <RotateCcw size={17} />
          Inicio
        </button>
        <label>
          <Gauge size={17} />
          BPM
          <input
            inputMode="numeric"
            max="240"
            min="30"
            pattern="[0-9]*"
            type="text"
            value={bpmInput}
            onBlur={commitBpmInput}
            onChange={(event) => updateBpmInput(event.target.value)}
          />
        </label>
        <label className="toggle">
          <input type="checkbox" checked={noteSound} onChange={(event) => setNoteSound(event.target.checked)} />
          <Volume2 size={17} />
          Som
        </label>
        <div className="octave-control">
          <Music2 size={17} />
          Oitava
          <button type="button" onClick={() => onOctaveShiftChange(Math.max(-2, octaveShift - 1))}>-</button>
          <strong>{octaveShiftLabel(octaveShift)}</strong>
          <button type="button" onClick={() => onOctaveShiftChange(Math.min(2, octaveShift + 1))}>+</button>
        </div>
      </div>
      <div className="melody-progress">
        <span>{canPlay ? noteLabels(currentNotes, "labelPt", octaveShift) : "melodia pendente de transcricao"}</span>
        <input
          aria-label="Posição da melodia"
          disabled={!canPlay}
          max={song.totalBeats || 1}
          min={startBeat}
          step={0.25}
          type="range"
          value={positionBeat}
          onChange={(event) => seekToBeat(Number(event.target.value))}
          style={{ "--progress": `${progressPercent}%` } as CSSProperties}
        />
      </div>
    </section>
  );
}

function Reader({
  song,
  onClose,
}: {
  song: SongData;
  onClose: () => void;
}) {
  const audioContextRef = useRef<AudioContext | null>(null);
  const playbackStartTimeRef = useRef(0);
  const playbackStartBeatRef = useRef(0);
  const nextNoteIndexRef = useRef(0);
  const nextMetronomeBeatRef = useRef(0);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [starting, setStarting] = useState(false);
  const [scoreReady, setScoreReady] = useState(false);
  const [bpm, setBpm] = useState(clampNumber(song.defaultBpm, 30, 240, 100));
  const [bpmInput, setBpmInput] = useState(String(clampNumber(song.defaultBpm, 30, 240, 100)));
  const [zoom, setZoom] = useState(1.55);
  const [fingeringScale, setFingeringScale] = useState(1);
  const [railScale, setRailScale] = useState(1);
  const [positionBeat, setPositionBeat] = useState(0);
  const [metronome, setMetronome] = useState(false);
  const [noteSound, setNoteSound] = useState(true);
  const [octaveShift, setOctaveShift] = useState(0);
  const [loopEnabled, setLoopEnabled] = useState(false);
  const [loopStart, setLoopStart] = useState(1);
  const [loopEnd, setLoopEnd] = useState(Math.min(song.totalMeasures, 4));

  const safeBpm = clampNumber(bpm, 30, 240, clampNumber(song.defaultBpm, 30, 240, 100));
  const playableStartBeat = firstPlayableBeat(song.notes);
  const playableStartMeasure = song.notes[0]?.measure ?? 1;
  const currentNotes = activeNotesForBeat(song.notes, positionBeat);
  const referenceNote = currentNotes[0] ?? lastNoteAtBeat(song.notes, positionBeat);
  const currentIndex = referenceNote?.index ?? 0;
  const activeIndices = currentNotes.map((note) => note.index);
  const readerStatus = !scoreReady || starting ? "PREPARANDO" : playing ? "TOCANDO" : "PAUSADO";
  const readerStatusClass = !scoreReady || starting ? "preparing" : playing ? "playing" : "paused";
  const currentMeasure = measureForBeat(song.notes, positionBeat);
  const currentBeatInMeasure = Math.max(1, positionBeat - measureStartBeat(song.notes, currentMeasure) + 1);
  const progressPercent = song.totalBeats ? Math.min(100, Math.max(0, (positionBeat / song.totalBeats) * 100)) : 0;

  function getAudioContext() {
    if (!audioContextRef.current) audioContextRef.current = new AudioContext();
    return audioContextRef.current;
  }

  async function prepareAudioForPlayback() {
    const ctx = getAudioContext();
    await ctx.resume();

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    osc.frequency.value = 440;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.025);
    await new Promise((resolve) => window.setTimeout(resolve, 35));
  }

  function playScoreNote(note: ScoreNote) {
    const frequency = noteFrequency(note.written);
    if (!frequency) return;
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    const duration = Math.max(0.08, (note.durationBeats * 60 * 0.88) / safeBpm);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.value = frequency * 2 ** octaveShift;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.12, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration + 0.03);
  }

  function playMetronomeClick(beatIndex: number) {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    const accent = beatIndex % 4 === 0;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = accent ? 1500 : 950;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(accent ? 0.12 : 0.075, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.045);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.055);
  }

  const followCursor = useCallback((cursorElement: HTMLElement | null) => {
    const viewport = viewportRef.current;
    if (!viewport || !cursorElement) return;

    const viewportBox = viewport.getBoundingClientRect();
    const cursorBox = cursorElement.getBoundingClientRect();
    const upperReadingLine = viewportBox.top + viewportBox.height * 0.28;
    const lowerReadingLine = viewportBox.top + viewportBox.height * 0.68;

    let delta = 0;
    if (cursorBox.top < upperReadingLine) delta = cursorBox.top - upperReadingLine;
    if (cursorBox.bottom > lowerReadingLine) delta = cursorBox.bottom - lowerReadingLine;
    if (Math.abs(delta) < 8) return;

    viewport.scrollTo({
      top: Math.max(0, viewport.scrollTop + delta),
      behavior: "auto",
    });
  }, []);

  const handleScoreReady = useCallback((ready: boolean) => {
    setScoreReady(ready);
  }, []);

  useEffect(() => {
    const defaultBpm = clampNumber(song.defaultBpm, 30, 240, 100);
    setPlaying(false);
    setStarting(false);
    setScoreReady(false);
    playbackStartTimeRef.current = 0;
    playbackStartBeatRef.current = playableStartBeat;
    nextNoteIndexRef.current = firstNoteIndexAtOrAfter(song.notes, playableStartBeat);
    nextMetronomeBeatRef.current = Math.ceil(playableStartBeat - 0.001);
    setPositionBeat(playableStartBeat);
    setBpm(defaultBpm);
    setBpmInput(String(defaultBpm));
    setOctaveShift(0);
    setLoopStart(playableStartMeasure);
    setLoopEnd(Math.min(song.totalMeasures, playableStartMeasure + 3));
    viewportRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [playableStartBeat, playableStartMeasure, song.id, song.defaultBpm, song.notes, song.totalMeasures]);

  useEffect(() => {
    if (!playing) return;
    playbackStartBeatRef.current = positionBeat;
    playbackStartTimeRef.current = performance.now();
    nextNoteIndexRef.current = firstNoteIndexAtOrAfter(song.notes, positionBeat);
    nextMetronomeBeatRef.current = Math.ceil(positionBeat - 0.001);
  }, [safeBpm]);

  useEffect(() => {
    if (!metronome) return;
    nextMetronomeBeatRef.current = Math.ceil(positionBeat - 0.001);
  }, [metronome]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const elapsedSeconds = (performance.now() - playbackStartTimeRef.current) / 1000;
      let nextBeat = playbackStartBeatRef.current + elapsedSeconds * (safeBpm / 60);
      const loopStartBeat = measureStartBeat(song.notes, loopStart);
      const nextMeasureBeat = loopEnd >= song.totalMeasures ? song.totalBeats : measureStartBeat(song.notes, loopEnd + 1);
      const loopEndBeat = Math.max(loopStartBeat + 0.25, nextMeasureBeat || song.totalBeats);

      const playScheduledNotesUntil = (untilBeat: number) => {
        if (!noteSound) {
          nextNoteIndexRef.current = firstNoteIndexAtOrAfter(song.notes, untilBeat);
          return;
        }
        let index = nextNoteIndexRef.current;
        while (index < song.notes.length && song.notes[index].absBeat <= untilBeat + 0.001) {
          playScoreNote(song.notes[index]);
          index += 1;
        }
        nextNoteIndexRef.current = index;
      };

      const playMetronomeUntil = (untilBeat: number) => {
        if (!metronome) return;
        while (nextMetronomeBeatRef.current <= untilBeat + 0.001) {
          playMetronomeClick(nextMetronomeBeatRef.current);
          nextMetronomeBeatRef.current += 1;
        }
      };

      if (loopEnabled && nextBeat >= loopEndBeat) {
        playScheduledNotesUntil(loopEndBeat);
        playMetronomeUntil(loopEndBeat);
        nextBeat = loopStartBeat;
        playbackStartBeatRef.current = loopStartBeat;
        playbackStartTimeRef.current = performance.now();
        nextNoteIndexRef.current = firstNoteIndexAtOrAfter(song.notes, loopStartBeat);
        nextMetronomeBeatRef.current = Math.ceil(loopStartBeat - 0.001);
      } else {
        playScheduledNotesUntil(nextBeat);
        playMetronomeUntil(nextBeat);
      }
      setPositionBeat(nextBeat);

      if (!loopEnabled && nextBeat >= song.totalBeats) {
        setPlaying(false);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, loopEnabled, loopEnd, loopStart, metronome, noteSound, octaveShift, safeBpm, song.notes, song.totalBeats]);

  function updateBpmInput(value: string) {
    setBpmInput(value);
    if (!value.trim()) return;
    const next = Number(value);
    if (!Number.isFinite(next)) return;
    setBpm(clampNumber(next, 30, 240, safeBpm));
  }

  function commitBpmInput() {
    const next = Number(bpmInput);
    const committed = clampNumber(next, 30, 240, safeBpm);
    setBpm(committed);
    setBpmInput(String(Math.round(committed)));
  }

  function updateLoopStart(value: string) {
    const next = Math.round(clampNumber(Number(value), 1, song.totalMeasures, loopStart));
    setLoopStart(next);
    setLoopEnd((end) => Math.max(end, next));
  }

  function updateLoopEnd(value: string) {
    const next = Math.round(clampNumber(Number(value), 1, song.totalMeasures, loopEnd));
    setLoopEnd(Math.max(loopStart, next));
  }

  function seekToBeat(value: number) {
    const nextBeat = clampNumber(value, playableStartBeat, song.totalBeats, positionBeat);
    playbackStartBeatRef.current = nextBeat;
    playbackStartTimeRef.current = performance.now();
    nextNoteIndexRef.current = firstNoteIndexAtOrAfter(song.notes, nextBeat);
    nextMetronomeBeatRef.current = Math.ceil(nextBeat - 0.001);
    setPositionBeat(nextBeat);
  }

  async function playPause() {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (!scoreReady || starting) return;
    setStarting(true);
    try {
      await prepareAudioForPlayback();
    } catch (error) {
      console.error(error);
      setStarting(false);
      return;
    }
    let startBeat = positionBeat >= song.totalBeats || positionBeat < playableStartBeat ? playableStartBeat : positionBeat;
    if (loopEnabled) {
      const loopStartBeat = measureStartBeat(song.notes, loopStart);
      const nextMeasureBeat = loopEnd >= song.totalMeasures ? song.totalBeats : measureStartBeat(song.notes, loopEnd + 1);
      const loopEndBeat = Math.max(loopStartBeat + 0.25, nextMeasureBeat || song.totalBeats);
      if (startBeat < loopStartBeat - 0.001 || startBeat >= loopEndBeat - 0.001) {
        startBeat = loopStartBeat;
      }
    }
    playbackStartBeatRef.current = startBeat;
    playbackStartTimeRef.current = performance.now();
    nextNoteIndexRef.current = firstNoteIndexAtOrAfter(song.notes, startBeat);
    nextMetronomeBeatRef.current = Math.ceil(startBeat - 0.001);
    setPositionBeat(startBeat);
    setPlaying(true);
    setStarting(false);
  }

  function reset() {
    setPlaying(false);
    playbackStartBeatRef.current = playableStartBeat;
    nextNoteIndexRef.current = firstNoteIndexAtOrAfter(song.notes, playableStartBeat);
    nextMetronomeBeatRef.current = Math.ceil(playableStartBeat - 0.001);
    setPositionBeat(playableStartBeat);
    viewportRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }

  function jumpMeasure(delta: number) {
    const targetMeasure = Math.max(1, (referenceNote?.measure ?? 1) + delta);
    const target = song.notes.find((note) => note.measure >= targetMeasure) ?? song.notes[0];
    playbackStartBeatRef.current = target.absBeat;
    playbackStartTimeRef.current = performance.now();
    nextNoteIndexRef.current = firstNoteIndexAtOrAfter(song.notes, target.absBeat);
    nextMetronomeBeatRef.current = Math.ceil(target.absBeat - 0.001);
    setPositionBeat(target.absBeat);
  }

  return (
    <section className="reader">
      <header className="reader-bar">
        <div>
          <strong>{song.title}</strong>
          <span>compasso {referenceNote?.measure ?? 1}</span>
        </div>
        <div className="reader-actions">
          <button onClick={() => void document.documentElement.requestFullscreen?.()} title="Tela cheia">
            <Maximize2 size={18} />
          </button>
          <button onClick={onClose}>Fechar</button>
        </div>
      </header>

      <div className="reader-controls">
        <button className="primary" disabled={!playing && (!scoreReady || starting)} onClick={() => void playPause()}>
          {playing ? <Pause size={18} /> : <Play size={18} />}
          {playing ? "Pausar" : !scoreReady || starting ? "Preparando" : "Tocar"}
        </button>
        <button onClick={reset}>
          <RotateCcw size={18} />
          Inicio
        </button>
        <button onClick={() => jumpMeasure(-1)}>
          <SkipBack size={18} />
          Compasso
        </button>
        <label>
          <Gauge size={18} />
          BPM
          <input
            inputMode="numeric"
            min="30"
            max="240"
            pattern="[0-9]*"
            type="text"
            value={bpmInput}
            onBlur={commitBpmInput}
            onChange={(event) => updateBpmInput(event.target.value)}
          />
        </label>
        <button onClick={() => setZoom((value) => Math.max(0.9, value - 0.1))}>
          <ZoomOut size={18} />
          Menos zoom
        </button>
        <button onClick={() => setZoom((value) => Math.min(2.6, value + 0.1))}>
          <ZoomIn size={18} />
          Mais zoom
        </button>
        <SizeSlider label="Partitura" min={0.9} max={2.8} value={zoom} onChange={setZoom} />
        <SizeSlider label="Números" min={0.7} max={2.2} value={fingeringScale} onChange={setFingeringScale} />
        <SizeSlider label="Tablatura" min={0.75} max={2.1} value={railScale} onChange={setRailScale} />
        <label className="toggle">
          <input type="checkbox" checked={metronome} onChange={(event) => setMetronome(event.target.checked)} />
          Metrônomo
        </label>
        <label className="toggle loop-toggle">
          <input type="checkbox" checked={loopEnabled} onChange={(event) => setLoopEnabled(event.target.checked)} />
          <Repeat size={18} />
          Loop
        </label>
        <label className="toggle">
          <input type="checkbox" checked={noteSound} onChange={(event) => setNoteSound(event.target.checked)} />
          <Volume2 size={18} />
          Som das notas
        </label>
        <div className="octave-control" aria-label="Controle de oitava do som">
          <Music2 size={18} />
          Oitava
          <button type="button" onClick={() => setOctaveShift((value) => Math.max(-2, value - 1))}>-</button>
          <strong>{octaveShiftLabel(octaveShift)}</strong>
          <button type="button" onClick={() => setOctaveShift((value) => Math.min(2, value + 1))}>+</button>
        </div>
        <label>
          Loop início
          <input inputMode="numeric" pattern="[0-9]*" type="text" value={loopStart} onChange={(event) => updateLoopStart(event.target.value)} />
        </label>
        <label>
          Loop fim
          <input inputMode="numeric" pattern="[0-9]*" type="text" value={loopEnd} onChange={(event) => updateLoopEnd(event.target.value)} />
        </label>
      </div>

      <div className="reader-progress">
        <div className="progress-meta">
          <strong>Compasso {currentMeasure}</strong>
          <span>
            tempo {currentBeatInMeasure.toFixed(2).replace(".", ",")} de {song.totalMeasures} compassos
          </span>
        </div>
        <input
          aria-label="Posição da música"
          max={song.totalBeats}
          min={playableStartBeat}
          step={0.25}
          type="range"
          value={positionBeat}
          onChange={(event) => seekToBeat(Number(event.target.value))}
          onInput={(event) => seekToBeat(Number(event.currentTarget.value))}
          style={{ "--progress": `${progressPercent}%` } as CSSProperties}
        />
      </div>

      <div className="now-playing">
        <div className={`play-state ${readerStatusClass}`}>
          <span>Status</span>
          <strong>{readerStatus}</strong>
        </div>
        <div className="valve-state">
          <span>Pistos</span>
          <ValveIndicator notes={currentNotes} octaveShift={octaveShift} />
        </div>
        <div>
          <span>Nota</span>
          <strong>{noteLabels(currentNotes, "labelPt", octaveShift)}</strong>
        </div>
        <div>
          <span>Escrita</span>
          <strong>{noteLabels(currentNotes, "written", octaveShift)}</strong>
        </div>
      </div>

      <div className="reader-score" ref={viewportRef}>
        <ScoreView
          song={song}
          zoom={zoom}
          currentBeat={currentNotes[0]?.absBeat ?? null}
          highlight
          fingeringScale={fingeringScale}
          fingeringOctaveShift={octaveShift}
          onCursorMove={followCursor}
          onReady={handleScoreReady}
          onNoteClick={(note) => seekToBeat(note.absBeat)}
        />
      </div>
      <NoteRail
        notes={song.notes}
        currentIndex={currentIndex}
        activeIndices={activeIndices}
        octaveShift={octaveShift}
        railScale={railScale}
        onNoteClick={(note) => seekToBeat(note.absBeat)}
      />
    </section>
  );
}

function GroupsPanel({
  songs,
  selectedSong,
}: {
  songs: Song[];
  selectedSong: Song | null;
}) {
  const [setlists, setSetlists] = useState<Setlist[]>(readSetlists);
  const [name, setName] = useState("");

  useEffect(() => saveSetlists(setlists), [setlists]);

  function createGroup() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSetlists((items) => [...items, { id: crypto.randomUUID(), name: trimmed, songIds: [] }]);
    setName("");
  }

  function addToGroup(id: string) {
    if (!selectedSong) return;
    setSetlists((items) =>
      items.map((item) =>
        item.id === id && !item.songIds.includes(selectedSong.id)
          ? { ...item, songIds: [...item.songIds, selectedSong.id] }
          : item,
      ),
    );
  }

  function removeFromGroup(id: string, songId: string) {
    setSetlists((items) => items.map((item) => (item.id === id ? { ...item, songIds: item.songIds.filter((s) => s !== songId) } : item)));
  }

  function exportGroups() {
    const blob = new Blob([JSON.stringify(setlists, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "grupos-repertorio.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  function importGroups(file: File) {
    file.text().then((text) => {
      const parsed = JSON.parse(text) as Setlist[];
      setSetlists(parsed);
    });
  }

  return (
    <aside className="groups">
      <div className="panel-title">
        <ListMusic size={18} />
        Grupos
      </div>
      <div className="group-create">
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Novo grupo" />
        <button onClick={createGroup}>
          <FolderPlus size={17} />
          Criar
        </button>
      </div>
      <div className="group-actions">
        <button onClick={exportGroups}>
          <Download size={16} />
          Exportar
        </button>
        <label className="import-button">
          <Upload size={16} />
          Importar
          <input type="file" accept="application/json" onChange={(event) => event.target.files?.[0] && importGroups(event.target.files[0])} />
        </label>
      </div>
      {setlists.map((group) => (
        <div className="group-item" key={group.id}>
          <div className="group-head">
            <strong>{group.name}</strong>
            <div>
              <button onClick={() => addToGroup(group.id)} title="Adicionar musica selecionada">
                <Plus size={15} />
                Adicionar
              </button>
              <button onClick={() => setSetlists((items) => items.filter((item) => item.id !== group.id))} title="Excluir grupo">
                <Trash2 size={15} />
                Excluir
              </button>
            </div>
          </div>
          {group.songIds.length === 0 ? (
            <span className="empty">sem músicas</span>
          ) : (
            group.songIds.map((songId) => {
              const song = songs.find((item) => item.id === songId);
              return (
                <div className="group-song" key={songId}>
                  <span>{song?.title ?? songId}</span>
                  <button onClick={() => removeFromGroup(group.id, songId)}>remover</button>
                </div>
              );
            })
          )}
        </div>
      ))}
    </aside>
  );
}

export function App() {
  const { catalog, error } = useCatalog();
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [songData, setSongData] = useState<SongData | null>(null);
  const [readerOpen, setReaderOpen] = useState(false);
  const [zoom, setZoom] = useState(1.1);
  const [homeBeat, setHomeBeat] = useState(0);
  const [homePlaying, setHomePlaying] = useState(false);
  const [homeOctaveShift, setHomeOctaveShift] = useState(0);
  const [homeFingeringScale, setHomeFingeringScale] = useState(1);
  const [homeGuideScale, setHomeGuideScale] = useState(1);
  const [homeSeekRequest, setHomeSeekRequest] = useState<{ beat: number; nonce: number } | null>(null);
  const [musicMenuOpen, setMusicMenuOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("both");

  const songs = catalog?.songs ?? [];
  const practiceEntries = useMemo(
    () =>
      trainingSequence.map((entry, index) => ({
        ...entry,
        index,
        song: songs.find((song) => song.id === entry.id) ?? null,
      })),
    [songs],
  );
  const selected = songs.find((song) => song.id === selectedId) ?? songs[0] ?? null;
  const readyCount = songs.filter((song) => song.status === "ready").length;
  const transcriptionCount = songs.filter((song) => song.status === "needs_transcription" || song.status === "visual_only").length;
  const playableSongData = songData?.status === "ready" && songData.notes.length > 0 ? songData : null;
  const highlightedNotes = playableSongData ? activeNotesForBeat(playableSongData.notes, homeBeat) : [];
  const selectedPracticeIndex = practiceEntries.findIndex((entry) => entry.song?.id === selected?.id);
  const selectedPracticeNumber = selectedPracticeIndex >= 0 ? selectedPracticeIndex + 1 : null;
  const practiceReadyCount = practiceEntries.filter((entry) => entry.song?.status === "ready").length;
  const showScore = viewMode !== "notes";
  const showNotes = viewMode !== "score";

  useEffect(() => {
    if (!selectedId && songs.length) {
      const songFromUrl = new URLSearchParams(window.location.search).get("song");
      const requested = songFromUrl ? songs.find((song) => song.id === songFromUrl) : null;
      const firstPracticeSong = practiceEntries.find((entry) => entry.song)?.song;
      setSelectedId((requested ?? firstPracticeSong ?? songs[0]).id);
    }
  }, [practiceEntries, songs, selectedId]);

  useEffect(() => {
    if (!selected?.data) {
      setSongData(null);
      return;
    }
    let cancelled = false;
    setSongData(null);
    setHomeBeat(0);
    setHomePlaying(false);
    setHomeOctaveShift(0);
    setHomeSeekRequest(null);
    fetch(`/${selected.data}`)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setSongData(data);
      })
      .catch(console.error);
    return () => {
      cancelled = true;
    };
  }, [selected]);

  useEffect(() => {
    if (viewMode === "notes" && !playableSongData) setViewMode("both");
  }, [playableSongData, viewMode]);

  const handleHomeBeatChange = useCallback((beat: number, playing: boolean) => {
    setHomeBeat(beat);
    setHomePlaying(playing);
  }, []);

  const handleHomeOctaveShift = useCallback((value: number) => {
    setHomeOctaveShift(clampNumber(value, -2, 2, 0));
  }, []);

  const seekHomeToNote = useCallback((note: ScoreNote) => {
    setHomeBeat(note.absBeat);
    setHomeSeekRequest({ beat: note.absBeat, nonce: Date.now() });
  }, []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return songs;
    return songs.filter((song) => song.title.toLowerCase().includes(needle));
  }, [query, songs]);

  function chooseSong(id: string) {
    setSelectedId(id);
    setMusicMenuOpen(false);
  }

  function choosePracticeSong(id: string) {
    const entry = practiceEntries.find((item) => item.id === id);
    if (entry?.song) chooseSong(entry.song.id);
  }

  function movePractice(delta: number) {
    if (!practiceEntries.length) return;
    const current = selectedPracticeIndex >= 0 ? selectedPracticeIndex : 0;
    for (let offset = 1; offset <= practiceEntries.length; offset += 1) {
      const nextIndex = (current + delta * offset + practiceEntries.length) % practiceEntries.length;
      const nextSong = practiceEntries[nextIndex]?.song;
      if (nextSong) {
        chooseSong(nextSong.id);
        return;
      }
    }
  }

  if (error) return <main className="state">Erro: {error}</main>;
  if (!catalog) return <main className="state">Carregando repertório...</main>;

  return (
    <main className="app">
      {readerOpen && playableSongData && <Reader song={playableSongData} onClose={() => setReaderOpen(false)} />}
      <header className="topbar">
        <div>
          <h1>Leitor de Partituras</h1>
          <p>{readyCount} músicas tocáveis, {transcriptionCount} para transcrever</p>
        </div>
        <div className="topbar-actions">
          <button className="music-menu-button" onClick={() => setMusicMenuOpen(true)} type="button">
            <ListMusic size={18} />
            Músicas
            <span>{selected?.title ?? "Selecionar"}</span>
          </button>
        </div>
      </header>

      <section className="practice-strip" aria-label="Sequencia de treino do bloco">
        <div className="practice-head">
          <div>
            <strong>Treino do Bloco</strong>
            <span>{practiceReadyCount} tocáveis de {practiceEntries.length} na sequência</span>
          </div>
          <div className="practice-nav">
            <button onClick={() => movePractice(-1)} type="button">
              <SkipBack size={17} />
              Anterior
            </button>
            <button className="primary" onClick={() => playableSongData ? setReaderOpen(true) : undefined} disabled={!playableSongData} type="button">
              <Play size={17} />
              Leitura
            </button>
            <button onClick={() => movePractice(1)} type="button">
              Próxima
              <SkipForward size={17} />
            </button>
          </div>
        </div>
        <div className="practice-sequence">
          {practiceEntries.map((entry) => {
            const song = entry.song;
            const active = song?.id === selected?.id;
            const status = song?.status === "ready" ? "tocável" : song ? "visual" : "sem fonte";
            return (
              <button
                className={`practice-song ${active ? "active" : ""}`}
                disabled={!song}
                key={entry.id}
                onClick={() => choosePracticeSong(entry.id)}
                type="button"
              >
                <span>{entry.index + 1}</span>
                <strong>{entry.label}</strong>
                <em className={`status-pill ${song ? songStatusClass(song) : "missing"}`}>{status}</em>
              </button>
            );
          })}
        </div>
      </section>

      <section className="layout">
        {musicMenuOpen && (
          <div className="music-menu-layer" onClick={() => setMusicMenuOpen(false)}>
            <aside className="song-list music-menu-panel" onClick={(event) => event.stopPropagation()}>
              <div className="music-menu-head">
                <strong>Escolher música</strong>
                <button onClick={() => setMusicMenuOpen(false)} type="button">Fechar</button>
              </div>
              <div className="search">
                <Search size={18} />
                <input autoFocus placeholder="Buscar música" value={query} onChange={(event) => setQuery(event.target.value)} />
              </div>
              <div className="music-menu-list">
                {filtered.map((song) => (
                  <button className={song.id === selectedId ? "song-row selected" : "song-row"} key={song.id} onClick={() => chooseSong(song.id)} type="button">
                    <FileMusic size={18} />
                    <span>
                      <strong>{song.title}</strong>
                      <small>{songStatusText(song)}</small>
                      <em className={`status-pill ${songStatusClass(song)}`}>{song.status === "ready" ? "tocável" : song.status === "missing_source" ? "sem fonte" : "transcrever"}</em>
                    </span>
                  </button>
                ))}
              </div>
              {catalog.pending.length > 0 && (
                <details>
                  <summary>Sem fonte</summary>
                  {catalog.pending.map((song) => (
                    <div className="pending" key={song.id}>{song.title}: {song.reason}</div>
                  ))}
                </details>
              )}
            </aside>
          </div>
        )}

        <section className="workspace">
          {selected && (
            <>
              <div className="score-toolbar">
                <div>
                  <h2>{selectedPracticeNumber ? `${selectedPracticeNumber}. ` : ""}{selected.title}</h2>
                  <p>{songStatusText(selected)}</p>
                </div>
                <div className="toolbar-actions">
                  {songData && (
                    <>
                      <div className="view-mode-control" aria-label="Modo de visualizacao">
                        <button className={viewMode === "both" ? "active" : ""} onClick={() => setViewMode("both")} type="button">Tudo</button>
                        <button className={viewMode === "score" ? "active" : ""} onClick={() => setViewMode("score")} type="button">Partitura</button>
                        <button className={viewMode === "notes" ? "active" : ""} disabled={!playableSongData} onClick={() => setViewMode("notes")} type="button">Notas e pistos</button>
                      </div>
                      <button onClick={() => setZoom((value) => Math.max(0.8, value - 0.1))}>
                        <ZoomOut size={17} />
                        Menos zoom
                      </button>
                      <button onClick={() => setZoom((value) => Math.min(2.2, value + 0.1))}>
                        <ZoomIn size={17} />
                        Mais zoom
                      </button>
                      <SizeSlider label="Partitura" min={0.8} max={2.4} value={zoom} onChange={setZoom} />
                      {playableSongData && showScore && <SizeSlider label="Números" min={0.7} max={2.2} value={homeFingeringScale} onChange={setHomeFingeringScale} />}
                      {playableSongData && showNotes && <SizeSlider label="Tablatura" min={0.75} max={2.1} value={homeGuideScale} onChange={setHomeGuideScale} />}
                    </>
                  )}
                  {playableSongData && (
                    <>
                      <button className="primary" onClick={() => setReaderOpen(true)}>
                        <Play size={17} />
                        Modo leitura
                      </button>
                    </>
                  )}
                  {selected.fingeringsPdf && (
                    <a className="button-link" href={`/${selected.fingeringsPdf}`} target="_blank" rel="noreferrer">
                      <Music2 size={17} />
                      PDF com pistos
                    </a>
                  )}
                  {selected.sourcePdf && (
                    <a className="button-link" href={`/${selected.sourcePdf}`} target="_blank" rel="noreferrer">
                      <FileMusic size={17} />
                      Abrir PDF
                    </a>
                  )}
                </div>
              </div>
              {playableSongData && (
                <MelodyPlayer
                  song={playableSongData}
                  onBeatChange={handleHomeBeatChange}
                  octaveShift={homeOctaveShift}
                  onOctaveShiftChange={handleHomeOctaveShift}
                  seekRequest={homeSeekRequest}
                />
              )}
              {showScore && songData && (
                <div className="score-panel">
                  {playableSongData ? (
                    <ScoreView
                      song={playableSongData}
                      zoom={zoom}
                      currentBeat={homePlaying ? highlightedNotes[0]?.absBeat ?? null : null}
                      highlight={homePlaying}
                      fingeringScale={homeFingeringScale}
                      fingeringOctaveShift={homeOctaveShift}
                      onNoteClick={seekHomeToNote}
                    />
                  ) : (
                    <VisualScore song={songData} zoom={zoom} />
                  )}
                </div>
              )}
              {playableSongData && showNotes && (
                <FullNoteGuide
                  notes={playableSongData.notes}
                  currentBeat={homePlaying ? highlightedNotes[0]?.absBeat ?? null : null}
                  octaveShift={homeOctaveShift}
                  guideScale={homeGuideScale}
                  onNoteClick={seekHomeToNote}
                />
              )}
            </>
          )}
        </section>

        <GroupsPanel songs={songs} selectedSong={selected} />
      </section>
    </main>
  );
}
