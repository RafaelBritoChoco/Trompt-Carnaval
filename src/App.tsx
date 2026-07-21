import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { OpenSheetMusicDisplay as OpenSheetMusicDisplayInstance } from "opensheetmusicdisplay";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Edit3,
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
  Save,
  Search,
  SlidersHorizontal,
  SkipBack,
  SkipForward,
  Trash2,
  Upload,
  Volume2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { Catalog, ScoreNote, Setlist, Song, SongData } from "./types";
import {
  cloneDraft,
  createEditorEvent,
  createEmptyDraft,
  downloadDraftMusicXml,
  draftFromSongData,
  draftToSongData,
  editorDurations,
  editorFingering,
  editorPitchLabel,
  editorPitches,
  eventMeasure,
  eventStartBeat,
  parseEditorPitch,
  readUserSongs,
  userSongSummary,
  withEditorOctave,
  withEditorPitchClass,
  writeUserSongs,
  type EditorEvent,
  type UserSongDraft,
} from "./songEditor";

const catalogUrl = "/data/catalog.json";
const setlistKey = "bloco-setlists-v1";
const emptyCatalogSongs: Song[] = [];
const audioLeadSeconds = 0.035;
const audioLookAheadSeconds = 0.12;

function performanceSeconds() {
  return performance.now() / 1000;
}

async function resumeAudioContext(context: AudioContext) {
  if (context.state === "running") return true;
  await Promise.race([
    context.resume(),
    new Promise<void>((resolve) => window.setTimeout(resolve, 600)),
  ]);
  return String(context.state) === "running";
}
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

function initialReaderZoom() {
  return window.matchMedia("(max-width: 760px)").matches ? 0.95 : 1.55;
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
  if (song.userCreated) return `${song.notesCount} notas | criada aqui`;
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
  const osmdRef = useRef<OpenSheetMusicDisplayInstance | null>(null);
  const coloredNotesRef = useRef<Array<{ setColor: (color: string, options: Record<string, boolean>) => void }>>([]);
  const pitchedSlotsRef = useRef<boolean[]>([]);
  const renderedZoomRef = useRef<number | null>(null);
  const [scoreReady, setScoreReady] = useState(false);
  const [fingeringMarkers, setFingeringMarkers] = useState<FingeringMarker[]>([]);
  const [renderRevision, setRenderRevision] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function renderScore() {
      if (!containerRef.current || (!song.musicxml && !song.musicxmlText)) return;
      setScoreReady(false);
      setFingeringMarkers([]);
      onReady?.(false);
      const [{ CursorType, OpenSheetMusicDisplay }, xml] = await Promise.all([
        import("opensheetmusicdisplay"),
        song.musicxmlText ? Promise.resolve(song.musicxmlText) : fetch(`/${song.musicxml}`).then((res) => res.text()),
      ]);
      if (cancelled || !containerRef.current) return;
      containerRef.current.innerHTML = "";
      const osmd = new OpenSheetMusicDisplay(containerRef.current, {
        autoResize: true,
        cursorsOptions: [{ type: CursorType.Standard, color: "#10a64a", alpha: 0.55, follow: false }],
        drawPartAbbreviations: false,
        drawPartNames: false,
        drawComposer: false,
        drawCredits: false,
        drawLyricist: false,
        drawTitle: false,
        drawSubtitle: false,
        followCursor: false,
        drawingParameters: "default",
      });
      osmdRef.current = osmd;
      const pitchedSlots = musicXmlPitchedSlots(xml);
      pitchedSlotsRef.current = pitchedSlots;
      if (cancelled) return;
      await osmd.load(xml);
      osmd.zoom = zoom;
      await osmd.render();
      if (cancelled) return;
      renderedZoomRef.current = zoom;
      if (highlight) osmd.cursor?.show();
      else osmd.cursor?.hide();
      osmd.cursor?.reset();
      osmd.cursor?.update();
      setScoreReady(true);
      setRenderRevision((value) => value + 1);
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
  }, [song.id, song.musicxml, song.musicxmlText, onReady]);

  useEffect(() => {
    if (!scoreReady || !osmdRef.current || renderedZoomRef.current === zoom) return;
    let cancelled = false;
    const osmd = osmdRef.current;
    async function renderZoom() {
      osmd.zoom = zoom;
      await osmd.render();
      if (cancelled) return;
      renderedZoomRef.current = zoom;
      osmd.cursor?.reset();
      osmd.cursor?.update();
      setRenderRevision((value) => value + 1);
    }
    void renderZoom().catch(console.error);
    return () => {
      cancelled = true;
    };
  }, [scoreReady, zoom]);

  useEffect(() => {
    if (!scoreReady || !containerRef.current || !showFingerings) {
      setFingeringMarkers([]);
      return;
    }
    const container = containerRef.current;
    let frame = 0;
    let resizeTimer = 0;
    const drawMarkers = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        setFingeringMarkers(buildFingeringMarkers(song, container, fingeringOctaveShift, pitchedSlotsRef.current));
      });
    };
    const refreshAfterResize = () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(drawMarkers, 100);
    };
    drawMarkers();
    window.addEventListener("resize", refreshAfterResize);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(resizeTimer);
      window.removeEventListener("resize", refreshAfterResize);
    };
  }, [fingeringOctaveShift, renderRevision, scoreReady, showFingerings, song]);

  useEffect(() => {
    if (!scoreReady || !osmdRef.current) return;
    if (highlight) osmdRef.current.cursor?.show();
    else osmdRef.current.cursor?.hide();
  }, [highlight, scoreReady]);

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
  const railRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const current = railRef.current?.querySelector<HTMLElement>(".note-chip.current");
    current?.scrollIntoView({ behavior: "auto", block: "nearest", inline: "center" });
  }, [currentIndex]);

  return (
    <div className="note-rail" ref={railRef} style={{ "--rail-scale": railScale } as CSSProperties}>
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
  onBpmChange,
}: {
  song: SongData;
  onBeatChange: (beat: number, playing: boolean) => void;
  octaveShift: number;
  onOctaveShiftChange: (value: number) => void;
  seekRequest?: { beat: number; nonce: number } | null;
  onBpmChange?: (value: number) => void;
}) {
  const audioContextRef = useRef<AudioContext | null>(null);
  const playbackStartTimeRef = useRef(0);
  const playbackStartBeatRef = useRef(0);
  const nextNoteIndexRef = useRef(0);
  const scheduledOscillatorsRef = useRef(new Set<OscillatorNode>());
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
    const running = await resumeAudioContext(ctx);
    if (!running) return;
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

  function stopScheduledNotes() {
    scheduledOscillatorsRef.current.forEach((oscillator) => {
      try {
        oscillator.stop();
      } catch {
        // The oscillator may already have ended.
      }
    });
    scheduledOscillatorsRef.current.clear();
  }

  function playNote(note: ScoreNote, when: number) {
    if (!noteSound) return;
    const frequency = noteFrequency(note.written);
    if (!frequency) return;
    const ctx = getAudioContext();
    const startAt = Math.max(ctx.currentTime, when);
    const duration = Math.max(0.08, (note.durationBeats * 60 * 0.9) / safeBpm);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.value = frequency * 2 ** octaveShift;
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(0.14, startAt + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    scheduledOscillatorsRef.current.add(osc);
    osc.onended = () => scheduledOscillatorsRef.current.delete(osc);
    osc.start(startAt);
    osc.stop(startAt + duration + 0.03);
  }

  useEffect(() => {
    const defaultBpm = clampNumber(song.defaultBpm, 30, 240, 100);
    stopScheduledNotes();
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
    stopScheduledNotes();
    playbackStartBeatRef.current = nextBeat;
    playbackStartTimeRef.current = performanceSeconds() + audioLeadSeconds;
    nextNoteIndexRef.current = firstNoteIndexAtOrAfter(song.notes, nextBeat);
    setPositionBeat(nextBeat);
  }, [seekRequest, song.notes, song.totalBeats, startBeat]);

  function seekToBeat(value: number) {
    const nextBeat = clampNumber(value, startBeat, song.totalBeats, positionBeat);
    stopScheduledNotes();
    playbackStartBeatRef.current = nextBeat;
    playbackStartTimeRef.current = performanceSeconds() + audioLeadSeconds;
    nextNoteIndexRef.current = firstNoteIndexAtOrAfter(song.notes, nextBeat);
    setPositionBeat(nextBeat);
  }

  useEffect(() => {
    onBeatChange(positionBeat, playing);
  }, [onBeatChange, playing, positionBeat]);

  useEffect(() => {
    if (!playing) return;
    stopScheduledNotes();
    playbackStartBeatRef.current = positionBeat;
    playbackStartTimeRef.current = performanceSeconds() + audioLeadSeconds;
    nextNoteIndexRef.current = firstNoteIndexAtOrAfter(song.notes, positionBeat);
  }, [noteSound, octaveShift, safeBpm]);

  useEffect(() => {
    if (!playing || !canPlay) return;
    let raf = 0;
    const ctx = getAudioContext();
    const tick = () => {
      const clockNow = performanceSeconds();
      const elapsedSeconds = Math.max(0, clockNow - playbackStartTimeRef.current);
      const nextBeat = playbackStartBeatRef.current + elapsedSeconds * (safeBpm / 60);
      const scheduleThroughBeat = nextBeat + audioLookAheadSeconds * (safeBpm / 60);
      let index = nextNoteIndexRef.current;
      while (index < song.notes.length && song.notes[index].absBeat <= scheduleThroughBeat + 0.001) {
        const note = song.notes[index];
        const secondsUntilNote = Math.max(
          0,
          playbackStartTimeRef.current - clockNow + ((note.absBeat - playbackStartBeatRef.current) * 60) / safeBpm,
        );
        const when = ctx.currentTime + secondsUntilNote;
        playNote(note, when);
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
    onBpmChange?.(committed);
  }

  async function playPause() {
    if (playing) {
      stopScheduledNotes();
      setPlaying(false);
      return;
    }
    if (!canPlay || starting) return;
    setStarting(true);
    try {
      await prepareAudio();
      const nextStartBeat = positionBeat >= song.totalBeats || positionBeat < startBeat ? startBeat : positionBeat;
      playbackStartBeatRef.current = nextStartBeat;
      playbackStartTimeRef.current = performanceSeconds() + audioLeadSeconds;
      nextNoteIndexRef.current = firstNoteIndexAtOrAfter(song.notes, nextStartBeat);
      setPositionBeat(nextStartBeat);
      setPlaying(true);
    } finally {
      setStarting(false);
    }
  }

  function reset() {
    stopScheduledNotes();
    setPlaying(false);
    playbackStartBeatRef.current = startBeat;
    playbackStartTimeRef.current = 0;
    nextNoteIndexRef.current = firstNoteIndexAtOrAfter(song.notes, startBeat);
    setPositionBeat(startBeat);
  }

  useEffect(() => () => stopScheduledNotes(), []);

  return (
    <section className="melody-player">
      <div className="melody-actions">
        <button className="primary melody-play-button" disabled={!canPlay || starting} onClick={() => void playPause()}>
          {playing ? <Pause size={17} /> : <Play size={17} />}
          {playing ? "Pausar melodia" : starting ? "Preparando" : "Tocar melodia"}
        </button>
        <button aria-label="Voltar ao início" className="melody-reset-button" disabled={!canPlay} onClick={reset} title="Voltar ao início">
          <RotateCcw size={17} />
          <span>Inicio</span>
        </button>
        <label className="bpm-control">
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
        <label className="toggle sound-toggle">
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
  const scheduledOscillatorsRef = useRef(new Set<OscillatorNode>());
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [starting, setStarting] = useState(false);
  const [scoreReady, setScoreReady] = useState(false);
  const [bpm, setBpm] = useState(clampNumber(song.defaultBpm, 30, 240, 100));
  const [bpmInput, setBpmInput] = useState(String(clampNumber(song.defaultBpm, 30, 240, 100)));
  const [zoom, setZoom] = useState(initialReaderZoom);
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
    const running = await resumeAudioContext(ctx);
    if (!running) return;

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

  function stopScheduledAudio() {
    scheduledOscillatorsRef.current.forEach((oscillator) => {
      try {
        oscillator.stop();
      } catch {
        // The oscillator may already have ended.
      }
    });
    scheduledOscillatorsRef.current.clear();
  }

  function playScoreNote(note: ScoreNote, when: number) {
    const frequency = noteFrequency(note.written);
    if (!frequency) return;
    const ctx = getAudioContext();
    const startAt = Math.max(ctx.currentTime, when);
    const duration = Math.max(0.08, (note.durationBeats * 60 * 0.88) / safeBpm);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.value = frequency * 2 ** octaveShift;
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(0.12, startAt + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    scheduledOscillatorsRef.current.add(osc);
    osc.onended = () => scheduledOscillatorsRef.current.delete(osc);
    osc.start(startAt);
    osc.stop(startAt + duration + 0.03);
  }

  function playMetronomeClick(beatIndex: number, when: number) {
    const ctx = getAudioContext();
    const startAt = Math.max(ctx.currentTime, when);
    const accent = beatIndex % 4 === 0;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = accent ? 1500 : 950;
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(accent ? 0.12 : 0.075, startAt + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.045);
    osc.connect(gain);
    gain.connect(ctx.destination);
    scheduledOscillatorsRef.current.add(osc);
    osc.onended = () => scheduledOscillatorsRef.current.delete(osc);
    osc.start(startAt);
    osc.stop(startAt + 0.055);
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
    stopScheduledAudio();
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
    stopScheduledAudio();
    playbackStartBeatRef.current = positionBeat;
    playbackStartTimeRef.current = performanceSeconds() + audioLeadSeconds;
    nextNoteIndexRef.current = firstNoteIndexAtOrAfter(song.notes, positionBeat);
    nextMetronomeBeatRef.current = Math.ceil(positionBeat - 0.001);
  }, [metronome, noteSound, octaveShift, safeBpm]);

  useEffect(() => {
    if (!metronome) return;
    nextMetronomeBeatRef.current = Math.ceil(positionBeat - 0.001);
  }, [metronome]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const ctx = getAudioContext();
    const tick = () => {
      const clockNow = performanceSeconds();
      const elapsedSeconds = Math.max(0, clockNow - playbackStartTimeRef.current);
      let nextBeat = playbackStartBeatRef.current + elapsedSeconds * (safeBpm / 60);
      const loopStartBeat = measureStartBeat(song.notes, loopStart);
      const nextMeasureBeat = loopEnd >= song.totalMeasures ? song.totalBeats : measureStartBeat(song.notes, loopEnd + 1);
      const loopEndBeat = Math.max(loopStartBeat + 0.25, nextMeasureBeat || song.totalBeats);
      if (loopEnabled && nextBeat >= loopEndBeat - 0.001) {
        stopScheduledAudio();
        nextBeat = loopStartBeat;
        playbackStartBeatRef.current = loopStartBeat;
        playbackStartTimeRef.current = performanceSeconds() + audioLeadSeconds;
        nextNoteIndexRef.current = firstNoteIndexAtOrAfter(song.notes, loopStartBeat);
        nextMetronomeBeatRef.current = Math.ceil(loopStartBeat - 0.001);
      }

      const lookAheadBeat = nextBeat + audioLookAheadSeconds * (safeBpm / 60);
      const scheduleThroughBeat = loopEnabled ? Math.min(lookAheadBeat, loopEndBeat - 0.001) : Math.min(lookAheadBeat, song.totalBeats);

      const playScheduledNotesUntil = (untilBeat: number) => {
        if (!noteSound) {
          nextNoteIndexRef.current = firstNoteIndexAtOrAfter(song.notes, untilBeat);
          return;
        }
        let index = nextNoteIndexRef.current;
        while (index < song.notes.length && song.notes[index].absBeat <= untilBeat + 0.001) {
          const note = song.notes[index];
          const secondsUntilNote = Math.max(
            0,
            playbackStartTimeRef.current - clockNow + ((note.absBeat - playbackStartBeatRef.current) * 60) / safeBpm,
          );
          const when = ctx.currentTime + secondsUntilNote;
          playScoreNote(note, when);
          index += 1;
        }
        nextNoteIndexRef.current = index;
      };

      const playMetronomeUntil = (untilBeat: number) => {
        if (!metronome) return;
        while (nextMetronomeBeatRef.current <= untilBeat + 0.001) {
          const beat = nextMetronomeBeatRef.current;
          const secondsUntilBeat = Math.max(
            0,
            playbackStartTimeRef.current - clockNow + ((beat - playbackStartBeatRef.current) * 60) / safeBpm,
          );
          const when = ctx.currentTime + secondsUntilBeat;
          playMetronomeClick(beat, when);
          nextMetronomeBeatRef.current += 1;
        }
      };

      playScheduledNotesUntil(scheduleThroughBeat);
      playMetronomeUntil(scheduleThroughBeat);
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
    stopScheduledAudio();
    playbackStartBeatRef.current = nextBeat;
    playbackStartTimeRef.current = performanceSeconds() + audioLeadSeconds;
    nextNoteIndexRef.current = firstNoteIndexAtOrAfter(song.notes, nextBeat);
    nextMetronomeBeatRef.current = Math.ceil(nextBeat - 0.001);
    setPositionBeat(nextBeat);
  }

  async function playPause() {
    if (playing) {
      stopScheduledAudio();
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
    playbackStartTimeRef.current = performanceSeconds() + audioLeadSeconds;
    nextNoteIndexRef.current = firstNoteIndexAtOrAfter(song.notes, startBeat);
    nextMetronomeBeatRef.current = Math.ceil(startBeat - 0.001);
    setPositionBeat(startBeat);
    setPlaying(true);
    setStarting(false);
  }

  function reset() {
    stopScheduledAudio();
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
    stopScheduledAudio();
    playbackStartBeatRef.current = target.absBeat;
    playbackStartTimeRef.current = performanceSeconds() + audioLeadSeconds;
    nextNoteIndexRef.current = firstNoteIndexAtOrAfter(song.notes, target.absBeat);
    nextMetronomeBeatRef.current = Math.ceil(target.absBeat - 0.001);
    setPositionBeat(target.absBeat);
  }

  useEffect(() => () => stopScheduledAudio(), []);

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
        <div className="reader-primary-controls">
          <div className="reader-transport">
            <button className="primary reader-play-button" disabled={!playing && (!scoreReady || starting)} onClick={() => void playPause()}>
              {playing ? <Pause size={18} /> : <Play size={18} />}
              {playing ? "Pausar" : !scoreReady || starting ? "Preparando" : "Tocar"}
            </button>
            <button aria-label="Voltar ao início" onClick={reset} title="Voltar ao início">
              <RotateCcw size={18} />
            </button>
            <button aria-label="Compasso anterior" onClick={() => jumpMeasure(-1)} title="Compasso anterior">
              <SkipBack size={18} />
            </button>
            <button aria-label="Próximo compasso" onClick={() => jumpMeasure(1)} title="Próximo compasso">
              <SkipForward size={18} />
            </button>
          </div>
          <div className="reader-quick-controls">
            <label className="reader-bpm-control">
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
            <button aria-label="Diminuir partitura" onClick={() => setZoom((value) => Math.max(0.8, value - 0.1))} title="Diminuir partitura">
              <ZoomOut size={18} />
            </button>
            <button aria-label="Aumentar partitura" onClick={() => setZoom((value) => Math.min(2.6, value + 0.1))} title="Aumentar partitura">
              <ZoomIn size={18} />
            </button>
          </div>
        </div>
        <details className="reader-more-controls">
          <summary>
            <SlidersHorizontal size={17} />
            Ajustes
            {loopEnabled && <span>Loop ligado</span>}
          </summary>
          <div className="reader-more-grid">
            <SizeSlider label="Partitura" min={0.8} max={2.8} value={zoom} onChange={setZoom} />
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
            {loopEnabled && (
              <>
                <label>
                  Loop início
                  <input inputMode="numeric" pattern="[0-9]*" type="text" value={loopStart} onChange={(event) => updateLoopStart(event.target.value)} />
                </label>
                <label>
                  Loop fim
                  <input inputMode="numeric" pattern="[0-9]*" type="text" value={loopEnd} onChange={(event) => updateLoopEnd(event.target.value)} />
                </label>
              </>
            )}
          </div>
        </details>
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

function SongEditor({
  initialDraft,
  availableSongs,
  loadSong,
  saved,
  onSave,
  onDelete,
  onClose,
}: {
  initialDraft: UserSongDraft;
  availableSongs: Song[];
  loadSong: (id: string) => Promise<SongData | null>;
  saved: boolean;
  onSave: (draft: UserSongDraft) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(() => cloneDraft(initialDraft));
  const [renderDraft, setRenderDraft] = useState(() => cloneDraft(initialDraft));
  const [selectedEventId, setSelectedEventId] = useState<string | null>(initialDraft.events[0]?.id ?? null);
  const [insertWritten, setInsertWritten] = useState("C5");
  const [insertDuration, setInsertDuration] = useState(1);
  const [previewBeat, setPreviewBeat] = useState(0);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [previewOctaveShift, setPreviewOctaveShift] = useState(0);
  const [previewSeek, setPreviewSeek] = useState<{ beat: number; nonce: number } | null>(null);
  const importableSongs = useMemo(() => availableSongs.filter((song) => song.status === "ready" && song.notesCount > 0), [availableSongs]);
  const [importId, setImportId] = useState(importableSongs[0]?.id ?? "");
  const [importing, setImporting] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState("");

  const selectedEvent = draft.events.find((event) => event.id === selectedEventId) ?? null;
  const activeWritten = selectedEvent?.kind === "note" ? selectedEvent.written ?? "C5" : insertWritten;
  const activePitch = parseEditorPitch(activeWritten) ?? parseEditorPitch("C5")!;
  const activeDuration = selectedEvent?.durationBeats ?? insertDuration;
  const previewSong = useMemo(() => draftToSongData(renderDraft), [renderDraft]);
  const selectedBeat = selectedEventId ? eventStartBeat(draft.events, selectedEventId) : 0;
  const activePreviewBeat = previewPlaying ? previewBeat : selectedBeat;
  const timelineMeasures = useMemo(() => {
    const result = new Map<number, Array<{ event: EditorEvent; beat: number }>>();
    let beat = 0;
    draft.events.forEach((event) => {
      const measure = Math.floor(beat / draft.beatsPerMeasure) + 1;
      const entries = result.get(measure) ?? [];
      entries.push({ event, beat: (beat % draft.beatsPerMeasure) + 1 });
      result.set(measure, entries);
      beat += event.durationBeats;
    });
    return Array.from(result.entries());
  }, [draft.beatsPerMeasure, draft.events]);
  const handlePreviewBeatChange = useCallback((beat: number, playing: boolean) => {
    setPreviewBeat(beat);
    setPreviewPlaying(playing);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setRenderDraft(cloneDraft(draft)), 140);
    return () => window.clearTimeout(timer);
  }, [draft]);

  function changeDraft(update: (current: UserSongDraft) => UserSongDraft) {
    setDraft((current) => ({ ...update(current), updatedAt: new Date().toISOString() }));
    setDirty(true);
    setMessage("");
  }

  function updateEvent(eventId: string, update: (event: EditorEvent) => EditorEvent) {
    changeDraft((current) => ({
      ...current,
      events: current.events.map((event) => event.id === eventId ? update(event) : event),
    }));
  }

  function addEvent(kind: "note" | "rest") {
    const event = createEditorEvent(kind, insertWritten, insertDuration);
    changeDraft((current) => {
      const selectedIndex = current.events.findIndex((item) => item.id === selectedEventId);
      const insertIndex = selectedIndex >= 0 ? selectedIndex + 1 : current.events.length;
      const events = [...current.events];
      events.splice(insertIndex, 0, event);
      return { ...current, events };
    });
    setSelectedEventId(event.id);
  }

  function setPitchClass(pitchClass: string) {
    const written = withEditorPitchClass(activeWritten, pitchClass);
    setInsertWritten(written);
    if (selectedEvent) updateEvent(selectedEvent.id, (event) => ({ ...event, kind: "note", written }));
  }

  function setPitchOctave(octave: number) {
    const written = withEditorOctave(activeWritten, octave);
    setInsertWritten(written);
    if (selectedEvent) updateEvent(selectedEvent.id, (event) => ({ ...event, kind: "note", written }));
  }

  function setDuration(durationBeats: number) {
    setInsertDuration(durationBeats);
    if (selectedEvent) updateEvent(selectedEvent.id, (event) => ({ ...event, durationBeats }));
  }

  function setSelectedKind(kind: "note" | "rest") {
    if (!selectedEvent) return;
    updateEvent(selectedEvent.id, (event) => ({ ...event, kind, written: kind === "note" ? event.written ?? insertWritten : undefined }));
  }

  function moveSelected(delta: number) {
    if (!selectedEventId) return;
    changeDraft((current) => {
      const index = current.events.findIndex((event) => event.id === selectedEventId);
      const target = index + delta;
      if (index < 0 || target < 0 || target >= current.events.length) return current;
      const events = [...current.events];
      [events[index], events[target]] = [events[target], events[index]];
      return { ...current, events };
    });
  }

  function duplicateSelected() {
    if (!selectedEvent) return;
    const copy = { ...selectedEvent, id: createEditorEvent(selectedEvent.kind, selectedEvent.written, selectedEvent.durationBeats).id };
    changeDraft((current) => {
      const index = current.events.findIndex((event) => event.id === selectedEvent.id);
      const events = [...current.events];
      events.splice(index + 1, 0, copy);
      return { ...current, events };
    });
    setSelectedEventId(copy.id);
  }

  function deleteSelected() {
    if (!selectedEventId) return;
    const index = draft.events.findIndex((event) => event.id === selectedEventId);
    const nextId = draft.events[index + 1]?.id ?? draft.events[index - 1]?.id ?? null;
    changeDraft((current) => ({ ...current, events: current.events.filter((event) => event.id !== selectedEventId) }));
    setSelectedEventId(nextId);
  }

  async function importSong() {
    if (!importId || importing) return;
    setImporting(true);
    setMessage("");
    try {
      const source = await loadSong(importId);
      if (!source) throw new Error("Não foi possível abrir a música.");
      const imported = draftFromSongData(source);
      setDraft(imported);
      setRenderDraft(imported);
      setSelectedEventId(imported.events[0]?.id ?? null);
      setDirty(true);
      setMessage(`${source.title} importada como cópia.`);
    } catch (importError) {
      setMessage(importError instanceof Error ? importError.message : "Falha ao importar música.");
    } finally {
      setImporting(false);
    }
  }

  function saveDraft() {
    const next = {
      ...draft,
      title: draft.title.trim() || "Minha música",
      defaultBpm: Math.round(clampNumber(draft.defaultBpm, 30, 240, 100)),
      updatedAt: new Date().toISOString(),
    };
    setDraft(next);
    setRenderDraft(next);
    onSave(next);
    setDirty(false);
    setMessage("Música salva neste navegador.");
  }

  function closeEditor() {
    if (dirty && !window.confirm("Fechar sem salvar as alterações?")) return;
    onClose();
  }

  function selectFromScore(note: ScoreNote) {
    if (!note.eventId) return;
    setSelectedEventId(note.eventId);
    setPreviewSeek({ beat: note.absBeat, nonce: Date.now() });
  }

  return (
    <div className="song-editor-layer">
      <section className="song-editor" aria-label="Editor de música">
        <header className="editor-header">
          <button aria-label="Fechar editor" className="editor-back" onClick={closeEditor} title="Fechar editor" type="button">
            <ArrowLeft size={20} />
          </button>
          <div>
            <span>{saved ? "EDITAR MÚSICA" : "NOVA MÚSICA"}</span>
            <strong>{draft.title.trim() || "Sem título"}</strong>
          </div>
          {dirty && <em>não salvo</em>}
          <div className="editor-header-actions">
            <button onClick={() => downloadDraftMusicXml(draft)} title="Baixar MusicXML" type="button">
              <Download size={18} />
              <span>MusicXML</span>
            </button>
            <button className="primary" onClick={saveDraft} type="button">
              <Save size={18} />
              Salvar
            </button>
          </div>
        </header>

        <div className="editor-body">
          <section className="editor-metadata">
            <label className="editor-title-field">
              <span>Nome da música</span>
              <input value={draft.title} onChange={(event) => changeDraft((current) => ({ ...current, title: event.target.value }))} />
            </label>
            <label>
              <span>Compasso</span>
              <select value={draft.beatsPerMeasure} onChange={(event) => changeDraft((current) => ({ ...current, beatsPerMeasure: Number(event.target.value) as 2 | 3 | 4 }))}>
                <option value="2">2/4</option>
                <option value="3">3/4</option>
                <option value="4">4/4</option>
              </select>
            </label>
            <div className="editor-import">
              <label>
                <span>Importar do repertório</span>
                <select value={importId} onChange={(event) => setImportId(event.target.value)}>
                  {importableSongs.map((song) => <option key={song.id} value={song.id}>{song.title}</option>)}
                </select>
              </label>
              <button disabled={!importId || importing} onClick={() => void importSong()} type="button">
                <Upload size={17} />
                {importing ? "Importando" : "Criar cópia"}
              </button>
            </div>
            {message && <output className="editor-message">{message}</output>}
          </section>

          <section className="editor-compose">
            <div className="editor-selection-head">
              <div>
                <span>{selectedEvent ? `COMPASSO ${eventMeasure(draft.events, selectedEvent.id, draft.beatsPerMeasure)}` : "PRÓXIMO EVENTO"}</span>
                <strong>{selectedEvent?.kind === "rest" ? "Pausa" : editorPitchLabel(activeWritten)}</strong>
              </div>
              <div className="editor-kind-control" aria-label="Tipo do evento">
                <button aria-pressed={selectedEvent?.kind !== "rest"} className={selectedEvent?.kind !== "rest" ? "active" : ""} disabled={!selectedEvent} onClick={() => setSelectedKind("note")} type="button">Nota</button>
                <button aria-pressed={selectedEvent?.kind === "rest"} className={selectedEvent?.kind === "rest" ? "active" : ""} disabled={!selectedEvent} onClick={() => setSelectedKind("rest")} type="button">Pausa</button>
              </div>
            </div>

            <div className="editor-pitch-grid" aria-label="Altura da nota">
              {editorPitches.map((pitch) => (
                <button
                  aria-pressed={activePitch.pitchClass === pitch.value}
                  className={`${pitch.value.includes("#") || pitch.value.includes("b") ? "accidental" : ""} ${activePitch.pitchClass === pitch.value ? "active" : ""}`}
                  key={pitch.value}
                  onClick={() => setPitchClass(pitch.value)}
                  type="button"
                >
                  <strong>{pitch.label}</strong>
                  <small>{pitch.value}</small>
                </button>
              ))}
            </div>

            <div className="editor-note-options">
              <div className="editor-octave-control">
                <span>Oitava</span>
                <button aria-label="Oitava abaixo" disabled={activePitch.octave <= 3} onClick={() => setPitchOctave(activePitch.octave - 1)} title="Oitava abaixo" type="button">-</button>
                <strong>{activePitch.octave}</strong>
                <button aria-label="Oitava acima" disabled={activePitch.octave >= 6} onClick={() => setPitchOctave(activePitch.octave + 1)} title="Oitava acima" type="button">+</button>
              </div>
              <div className="editor-valves">
                <span>Pistos</span>
                <strong>{editorFingering(activeWritten).join("/")}</strong>
              </div>
              <div className="editor-duration-control">
                <span>Duração</span>
                <div>
                  {editorDurations.map((duration) => (
                    <button aria-label={`${duration.value} tempo, ${duration.name}`} aria-pressed={activeDuration === duration.value} className={activeDuration === duration.value ? "active" : ""} key={duration.value} onClick={() => setDuration(duration.value)} title={duration.name} type="button">
                      {duration.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="editor-add-actions">
              <button className="primary" onClick={() => addEvent("note")} type="button"><Plus size={18} />Adicionar nota</button>
              <button onClick={() => addEvent("rest")} type="button"><Plus size={18} />Adicionar pausa</button>
              <span />
              <button aria-label="Mover para esquerda" disabled={!selectedEvent} onClick={() => moveSelected(-1)} title="Mover para esquerda" type="button"><ChevronLeft size={18} /></button>
              <button aria-label="Mover para direita" disabled={!selectedEvent} onClick={() => moveSelected(1)} title="Mover para direita" type="button"><ChevronRight size={18} /></button>
              <button aria-label="Duplicar" disabled={!selectedEvent} onClick={duplicateSelected} title="Duplicar" type="button"><Copy size={18} /></button>
              <button aria-label="Excluir" className="danger-icon" disabled={!selectedEvent} onClick={deleteSelected} title="Excluir" type="button"><Trash2 size={18} /></button>
            </div>
          </section>

          <section className="editor-timeline" aria-label="Sequência da música">
            <div className="editor-section-title">
              <div><span>SEQUÊNCIA</span><strong>{draft.events.length} eventos · {previewSong.totalMeasures} compassos</strong></div>
              {saved && <button className="editor-delete-song" onClick={() => onDelete(draft.id)} type="button"><Trash2 size={16} />Excluir música</button>}
            </div>
            {timelineMeasures.length ? (
              <div className="editor-measures">
                {timelineMeasures.map(([measure, events]) => (
                  <div className="editor-measure" key={measure}>
                    <span>c.{measure}</span>
                    <div>
                      {events.map(({ event, beat }) => (
                        <button aria-pressed={event.id === selectedEventId} className={`${event.kind} ${event.id === selectedEventId ? "selected" : ""}`} key={event.id} onClick={() => {
                          setSelectedEventId(event.id);
                          setPreviewSeek({ beat: eventStartBeat(draft.events, event.id), nonce: Date.now() });
                        }} type="button">
                          <small>{beat}</small><strong>{event.kind === "rest" ? "Pausa" : editorPitchLabel(event.written ?? "C5")}</strong><em>{event.durationBeats}t</em>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : <div className="editor-empty">Nenhuma nota ou pausa.</div>}
          </section>

          <section className="editor-preview">
            <div className="editor-section-title"><div><span>TESTAR E CONFERIR</span><strong>Partitura com pistos</strong></div></div>
            <MelodyPlayer
              song={previewSong}
              onBeatChange={handlePreviewBeatChange}
              octaveShift={previewOctaveShift}
              onOctaveShiftChange={setPreviewOctaveShift}
              seekRequest={previewSeek}
              onBpmChange={(value) => changeDraft((current) => ({ ...current, defaultBpm: value }))}
            />
            <div className="editor-score">
              <ScoreView song={previewSong} zoom={1.05} currentBeat={activePreviewBeat} highlight={previewSong.notes.length > 0} fingeringScale={1} onNoteClick={selectFromScore} />
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}

export function App() {
  const { catalog, error } = useCatalog();
  const [userSongs, setUserSongs] = useState<UserSongDraft[]>(readUserSongs);
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
  const [editorDraft, setEditorDraft] = useState<UserSongDraft | null>(null);

  const catalogSongs = catalog?.songs ?? emptyCatalogSongs;
  const userSongSummaries = useMemo(() => userSongs.map(userSongSummary), [userSongs]);
  const songs = useMemo(() => [...userSongSummaries, ...catalogSongs], [catalogSongs, userSongSummaries]);
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

  useEffect(() => writeUserSongs(userSongs), [userSongs]);

  const loadSongById = useCallback(async (id: string) => {
    const localDraft = userSongs.find((draft) => draft.id === id);
    if (localDraft) return draftToSongData(localDraft);
    const catalogSong = catalogSongs.find((song) => song.id === id);
    if (!catalogSong?.data) return null;
    const response = await fetch(`/${catalogSong.data}`);
    if (!response.ok) throw new Error(`Falha ao abrir ${catalogSong.title}.`);
    return response.json() as Promise<SongData>;
  }, [catalogSongs, userSongs]);

  useEffect(() => {
    if (catalog && !selectedId && songs.length) {
      const songFromUrl = new URLSearchParams(window.location.search).get("song");
      const requested = songFromUrl ? songs.find((song) => song.id === songFromUrl) : null;
      const firstPracticeSong = practiceEntries.find((entry) => entry.song)?.song;
      setSelectedId((requested ?? firstPracticeSong ?? songs[0]).id);
    }
  }, [catalog, practiceEntries, songs, selectedId]);

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
    loadSongById(selected.id)
      .then((data) => {
        if (!cancelled) setSongData(data);
      })
      .catch(console.error);
    return () => {
      cancelled = true;
    };
  }, [loadSongById, selected]);

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

  function saveUserSong(draft: UserSongDraft) {
    setUserSongs((current) => {
      const exists = current.some((song) => song.id === draft.id);
      return exists ? current.map((song) => song.id === draft.id ? cloneDraft(draft) : song) : [cloneDraft(draft), ...current];
    });
    setSelectedId(draft.id);
    setMusicMenuOpen(false);
  }

  function deleteUserSong(id: string) {
    if (!window.confirm("Excluir esta música criada?")) return;
    setUserSongs((current) => current.filter((song) => song.id !== id));
    setEditorDraft(null);
    if (selectedId === id) setSelectedId(practiceEntries.find((entry) => entry.song)?.song?.id ?? catalogSongs[0]?.id ?? null);
  }

  function editSelectedSong() {
    if (!selected || !songData) return;
    const localDraft = userSongs.find((draft) => draft.id === selected.id);
    setEditorDraft(localDraft ? cloneDraft(localDraft) : draftFromSongData(songData));
  }

  if (error) return <main className="state">Erro: {error}</main>;
  if (!catalog) return <main className="state">Carregando repertório...</main>;

  return (
    <main className="app">
      {editorDraft && (
        <SongEditor
          initialDraft={editorDraft}
          availableSongs={songs}
          loadSong={loadSongById}
          saved={userSongs.some((song) => song.id === editorDraft.id)}
          onSave={saveUserSong}
          onDelete={deleteUserSong}
          onClose={() => setEditorDraft(null)}
        />
      )}
      {readerOpen && playableSongData && <Reader song={playableSongData} onClose={() => setReaderOpen(false)} />}
      <header className="topbar">
        <div>
          <h1>Leitor de Partituras</h1>
          <p>{readyCount} músicas tocáveis, {transcriptionCount} para transcrever</p>
        </div>
        <div className="topbar-actions">
          <button aria-label="Criar música" className="primary create-song-button" onClick={() => setEditorDraft(createEmptyDraft())} title="Criar música" type="button">
            <Edit3 size={18} />
            <span>Criar música</span>
          </button>
          <button className="music-menu-button" onClick={() => setMusicMenuOpen(true)} type="button">
            <ListMusic size={18} />
            Músicas
            <span>{selected?.title ?? "Selecionar"}</span>
          </button>
        </div>
      </header>

      <section className="practice-strip" aria-label="Sequencia de treino do bloco">
        <div className="practice-mobile">
          <button aria-label="Música anterior" onClick={() => movePractice(-1)} title="Música anterior" type="button">
            <SkipBack size={19} />
          </button>
          <button className="practice-mobile-current" onClick={() => setMusicMenuOpen(true)} type="button">
            <span>{selectedPracticeNumber ? `${selectedPracticeNumber} de ${practiceEntries.length}` : "Repertório"}</span>
            <strong>{selected?.title ?? "Escolher música"}</strong>
          </button>
          <button aria-label="Próxima música" onClick={() => movePractice(1)} title="Próxima música" type="button">
            <SkipForward size={19} />
          </button>
          <button
            aria-label="Abrir modo leitura"
            className="primary practice-mobile-reader"
            disabled={!playableSongData}
            onClick={() => playableSongData ? setReaderOpen(true) : undefined}
            title="Abrir modo leitura"
            type="button"
          >
            <Play size={19} />
            <span>Leitura</span>
          </button>
        </div>
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
                <div>
                  <button className="primary" onClick={() => { setMusicMenuOpen(false); setEditorDraft(createEmptyDraft()); }} type="button"><Plus size={16} />Criar</button>
                  <button onClick={() => setMusicMenuOpen(false)} type="button">Fechar</button>
                </div>
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
                      <div className="desktop-size-controls">
                        <button onClick={() => setZoom((value) => Math.max(0.8, value - 0.1))} type="button">
                          <ZoomOut size={17} />
                          Menos zoom
                        </button>
                        <button onClick={() => setZoom((value) => Math.min(2.2, value + 0.1))} type="button">
                          <ZoomIn size={17} />
                          Mais zoom
                        </button>
                        <SizeSlider label="Partitura" min={0.8} max={2.4} value={zoom} onChange={setZoom} />
                        {playableSongData && showScore && <SizeSlider label="Números" min={0.7} max={2.2} value={homeFingeringScale} onChange={setHomeFingeringScale} />}
                        {playableSongData && showNotes && <SizeSlider label="Tablatura" min={0.75} max={2.1} value={homeGuideScale} onChange={setHomeGuideScale} />}
                      </div>
                      <details className="mobile-size-settings">
                        <summary>
                          <SlidersHorizontal size={17} />
                          Tamanho
                          <strong>{scalePercent(zoom)}</strong>
                        </summary>
                        <div className="mobile-size-grid">
                          <div className="mobile-zoom-stepper">
                            <button aria-label="Diminuir partitura" onClick={() => setZoom((value) => Math.max(0.8, value - 0.1))} title="Diminuir partitura" type="button">
                              <ZoomOut size={18} />
                            </button>
                            <span>Partitura</span>
                            <button aria-label="Aumentar partitura" onClick={() => setZoom((value) => Math.min(2.2, value + 0.1))} title="Aumentar partitura" type="button">
                              <ZoomIn size={18} />
                            </button>
                          </div>
                          <SizeSlider label="Partitura" min={0.8} max={2.4} value={zoom} onChange={setZoom} />
                          {playableSongData && showScore && <SizeSlider label="Números" min={0.7} max={2.2} value={homeFingeringScale} onChange={setHomeFingeringScale} />}
                          {playableSongData && showNotes && <SizeSlider label="Tablatura" min={0.75} max={2.1} value={homeGuideScale} onChange={setHomeGuideScale} />}
                        </div>
                      </details>
                    </>
                  )}
                  {playableSongData && (
                    <>
                      <button className="primary" onClick={() => setReaderOpen(true)}>
                        <Play size={17} />
                        Modo leitura
                      </button>
                      <button onClick={editSelectedSong} type="button">
                        <Edit3 size={17} />
                        {selected.userCreated ? "Editar" : "Editar cópia"}
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
