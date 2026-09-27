export interface Correction {
	hand: string;
	content: any[];
	type?: string;
	position?: string;
	rend?: string;
	readingAttrs?: Record<string, string>;
	segmentAttrs?: Record<string, string>;
}

export interface MarkVisibility {
	lacunose: boolean;
	unclear: boolean;
	unconfirmed: boolean;
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

export interface Abbreviation {
	type: string;
	expansion: string;
}
