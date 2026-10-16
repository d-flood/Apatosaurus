import { deserializeAlignmentColumns } from './alignment-snapshot';
import { buildSegmentSequence, type Segment, NON_ATTESTATION_LABEL } from './collation-apparatus';
import { applyDecisions, type UnitDecisions, type UnitView } from './collation-decisions';
import type { CollationDocument } from './collation-document';
import {
	buildReadingProposal,
	splitReadingGroups,
	type NonAttestation,
} from './collation-reading-proposal';
import { projectLocalStemma, type LocalStemma } from './collation-stemma';
import type { ClassifiedReading, ManualWitnessDefinition } from './collation-types';
import { buildVariationUnitSpans } from './collation-variation-units';
import { isPunctuationOnlyText } from './token-text';
import { resolveReadingTypeVocabulary, type ReadingTypeDefinition } from './reading-types';

type ApparatusExportRefusalKind =
	'untranscribed-witness' | 'missing-lemma' | 'unresolved-attestation';

export interface ApparatusExportRefusal {
	kind: ApparatusExportRefusalKind;
	label: string;
	/** Absent when the unfinished witness occurs only in agreed text. */
	unitId?: string;
	witnessIds?: string[];
}

export class ApparatusExportError extends Error {
	constructor(public readonly refusals: ApparatusExportRefusal[]) {
		super(
			`Cannot export apparatus: ${refusals
				.map(refusal => {
					const location = refusal.unitId
						? `unit ${refusal.label}`
						: `agreed text ${refusal.label}`;
					if (refusal.kind === 'untranscribed-witness') {
						return `${location} has untranscribed witnesses`;
					}
					if (refusal.kind === 'unresolved-attestation') {
						const witnesses = refusal.witnessIds ?? [];
						return `${location} has unresolved attestations (${witnesses.join(', ')})`;
					}
					return `${location} has no established lemma`;
				})
				.join('; ')}`
		);
		this.name = 'ApparatusExportError';
	}
}

export interface ApparatusTeiUnit {
	view: UnitView;
	nonAttestation: NonAttestation;
	stemma: LocalStemma;
	connectivity: number | 'absolute';
	/** Types inferred from evidence remain proposals until this set contains the reading id. */
	recordedReadingTypeIds: readonly string[];
}

export interface ApparatusTeiExportInput {
	title: string;
	segmentName: string;
	witnesses: ReadonlyArray<{
		witnessId: string;
		siglum: string;
		isExcluded: boolean;
	}>;
	baseTextWitnessId: string | null;
	segments: readonly Segment[];
	units: ReadonlyMap<string, ApparatusTeiUnit>;
	readingTags?: ReadonlyArray<{ id: string; label: string }>;
}

function xmlId(value: string): string {
	const normalized = value.trim().replace(/[^A-Za-z0-9_.-]+/g, '-');
	if (!normalized) return 'generated-id';
	return /^[A-Za-z_]/.test(normalized) ? normalized : `id-${normalized}`;
}

export function escapeText(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escapeAttribute(value: string): string {
	return escapeText(value).replace(/"/g, '&quot;');
}

function citationOrder(readings: readonly ClassifiedReading[]): ClassifiedReading[] {
	const subreadingsByParent = new Map<string, ClassifiedReading[]>();
	for (const reading of readings) {
		if (reading.parentReadingId === null) continue;
		const children = subreadingsByParent.get(reading.parentReadingId) ?? [];
		children.push(reading);
		subreadingsByParent.set(reading.parentReadingId, children);
	}

	const ordered: ClassifiedReading[] = [];
	const cited = new Set<string>();
	const cite = (reading: ClassifiedReading) => {
		if (cited.has(reading.id)) return;
		cited.add(reading.id);
		ordered.push(reading);
		for (const child of subreadingsByParent.get(reading.id) ?? []) cite(child);
	};
	for (const reading of readings) if (reading.parentReadingId === null) cite(reading);
	for (const reading of readings) cite(reading);
	return ordered;
}

export function textContent(text: string | null, isOmission: boolean): string {
	if (isOmission || !text?.trim()) return '';
	const trimmed = text.trim();
	return `${isPunctuationOnlyText(trimmed) ? '' : ' '}${escapeText(trimmed)}`;
}

function witnessAttribute(
	witnessIds: readonly string[],
	witnessXmlIds: ReadonlyMap<string, string>,
	baseTextWitnessId: string | null,
	includeBaseText: boolean
): string {
	const refs = witnessIds.flatMap(witnessId => {
		const xmlIdentifier = witnessXmlIds.get(witnessId);
		return xmlIdentifier ? [`#${xmlIdentifier}`] : [];
	});
	if (includeBaseText && baseTextWitnessId && witnessIds.includes(baseTextWitnessId)) {
		refs.push('#basetext');
	}
	return refs.length > 0 ? ` wit="${escapeAttribute(refs.join(' '))}"` : '';
}

function readingAttributes(
	reading: ClassifiedReading,
	options: {
		xmlId?: string;
		label?: string;
		sequence?: number;
		witnessXmlIds: ReadonlyMap<string, string>;
		baseTextWitnessId: string | null;
		includeBaseText: boolean;
		recordedReadingTypeIds: ReadonlySet<string>;
		isLaterSplitMember?: boolean;
		tagXmlIds?: ReadonlyMap<string, string>;
	}
): string {
	const attributes: string[] = [];
	if (options.xmlId !== undefined) attributes.push(`xml:id="${escapeAttribute(options.xmlId)}"`);
	if (options.label !== undefined) attributes.push(`n="${escapeAttribute(options.label)}"`);
	if (options.sequence !== undefined) attributes.push(`varSeq="${options.sequence}"`);
	const type = reading.isOmission
		? 'om'
		: options.recordedReadingTypeIds.has(reading.id)
			? reading.readingType
			: null;
	if (options.isLaterSplitMember) {
		attributes.push('type="split"');
		if (type !== null) attributes.push(`subtype="${escapeAttribute(type)}"`);
	} else if (type !== null) attributes.push(`type="${escapeAttribute(type)}"`);
	if (reading.certainty !== null)
		attributes.push(`cert="${escapeAttribute(String(reading.certainty))}"`);
	const tags = (reading.readingTags ?? []).flatMap(id => {
		const xmlId = options.tagXmlIds?.get(id);
		return xmlId ? [`#${xmlId}`] : [];
	});
	if (tags.length > 0) attributes.push(`ana="${escapeAttribute(tags.join(' '))}"`);
	attributes.push(
		witnessAttribute(
			[...reading.witnessIds, ...(reading.manualWitnessIds ?? [])],
			options.witnessXmlIds,
			options.baseTextWitnessId,
			options.includeBaseText
		).trim()
	);
	return attributes.filter(Boolean).join(' ');
}

function serializeReading(
	reading: ClassifiedReading,
	options: Parameters<typeof readingAttributes>[1]
): string {
	const attributes = readingAttributes(reading, options);
	const content = textContent(reading.text, reading.isOmission);
	return content ? `<rdg ${attributes}>${content}</rdg>` : `<rdg ${attributes}/>`;
}

function serializeUnit(
	segmentName: string,
	segment: Extract<Segment, { kind: 'unit' }>,
	unit: ApparatusTeiUnit,
	witnessXmlIds: ReadonlyMap<string, string>,
	baseTextWitnessId: string | null,
	tagXmlIds: ReadonlyMap<string, string>
): string {
	const lemma = unit.view.readings.find(reading => reading.id === unit.view.lemmaReadingId);
	if (!lemma)
		throw new ApparatusExportError([
			{
				kind: 'missing-lemma',
				unitId: segment.span.unitId,
				label: segment.label,
			},
		]);
	const recordedReadingTypeIds = new Set(unit.recordedReadingTypeIds);
	const lemmaAttributes = readingAttributes(lemma, {
		tagXmlIds,
		witnessXmlIds,
		baseTextWitnessId,
		includeBaseText: true,
		recordedReadingTypeIds,
	});
	const lemmaContent = textContent(lemma.text, lemma.isOmission);
	const serializedLemma = lemmaContent
		? `<lem ${lemmaAttributes}>${lemmaContent}</lem>`
		: `<lem ${lemmaAttributes}/>`;
	const ordered = citationOrder(unit.view.readings);
	const laterSplitMemberIds = new Set(
		splitReadingGroups(ordered).flatMap(group => group.slice(1).map(reading => reading.id))
	);
	const unitXmlId = xmlId(segment.span.unitId);
	const readingXmlIds = new Map(
		ordered.map(reading => [reading.id, xmlId(`${unitXmlId}-${reading.label}`)] as const)
	);
	const targetIds = new Set(
		unit.view.ambiguousAttestations.flatMap(attestation => attestation.targetReadingIds)
	);
	const readings = ordered.map((reading, index) =>
		serializeReading(reading, {
			tagXmlIds,
			xmlId: targetIds.has(reading.id) ? readingXmlIds.get(reading.id) : undefined,
			label: reading.label,
			sequence: index + 1,
			witnessXmlIds,
			baseTextWitnessId,
			includeBaseText: false,
			recordedReadingTypeIds,
			isLaterSplitMember: laterSplitMemberIds.has(reading.id),
		})
	);
	if (unit.nonAttestation.witnessIds.length > 0) {
		const sequence = readings.length + 1;
		const witnesses = witnessAttribute(
			unit.nonAttestation.witnessIds,
			witnessXmlIds,
			baseTextWitnessId,
			false
		);
		readings.push(
			`<rdg n="${NON_ATTESTATION_LABEL}" type="lac" varSeq="${sequence}"${witnesses}/>`
		);
	}
	for (const attestation of unit.view.ambiguousAttestations) {
		const witnesses = witnessAttribute(
			attestation.witnessIds,
			witnessXmlIds,
			baseTextWitnessId,
			false
		);
		if (!witnesses) continue;
		const target = attestation.targetReadingIds
			.map(readingId => `#${readingXmlIds.get(readingId)}`)
			.join(' ');
		readings.push(
			`<witDetail type="ambiguous" n="${escapeAttribute(`zw-${attestation.targetLabels.join('/')}`)}" target="${escapeAttribute(target)}"${witnesses}/>`
		);
	}

	const graphNodeId = new Map(
		unit.stemma.nodes.map(
			node => [node.readingId, xmlId(`${segment.span.columnIds[0]}-${node.label}`)] as const
		)
	);
	const nodes = unit.stemma.nodes
		.map(
			node =>
				`<node xml:id="${escapeAttribute(graphNodeId.get(node.readingId) ?? node.readingId)}" n="${escapeAttribute(node.label)}"/>`
		)
		.join('');
	const arcs = unit.stemma.nodes
		.flatMap(node => {
			if (node.sourceDecision.kind !== 'derived') return [];
			const from = graphNodeId.get(node.sourceDecision.from);
			const to = graphNodeId.get(node.readingId);
			return from && to
				? [`<arc from="#${escapeAttribute(from)}" to="#${escapeAttribute(to)}"/>`]
				: [];
		})
		.join('');
	const connectivity =
		unit.connectivity === 'absolute'
			? ''
			: `<fs><f name="connectivity"><numeric value="${unit.connectivity}"/></f></fs>`;

	return `<app xml:id="${escapeAttribute(unitXmlId)}" from="${escapeAttribute(segment.label)}" n="${escapeAttribute(segmentName)}" to="${escapeAttribute(segment.label)}" type="main">${serializedLemma}${readings.join('')}<note><label>${escapeText(`${segmentName}/${segment.ordinal}`)}</label>${connectivity}<graph type="directed">${nodes}${arcs}</graph></note></app>`;
}

export function getApparatusExportRefusals(
	input: ApparatusTeiExportInput
): ApparatusExportRefusal[] {
	const refusals: ApparatusExportRefusal[] = [];
	const activeWitnessIds = new Set(
		input.witnesses.filter(witness => !witness.isExcluded).map(witness => witness.witnessId)
	);
	for (const segment of input.segments) {
		if (segment.kind === 'agreed') {
			const witnessIds = segment.untranscribedWitnessIds.filter(witnessId =>
				activeWitnessIds.has(witnessId)
			);
			if (witnessIds.length > 0) {
				refusals.push({
					kind: 'untranscribed-witness',
					label: segment.label,
					witnessIds,
				});
			}
			continue;
		}
		const unitId = segment.span.unitId;
		const unit = input.units.get(unitId);
		if (!unit?.view.lemmaReadingId) {
			refusals.push({ kind: 'missing-lemma', unitId, label: segment.label });
		}
		if (!unit) continue;
		if (unit.view.unresolvedAttestations.length > 0) {
			refusals.push({
				kind: 'unresolved-attestation',
				unitId,
				label: segment.label,
				witnessIds: unit.view.unresolvedAttestations.map(entry => entry.witnessId),
			});
		}
		if (segment.untranscribedWitnessIds.length > 0) {
			const witnessIds = segment.untranscribedWitnessIds.filter(witnessId =>
				activeWitnessIds.has(witnessId)
			);
			if (witnessIds.length > 0) {
				refusals.push({
					kind: 'untranscribed-witness',
					unitId,
					label: segment.label,
					witnessIds,
				});
			}
		}
	}
	return refusals;
}

export function exportApparatusTei(input: ApparatusTeiExportInput): string {
	const refusals = getApparatusExportRefusals(input);
	if (refusals.length > 0) throw new ApparatusExportError(refusals);

	const activeWitnesses = input.witnesses.filter(witness => !witness.isExcluded);
	const tags = [
		...new Set(
			[...input.units.values()].flatMap(unit =>
				unit.view.readings.flatMap(reading => reading.readingTags ?? [])
			)
		),
	];
	const tagXmlIds = new Map(tags.map((id, index) => [id, `reading-tag-${index + 1}`]));
	const tagLabels = new Map((input.readingTags ?? []).map(tag => [tag.id, tag.label]));
	const tagDeclarations =
		tags.length > 0
			? `<interpGrp type="readingTags">${tags
					.map(
						id =>
							`<interp xml:id="${tagXmlIds.get(id)}">${escapeText(tagLabels.get(id) ?? id)}</interp>`
					)
					.join('')}</interpGrp>`
			: '';
	const witnessXmlIds = new Map(
		activeWitnesses.map(
			witness => [witness.witnessId, xmlId(`wit-${witness.witnessId}`)] as const
		)
	);
	const witnessList = activeWitnesses
		.map(
			witness =>
				`<witness xml:id="${escapeAttribute(witnessXmlIds.get(witness.witnessId) ?? witness.witnessId)}" n="${escapeAttribute(witness.siglum)}"/>`
		)
		.join('');
	const verse = input.segments
		.map(segment => {
			if (segment.kind === 'agreed') return textContent(segment.text, false);
			const unitId = segment.span.unitId;
			const unit = input.units.get(unitId);
			if (!unit)
				throw new ApparatusExportError([
					{ kind: 'missing-lemma', unitId, label: segment.label },
				]);
			return serializeUnit(
				input.segmentName,
				segment,
				unit,
				witnessXmlIds,
				input.baseTextWitnessId,
				tagXmlIds
			);
		})
		.join('');

	return `<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0"><teiHeader><fileDesc><titleStmt><title>${escapeText(input.title)}</title></titleStmt><publicationStmt><p>Derived collation apparatus generated by Apatosaurus.</p></publicationStmt><sourceDesc><listWit><witness xml:id="basetext" n="basetext"/>${witnessList}</listWit></sourceDesc></fileDesc></teiHeader><text xml:lang="grc"><body><div type="collation" n="${escapeAttribute(input.segmentName)}">${tagDeclarations}<ab xml:id="${escapeAttribute(xmlId(`${input.segmentName}-APP`))}">${verse}</ab></div></body></text></TEI>`;
}

function activeWitnessIds(
	document: CollationDocument,
	fallbackBaseWitnessId: string | null
): string[] {
	const active = document.setup.witnesses
		.filter(witness => !witness.isExcluded)
		.map(witness => witness.id);
	const ordered: string[] = [];
	if (fallbackBaseWitnessId && active.includes(fallbackBaseWitnessId))
		ordered.push(fallbackBaseWitnessId);
	for (const witnessId of document.alignment?.witnessOrder ?? []) {
		if (active.includes(witnessId) && !ordered.includes(witnessId)) ordered.push(witnessId);
	}
	for (const witnessId of active) if (!ordered.includes(witnessId)) ordered.push(witnessId);
	return ordered;
}

export function buildApparatusTeiExportInput(
	document: CollationDocument,
	projectReadingTypes: readonly ReadingTypeDefinition[] = [],
	projectReadingTags: ReadonlyArray<{ id: string; label: string }> = [],
	projectManualWitnesses: readonly ManualWitnessDefinition[] = []
): ApparatusTeiExportInput {
	const vocabulary = resolveReadingTypeVocabulary(projectReadingTypes);
	const columns = deserializeAlignmentColumns(document.alignment?.columns ?? []);
	const baseTextWitnessId =
		document.setup.witnesses.find(witness => witness.isBaseText && !witness.isExcluded)?.id ??
		null;
	const displayBaseWitnessId =
		baseTextWitnessId ??
		document.setup.witnesses.find(witness => !witness.isExcluded)?.id ??
		null;
	const spans = buildVariationUnitSpans(columns, document.alignment?.declaredUnits);
	const segments = buildSegmentSequence({
		columns,
		spans,
		baseWitnessId: displayBaseWitnessId,
	});
	const apparatusByUnitId = new Map(
		(document.apparatus?.units ?? []).map(unit => [unit.unitId, unit] as const)
	);
	const stemmaByUnitId = new Map(
		(document.stemma?.units ?? []).map(unit => [unit.unitId, unit] as const)
	);
	const witnessIds = activeWitnessIds(document, displayBaseWitnessId);
	const units = new Map<string, ApparatusTeiUnit>();

	for (const span of spans) {
		const unitId = span.unitId;
		const saved = apparatusByUnitId.get(unitId);
		const decisions: UnitDecisions = saved?.decisions ?? {};
		const proposal = buildReadingProposal({
			columns: columns.slice(span.startIndex, span.endIndex + 1),
			spanColumnIds: span.columnIds,
			sourceWitnessIds: witnessIds,
			baseWitnessId: baseTextWitnessId,
		});
		const view = applyDecisions(saved?.readings ?? proposal.readings, decisions, {
			baseWitnessId: baseTextWitnessId,
			vocabulary,
		});
		const stemmaUnit = stemmaByUnitId.get(unitId);
		units.set(unitId, {
			view,
			nonAttestation: proposal.nonAttestation,
			stemma: projectLocalStemma(
				view.readings,
				stemmaUnit?.arcs ?? [],
				view.lemmaReadingId,
				decisions.sourceDecision ?? {}
			),
			connectivity: stemmaUnit?.connectivity ?? 10,
			recordedReadingTypeIds: Object.keys(decisions.readingType ?? {}),
		});
	}

	return {
		title: document.meta.projectName
			? `${document.meta.projectName} Collation`
			: 'Apatosaurus Collation',
		segmentName: document.setup.segment.name,
		witnesses: [
			...document.setup.witnesses.map(witness => ({
				witnessId: witness.id,
				siglum: witness.siglum,
				isExcluded: witness.isExcluded,
			})),
			...projectManualWitnesses
				.filter(witness =>
					(document.apparatus?.units ?? []).some(
						unit => unit.decisions.manualTestimony?.[witness.id]
					)
				)
				.map(witness => ({
					witnessId: witness.id,
					siglum: witness.siglum,
					isExcluded: false,
				})),
		],
		baseTextWitnessId,
		segments,
		units,
		readingTags: projectReadingTags,
	};
}

export function exportCollationDocumentTei(
	document: CollationDocument,
	projectReadingTypes: readonly ReadingTypeDefinition[] = [],
	projectReadingTags: ReadonlyArray<{ id: string; label: string }> = [],
	projectManualWitnesses: readonly ManualWitnessDefinition[] = []
): string {
	return exportApparatusTei(
		buildApparatusTeiExportInput(
			document,
			projectReadingTypes,
			projectReadingTags,
			projectManualWitnesses
		)
	);
}
