import { Extension } from '@tiptap/core';
import type { MarkType, Node as ProseMirrorNode } from '@tiptap/pm/model';
import { type EditorState, Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';

export interface MilestoneContext {
	book?: string;
	chapter?: string;
	verse?: string;
}

interface TranscriptionIndexState {
	positions: number[];
	milestones: ProseMirrorNode[];
	lastBook: Int32Array;
	lastChapter: Int32Array;
	lastVerse: Int32Array;
	versesThrough: Int32Array;
	verseMarkedSizes: number[];
	unconfirmedVerseCount: number;
}

const MILESTONE_TYPES = new Set(['book', 'chapter', 'verse']);

export const transcriptionIndexKey = new PluginKey<TranscriptionIndexState>('transcriptionIndex');

function firstAtOrAfter(positions: number[], pos: number): number {
	let low = 0;
	let high = positions.length;
	while (low < high) {
		const middle = (low + high) >>> 1;
		if (positions[middle] < pos) low = middle + 1;
		else high = middle;
	}
	return low;
}

function collectMilestones(doc: ProseMirrorNode, from: number, to: number) {
	const positions: number[] = [];
	const milestones: ProseMirrorNode[] = [];
	if (from >= to) return { positions, milestones };
	doc.nodesBetween(from, to, (node, pos) => {
		if (!MILESTONE_TYPES.has(node.type.name) || pos < from) return true;
		positions.push(pos);
		milestones.push(node);
		return false;
	});
	return { positions, milestones };
}

// Sums each marked node's overlap with the range so that adjacent ranges add up exactly.
function markedSize(
	doc: ProseMirrorNode,
	from: number,
	to: number,
	markType: MarkType | undefined
): number {
	if (!markType || from >= to) return 0;
	let total = 0;
	doc.nodesBetween(from, to, (node, pos) => {
		if (markType.isInSet(node.marks)) {
			total += Math.min(pos + node.nodeSize, to) - Math.max(pos, from);
		}
	});
	return total;
}

function verseSegmentEnd(
	doc: ProseMirrorNode,
	positions: number[],
	milestones: ProseMirrorNode[],
	index: number
): number {
	for (let next = index + 1; next < milestones.length; next += 1) {
		if (milestones[next].type.name === 'verse') return positions[next];
	}
	return doc.content.size;
}

function verseSegmentSize(
	doc: ProseMirrorNode,
	positions: number[],
	milestones: ProseMirrorNode[],
	index: number,
	markType: MarkType | undefined
): number {
	return markedSize(
		doc,
		positions[index] + 1,
		verseSegmentEnd(doc, positions, milestones, index),
		markType
	);
}

function withLookups(
	positions: number[],
	milestones: ProseMirrorNode[],
	verseMarkedSizes: number[]
): TranscriptionIndexState {
	const count = milestones.length;
	const lastBook = new Int32Array(count);
	const lastChapter = new Int32Array(count);
	const lastVerse = new Int32Array(count);
	const versesThrough = new Int32Array(count);
	let book = -1;
	let chapter = -1;
	let verse = -1;
	let verses = 0;
	for (let index = 0; index < count; index += 1) {
		const type = milestones[index].type.name;
		if (type === 'book') book = index;
		else if (type === 'chapter') chapter = index;
		else {
			verse = index;
			verses += 1;
		}
		lastBook[index] = book;
		lastChapter[index] = chapter;
		lastVerse[index] = verse;
		versesThrough[index] = verses;
	}
	return {
		positions,
		milestones,
		lastBook,
		lastChapter,
		lastVerse,
		versesThrough,
		verseMarkedSizes,
		unconfirmedVerseCount: verseMarkedSizes.filter(size => size > 0).length,
	};
}

function buildIndex(doc: ProseMirrorNode, markType: MarkType | undefined): TranscriptionIndexState {
	const { positions, milestones } = collectMilestones(doc, 0, doc.content.size);
	const verseMarkedSizes: number[] = [];
	milestones.forEach((node, index) => {
		if (node.type.name === 'verse') {
			verseMarkedSizes.push(verseSegmentSize(doc, positions, milestones, index, markType));
		}
	});
	return withLookups(positions, milestones, verseMarkedSizes);
}

function applyIndex(
	tr: Transaction,
	previous: TranscriptionIndexState,
	newState: EditorState
): TranscriptionIndexState {
	const oldDoc = tr.before;
	const newDoc = newState.doc;
	const start = oldDoc.content.findDiffStart(newDoc.content);
	if (start === null) return previous;
	const diffEnd = oldDoc.content.findDiffEnd(newDoc.content);
	let endA = diffEnd?.a ?? oldDoc.content.size;
	let endB = diffEnd?.b ?? newDoc.content.size;
	const overlap = start - Math.min(endA, endB);
	if (overlap > 0) {
		endA += overlap;
		endB += overlap;
	}

	const markType = newState.schema.marks.unconfirmed;
	const delta = endB - endA;
	const removedFrom = firstAtOrAfter(previous.positions, start);
	const removedTo = firstAtOrAfter(previous.positions, endA);
	const added = collectMilestones(newDoc, start, endB);
	const verseBefore = removedFrom > 0 ? previous.versesThrough[removedFrom - 1] - 1 : -1;

	const positions = [
		...previous.positions.slice(0, removedFrom),
		...added.positions,
		...previous.positions.slice(removedTo).map(pos => pos + delta),
	];

	const structureChanged = removedTo > removedFrom || added.milestones.length > 0;
	if (!structureChanged) {
		if (verseBefore < 0) return { ...previous, positions };
		const oldSize = previous.verseMarkedSizes[verseBefore];
		const size =
			oldSize -
			markedSize(oldDoc, start, endA, markType) +
			markedSize(newDoc, start, endB, markType);
		if (size === oldSize) return { ...previous, positions };
		const verseMarkedSizes = previous.verseMarkedSizes.slice();
		verseMarkedSizes[verseBefore] = size;
		return {
			...previous,
			positions,
			verseMarkedSizes,
			unconfirmedVerseCount:
				previous.unconfirmedVerseCount + Number(size > 0) - Number(oldSize > 0),
		};
	}

	const milestones = [
		...previous.milestones.slice(0, removedFrom),
		...added.milestones,
		...previous.milestones.slice(removedTo),
	];
	const versesRemoved =
		removedTo > removedFrom ? previous.versesThrough[removedTo - 1] - (verseBefore + 1) : 0;
	const addedVerseIndexes: number[] = [];
	added.milestones.forEach((node, offset) => {
		if (node.type.name === 'verse') addedVerseIndexes.push(removedFrom + offset);
	});
	const verseMarkedSizes = [
		...previous.verseMarkedSizes.slice(0, verseBefore + 1),
		...addedVerseIndexes.map(index =>
			verseSegmentSize(newDoc, positions, milestones, index, markType)
		),
		...previous.verseMarkedSizes.slice(verseBefore + 1 + versesRemoved),
	];
	if (verseBefore >= 0) {
		const verseIndex = previous.lastVerse[removedFrom - 1];
		verseMarkedSizes[verseBefore] = verseSegmentSize(
			newDoc,
			positions,
			milestones,
			verseIndex,
			markType
		);
	}
	return withLookups(positions, milestones, verseMarkedSizes);
}

export function milestoneContextAt(state: EditorState, pos: number): MilestoneContext {
	const index = transcriptionIndexKey.getState(state);
	if (!index) return {};
	const last = firstAtOrAfter(index.positions, pos) - 1;
	if (last < 0) return {};

	const book = index.lastBook[last];
	const chapter = index.lastChapter[last] > book ? index.lastChapter[last] : -1;
	const verse =
		index.lastVerse[last] > book && index.lastVerse[last] > chapter
			? index.lastVerse[last]
			: -1;
	const result: MilestoneContext = {};
	let fallbackBook: string | undefined;
	let fallbackChapter: string | undefined;
	if (verse >= 0) {
		const attrs = index.milestones[verse].attrs;
		result.verse = attrs.verse;
		fallbackBook = attrs.book;
		fallbackChapter = attrs.chapter;
	}
	if (chapter >= 0) {
		const attrs = index.milestones[chapter].attrs;
		result.chapter = attrs.chapter;
		fallbackBook = attrs.book;
	}
	if (book >= 0) result.book = index.milestones[book].attrs.book;
	result.book ??= fallbackBook;
	result.chapter ??= fallbackChapter;
	return result;
}

export function unconfirmedVerseCount(state: EditorState): number {
	return transcriptionIndexKey.getState(state)?.unconfirmedVerseCount ?? 0;
}

export const TranscriptionIndex = Extension.create({
	name: 'transcriptionIndex',
	addProseMirrorPlugins() {
		return [
			new Plugin<TranscriptionIndexState>({
				key: transcriptionIndexKey,
				state: {
					init: (_config, state) => buildIndex(state.doc, state.schema.marks.unconfirmed),
					apply: (tr, previous, _oldState, newState) =>
						tr.docChanged ? applyIndex(tr, previous, newState) : previous,
				},
			}),
		];
	},
});
