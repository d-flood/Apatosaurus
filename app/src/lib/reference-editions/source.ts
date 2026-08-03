import type {
	InlineItem,
	LineItem,
	MilestoneItem,
	TeiElementNode,
	TeiNode,
	TranscriptionDocument,
} from '$lib/tei/tei-transcription';

export interface ReferenceEditionUnitLabel {
	book?: string;
	chapter?: string;
	verse?: string;
	unit?: string;
	value?: string;
}

export interface ReferenceEditionUnit {
	position: number;
	label: ReferenceEditionUnitLabel;
	content: LineItem[];
}

export interface ParsedReferenceEdition {
	units: ReferenceEditionUnit[];
}

export type ReferenceEditionSource = ParsedReferenceEdition;

type AddressableMilestoneKind = 'book' | 'chapter' | 'verse';

export function createReferenceEditionSource(
	document: TranscriptionDocument
): ParsedReferenceEdition {
	const content = flattenDocumentContent(document);
	const hasStandardMilestone = content.some(item => item.type === 'milestone');
	const hasAnyMilestone = content.some(
		item => item.type === 'milestone' || item.type === 'teiMilestone'
	);

	if (!hasAnyMilestone) {
		throw new Error('Reference edition must contain at least one milestone.');
	}

	if (!hasStandardMilestone) {
		return buildGenericMilestoneSource(content);
	}

	const addressableKind = chooseAddressableMilestoneKind(content);
	const units: ReferenceEditionUnit[] = [];
	let pendingStructuralContent: LineItem[] = [];
	let currentUnit: Omit<ReferenceEditionUnit, 'position'> | null = null;
	let currentBook: string | undefined;
	let currentChapter: string | undefined;

	for (const item of content) {
		if (item.type !== 'milestone') {
			if (currentUnit) currentUnit.content.push(item);
			continue;
		}

		if (item.kind === 'book') {
			currentBook = item.attrs.book || undefined;
			currentChapter = undefined;
		}
		if (item.kind === 'chapter') {
			currentBook = item.attrs.book || currentBook;
			currentChapter = item.attrs.chapter || undefined;
		}

		if (item.kind !== addressableKind) {
			pendingStructuralContent.push(item);
			continue;
		}

		if (currentUnit) units.push(withPosition(currentUnit, units.length));
		currentUnit = {
			label: buildStandardLabel(item, currentBook, currentChapter),
			content: [...pendingStructuralContent, item],
		};
		pendingStructuralContent = [];
	}

	if (currentUnit) units.push(withPosition(currentUnit, units.length));

	return { units };
}

export function listUnits(source: ParsedReferenceEdition): ReferenceEditionUnit[] {
	return source.units;
}

export function extractRange(
	source: ParsedReferenceEdition,
	startPosition: number,
	endPosition: number
): LineItem[] {
	if (
		!Number.isInteger(startPosition) ||
		!Number.isInteger(endPosition) ||
		startPosition < 0 ||
		endPosition < startPosition ||
		endPosition >= source.units.length
	) {
		throw new RangeError('Reference edition range must use ordered unit positions.');
	}

	return source.units
		.slice(startPosition, endPosition + 1)
		.flatMap(unit => unit.content.map(cloneLineItem));
}

function chooseAddressableMilestoneKind(content: LineItem[]): AddressableMilestoneKind {
	if (content.some(item => item.type === 'milestone' && item.kind === 'verse')) return 'verse';
	if (content.some(item => item.type === 'milestone' && item.kind === 'chapter'))
		return 'chapter';
	return 'book';
}

function buildStandardLabel(
	item: MilestoneItem,
	currentBook: string | undefined,
	currentChapter: string | undefined
): ReferenceEditionUnitLabel {
	if (item.kind === 'book') return { book: item.attrs.book };
	if (item.kind === 'chapter') {
		return {
			book: item.attrs.book || currentBook,
			chapter: item.attrs.chapter,
		};
	}
	return {
		book: item.attrs.book || currentBook,
		chapter: item.attrs.chapter || currentChapter,
		verse: item.attrs.verse,
	};
}

function buildGenericMilestoneSource(content: LineItem[]): ParsedReferenceEdition {
	const units: ReferenceEditionUnit[] = [];
	let currentUnit: Omit<ReferenceEditionUnit, 'position'> | null = null;

	for (const item of content) {
		if (item.type === 'teiMilestone') {
			if (currentUnit) units.push(withPosition(currentUnit, units.length));
			currentUnit = {
				label: {
					unit: item.attrs.unit,
					value: item.attrs.n,
				},
				content: [item],
			};
			continue;
		}
		if (currentUnit) currentUnit.content.push(item);
	}

	if (currentUnit) units.push(withPosition(currentUnit, units.length));
	return { units };
}

function flattenDocumentContent(document: TranscriptionDocument): LineItem[] {
	const flattened: LineItem[] = [];
	let previousLine: { lastItem: LineItem | undefined; wrapped: boolean } | null = null;

	for (const page of document.pages) {
		for (const column of page.columns) {
			for (const line of column.lines) {
				const lineItems = line.items.flatMap(item => {
					const stripped = stripStructuralBreaks(item);
					return stripped ? [stripped] : [];
				});

				if (
					previousLine &&
					lineItems.length > 0 &&
					!line.wrapped &&
					shouldSeparateLines(previousLine.lastItem, lineItems[0])
				) {
					flattened.push({ type: 'boundary', kind: 'word' });
				}

				for (const item of lineItems) flattened.push(item);
				previousLine = {
					lastItem: lineItems.at(-1),
					wrapped: line.wrapped === true,
				};
			}
		}
	}

	return flattened;
}

function shouldSeparateLines(previous: LineItem | undefined, next: LineItem): boolean {
	return previous?.type === 'text' && next.type === 'text';
}

function stripStructuralBreaks(item: LineItem): LineItem | null {
	if (item.type === 'fw') {
		return {
			...cloneLineItem(item),
			content: stripInlineStructuralBreaks(item.content),
		} as LineItem;
	}
	if (item.type === 'correctionOnly') {
		return {
			...cloneLineItem(item),
			corrections: item.corrections.map(correction => ({
				...correction,
				content: stripInlineStructuralBreaks(correction.content),
			})),
		} as LineItem;
	}
	if (item.type === 'teiWrapper') {
		return {
			...cloneLineItem(item),
			children: stripTeiStructuralBreaks(item.children),
		} as LineItem;
	}
	if (item.type === 'teiAtom') {
		return {
			...cloneLineItem(item),
			node: stripTeiElementStructuralBreaks(item.node),
		} as LineItem;
	}
	return cloneLineItem(item);
}

function stripInlineStructuralBreaks(items: InlineItem[]): InlineItem[] {
	return items.flatMap(item => {
		if (item.type === 'pageBreak' || item.type === 'columnBreak' || item.type === 'lineBreak') {
			return [];
		}
		if (item.type === 'fw') {
			return [{ ...item, content: stripInlineStructuralBreaks(item.content) } as InlineItem];
		}
		if (item.type === 'correctionOnly') {
			return [
				{
					...item,
					corrections: item.corrections.map(correction => ({
						...correction,
						content: stripInlineStructuralBreaks(correction.content),
					})),
				},
			];
		}
		if (item.type === 'teiWrapper') {
			return [{ ...item, children: stripTeiStructuralBreaks(item.children) }];
		}
		return [cloneValue(item) as InlineItem];
	});
}

function stripTeiStructuralBreaks(nodes: TeiNode[]): TeiNode[] {
	return nodes.flatMap(node => {
		if (node.type === 'text') return [cloneValue(node)];
		const tag = node.tag.toLowerCase();
		if (tag === 'pb' || tag === 'cb' || tag === 'lb') return [];
		return [
			{
				...cloneValue(node),
				children: stripTeiStructuralBreaks(node.children || []),
			} as TeiNode,
		];
	});
}

function stripTeiElementStructuralBreaks(node: TeiElementNode): TeiElementNode {
	return {
		...cloneValue(node),
		children: stripTeiStructuralBreaks(node.children || []),
	};
}

function withPosition(
	unit: Omit<ReferenceEditionUnit, 'position'>,
	position: number
): ReferenceEditionUnit {
	return { position, ...unit };
}

function cloneLineItem(item: LineItem): LineItem {
	return cloneValue(item);
}

function cloneValue<T>(value: T): T {
	if (typeof globalThis.structuredClone === 'function') {
		try {
			return globalThis.structuredClone(value);
		} catch {
			// Plain transcription items are JSON-compatible.
		}
	}
	return JSON.parse(JSON.stringify(value)) as T;
}
