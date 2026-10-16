import type { CoherenceSettings } from '@apatosaurus/open-cbgm-wasm';

import type { CollationDocument } from '$lib/collation/collation-document';
import { splitReadingGroups } from '$lib/collation/collation-reading-proposal';
import {
	buildApparatusTeiExportInput,
	escapeAttribute,
	escapeText,
	textContent,
	type ApparatusTeiUnit,
} from '$lib/collation/collation-tei';

export type CbgmInput = {
	tei: string | null;
	witnesses: string[];
	siglumConflicts: { siglum: string; transcriptionIds: string[] }[];
	blockingUnits: { collationId: string; unitId: string; label: string; kind: 'missing-lemma' }[];
	undecidedReadings: { unit: string; reading: string }[];
	availableCorrectors: string[];
};

function claimUnitPrefix(segmentName: string, claimed: Set<string>): string {
	const base = segmentName.replace(/\s+/g, '');
	let prefix = base;
	for (let index = 2; claimed.has(prefix); index += 1) prefix = `${base}-${index}`;
	claimed.add(prefix);
	return prefix;
}

function serializeApp(
	id: string,
	label: string,
	unit: ApparatusTeiUnit,
	siglumOf: ReadonlyMap<string, string>
): string {
	const readingById = new Map(unit.view.readings.map(reading => [reading.id, reading] as const));
	const recordedReadingTypeIds = new Set(unit.recordedReadingTypeIds);
	const laterSplitMemberIds = new Set(
		splitReadingGroups(unit.view.readings).flatMap(group =>
			group.slice(1).map(reading => reading.id)
		)
	);
	const labelOf = new Map(unit.stemma.nodes.map(node => [node.readingId, node.label] as const));

	const readings = unit.stemma.nodes.map(node => {
		const reading = readingById.get(node.readingId)!;
		const readingType = reading.isOmission
			? 'omission'
			: recordedReadingTypeIds.has(reading.id)
				? reading.readingType
				: null;
		const types = [
			...(laterSplitMemberIds.has(reading.id) ? ['split'] : []),
			...(readingType === null ? [] : [readingType]),
		];
		const sigla = [
			...new Set(node.witnessIds.flatMap(witnessId => siglumOf.get(witnessId) ?? [])),
		];
		const attributes = [
			`n="${escapeAttribute(node.label)}"`,
			...(types.length > 0 ? [`type="${escapeAttribute(types.join(' '))}"`] : []),
			...(sigla.length > 0 ? [`wit="${escapeAttribute(sigla.join(' '))}"`] : []),
		].join(' ');
		const content = textContent(node.text, node.isOmission);
		return content ? `<rdg ${attributes}>${content}</rdg>` : `<rdg ${attributes}/>`;
	});

	const nodes = unit.stemma.nodes
		.map(node => `<node n="${escapeAttribute(node.label)}"/>`)
		.join('');
	// open-cbgm keys stemma vertices by node/@n and reads arc ends verbatim, not as #xml:id refs.
	const arcs = unit.stemma.nodes
		.flatMap(node => {
			if (node.sourceDecision.kind !== 'derived') return [];
			const from = labelOf.get(node.sourceDecision.from);
			return from
				? [`<arc from="${escapeAttribute(from)}" to="${escapeAttribute(node.label)}"/>`]
				: [];
		})
		.join('');
	const connectivity =
		unit.connectivity === 'absolute'
			? ''
			: `<fs><f name="connectivity"><numeric value="${unit.connectivity}"/></f></fs>`;

	return `<app n="${escapeAttribute(id)}">${readings.join('')}<note><label>${escapeText(label)}</label>${connectivity}<graph type="directed">${nodes}${arcs}</graph></note></app>`;
}

export function buildCbgmInput(
	collations: CollationDocument[],
	settings: CoherenceSettings
): CbgmInput {
	const includedCorrectors = new Set(settings.includedCorrectors);
	const transcriptionIdsBySiglum = new Map<string, string[]>();
	const availableCorrectors = new Set<string>();
	const blockingUnits: CbgmInput['blockingUnits'] = [];
	const undecidedReadings: CbgmInput['undecidedReadings'] = [];
	const claimedPrefixes = new Set<string>();
	const blocks: string[] = [];

	for (const document of collations) {
		const siglumOf = new Map<string, string>();
		for (const witness of document.setup.witnesses) {
			if (witness.isExcluded) continue;
			if (witness.kind === 'corrector') {
				availableCorrectors.add(witness.siglum);
				if (!includedCorrectors.has(witness.siglum)) continue;
			}
			siglumOf.set(witness.id, witness.siglum);
			const transcriptionIds = transcriptionIdsBySiglum.get(witness.siglum) ?? [];
			if (!transcriptionIds.includes(witness.transcriptionId)) {
				transcriptionIds.push(witness.transcriptionId);
			}
			transcriptionIdsBySiglum.set(witness.siglum, transcriptionIds);
		}

		const segmentName = document.setup.segment.name;
		const prefix = claimUnitPrefix(segmentName, claimedPrefixes);
		const input = buildApparatusTeiExportInput({
			...document,
			apparatus: document.apparatus
				? {
						...document.apparatus,
						units: document.apparatus.units.map(unit => ({
							...unit,
							decisions: { ...unit.decisions, authoredReadings: [] },
						})),
					}
				: null,
		});
		const apps: string[] = [];
		for (const segment of input.segments) {
			if (segment.kind !== 'unit') continue;
			const unitId = segment.span.unitId;
			const unit = input.units.get(unitId);
			const isDeclared = document.alignment?.declaredUnits?.some(
				declaration =>
					declaration.firstColumnId === segment.span.columnIds[0] &&
					declaration.lastColumnId === segment.span.columnIds.at(-1)
			);
			if (
				!unit ||
				unit.stemma.nodes.length === 0 ||
				(unit.stemma.nodes.length < 2 && !isDeclared)
			)
				continue;
			const label = `${segmentName}/${segment.ordinal}`;
			if (unit.view.lemmaReadingId === null) {
				blockingUnits.push({
					collationId: document.meta.collationId ?? '',
					unitId,
					label,
					kind: 'missing-lemma',
				});
				continue;
			}
			const id = `${prefix}U${segment.ordinal}`;
			apps.push(serializeApp(id, label, unit, siglumOf));
			for (const node of unit.stemma.nodes) {
				if (!node.isRoot && node.sourceDecision.kind === 'undecided') {
					undecidedReadings.push({ unit: id, reading: node.label });
				}
			}
		}
		blocks.push(`<ab n="${escapeAttribute(segmentName)}">${apps.join('')}</ab>`);
	}

	const witnesses = [...transcriptionIdsBySiglum.keys()];
	const witnessList = witnesses
		.map(siglum => `<witness n="${escapeAttribute(siglum)}"/>`)
		.join('');
	return {
		tei:
			blockingUnits.length > 0
				? null
				: `<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0"><teiHeader><fileDesc><titleStmt><title>CBGM input</title></titleStmt><publicationStmt><p>CBGM input generated by Apatosaurus.</p></publicationStmt><sourceDesc><listWit>${witnessList}</listWit></sourceDesc></fileDesc></teiHeader><text xml:lang="grc"><body>${blocks.join('')}</body></text></TEI>`,
		witnesses,
		siglumConflicts: [...transcriptionIdsBySiglum]
			.filter(([, transcriptionIds]) => transcriptionIds.length > 1)
			.map(([siglum, transcriptionIds]) => ({ siglum, transcriptionIds })),
		blockingUnits,
		undecidedReadings,
		availableCorrectors: [...availableCorrectors],
	};
}
