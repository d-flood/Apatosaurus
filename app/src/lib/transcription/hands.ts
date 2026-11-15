import type { CorrectionReading, TranscriptionDocument } from '@apatosaurus/tei-transcription';

export interface ProjectTranscriptionHandOption {
	id: string;
	label: string;
	kind: 'firsthand' | 'corrector';
	isBaseHand: boolean;
}

function normalizeHandRef(value: string | null | undefined): string {
	return (value || '').trim().replace(/^#/, '');
}

function inferBaseHand(document: TranscriptionDocument): string {
	const witnessIds = Array.isArray(document.header?.witnessIds)
		? document.header.witnessIds.map((value: string) => value.trim()).filter(Boolean)
		: [];
	const handIds = Array.isArray(document.header?.msDescription?.hands)
		? document.header.msDescription.hands
				.map((hand: any) => {
					const id = hand?.attrs?.['xml:id'] || hand?.attrs?.n || '';
					return id.trim();
				})
				.filter(Boolean)
		: [];
	const preferredWitness =
		witnessIds.find((id: string) => /firsthand/i.test(id)) ||
		witnessIds.find((id: string) => /base|main/i.test(id)) ||
		witnessIds.find((id: string) => !/correct/i.test(id));
	if (preferredWitness) return normalizeHandRef(preferredWitness);
	const preferredHand =
		handIds.find((id: string) => /firsthand/i.test(id)) ||
		handIds.find((id: string) => /first hand/i.test(id)) ||
		handIds.find((id: string) => !/correct/i.test(id));
	return normalizeHandRef(preferredHand || 'firsthand') || 'firsthand';
}

function collectCorrectionHandIds(corrections: CorrectionReading[] | undefined, into: Set<string>) {
	for (const correction of corrections || []) {
		const handId = normalizeHandRef(correction.hand);
		if (handId) into.add(handId);
	}
}

export function collectDocumentHandOptions(
	document: TranscriptionDocument | null
): ProjectTranscriptionHandOption[] {
	if (!document) return [];
	const baseHand = inferBaseHand(document);
	const handIds = new Set<string>([baseHand]);
	for (const witnessId of document.header?.witnessIds || []) {
		const handId = normalizeHandRef(witnessId);
		if (handId) handIds.add(handId);
	}
	for (const hand of document.header?.msDescription?.hands || []) {
		const handId = normalizeHandRef(hand?.attrs?.['xml:id'] || hand?.attrs?.n || '');
		if (handId) handIds.add(handId);
	}
	for (const page of document.pages) {
		for (const column of page.columns) {
			for (const line of column.lines) {
				for (const item of line.items) {
					if (item.type === 'handShift') {
						const handId = normalizeHandRef(item.attrs.new || item.attrs.hand || '');
						if (handId) handIds.add(handId);
						continue;
					}
					if (item.type === 'text') {
						for (const mark of item.marks || []) {
							if (mark?.type === 'correction') {
								collectCorrectionHandIds(mark.attrs?.corrections, handIds);
							}
						}
						continue;
					}
					if (item.type === 'correctionOnly') {
						collectCorrectionHandIds(item.corrections, handIds);
					}
				}
			}
		}
	}
	return [...handIds]
		.sort((left, right) => {
			if (left === baseHand) return -1;
			if (right === baseHand) return 1;
			return left.localeCompare(right, undefined, { sensitivity: 'base', numeric: true });
		})
		.map(handId => ({
			id: handId,
			label: handId,
			kind: handId === baseHand ? 'firsthand' : 'corrector',
			isBaseHand: handId === baseHand,
		}));
}
