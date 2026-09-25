import type { CollationDocument } from '$lib/client/collation/collation-document';
import type { ClassifiedReading, ReadingArc } from '$lib/client/collation/collation-types';
import type { UnitDecisions } from '$lib/client/collation/collation-decisions';
import { variationUnitId } from '$lib/client/collation/collation-unit-id';
import { hashCanonicalPayload } from '../canonical-json';
import type { JsonObject } from '../envelope';
import { readObjectValue, readString, assertContentHashMatches } from './validation';

export const ALPHA_READING_TYPES = [
	{
		id: 'add',
		label: 'Addition',
		description: 'Addition, classified in alpha.',
		selectable: true,
	},
	{
		id: 'substitute',
		label: 'Substitution',
		description: 'Substitution, classified in alpha.',
		selectable: true,
	},
	{
		id: 'transpose',
		label: 'Transposition',
		description: 'Transposition, classified in alpha.',
		selectable: true,
	},
];

// c7d94ee used format v2 for primaries, working files, and checkpoints.
export async function upgradeAlphaCollation(payload: JsonObject): Promise<JsonObject> {
	const { current_revision, created_at, updated_at, ...content } = payload;
	const revision = readObjectValue(current_revision, 'current_revision');
	await assertContentHashMatches(
		content,
		readString(revision, 'content_hash'),
		'Alpha collation'
	);
	const upgraded = upgradeAlphaContent(content);
	return {
		...upgraded,
		created_at,
		updated_at,
		current_revision: {
			...(current_revision as JsonObject),
			content_hash: await hashCanonicalPayload(upgraded),
		},
	};
}

export function upgradeAlphaWorkingCollation(payload: JsonObject): JsonObject {
	const { draft, created_at, updated_at, ...content } = payload;
	return { ...upgradeAlphaContent(content), draft, created_at, updated_at };
}

export async function upgradeAlphaCollationCheckpoint(payload: JsonObject): Promise<JsonObject> {
	const content = readObjectValue(payload.payload, 'payload') as JsonObject;
	await assertContentHashMatches(
		content,
		readString(payload, 'payload_content_hash'),
		'Alpha checkpoint'
	);
	const upgraded = upgradeAlphaContent(content);
	return {
		...payload,
		payload: upgraded,
		payload_content_hash: await hashCanonicalPayload(upgraded),
	};
}

function upgradeAlphaContent(content: JsonObject): JsonObject {
	return {
		...content,
		document: upgradeAlphaDocument(
			content.document,
			readString(content, 'verse_identifier')
		) as unknown as JsonObject,
	};
}

function upgradeAlphaDocument(value: unknown, verseIdentifier: string): CollationDocument {
	const source = readObjectValue(value, 'document');
	if (source.type !== 'collationDocument' || source.version !== 1)
		throw new Error('Unsupported alpha collation document.');
	const document = structuredClone(source);
	const setup = readObjectValue(document.setup, 'setup');
	const selected = setup.selectedVerse
		? readObjectValue(setup.selectedVerse, 'selectedVerse')
		: null;
	const member =
		typeof selected?.identifier === 'string' && selected.identifier.trim()
			? selected.identifier
			: verseIdentifier.trim();
	if (!setup.segment) {
		if (!member) throw new Error('Alpha collation has no textual scope.');
		const meta = readObjectValue(document.meta, 'meta');
		setup.segment = {
			id: `alpha:${readString(meta, 'collationId')}`,
			name: member,
			members: [member],
		};
		delete setup.selectedVerse;
		delete setup.selectedBook;
		delete setup.selectedChapter;
		delete setup.selectedVerseNum;
	}
	const apparatus = document.apparatus ? readObjectValue(document.apparatus, 'apparatus') : null;
	if (apparatus) {
		if (!Array.isArray(apparatus.units))
			throw new Error('Alpha apparatus units must be an array.');
		apparatus.units = apparatus.units.map(value => {
			const unit = readObjectValue(value, 'variation unit');
			const columnId = readString(unit, 'columnId');
			if (!Array.isArray(unit.readings)) throw new Error('Alpha readings must be an array.');
			const decisions: UnitDecisions = {
				preserveReadings: true,
				subreadingOf: {},
				readingType: {},
			};
			const readings = unit.readings.map(value => {
				const reading = readObjectValue(value, 'reading');
				const { classification, ...rest } = reading;
				const id = readString(reading, 'id');
				const type =
					classification === 'omit'
						? 'omission'
						: typeof classification === 'string' && classification !== 'unclassified'
							? classification
							: null;
				if (type) decisions.readingType![id] = type;
				decisions.subreadingOf![id] =
					reading.parentReadingId === null
						? null
						: readString(reading, 'parentReadingId');
				return {
					...rest,
					readingType: reading.readingType === 'ns' ? 'nonsense' : null,
					certainty: null,
				} as unknown as ClassifiedReading;
			});
			return {
				type: 'variationUnit',
				id: variationUnitId(columnId),
				unitId: variationUnitId(columnId),
				columnId,
				readings,
				decisions,
			};
		});
	}
	const stemma = document.stemma ? readObjectValue(document.stemma, 'stemma') : null;
	if (stemma) {
		if (!Array.isArray(stemma.units)) throw new Error('Alpha stemma units must be an array.');
		stemma.units = stemma.units.map(value => {
			const unit = readObjectValue(value, 'stemma unit');
			const columnId = readString(unit, 'columnId');
			if (!Array.isArray(unit.edges)) throw new Error('Alpha stemma edges must be an array.');
			const arcs: ReadingArc[] = unit.edges.map(value => {
				const edge = readObjectValue(value, 'edge');
				if (edge.directed !== true)
					throw new Error(
						'An undirected alpha stemma edge needs an editorial direction before conversion.'
					);
				return {
					id: readString(edge, 'id'),
					priorReadingId: readString(edge, 'sourceReadingId'),
					posteriorReadingId: readString(edge, 'targetReadingId'),
				};
			});
			return {
				type: 'stemmaUnit',
				id: variationUnitId(columnId),
				unitId: variationUnitId(columnId),
				columnId,
				arcs,
			};
		});
	}
	return document as unknown as CollationDocument;
}
