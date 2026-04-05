import type { Editor } from '@tiptap/core';

export interface Correction {
	hand: string;
	content: any[];
	type?: string;
	position?: string;
}

export interface PageMetadata {
	pos: number;
	pageName: string | null;
}

export interface MarkVisibility {
	lacunose: boolean;
	unclear: boolean;
	correction: boolean;
	abbreviation: boolean;
	punctuation: boolean;
	untranscribed: boolean;
	gap: boolean;
	book: boolean;
	chapter: boolean;
	verse: boolean;
	wrappedArrow: boolean;
	paragraphStart: boolean;
}

export interface TranscriptionEditorState {
	editor: Editor | null;
}

export interface Abbreviation {
	type: string;
	expansion: string;
}

export interface CorrectionForm {
	hand: string;
	tempCorrections: Correction[];
}
