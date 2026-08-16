import { deserializeAlignmentColumns } from './alignment-snapshot';
import { buildSegmentSequence, type Segment, NON_ATTESTATION_LABEL } from './collation-apparatus';
import { applyDecisions, type UnitDecisions, type UnitView } from './collation-decisions';
import type { CollationDocument } from './collation-document';
import { buildReadingProposal, type NonAttestation } from './collation-reading-proposal';
import { projectLocalStemma, type LocalStemma } from './collation-stemma';
import type { ClassifiedReading } from './collation-types';
import { variationUnitId } from './collation-unit-id';
import { buildVariationUnitSpans } from './collation-variation-units';
import { isPunctuationOnlyText } from './token-text';

export type ApparatusExportRefusalKind =
	'undecided-source' | 'untranscribed-witness' | 'missing-lemma';

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
					if (refusal.kind === 'undecided-source')
						return `${location} has undecided sources`;
					if (refusal.kind === 'untranscribed-witness') {
						return `${location} has untranscribed witnesses`;
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
	connectivity: number;
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
}

function xmlId(value: string): string {
	const normalized = value.trim().replace(/[^A-Za-z0-9_.-]+/g, '-');
	if (!normalized) return 'generated-id';
	return /^[A-Za-z_]/.test(normalized) ? normalized : `id-${normalized}`;
}

function escapeText(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttribute(value: string): string {
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

function textContent(text: string | null, isOmission: boolean): string {
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
		label?: string;
		sequence?: number;
		witnessXmlIds: ReadonlyMap<string, string>;
		baseTextWitnessId: string | null;
		includeBaseText: boolean;
		recordedReadingTypeIds: ReadonlySet<string>;
	}
): string {
	const attributes: string[] = [];
	if (options.label !== undefined) attributes.push(`n="${escapeAttribute(options.label)}"`);
	if (options.sequence !== undefined) attributes.push(`varSeq="${options.sequence}"`);
	if (reading.isOmission) attributes.push('type="om"');
	else if (options.recordedReadingTypeIds.has(reading.id) && reading.readingType !== null) {
		attributes.push(`type="${escapeAttribute(reading.readingType)}"`);
	}
	if (reading.certainty !== null)
		attributes.push(`cert="${escapeAttribute(String(reading.certainty))}"`);
	attributes.push(
		witnessAttribute(
			reading.witnessIds,
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
	baseTextWitnessId: string | null
): string {
	const lemma = unit.view.readings.find(reading => reading.id === unit.view.lemmaReadingId);
	if (!lemma)
		throw new ApparatusExportError([
			{ kind: 'missing-lemma', unitId: '', label: segment.label },
		]);
	const recordedReadingTypeIds = new Set(unit.recordedReadingTypeIds);
	const lemmaAttributes = readingAttributes(lemma, {
		witnessXmlIds,
		baseTextWitnessId,
		includeBaseText: true,
		recordedReadingTypeIds,
	});
	const lemmaContent = textContent(lemma.text, lemma.isOmission);
	const serializedLemma = lemmaContent
		? `<lem ${lemmaAttributes}>${lemmaContent}</lem>`
		: `<lem ${lemmaAttributes}/>`;
	const readings = citationOrder(unit.view.readings).map((reading, index) =>
		serializeReading(reading, {
			label: reading.label,
			sequence: index + 1,
			witnessXmlIds,
			baseTextWitnessId,
			includeBaseText: false,
			recordedReadingTypeIds,
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

	return `<app from="${escapeAttribute(segment.label)}" n="${escapeAttribute(segmentName)}" to="${escapeAttribute(segment.label)}" type="main">${serializedLemma}${readings.join('')}<note><label>${escapeText(`${segmentName}/${segment.ordinal}`)}</label><fs><f name="connectivity"><numeric value="${unit.connectivity}"/></f></fs><graph type="directed">${nodes}${arcs}</graph></note></app>`;
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
		const unitId = variationUnitId(segment.span.columnIds[0]);
		const unit = input.units.get(unitId);
		if (!unit?.view.lemmaReadingId) {
			refusals.push({ kind: 'missing-lemma', unitId, label: segment.label });
		}
		if (!unit) continue;
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
		if (unit.stemma.nodes.some(node => node.sourceDecision.kind === 'undecided')) {
			refusals.push({ kind: 'undecided-source', unitId, label: segment.label });
		}
	}
	return refusals;
}

/**
 * Serialize an apparatus from the shared sequence that the basetext strip and live preview use.
 * Supplying that sequence is deliberate: re-deriving it here would make reconstruction depend on
 * two definitions of a variation unit.
 */
export function exportApparatusTei(input: ApparatusTeiExportInput): string {
	const refusals = getApparatusExportRefusals(input);
	if (refusals.length > 0) throw new ApparatusExportError(refusals);

	const activeWitnesses = input.witnesses.filter(witness => !witness.isExcluded);
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
			const unitId = variationUnitId(segment.span.columnIds[0]);
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
				input.baseTextWitnessId
			);
		})
		.join('');

	return `<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0"><teiHeader><fileDesc><titleStmt><title>${escapeText(input.title)}</title></titleStmt><publicationStmt><p>Derived collation apparatus generated by Apatosaurus.</p></publicationStmt><sourceDesc><listWit><witness xml:id="basetext" n="basetext"/>${witnessList}</listWit></sourceDesc></fileDesc></teiHeader><text xml:lang="grc"><body><div type="collation" n="${escapeAttribute(input.segmentName)}"><ab xml:id="${escapeAttribute(xmlId(`${input.segmentName}-APP`))}">${verse}</ab></div></body></text></TEI>`;
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

/** Build a serializable export input while retaining the same segment derivation as the editor. */
export function buildApparatusTeiExportInput(document: CollationDocument): ApparatusTeiExportInput {
	const columns = deserializeAlignmentColumns(document.alignment?.columns ?? []);
	const baseTextWitnessId =
		document.setup.witnesses.find(witness => witness.isBaseText && !witness.isExcluded)?.id ??
		null;
	const displayBaseWitnessId =
		baseTextWitnessId ??
		document.setup.witnesses.find(witness => !witness.isExcluded)?.id ??
		null;
	const spans = buildVariationUnitSpans(columns);
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
		const unitId = variationUnitId(span.columnIds[0]);
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
		witnesses: document.setup.witnesses.map(witness => ({
			witnessId: witness.id,
			siglum: witness.siglum,
			isExcluded: witness.isExcluded,
		})),
		baseTextWitnessId,
		segments,
		units,
	};
}

export function exportCollationDocumentTei(document: CollationDocument): string {
	return exportApparatusTei(buildApparatusTeiExportInput(document));
}
