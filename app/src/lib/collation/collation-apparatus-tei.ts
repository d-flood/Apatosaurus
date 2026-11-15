import { DOMParser } from '@xmldom/xmldom';
import type { Element as XmlElement } from '@xmldom/xmldom';

import { citationOrder, NON_ATTESTATION_LABEL, type Segment } from './collation-apparatus';
import type { AmbiguousAttestation } from './collation-decisions';
import type { CollationDocument } from './collation-document';
import { splitReadingGroups } from './collation-reading-proposal';
import {
	ApparatusExportError,
	buildApparatusTeiExportInput,
	getApparatusExportRefusals,
	escapeAttribute,
	escapeText,
	textContent,
	type ApparatusTeiExportInput,
	type ApparatusTeiUnit,
} from './collation-tei';
import type { ClassifiedReading, ProjectCollationSettings, ReadingArc } from './collation-types';
import {
	BUNDLED_READING_TYPES,
	CERTAINTY_LEVELS,
	resolveReadingTypeVocabulary,
	type Certainty,
	type ReadingTypeDefinition,
} from './reading-types';

export type CollationVocabulary = Pick<
	ProjectCollationSettings,
	'readingTypes' | 'readingTags' | 'manualWitnesses'
>;

/**
 * Persistent ids are a reversible encoding (percent-encoding) of the document's ids, not a
 * stored map. They ride in `@sameAs` rather than `@xml:id` because open-cbgm names witnesses,
 * units and readings by `@xml:id` before `@n`. Stemma arcs carry `@sameAs`; subreading arcs
 * never do.
 */
export type PersistentId = string;

export interface ApparatusWitness {
	id: string;
	siglum: string;
	isManual: boolean;
}

export interface ApparatusReading {
	id: string;
	label: string;
	text: string | null;
	isOmission: boolean;
	witnessIds: string[];
	/** Recorded types only; omissions always read `omission`. */
	readingType: string | null;
	certainty: Certainty | null;
	readingTags: string[];
	note?: string;
	parentReadingId: string | null;
}

export interface ApparatusUnit {
	/** The open-cbgm unit id, shared with the CBGM input. */
	id: string;
	unitId: string;
	label: string;
	readings: ApparatusReading[];
	lemmaReadingId: string | null;
	nonAttestingWitnessIds: string[];
	ambiguousAttestations: AmbiguousAttestation[];
	overlaps: Array<{ witnessId: string; targets: Array<{ unitId: string; readingId: string }> }>;
	arcs: ReadingArc[];
	connectivity: number | 'absolute';
}

export interface ApparatusLayer {
	title: string;
	segmentName: string;
	notes: string;
	witnesses: ApparatusWitness[];
	units: ApparatusUnit[];
	readingTypes: ReadingTypeDefinition[];
	readingTags: Array<{ id: string; label: string }>;
}

const MANUAL_PREFIX = 'manual:';

export function encodePersistentId(id: string): PersistentId {
	return encodeURIComponent(id);
}

export function decodePersistentId(value: PersistentId): string {
	return decodeURIComponent(value);
}

/** open-cbgm splits witness lists on spaces, so corrector sigla such as `01 C1` lose theirs. */
export function compactSiglum(siglum: string): string {
	return siglum.replace(/\s+/g, '');
}

export function apparatusUnitPrefix(segmentName: string): string {
	return segmentName.replace(/\s+/g, '');
}

export function readingTypeTokens(
	reading: Pick<ClassifiedReading, 'id' | 'isOmission' | 'readingType'>,
	recordedReadingTypeIds: ReadonlySet<string>,
	isLaterSplitMember: boolean
): string[] {
	const readingType = reading.isOmission
		? 'omission'
		: recordedReadingTypeIds.has(reading.id)
			? reading.readingType
			: null;
	return [
		...(isLaterSplitMember ? ['split'] : []),
		...(readingType === null ? [] : [readingType]),
	];
}

function attribute(name: string, value: string | null | undefined): string {
	return value === null || value === undefined || value === ''
		? ''
		: ` ${name}="${escapeAttribute(value)}"`;
}

function element(name: string, attributes: string, content = ''): string {
	return content ? `<${name}${attributes}>${content}</${name}>` : `<${name}${attributes}/>`;
}

function serializeTaxonomy(types: readonly ReadingTypeDefinition[], used: readonly string[]) {
	if (used.length === 0) return '';
	const byId = new Map(types.map(type => [type.id, type] as const));
	const categories = used.map((id, index) => {
		const type = byId.get(id);
		const description = type?.description
			? `<gloss>${escapeText(type.description)}</gloss>`
			: '';
		const content = type
			? `<catDesc><term>${escapeText(type.label)}</term>${description}</catDesc>`
			: '';
		return element(
			'category',
			`${attribute('xml:id', `reading-type-${index + 1}`)}${attribute('n', type?.suffix)}${attribute('sameAs', encodePersistentId(id))}`,
			content
		);
	});
	return `<classDecl><taxonomy xml:id="reading-types">${categories.join('')}</taxonomy></classDecl>`;
}

function serializeApparatusUnit(
	unitN: string,
	segment: Extract<Segment, { kind: 'unit' }>,
	unit: SerializableUnit,
	context: {
		segmentName: string;
		siglumOf: ReadonlyMap<string, string>;
		tagXmlIds: ReadonlyMap<string, string>;
		targetOf: (unitId: string, readingId: string) => string | null;
	}
): string {
	const { siglumOf, tagXmlIds } = context;
	const wit = (witnessIds: readonly string[]) =>
		[...new Set(witnessIds.flatMap(id => siglumOf.get(id) ?? []))].join(' ');
	const recorded = new Set(unit.recordedReadingTypeIds);
	const ordered = citationOrder(unit.view.readings.filter(reading => !reading.isLacuna));
	const labelOf = new Map(ordered.map(reading => [reading.id, reading.label] as const));
	const laterSplitMemberIds = new Set(
		splitReadingGroups(ordered).flatMap(group => group.slice(1).map(reading => reading.id))
	);

	const readings = ordered.map(reading => {
		const tags = (reading.readingTags ?? []).flatMap(id => {
			const xmlId = tagXmlIds.get(id);
			return xmlId ? [`#${xmlId}`] : [];
		});
		const attributes =
			attribute('n', reading.label) +
			attribute('sameAs', encodePersistentId(reading.id)) +
			attribute(
				'type',
				readingTypeTokens(reading, recorded, laterSplitMemberIds.has(reading.id)).join(' ')
			) +
			attribute('cert', reading.certainty === null ? null : String(reading.certainty)) +
			attribute('ana', tags.join(' ')) +
			attribute('wit', wit([...reading.witnessIds, ...(reading.manualWitnessIds ?? [])]));
		return element('rdg', attributes, textContent(reading.text, reading.isOmission));
	});

	const nonAttesting = wit([
		...unit.nonAttestation.witnessIds,
		...unit.view.nonAttestingManualWitnessIds,
	]);
	if (nonAttesting)
		readings.push(
			element(
				'rdg',
				`${attribute('n', NON_ATTESTATION_LABEL)} type="lac"${attribute('wit', nonAttesting)}`
			)
		);
	for (const attestation of unit.view.ambiguousAttestations) {
		const witnesses = wit(attestation.witnessIds);
		if (!witnesses) continue;
		const targets = unit
			.recordedTargetsOf(attestation.id, attestation.targetReadingIds)
			.flatMap(id => labelOf.get(id) ?? []);
		readings.push(
			element(
				'witDetail',
				attribute('n', `zw-${attestation.targetLabels.join('/')}`) +
					' type="ambiguous"' +
					attribute('sameAs', encodePersistentId(attestation.id)) +
					attribute('target', targets.join(' ')) +
					attribute('wit', witnesses)
			)
		);
	}
	for (const witnessId of unit.view.overlappedWitnessIds) {
		const witnesses = wit([witnessId]);
		if (!witnesses) continue;
		const targets = (unit.view.overlapTargets[witnessId] ?? []).flatMap(
			target => context.targetOf(target.unitId, target.readingId) ?? []
		);
		readings.push(
			element(
				'witDetail',
				`${attribute('n', 'overlap')} type="overlap"${attribute('target', targets.join(' '))}${attribute('wit', witnesses)}`
			)
		);
	}

	const stemmaNodeLabel = new Map(
		unit.stemma.nodes.map(node => [node.readingId, node.label] as const)
	);
	const nodes = [
		...unit.stemma.nodes.map(node => node.label),
		...ordered
			.filter(reading => reading.parentReadingId !== null)
			.map(reading => reading.label),
	].map(label => `<node n="${escapeAttribute(label)}"/>`);
	const arcs = unit.stemma.nodes.flatMap(node => {
		if (node.sourceDecision.kind !== 'derived') return [];
		const prior = node.sourceDecision.from;
		const from = stemmaNodeLabel.get(prior);
		if (!from) return [];
		const id = unit.arcIdOf(prior, node.readingId);
		return [
			`<arc from="${escapeAttribute(from)}" to="${escapeAttribute(node.label)}"${attribute('sameAs', id === null ? null : encodePersistentId(id))}/>`,
		];
	});
	const subreadingArcs = ordered.flatMap(reading => {
		if (reading.parentReadingId === null) return [];
		const from = labelOf.get(reading.parentReadingId);
		return from
			? [`<arc from="${escapeAttribute(from)}" to="${escapeAttribute(reading.label)}"/>`]
			: [];
	});
	const lemmaLabel = unit.view.lemmaReadingId ? labelOf.get(unit.view.lemmaReadingId) : undefined;
	const features = [
		...(unit.connectivity === 'absolute'
			? []
			: [`<f name="connectivity"><numeric value="${unit.connectivity}"/></f>`]),
		...(lemmaLabel
			? [`<f name="lemma"><symbol value="${escapeAttribute(lemmaLabel)}"/></f>`]
			: []),
	];
	const fs = features.length > 0 ? `<fs>${features.join('')}</fs>` : '';
	const readingNotes = ordered
		.filter(reading => reading.note)
		.map(
			reading =>
				`<note type="reading" n="${escapeAttribute(reading.label)}">${escapeText(reading.note!)}</note>`
		);
	const label = `${context.segmentName}/${segment.ordinal}`;
	return `<app${attribute('n', unitN)}${attribute('sameAs', encodePersistentId(segment.span.unitId))}>${readings.join('')}<note><label>${escapeText(label)}</label>${fs}<graph type="directed">${nodes.join('')}${arcs.join('')}${subreadingArcs.join('')}</graph></note>${readingNotes.join('')}</app>`;
}

interface SerializableUnit extends ApparatusTeiUnit {
	arcIdOf: (priorReadingId: string, posteriorReadingId: string) => string | null;
	recordedTargetsOf: (attestationId: string, targetReadingIds: string[]) => string[];
}

export interface CollationTeiParts {
	editorialDecl?: string;
	revisionDesc?: string;
	standOff?: string;
}

function serializeApparatusInput(
	input: ApparatusTeiExportInput,
	document: CollationDocument,
	vocab: CollationVocabulary,
	notes = '',
	parts: CollationTeiParts = {}
): string {
	const vocabulary = resolveReadingTypeVocabulary(vocab.readingTypes ?? []);
	const witnesses = input.witnesses.filter(witness => !witness.isExcluded);
	const manualIds = new Set((vocab.manualWitnesses ?? []).map(witness => witness.id));
	const siglumOf = new Map(
		witnesses.map(witness => [witness.witnessId, compactSiglum(witness.siglum)] as const)
	);
	const unitPrefix = apparatusUnitPrefix(input.segmentName);
	const unitSegments = input.segments.filter(
		(segment): segment is Extract<Segment, { kind: 'unit' }> => segment.kind === 'unit'
	);
	const unitN = new Map(
		unitSegments.map(segment => [segment.span.unitId, `${unitPrefix}U${segment.ordinal}`])
	);
	const arcsByUnit = new Map(
		(document.stemma?.units ?? []).map(unit => [unit.unitId, unit.arcs] as const)
	);
	const attestationsByUnit = new Map(
		(document.apparatus?.units ?? []).map(
			unit => [unit.unitId, unit.decisions.ambiguousAttestations ?? []] as const
		)
	);
	const units = new Map(
		[...input.units].map(([unitId, unit]) => {
			const attestations = attestationsByUnit.get(unitId) ?? [];
			const mainOf = new Map(
				unit.stemma.nodes.flatMap(node =>
					[node.readingId, ...node.subreadingIds].map(id => [id, node.readingId] as const)
				)
			);
			const arcs = arcsByUnit.get(unitId) ?? [];
			const serializable: SerializableUnit = {
				...unit,
				arcIdOf: (prior, posterior) =>
					arcs.find(
						arc =>
							mainOf.get(arc.priorReadingId) === prior &&
							mainOf.get(arc.posteriorReadingId) === posterior
					)?.id ?? null,
				recordedTargetsOf: (attestationId, targetReadingIds) => {
					const recorded = attestations.find(entry => entry.id === attestationId);
					return recorded
						? recorded.targetReadingIds.filter(id => targetReadingIds.includes(id))
						: targetReadingIds;
				},
			};
			return [unitId, serializable] as const;
		})
	);

	const tags = [
		...new Set(
			[...units.values()].flatMap(unit =>
				unit.view.readings.flatMap(reading => reading.readingTags ?? [])
			)
		),
	];
	const tagXmlIds = new Map(tags.map((id, index) => [id, `reading-tag-${index + 1}`]));
	const tagLabels = new Map((vocab.readingTags ?? []).map(tag => [tag.id, tag.label]));
	const tagDeclarations =
		tags.length > 0
			? `<interpGrp type="readingTags">${tags
					.map(id =>
						element(
							'interp',
							`${attribute('xml:id', tagXmlIds.get(id))}${attribute('sameAs', encodePersistentId(id))}`,
							escapeText(tagLabels.get(id) ?? '')
						)
					)
					.join('')}</interpGrp>`
			: '';

	const usedTypes = [
		...new Set(
			[...units.values()].flatMap(unit => {
				const recorded = new Set(unit.recordedReadingTypeIds);
				return unit.view.readings
					.filter(reading => !reading.isLacuna)
					.flatMap(reading => readingTypeTokens(reading, recorded, false));
			})
		),
	];

	const targetOf = (unitId: string, readingId: string) => {
		const n = unitN.get(unitId);
		const label = units
			.get(unitId)
			?.view.readings.find(reading => reading.id === readingId)?.label;
		return n && label ? `${n}/${label}` : null;
	};
	const context = { segmentName: input.segmentName, siglumOf, tagXmlIds, targetOf };
	const attached: string[] = [];
	const verse = input.segments
		.map(segment => {
			if (segment.kind === 'agreed') return textContent(segment.text, false);
			const unit = units.get(segment.span.unitId);
			if (!unit) return '';
			const serialized = serializeApparatusUnit(
				unitN.get(segment.span.unitId)!,
				segment,
				unit,
				context
			);
			if (!segment.overlapping) return serialized;
			attached.push(serialized);
			return '';
		})
		.join('');

	const witnessList = witnesses
		.map(witness =>
			element(
				'witness',
				attribute('n', siglumOf.get(witness.witnessId)) +
					attribute(
						'sameAs',
						`${manualIds.has(witness.witnessId) ? MANUAL_PREFIX : ''}${encodePersistentId(witness.witnessId)}`
					)
			)
		)
		.join('');
	const verseNote = notes.trim() ? `<note type="verse">${escapeText(notes.trim())}</note>` : '';
	const encodingDesc = `${parts.editorialDecl ?? ''}${serializeTaxonomy(vocabulary, usedTypes)}`;
	const xml = `<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0"><teiHeader><fileDesc><titleStmt><title>${escapeText(input.title)}</title></titleStmt><publicationStmt><p>Collation apparatus written by Apatosaurus.</p></publicationStmt><sourceDesc><listWit>${witnessList}</listWit></sourceDesc></fileDesc>${encodingDesc ? `<encodingDesc>${encodingDesc}</encodingDesc>` : ''}${parts.revisionDesc ?? ''}</teiHeader><text xml:lang="grc"><body><div type="collation" n="${escapeAttribute(input.segmentName)}">${tagDeclarations}${verseNote}<ab n="${escapeAttribute(input.segmentName)}">${verse}${attached.join('')}</ab></div></body></text>${parts.standOff ?? ''}</TEI>
`;
	return xml.normalize('NFC');
}

/** Writes the derived collation TEI; refuses what today's apparatus export refuses. */
export function exportCollationDocumentTei(
	document: CollationDocument,
	projectSettings: ProjectCollationSettings = {},
	notes = ''
): string {
	const input = buildApparatusTeiExportInput(document, projectSettings);
	const refusals = getApparatusExportRefusals(input);
	if (refusals.length > 0) throw new ApparatusExportError(refusals);
	return serializeApparatusInput(input, document, projectSettings, notes);
}

export function serializeCollationApparatus(
	document: CollationDocument,
	vocab: CollationVocabulary,
	notes = '',
	parts: CollationTeiParts = {}
): string {
	return serializeApparatusInput(
		buildApparatusTeiExportInput(document, vocab),
		document,
		vocab,
		notes,
		parts
	);
}

const children = (node: XmlElement, name: string): XmlElement[] =>
	Array.from(node.childNodes).filter(
		(child): child is XmlElement =>
			child.nodeType === 1 && (child as XmlElement).localName === name
	);

const descendants = (node: XmlElement, name: string): XmlElement[] =>
	Array.from(node.getElementsByTagNameNS('*', name));

const tokens = (value: string | null): string[] => value?.split(/\s+/).filter(Boolean) ?? [];

function parseCertainty(value: string | null): Certainty | null {
	if (value === null) return null;
	if ((CERTAINTY_LEVELS as readonly string[]).includes(value)) return value as Certainty;
	const number = Number(value);
	return Number.isFinite(number) ? number : null;
}

export function parseCollationApparatus(xml: string): ApparatusLayer {
	const parsed = new DOMParser().parseFromString(xml, 'application/xml');
	const root = parsed.documentElement;
	if (!root || root.localName !== 'TEI') throw new Error('The collation TEI has no <TEI> root.');

	const witnesses = descendants(root, 'listWit')
		.flatMap(list => children(list, 'witness'))
		.map(node => {
			const sameAs = node.getAttribute('sameAs') ?? '';
			const isManual = sameAs.startsWith(MANUAL_PREFIX);
			return {
				id: decodePersistentId(isManual ? sameAs.slice(MANUAL_PREFIX.length) : sameAs),
				siglum: node.getAttribute('n') ?? '',
				isManual,
			};
		});
	const witnessIdOf = new Map(witnesses.map(witness => [witness.siglum, witness.id] as const));
	const witnessIds = (value: string | null) =>
		tokens(value).flatMap(siglum => witnessIdOf.get(siglum) ?? []);

	const bundled = new Map(BUNDLED_READING_TYPES.map(type => [type.id, type] as const));
	const readingTypes = descendants(root, 'taxonomy')
		.filter(taxonomy => taxonomy.getAttribute('xml:id') === 'reading-types')
		.flatMap(taxonomy => children(taxonomy, 'category'))
		.map(category => {
			const id = decodePersistentId(category.getAttribute('sameAs') ?? '');
			const description = children(category, 'catDesc').flatMap(desc =>
				children(desc, 'gloss')
			);
			return {
				id,
				label:
					children(category, 'catDesc').flatMap(desc => children(desc, 'term'))[0]
						?.textContent ?? '',
				description: description[0]?.textContent ?? '',
				selectable: bundled.get(id)?.selectable ?? true,
				suffix: category.getAttribute('n') ?? '',
			};
		});

	const tagIdOf = new Map<string, string>();
	const readingTags = descendants(root, 'interpGrp')
		.filter(group => group.getAttribute('type') === 'readingTags')
		.flatMap(group => children(group, 'interp'))
		.map(interp => {
			const id = decodePersistentId(interp.getAttribute('sameAs') ?? '');
			tagIdOf.set(`#${interp.getAttribute('xml:id')}`, id);
			return { id, label: interp.textContent ?? '' };
		});

	const div = descendants(root, 'div').find(node => node.getAttribute('type') === 'collation');
	const body = children(root, 'text')[0];
	const apps = body ? descendants(body, 'app') : [];
	const parsedUnits = apps.map(app => {
		const readingNodes = children(app, 'rdg').filter(
			rdg =>
				rdg.getAttribute('n') !== NON_ATTESTATION_LABEL ||
				rdg.getAttribute('type') !== 'lac'
		);
		const readingIdOf = new Map(
			readingNodes.map(rdg => [
				rdg.getAttribute('n') ?? '',
				decodePersistentId(rdg.getAttribute('sameAs') ?? ''),
			])
		);
		const note = children(app, 'note').find(node => !node.getAttribute('type'));
		const graph = note && children(note, 'graph')[0];
		const features = note ? children(note, 'fs').flatMap(fs => children(fs, 'f')) : [];
		const feature = (name: string, child: string) =>
			features
				.filter(f => f.getAttribute('name') === name)
				.flatMap(f => children(f, child))[0]
				?.getAttribute('value') ?? null;
		const arcNodes = graph ? children(graph, 'arc') : [];
		const parentOf = new Map(
			arcNodes
				.filter(arc => !arc.hasAttribute('sameAs'))
				.map(arc => [arc.getAttribute('to') ?? '', arc.getAttribute('from') ?? ''])
		);
		const notes = new Map(
			children(app, 'note')
				.filter(node => node.getAttribute('type') === 'reading')
				.map(node => [node.getAttribute('n') ?? '', node.textContent ?? ''])
		);
		const readings = readingNodes.map((rdg): ApparatusReading => {
			const label = rdg.getAttribute('n') ?? '';
			const types = tokens(rdg.getAttribute('type')).filter(type => type !== 'split');
			const isOmission = types.includes('omission');
			const parentLabel = parentOf.get(label);
			const text = (rdg.textContent ?? '').trim();
			const readingNote = notes.get(label);
			return {
				id: readingIdOf.get(label)!,
				label,
				text: isOmission ? null : text,
				isOmission,
				witnessIds: witnessIds(rdg.getAttribute('wit')),
				readingType: types[0] ?? null,
				certainty: parseCertainty(rdg.getAttribute('cert')),
				readingTags: tokens(rdg.getAttribute('ana')).flatMap(ref => tagIdOf.get(ref) ?? []),
				...(readingNote ? { note: readingNote } : {}),
				parentReadingId: parentLabel ? (readingIdOf.get(parentLabel) ?? null) : null,
			};
		});
		const connectivity = feature('connectivity', 'numeric');
		const lemma = feature('lemma', 'symbol');
		const witDetails = children(app, 'witDetail');
		return {
			app,
			unit: {
				id: app.getAttribute('n') ?? '',
				unitId: decodePersistentId(app.getAttribute('sameAs') ?? ''),
				label: (note && children(note, 'label')[0]?.textContent) ?? '',
				readings,
				lemmaReadingId: lemma ? (readingIdOf.get(lemma) ?? null) : null,
				nonAttestingWitnessIds: children(app, 'rdg')
					.filter(rdg => !readingNodes.includes(rdg))
					.flatMap(rdg => witnessIds(rdg.getAttribute('wit'))),
				ambiguousAttestations: witDetails
					.filter(detail => detail.getAttribute('type') === 'ambiguous')
					.map(detail => ({
						id: decodePersistentId(detail.getAttribute('sameAs') ?? ''),
						witnessIds: witnessIds(detail.getAttribute('wit')),
						targetReadingIds: tokens(detail.getAttribute('target')).flatMap(
							label => readingIdOf.get(label) ?? []
						),
					})),
				overlaps: [] as ApparatusUnit['overlaps'],
				arcs: arcNodes
					.filter(arc => arc.hasAttribute('sameAs'))
					.map(arc => ({
						id: decodePersistentId(arc.getAttribute('sameAs')!),
						priorReadingId: readingIdOf.get(arc.getAttribute('from') ?? '') ?? '',
						posteriorReadingId: readingIdOf.get(arc.getAttribute('to') ?? '') ?? '',
					})),
				connectivity:
					connectivity !== null && Number(connectivity) > 0
						? Number(connectivity)
						: ('absolute' as const),
			} satisfies ApparatusUnit,
			readingIdOf,
		};
	});

	const byN = new Map(parsedUnits.map(entry => [entry.unit.id, entry] as const));
	for (const { app, unit } of parsedUnits) {
		unit.overlaps = children(app, 'witDetail')
			.filter(detail => detail.getAttribute('type') === 'overlap')
			.flatMap(detail =>
				witnessIds(detail.getAttribute('wit')).map(witnessId => ({
					witnessId,
					targets: tokens(detail.getAttribute('target')).flatMap(target => {
						const slash = target.lastIndexOf('/');
						const entry = byN.get(target.slice(0, slash));
						const readingId = entry?.readingIdOf.get(target.slice(slash + 1));
						return entry && readingId ? [{ unitId: entry.unit.unitId, readingId }] : [];
					}),
				}))
			);
	}

	return {
		title: descendants(root, 'title')[0]?.textContent ?? '',
		segmentName: div?.getAttribute('n') ?? '',
		notes:
			(div &&
				children(div, 'note').find(node => node.getAttribute('type') === 'verse')
					?.textContent) ??
			'',
		witnesses,
		units: parsedUnits.map(entry => entry.unit),
		readingTypes,
		readingTags,
	};
}
