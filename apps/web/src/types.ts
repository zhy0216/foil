export interface Reply {
  id: string;
  author: string;
  ts: number;
  body: string;
}

export interface CommentThread {
  id: string;
  quote: string;
  before: string;
  after: string;
  replies: Reply[];
}

export interface DocState {
  md: string;
  comments: CommentThread[];
  title: string;
}

export type Theme = 'auto' | 'light' | 'dark';
export type ProseFont = 'serif' | 'modern-serif' | 'sans' | 'humanist' | 'mono';
export type ProseSize = 'small' | 'default' | 'large';
export type Accent = 'cerulean' | 'emerald' | 'ember' | 'violet' | 'graphite';
export type EditorWidth = 'narrow' | 'default' | 'wide';
export type Density = 'comfortable' | 'compact';

export interface Settings {
  theme: Theme;
  proseFont: ProseFont;
  proseSize: ProseSize;
  accent: Accent;
  editorWidth: EditorWidth;
  density: Density;
}

export interface SelectionInfo {
  text: string;
  rect: DOMRect;
  startOff: number | null;
  endOff: number | null;
}

export interface ComposerState {
  quote: string;
  before: string;
  after: string;
  top: number;
  left: number;
}
