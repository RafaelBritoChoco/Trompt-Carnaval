export type Fingering = string[];

export type ScoreNote = {
  index: number;
  measure: number;
  beat: number;
  absBeat: number;
  durationBeats: number;
  written: string;
  labelPt: string;
  fingering: Fingering;
  tie: "start" | "stop" | "continue" | null;
  eventId?: string;
};

export type Song = {
  id: string;
  title: string;
  folder: string;
  status: "ready" | "visual_only" | "needs_transcription" | "missing_source";
  reason?: string;
  musicxml?: string;
  audio?: string;
  fingeringsPdf?: string;
  sourceImage?: string;
  sourcePdf?: string;
  data: string;
  defaultBpm: number;
  trumpetPart: string;
  totalMeasures: number;
  totalBeats: number;
  notesCount: number;
  userCreated?: boolean;
};

export type SongData = Song & {
  notes: ScoreNote[];
  musicxmlText?: string;
};

export type Catalog = {
  generatedAt: string;
  sourceRoot: string;
  songs: Song[];
  pending: Song[];
};

export type Setlist = {
  id: string;
  name: string;
  songIds: string[];
};
