export interface Coords { lat: number; lon: number; zoom: number; }

export interface RouteIndexEntry {
  id: string;
  title: string;
  area: string[];
  coords: Coords | null;
  grade: string | null;
  gradeSource: 'label' | 'prose' | null;
  time: string | null;
  heightGain: string | null;
  isFullEntry: boolean;
}

export interface RouteContent extends RouteIndexEntry {
  sections: Record<string, string>;
  description: string;
  related: { id: string; title: string }[];
  attachments: string[];
  photoCount: number;
  sourceUrl: string;
}

export interface JournalEntry {
  routeId: string;
  done: boolean;
  date: string | null;
  notes: string;
}
