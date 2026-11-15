import { DOMParser } from '@xmldom/xmldom';
import type { Element as XmlElement } from '@xmldom/xmldom';

import { hashContent } from '$lib/storage/content-hash';
import { teiContentHash } from '$lib/storage/tei-content';

import type { AlignmentCell, SerializedAlignmentColumn } from './alignment-snapshot';
import {
	decodePersistentId,
	encodePersistentId,
	serializeCollationApparatus,
	type CollationVocabulary,
} from './collation-apparatus-tei';
import type { CollationDocument, ImportNote } from './collation-document';
import { escapeAttribute, escapeText } from './collation-tei';
import type {
	AlignmentCellKind,
	GapMetadata,
	RegularizationRule,
	WitnessTextSegment,
} from './collation-types';

export interface CollationRevisionChange {
	type: string;
	when?: string;
	n?: string;
	idnos?: ReadonlyArray<readonly [type: string, value: string | null]>;
	author?: string | null;
	note?: string | null;
}

export type CollationTeiRecord = Record<string, string | number>;

export interface CollationTeiOptions {
	notes?: string;
	changes?: CollationRevisionChange[];
	record?: CollationTeiRecord;
}

export interface ParsedCollationTei {
	document: CollationDocument;
	record: CollationTeiRecord;
	changes: CollationRevisionChange[];
}

export interface SerializedCollationTei {
	xml: string;
	fileHash: string;
	contentHash: string;
}

type WitnessNode = CollationDocument['setup']['witnesses'][number];
type SourceToken = WitnessNode['sourceTokens'][number];
type ApparatusUnitNode = NonNullable<CollationDocument['apparatus']>['units'][number];
type StemmaUnitNode = NonNullable<CollationDocument['stemma']>['units'][number];

const STANDOFF_TYPE = 'apatosaurus-collation';
const WITNESS = 'w-';
const TOKEN = 't-';
const COLUMN = 'c-';
const RULE = 'rule-';
const TOKEN_LISTS = [
	{ key: 'sourceTokens', subtype: null },
	{ key: 'fullSourceTokens', subtype: 'full' },
	{ key: 'fragmentarySourceTokens', subtype: 'fragmentary' },
] as const;
/** The `ns` rule type is the nomen sacrum the UI and classic imports name, not "nonsense". */
const RULE_TYPE_SYMBOLS: Record<string, string> = { none: 'none', ns: 'nomenSacrum' };
const XML_UNSAFE =
	// eslint-disable-next-line no-control-regex
	/[\u0000-\u0008\u000B\u000C\u000E-\u001F\r￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

class FsSymbol {
	constructor(readonly value: string) {}
}

function xmlText(value: string): string {
	return escapeText(value).replace(
		XML_UNSAFE,
		char =>
			`<g type="char" n="U+${char.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}"/>`
	);
}

/** Reversible NCName-safe encoding; `_` is escaped too, so `_hex.` never collides. */
function xid(id: string): string {
	return id.replace(/[^A-Za-z0-9-]/gu, char => `_${char.codePointAt(0)!.toString(16)}.`);
}

function unxid(value: string): string {
	return value.replace(/_([0-9a-f]+)\./g, (_, hex: string) =>
		String.fromCodePoint(parseInt(hex, 16))
	);
}

function featureName(key: string): string {
	return /^[A-Za-z][A-Za-z0-9-]*$/.test(key) ? key : `_.${xid(key)}`;
}

function readFeatureName(name: string): string {
	return name.startsWith('_.') ? unxid(name.slice(2)) : name;
}

const refs = (prefix: string, ids: readonly string[]) =>
	ids.map(id => `#${prefix}${xid(id)}`).join(' ');

function attribute(name: string, value: string | undefined): string {
	return value
		? ` ${name}="${escapeAttribute(value).replace(/[\t\n]/g, char => `&#${char.charCodeAt(0)};`)}"`
		: '';
}

function fsValue(value: unknown): string {
	if (value === null) return '<symbol value="null"/>';
	if (value instanceof FsSymbol) return `<symbol value="${escapeAttribute(value.value)}"/>`;
	if (typeof value === 'boolean') return `<binary value="${value}"/>`;
	if (typeof value === 'number') return `<numeric value="${value}"/>`;
	if (typeof value === 'string')
		return value ? `<string>${xmlText(value)}</string>` : '<string/>';
	if (Array.isArray(value)) {
		const items = value.map(fsValue).join('');
		return items ? `<vColl org="list">${items}</vColl>` : '<vColl org="list"/>';
	}
	return fs(value as Record<string, unknown>);
}

function fs(record: Record<string, unknown>, attributes = ''): string {
	const features = Object.keys(record)
		.filter(key => record[key] !== undefined)
		.map(key => `<f name="${featureName(key)}">${fsValue(record[key])}</f>`)
		.join('');
	return features ? `<fs${attributes}>${features}</fs>` : `<fs${attributes}/>`;
}

function detailFs(record: Record<string, unknown>): string {
	return Object.values(record).some(value => value !== undefined)
		? fs(record, ' type="detail"')
		: '';
}

function segmentsXml(segments: readonly WitnessTextSegment[]): string {
	return segments
		.map(segment => {
			let xml = xmlText(segment.text);
			if (segment.hasUnclear) xml = `<unclear>${xml}</unclear>`;
			if (segment.isSupplied) xml = `<supplied>${xml}</supplied>`;
			if (segment.isPunctuation) xml = `<pc>${xml}</pc>`;
			else if (!segment.hasUnclear && !segment.isSupplied) xml = `<seg>${xml}</seg>`;
			return xml;
		})
		.join('');
}

function gapXml(gap: GapMetadata): string {
	return `<gap${attribute('reason', gap.reason)}${attribute('unit', gap.unit)}${attribute('extent', gap.extent)} agent="${gap.source}"/>`;
}

const joinSegments = (segments: readonly WitnessTextSegment[]) =>
	segments.map(segment => segment.text).join('');

function tokenXml(token: SourceToken, witness: WitnessNode, index: number): string {
	const defaultOriginal = token.kind === 'text' ? joinSegments(token.segments).trim() : '⊘';
	const { sourceRef } = token;
	const defaultRef =
		sourceRef.witnessId === witness.id &&
		sourceRef.transcriptionId === witness.transcriptionId &&
		sourceRef.index === index;
	return `<w xml:id="${TOKEN}${xid(token.tokenId)}" type="${token.kind}">${token.gap ? gapXml(token.gap) : ''}${segmentsXml(token.segments)}${detailFs(
		{
			original: token.original === defaultOriginal ? undefined : token.original,
			sourceRef: defaultRef ? undefined : sourceRef,
		}
	)}</w>`;
}

function witnessXml(witness: WitnessNode): string {
	const {
		type: _type,
		id,
		sourceTokens: _source,
		fullSourceTokens: _full,
		fragmentarySourceTokens: _fragmentary,
		...fields
	} = witness;
	const tokenLists = TOKEN_LISTS.flatMap(({ key, subtype }) => {
		const tokens = witness[key];
		if (!tokens) return [];
		const content = tokens.map((token, index) => tokenXml(token, witness, index)).join('');
		return [
			`<seg type="witness-tokens"${attribute('subtype', subtype ?? undefined)} corresp="#${WITNESS}${xid(id)}">${content}</seg>`,
		];
	});
	return fs(fields, ` type="witness" xml:id="${WITNESS}${xid(id)}"`) + tokenLists.join('');
}

function cellXml(witnessId: string, cell: AlignmentCell): string {
	const { text, regularizedText: reg, originalSegments: segments } = cell;
	const inline =
		segments !== undefined &&
		segments.length > 0 &&
		text !== null &&
		joinSegments(segments) === text;
	const orig = inline ? segmentsXml(segments) : text === null ? '' : xmlText(text);
	let content: string;
	if (text === reg)
		content =
			text === null ? '' : text === '' && !inline ? '<choice><orig/><reg/></choice>' : orig;
	else if (text !== null && reg !== null)
		content = `<choice><orig>${orig}</orig><reg>${xmlText(reg)}</reg></choice>`;
	else if (text === null) content = `<reg>${xmlText(reg!)}</reg>`;
	else content = `<orig>${orig}</orig>`;
	const detail = detailFs({
		alignmentValue: cell.alignmentValue === reg ? undefined : cell.alignmentValue,
		isOmission: cell.isOmission === (cell.kind === 'omission') ? undefined : cell.isOmission,
		isLacuna:
			cell.isLacuna === (cell.kind === 'gap' || cell.kind === 'untranscribed')
				? undefined
				: cell.isLacuna,
		isRegularized: cell.isRegularized === (text !== reg) ? undefined : cell.isRegularized,
		regularizationTypes: cell.regularizationTypes.length ? cell.regularizationTypes : undefined,
		originalSegments: segments !== undefined && !inline ? segments : undefined,
	});
	const attributes =
		` source="#${WITNESS}${xid(witnessId)}"` +
		attribute('corresp', refs(TOKEN, cell.sourceTokenIds)) +
		attribute('ana', refs(RULE, cell.ruleIds)) +
		` type="${cell.kind}"`;
	return `<seg${attributes}>${cell.gap ? gapXml(cell.gap) : ''}${content}${detail}</seg>`;
}

function columnXml(column: SerializedAlignmentColumn): string {
	const id = `${COLUMN}${xid(column.id)}`;
	const attributes =
		` type="column"${column.merged ? ' subtype="merged"' : ''} xml:id="${id}" n="${column.index}"` +
		attribute('corresp', refs(COLUMN, column.mergedWith ?? []));
	const detail = detailFs({
		mergedWith: column.mergedWith?.length === 0 ? [] : undefined,
		splitInto: column.splitInto?.length === 0 ? [] : undefined,
	});
	const split = column.splitInto?.length
		? `<seg type="split" corresp="#${id}">${column.splitInto.map(columnXml).join('')}</seg>`
		: '';
	return `<seg${attributes}>${column.cells.map(([witnessId, cell]) => cellXml(witnessId, cell)).join('')}${detail}</seg>${split}`;
}

function unitXml(unit: ApparatusUnitNode): string {
	return fs(
		{
			id: unit.id === unit.unitId ? undefined : unit.id,
			columnId: unit.columnId,
			readings: unit.readings,
			decisions: unit.decisions,
		},
		` type="unit-decisions" sameAs="${encodePersistentId(unit.unitId)}"`
	);
}

function stemmaUnitXml(unit: StemmaUnitNode): string {
	return fs(
		{
			id: unit.id === unit.unitId ? undefined : unit.id,
			columnId: unit.columnId,
			arcs: unit.arcs,
			connectivity: unit.connectivity,
		},
		` type="stemma-unit" sameAs="${encodePersistentId(unit.unitId)}"`
	);
}

function importNoteXml(note: ImportNote): string {
	return `<note type="import" sameAs="${encodePersistentId(note.id)}"${attribute('n', note.unitId === null ? undefined : encodePersistentId(note.unitId))}>${xmlText(note.detail)}</note>`;
}

function rulesXml(rules: readonly RegularizationRule[]): string {
	if (rules.length === 0) return '';
	const content = rules
		.map(({ id, type, ...rule }) =>
			fs(
				{ ...rule, type: new FsSymbol(RULE_TYPE_SYMBOLS[type] ?? type) },
				` type="rule" xml:id="${RULE}${xid(id)}"`
			)
		)
		.join('');
	return `<editorialDecl><normalization><ab type="regularization-rules">${content}</ab></normalization></editorialDecl>`;
}

function revisionDescXml(changes: readonly CollationRevisionChange[]): string {
	if (changes.length === 0) return '';
	const content = changes
		.map(change => {
			const idnos = (change.idnos ?? [])
				.filter(([, value]) => value !== null)
				.map(([type, value]) => `<idno${attribute('type', type)}>${xmlText(value!)}</idno>`)
				.join('');
			return `<change${attribute('type', change.type)}${attribute('when', change.when)}${attribute('n', change.n)}>${idnos}${change.author != null ? `<name>${xmlText(change.author)}</name>` : ''}${change.note != null ? `<note>${xmlText(change.note)}</note>` : ''}</change>`;
		})
		.join('');
	return `<revisionDesc>${content}</revisionDesc>`.normalize('NFC');
}

function standOffXml(document: CollationDocument, record?: CollationTeiRecord): string {
	const { alignment, apparatus, stemma, settings, setup, meta } = document;
	const { regularizationRules: _rules, ...settingFields } = settings;
	const parts = [
		...setup.witnesses.map(witnessXml),
		...(alignment?.columns.length
			? [`<seg type="alignment">${alignment.columns.map(columnXml).join('')}</seg>`]
			: []),
		...(alignment
			? [
					fs(
						{
							witnessOrder: alignment.witnessOrder,
							declaredUnits: alignment.declaredUnits,
						},
						' type="alignment"'
					),
				]
			: []),
		...(apparatus?.units.map(unitXml) ?? []),
		...(stemma?.units.map(stemmaUnitXml) ?? []),
		fs(settingFields, ' type="collation-settings"'),
		fs(
			{
				...meta,
				segment: setup.segment,
				manualWitnessOverrides: setup.manualWitnessOverrides,
				importNotes: document.importNotes?.length === 0 ? [] : undefined,
				emptyApparatus: apparatus?.units.length === 0 ? true : undefined,
				emptyStemma: stemma?.units.length === 0 ? true : undefined,
			},
			' type="collation"'
		),
		fs(document.flow, ' type="workflow"'),
		...(document.importNotes?.map(importNoteXml) ?? []),
		...(record ? [fs(record, ' type="record"')] : []),
	];
	return `<standOff type="${STANDOFF_TYPE}">${parts.join('')}</standOff>`;
}

/** Normalizes keys too: the XML is NFC as a whole, but encoded ids decode to their original form. */
function nfc<T>(value: T): T {
	if (typeof value === 'string') return value.normalize('NFC') as T;
	if (Array.isArray(value)) return value.map(nfc) as T;
	if (value && typeof value === 'object')
		return Object.fromEntries(
			Object.entries(value).map(([key, entry]) => [key.normalize('NFC'), nfc(entry)])
		) as T;
	return value;
}

/** Writes both layers; unfinished collations are always written, never refused. */
export async function serializeCollationTei(
	source: CollationDocument,
	sourceVocab: CollationVocabulary,
	options: CollationTeiOptions = {}
): Promise<SerializedCollationTei> {
	const document = nfc(source);
	const vocab = nfc(sourceVocab);
	const xml = serializeCollationApparatus(document, vocab, options.notes, {
		editorialDecl: rulesXml(document.settings.regularizationRules),
		revisionDesc: revisionDescXml(options.changes ?? []),
		standOff: standOffXml(document, options.record),
	});
	return hashedCollationTei(xml);
}

async function hashedCollationTei(xml: string): Promise<SerializedCollationTei> {
	const [fileHash, contentHash] = await Promise.all([hashContent(xml), teiContentHash(xml)]);
	return { xml, fileHash, contentHash };
}

const REVISION_DESC = /<revisionDesc(?:\s[^>]*)?>[\s\S]*?<\/revisionDesc>/;

/** Rewrites only `<revisionDesc>`, so a Version note edit leaves every other byte alone. */
export async function rewriteCollationTeiChanges(
	xml: string,
	update: (changes: CollationRevisionChange[]) => CollationRevisionChange[]
): Promise<SerializedCollationTei> {
	const headerEnd = xml.indexOf('</teiHeader>');
	const header = xml.slice(0, headerEnd);
	const next = revisionDescXml(update(parseCollationTeiChanges(xml)));
	const rewritten = REVISION_DESC.test(header)
		? header.replace(REVISION_DESC, () => next)
		: header + next;
	return hashedCollationTei(rewritten + xml.slice(headerEnd));
}

/** Parses only the header's `<revisionDesc>`. */
export function parseCollationTeiChanges(xml: string): CollationRevisionChange[] {
	const match = REVISION_DESC.exec(xml.slice(0, xml.indexOf('</teiHeader>')));
	if (!match) return [];
	const root = new DOMParser().parseFromString(match[0], 'application/xml').documentElement;
	if (!root || root.localName !== 'revisionDesc')
		throw new Error('The collation TEI has an unreadable <revisionDesc>.');
	return readChanges(root);
}

function readChanges(revisionDesc: XmlElement | undefined): CollationRevisionChange[] {
	return (revisionDesc ? children(revisionDesc, 'change') : []).map(node => {
		const name = children(node, 'name')[0];
		const note = children(node, 'note')[0];
		const idnos = children(node, 'idno').map(
			idno => [idno.getAttribute('type') ?? '', readText(idno)] as const
		);
		return {
			type: node.getAttribute('type') ?? '',
			...(node.hasAttribute('when') ? { when: node.getAttribute('when')! } : {}),
			...(node.hasAttribute('n') ? { n: node.getAttribute('n')! } : {}),
			...(idnos.length ? { idnos } : {}),
			...(name ? { author: readText(name) } : {}),
			...(note ? { note: readText(note) } : {}),
		};
	});
}

const elements = (node: XmlElement): XmlElement[] =>
	Array.from(node.childNodes).filter((child): child is XmlElement => child.nodeType === 1);

const children = (node: XmlElement, name: string): XmlElement[] =>
	elements(node).filter(child => child.localName === name);

const byType = (node: XmlElement, name: string, type: string): XmlElement[] =>
	children(node, name).filter(child => child.getAttribute('type') === type);

const readRefs = (prefix: string, value: string | null): string[] =>
	(value?.split(/\s+/).filter(Boolean) ?? []).map(ref => unxid(ref.slice(1 + prefix.length)));

function readText(node: XmlElement): string {
	return Array.from(node.childNodes)
		.map(child => {
			if (child.nodeType === 3 || child.nodeType === 4) return child.nodeValue ?? '';
			const element = child as XmlElement;
			return child.nodeType === 1 && element.localName === 'g'
				? String.fromCharCode(parseInt((element.getAttribute('n') ?? '').slice(2), 16))
				: '';
		})
		.join('');
}

function readFsValue(node: XmlElement | undefined): unknown {
	switch (node?.localName) {
		case 'symbol': {
			const value = node.getAttribute('value');
			return value === 'null' ? null : value;
		}
		case 'binary':
			return node.getAttribute('value') === 'true';
		case 'numeric':
			return Number(node.getAttribute('value'));
		case 'string':
			return readText(node);
		case 'vColl':
			return elements(node).map(readFsValue);
		case 'fs':
			return readFs(node);
	}
	throw new Error(`Unexpected feature value <${node?.localName}> in the collation TEI.`);
}

function readFs(node: XmlElement | undefined): Record<string, unknown> {
	if (!node) return {};
	return Object.fromEntries(
		children(node, 'f').map(feature => [
			readFeatureName(feature.getAttribute('name') ?? ''),
			readFsValue(elements(feature)[0]),
		])
	);
}

const SEGMENT_WRAPPERS = new Set(['seg', 'unclear', 'supplied', 'pc']);

function readSegments(node: XmlElement): WitnessTextSegment[] {
	return elements(node)
		.filter(child => SEGMENT_WRAPPERS.has(child.localName ?? ''))
		.map(wrapper => {
			const segment = {
				text: '',
				hasUnclear: false,
				isPunctuation: false,
				isSupplied: false,
			};
			let current = wrapper;
			for (;;) {
				if (current.localName === 'unclear') segment.hasUnclear = true;
				if (current.localName === 'supplied') segment.isSupplied = true;
				if (current.localName === 'pc') segment.isPunctuation = true;
				const inner = elements(current).find(
					child => child.localName === 'unclear' || child.localName === 'supplied'
				);
				if (!inner) break;
				current = inner;
			}
			segment.text = readText(current);
			return segment;
		});
}

function readGap(node: XmlElement | undefined): GapMetadata | null {
	if (!node) return null;
	return {
		source: (node.getAttribute('agent') ?? 'gap') as GapMetadata['source'],
		reason: node.getAttribute('reason') ?? '',
		unit: node.getAttribute('unit') ?? '',
		extent: node.getAttribute('extent') ?? '',
	};
}

function readToken(node: XmlElement, witness: WitnessNode, index: number): SourceToken {
	const kind = node.getAttribute('type') as SourceToken['kind'];
	const segments = readSegments(node);
	const detail = readFs(byType(node, 'fs', 'detail')[0]);
	return {
		kind,
		original:
			(detail.original as string | undefined) ??
			(kind === 'text' ? joinSegments(segments).trim() : '⊘'),
		segments,
		gap: readGap(children(node, 'gap')[0]),
		tokenId: unxid((node.getAttribute('xml:id') ?? '').slice(TOKEN.length)),
		sourceRef: (detail.sourceRef as SourceToken['sourceRef'] | undefined) ?? {
			witnessId: witness.id,
			transcriptionId: witness.transcriptionId,
			index,
		},
	};
}

function readOriginal(node: XmlElement): { text: string; segments?: WitnessTextSegment[] } {
	const segments = readSegments(node);
	return segments.length > 0
		? { text: joinSegments(segments), segments }
		: { text: readText(node) };
}

function readCell(node: XmlElement): [string, AlignmentCell] {
	const kind = node.getAttribute('type') as AlignmentCellKind;
	const choice = children(node, 'choice')[0];
	const origNode = children(choice ?? node, 'orig')[0];
	const regNode = children(choice ?? node, 'reg')[0];
	let text: string | null = null;
	let reg: string | null = null;
	let segments: WitnessTextSegment[] | undefined;
	if (choice || origNode || regNode) {
		const original = origNode ? readOriginal(origNode) : null;
		text = original?.text ?? null;
		segments = original?.segments;
		reg = regNode ? readText(regNode) : null;
	} else {
		const original = readOriginal(node);
		if (original.segments || original.text) {
			text = reg = original.text;
			segments = original.segments;
		}
	}
	const detail = readFs(byType(node, 'fs', 'detail')[0]);
	const originalSegments =
		(detail.originalSegments as WitnessTextSegment[] | undefined) ?? segments;
	return [
		readRefs(WITNESS, node.getAttribute('source'))[0] ?? '',
		{
			text,
			regularizedText: reg,
			alignmentValue:
				'alignmentValue' in detail ? (detail.alignmentValue as string | null) : reg,
			sourceTokenIds: readRefs(TOKEN, node.getAttribute('corresp')),
			kind,
			gap: readGap(children(node, 'gap')[0]),
			isOmission: (detail.isOmission as boolean | undefined) ?? kind === 'omission',
			isLacuna:
				(detail.isLacuna as boolean | undefined) ??
				(kind === 'gap' || kind === 'untranscribed'),
			isRegularized: (detail.isRegularized as boolean | undefined) ?? text !== reg,
			ruleIds: readRefs(RULE, node.getAttribute('ana')),
			regularizationTypes:
				(detail.regularizationTypes as AlignmentCell['regularizationTypes'] | undefined) ??
				[],
			...(originalSegments ? { originalSegments } : {}),
		},
	];
}

function readColumns(container: XmlElement): SerializedAlignmentColumn[] {
	const columns: SerializedAlignmentColumn[] = [];
	for (const node of elements(container)) {
		if (node.getAttribute('type') === 'split') {
			columns[columns.length - 1].splitInto = readColumns(node);
			continue;
		}
		const detail = readFs(byType(node, 'fs', 'detail')[0]);
		const mergedWith = readRefs(COLUMN, node.getAttribute('corresp'));
		columns.push({
			id: unxid((node.getAttribute('xml:id') ?? '').slice(COLUMN.length)),
			index: Number(node.getAttribute('n')),
			cells: children(node, 'seg').map(readCell),
			merged: node.getAttribute('subtype') === 'merged',
			...(mergedWith.length > 0 || detail.mergedWith
				? { mergedWith: (detail.mergedWith as string[] | undefined) ?? mergedWith }
				: {}),
			...(detail.splitInto ? { splitInto: [] } : {}),
		});
	}
	return columns;
}

function readRules(root: XmlElement): RegularizationRule[] {
	const rules = ['teiHeader', 'encodingDesc', 'editorialDecl', 'normalization']
		.reduce((nodes, name) => nodes.flatMap(node => children(node, name)), [root])
		.flatMap(node => byType(node, 'ab', 'regularization-rules'))
		.flatMap(node => byType(node, 'fs', 'rule'));
	const types = new Map(
		Object.entries(RULE_TYPE_SYMBOLS).map(([type, symbol]) => [symbol, type])
	);
	return rules.map(node => {
		const { type, ...rule } = readFs(node);
		return {
			id: unxid((node.getAttribute('xml:id') ?? '').slice(RULE.length)),
			...rule,
			type: types.get(type as string) ?? type,
		} as RegularizationRule;
	});
}

export function parseCollationTei(xml: string): CollationDocument {
	return parseCollationTeiParts(xml).document;
}

export function parseCollationTeiParts(xml: string): ParsedCollationTei {
	const root = new DOMParser().parseFromString(xml, 'application/xml').documentElement;
	if (!root || root.localName !== 'TEI') throw new Error('The collation TEI has no <TEI> root.');
	const standOff = byType(root, 'standOff', STANDOFF_TYPE)[0];
	if (!standOff) throw new Error('The collation TEI has no working-state layer.');
	return {
		document: readDocument(root, standOff),
		record: readFs(byType(standOff, 'fs', 'record')[0]) as CollationTeiRecord,
		changes: readChanges(children(children(root, 'teiHeader')[0] ?? root, 'revisionDesc')[0]),
	};
}

function readDocument(root: XmlElement, standOff: XmlElement): CollationDocument {
	const tokenLists = new Map<string, XmlElement>(
		byType(standOff, 'seg', 'witness-tokens').map(node => [
			`${node.getAttribute('corresp')}|${node.getAttribute('subtype') ?? ''}`,
			node,
		])
	);
	const witnesses = byType(standOff, 'fs', 'witness').map(node => {
		const witness = {
			type: 'witness',
			id: unxid((node.getAttribute('xml:id') ?? '').slice(WITNESS.length)),
			...readFs(node),
		} as WitnessNode;
		for (const { key, subtype } of TOKEN_LISTS) {
			const list = tokenLists.get(`#${node.getAttribute('xml:id')}|${subtype ?? ''}`);
			if (list)
				witness[key] = children(list, 'w').map((token, index) =>
					readToken(token, witness, index)
				);
		}
		return witness;
	});

	const collation = readFs(byType(standOff, 'fs', 'collation')[0]);
	const alignmentFs = byType(standOff, 'fs', 'alignment')[0];
	const alignmentFields = readFs(alignmentFs);
	const alignmentSeg = byType(standOff, 'seg', 'alignment')[0];
	const units = byType(standOff, 'fs', 'unit-decisions').map(node => {
		const { id, ...fields } = readFs(node);
		const unitId = decodePersistentId(node.getAttribute('sameAs') ?? '');
		return { type: 'variationUnit', id: id ?? unitId, unitId, ...fields } as ApparatusUnitNode;
	});
	const stemmaUnits = byType(standOff, 'fs', 'stemma-unit').map(node => {
		const { id, ...fields } = readFs(node);
		const unitId = decodePersistentId(node.getAttribute('sameAs') ?? '');
		return { type: 'stemmaUnit', id: id ?? unitId, unitId, ...fields } as StemmaUnitNode;
	});
	const importNotes: ImportNote[] = byType(standOff, 'note', 'import').map(node => {
		const unitId = node.getAttribute('n');
		return {
			id: decodePersistentId(node.getAttribute('sameAs') ?? ''),
			unitId: unitId ? decodePersistentId(unitId) : null,
			detail: readText(node),
		};
	});

	return {
		type: 'collationDocument',
		version: 1,
		...(importNotes.length > 0 || collation.importNotes ? { importNotes } : {}),
		meta: {
			collationId: collation.collationId as string | null,
			projectId: collation.projectId as string | null,
			projectName: collation.projectName as string | null,
		},
		flow: readFs(byType(standOff, 'fs', 'workflow')[0]) as CollationDocument['flow'],
		setup: {
			segment: collation.segment as CollationDocument['setup']['segment'],
			witnesses,
			...(collation.manualWitnessOverrides
				? {
						manualWitnessOverrides:
							collation.manualWitnessOverrides as CollationDocument['setup']['manualWitnessOverrides'],
					}
				: {}),
		},
		settings: {
			regularizationRules: readRules(root),
			...readFs(byType(standOff, 'fs', 'collation-settings')[0]),
		} as CollationDocument['settings'],
		alignment: alignmentFs
			? {
					type: 'alignment',
					witnessOrder: alignmentFields.witnessOrder as string[],
					columns: alignmentSeg ? readColumns(alignmentSeg) : [],
					...(alignmentFields.declaredUnits
						? {
								declaredUnits: alignmentFields.declaredUnits as NonNullable<
									CollationDocument['alignment']
								>['declaredUnits'],
							}
						: {}),
				}
			: null,
		apparatus:
			units.length > 0 || collation.emptyApparatus ? { type: 'apparatus', units } : null,
		stemma:
			stemmaUnits.length > 0 || collation.emptyStemma
				? { type: 'stemma', units: stemmaUnits }
				: null,
	};
}
