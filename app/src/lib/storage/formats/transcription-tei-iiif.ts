import type { TeiElementNode, TeiNode, TranscriptionPage } from '@apatosaurus/tei-transcription';

import type { JsonObject, JsonValue } from '../envelope';
import type { ProjectTranscriptionPayload } from './project-transcription';

export type TranscriptionIiif = Pick<
	ProjectTranscriptionPayload,
	'iiif_manifest_sources' | 'page_canvas_links' | 'canvas_annotations'
>;
type ManifestSource = TranscriptionIiif['iiif_manifest_sources'][number];
type SyntheticCanvas = ManifestSource['synthetic_canvases'][number];
type PageCanvasLink = TranscriptionIiif['page_canvas_links'][number];
type CanvasAnnotation = TranscriptionIiif['canvas_annotations'][number];

const STANDOFF_TYPE = 'apatosaurus-iiif';
const FACSIMILE_ID_PREFIX = 'iiif-';
const LINK_ID_PREFIX = 'canvas-';
const ANNOTATION_ID_PREFIX = 'annotation-';
const MANIFEST_SURFACE = 'iiif-manifest';
const DEFAULT_CANVAS_SURFACE = 'default-canvas';
const SYNTHETIC_CANVAS_SURFACE = 'canvas';
const SOURCE_KIND_DESC = 'source-kind';
const DEFAULT_IMAGE_GRAPHIC = 'default-image-service';
const THUMBNAIL_GRAPHIC = 'thumbnail';
const PAGE_LABEL = 'page';
const STATE_FS = 'apatosaurus';
const ANCHOR_NOTE = 'apatosaurus-anchor';
const STATE_NOTE = 'apatosaurus-annotation';
const MEDIA_FRAGMENTS = 'http://www.w3.org/TR/media-frags/';
const ANCHOR_POINTERS = [
	['pageId', 'page'],
	['columnId', 'column'],
	['lineId', 'line'],
	['lineEndId', 'line-end'],
	['marginaliaId', 'marginalia'],
] as const;

export function isAppIiifNode(node: TeiElementNode): boolean {
	return (
		(node.tag === 'facsimile' &&
			Boolean(node.attrs?.['xml:id']?.startsWith(FACSIMILE_ID_PREFIX))) ||
		(node.tag === 'standOff' && node.attrs?.type === STANDOFF_TYPE)
	);
}

export function buildIiifNodes(iiif: TranscriptionIiif): TeiElementNode[] {
	const sources = [...iiif.iiif_manifest_sources].sort(compareIds);
	const links = [...iiif.page_canvas_links].sort(comparePageCanvasLinks);
	const annotations = [...iiif.canvas_annotations].sort(compareCanvasAnnotations);
	const facsimiles = sources.map(source =>
		facsimileNode(
			source,
			links.filter(link => link.manifest_source_id === source.id)
		)
	);
	if (annotations.length === 0) return facsimiles;
	return [
		...facsimiles,
		element('standOff', { type: STANDOFF_TYPE }, [
			element(
				'listAnnotation',
				{},
				annotations.map(annotation => annotationNode(annotation, links))
			),
		]),
	];
}

export function withIiifPageFacs(
	pages: TranscriptionPage[],
	links: PageCanvasLink[]
): TranscriptionPage[] {
	const pointers = new Map<string, string[]>();
	for (const link of [...links].sort(comparePageCanvasLinks)) {
		pointers.set(link.page_id, [
			...(pointers.get(link.page_id) ?? []),
			`#${LINK_ID_PREFIX}${link.id}`,
		]);
	}
	return pages.map(page => {
		const appFacs = page.pageId ? pointers.get(page.pageId) : undefined;
		if (!appFacs) return page;
		const facs = [
			...facsTokens(page.teiAttrs?.facs).filter(token => !appFacs.includes(token)),
			...appFacs,
		].join(' ');
		return { ...page, teiAttrs: { ...pbAttrsAsSerialized(page), facs } };
	});
}

// Mirrors the attributes the pb serializer adds so a parsed pb keeps the same attribute order.
function pbAttrsAsSerialized(page: TranscriptionPage): Record<string, string> {
	const attrs: Record<string, string> = { ...(page.teiAttrs ?? { type: 'folio' }) };
	attrs['xml:id'] ??= page.pageId!;
	if (attrs.n === undefined && page.id) attrs.n = page.id;
	if (attrs.break === undefined && page.wrapped) attrs.break = 'no';
	return attrs;
}

export function withoutIiifPageFacs(
	pages: TranscriptionPage[],
	appSurfaceIds: Set<string>
): TranscriptionPage[] {
	const isAppFacs = (token: string) => token.startsWith('#') && appSurfaceIds.has(token.slice(1));
	return pages.map(page => {
		const tokens = facsTokens(page.teiAttrs?.facs);
		if (!tokens.some(isAppFacs)) return page;
		const kept = tokens.filter(token => !isAppFacs(token)).join(' ');
		const teiAttrs = Object.fromEntries(
			Object.entries(page.teiAttrs!).flatMap(([key, value]) =>
				key !== 'facs' ? [[key, value]] : kept ? [[key, kept]] : []
			)
		);
		return Object.keys(teiAttrs).length > 0
			? { ...page, teiAttrs }
			: { ...page, teiAttrs: undefined };
	});
}

export function parseIiifNodes(nodes: TeiElementNode[]): TranscriptionIiif {
	const sources: ManifestSource[] = [];
	const links: PageCanvasLink[] = [];
	const annotations: CanvasAnnotation[] = [];
	for (const facsimile of nodes.filter(node => node.tag === 'facsimile')) {
		const parsed = parseFacsimile(facsimile);
		sources.push(parsed.source);
		links.push(...parsed.links);
	}
	const linkById = new Map(links.map(link => [link.id, link]));
	for (const standOff of nodes.filter(node => node.tag === 'standOff')) {
		for (const list of children(standOff, 'listAnnotation')) {
			for (const annotation of children(list, 'annotation')) {
				annotations.push(parseAnnotation(annotation, linkById));
			}
		}
	}
	return {
		iiif_manifest_sources: sources.sort(compareIds),
		page_canvas_links: links.sort(comparePageCanvasLinks),
		canvas_annotations: annotations.sort(compareCanvasAnnotations),
	};
}

function facsimileNode(source: ManifestSource, links: PageCanvasLink[]): TeiElementNode {
	const overflow: TeiElementNode[] = [];
	const manifestUrl = attr(overflow, 'manifestUrl', source.manifest_url);
	const defaultImage = attr(overflow, 'defaultImageServiceUrl', source.default_image_service_url);
	const defaultCanvas = attr(overflow, 'defaultCanvasId', source.default_canvas_id);
	const manifestSurface = element('surface', { type: MANIFEST_SURFACE }, [
		element('label', {}, text(source.label)),
		element('desc', { type: SOURCE_KIND_DESC }, text(source.source_kind)),
		defaultImage
			? element('graphic', { type: DEFAULT_IMAGE_GRAPHIC, url: defaultImage })
			: null,
		stateFs(overflow),
		defaultCanvas
			? element('surface', { type: DEFAULT_CANVAS_SURFACE, sameAs: defaultCanvas })
			: null,
	]);
	return element(
		'facsimile',
		{ 'xml:id': `${FACSIMILE_ID_PREFIX}${source.id}`, sameAs: manifestUrl },
		[
			manifestSurface,
			...source.synthetic_canvases.map(syntheticCanvasNode),
			...links.map(link => linkSurfaceNode(link, source)),
		]
	);
}

function syntheticCanvasNode(canvas: SyntheticCanvas): TeiElementNode {
	const overflow: TeiElementNode[] = [];
	const canvasId = attr(overflow, 'canvasId', canvas.canvas_id);
	const imageUrl = attr(overflow, 'imageUrl', canvas.image_url);
	const thumbnailUrl = attr(overflow, 'thumbnailUrl', canvas.thumbnail_url);
	overflow.push(
		feature('width', jsonNode(canvas.width)),
		feature('height', jsonNode(canvas.height))
	);
	const metadataTypes = canvas.metadata.map(item => isAttrSafe(item.label));
	if (!metadataTypes.every(Boolean)) {
		overflow.push(feature('metadata', jsonNode(canvas.metadata as unknown as JsonValue)));
	}
	return element('surface', { type: SYNTHETIC_CANVAS_SURFACE, sameAs: canvasId }, [
		element('label', {}, text(canvas.label)),
		imageUrl ? element('graphic', { url: imageUrl }) : null,
		thumbnailUrl ? element('graphic', { type: THUMBNAIL_GRAPHIC, url: thumbnailUrl }) : null,
		...(metadataTypes.every(Boolean)
			? canvas.metadata.map(item => element('desc', { type: item.label }, text(item.value)))
			: []),
		stateFs(overflow),
	]);
}

function linkSurfaceNode(link: PageCanvasLink, source: ManifestSource): TeiElementNode {
	const overflow: TeiElementNode[] = [];
	const canvasId = attr(overflow, 'canvasId', link.canvas_id);
	const canvasLabel = attr(overflow, 'canvasLabel', link.canvas_label);
	const linkRole = attr(overflow, 'linkRole', link.link_role);
	const pageId = pointerAttr(overflow, 'pageId', link.page_id);
	const imageUrl = attr(overflow, 'imageServiceUrl', link.image_service_url);
	const thumbnailUrl = attr(overflow, 'thumbnailUrl', link.thumbnail_url);
	overflow.push(
		feature('pageOrder', jsonNode(link.page_order)),
		feature('canvasOrder', jsonNode(link.canvas_order))
	);
	if (link.manifest_url_snapshot !== source.manifest_url) {
		overflow.push(feature('manifestUrlSnapshot', jsonNode(link.manifest_url_snapshot)));
	}
	return element(
		'surface',
		{
			'xml:id': `${LINK_ID_PREFIX}${link.id}`,
			sameAs: canvasId,
			n: canvasLabel,
			type: linkRole,
			corresp: pageId ? `#${pageId}` : undefined,
		},
		[
			element('label', { type: PAGE_LABEL }, text(link.page_name_snapshot)),
			imageUrl ? element('graphic', { url: imageUrl }) : null,
			thumbnailUrl
				? element('graphic', { type: THUMBNAIL_GRAPHIC, url: thumbnailUrl })
				: null,
			stateFs(overflow),
		]
	);
}

function annotationNode(annotation: CanvasAnnotation, links: PageCanvasLink[]): TeiElementNode {
	const overflow: TeiElementNode[] = [];
	const sameCanvas = links.filter(
		link =>
			link.manifest_source_id === annotation.manifest_source_id &&
			link.canvas_id === annotation.canvas_id
	);
	const link = sameCanvas.find(entry => entry.page_id === annotation.page_id) ?? sameCanvas[0];
	const canvasPointer =
		isPointerSafe(annotation.canvas_id) && !annotation.canvas_id.includes('#');
	if (!link && !canvasPointer) overflow.push(feature('canvasId', jsonNode(annotation.canvas_id)));
	if ((link?.page_id ?? null) !== annotation.page_id) {
		overflow.push(feature('pageId', jsonNode(annotation.page_id)));
	}
	if (annotation.annotation_kind !== null) {
		overflow.push(feature('kind', jsonNode(annotation.annotation_kind)));
	}
	const motivation = attr(overflow, 'motivation', annotation.motivation);
	const annotationId = attr(overflow, 'annotationId', annotation.annotation_id);
	const createdBy = pointerAttr(overflow, 'createdBy', annotation.created_by);

	const fragment = fragmentSelectorValue(annotation.target_json);
	const nativeTarget =
		canvasPointer &&
		canonical(annotation.target_json) ===
			canonical(targetFromPointer(annotation.canvas_id, fragment));
	if (!nativeTarget) overflow.push(feature('target', jsonNode(annotation.target_json)));
	const target = [
		link
			? `#${LINK_ID_PREFIX}${link.id}`
			: `#${FACSIMILE_ID_PREFIX}${annotation.manifest_source_id}`,
		canvasPointer ? `${annotation.canvas_id}${fragment ? `#${fragment}` : ''}` : null,
	]
		.filter(Boolean)
		.join(' ');

	const bodyNotes = nativeBodyNotes(annotation.body_json);
	if (!bodyNotes) overflow.push(feature('body', jsonNode(annotation.body_json)));

	const anchor = annotation.anchor_json;
	const anchorNote = isObject(anchor) ? anchorNoteNode(anchor) : null;
	if (!isObject(anchor) && anchor !== null) {
		overflow.push(feature('anchor', jsonNode(anchor)));
	}

	return element(
		'annotation',
		{
			'xml:id': `${ANNOTATION_ID_PREFIX}${annotation.id}`,
			n: annotationId,
			motivation,
			target,
			resp: createdBy,
		},
		[
			...(bodyNotes ?? []),
			anchorNote,
			overflow.length > 0 ? element('note', { type: STATE_NOTE }, [stateFs(overflow)]) : null,
		]
	);
}

function nativeBodyNotes(body: JsonValue): TeiElementNode[] | null {
	if (!Array.isArray(body)) return null;
	const notes: TeiElementNode[] = [];
	for (const entry of body) {
		if (!isObject(entry) || entry.type !== 'TextualBody' || typeof entry.value !== 'string') {
			return null;
		}
		const { type: _type, value, format, purpose, language, ...rest } = entry;
		if (Object.keys(rest).length > 0) return null;
		const attrs = { type: format, subtype: purpose, 'xml:lang': language };
		if (Object.values(attrs).some(item => item !== undefined && !isAttrSafe(String(item)))) {
			return null;
		}
		if (format === ANCHOR_NOTE || format === STATE_NOTE) return null;
		notes.push(element('note', attrs as Record<string, string | undefined>, text(value)));
	}
	return notes;
}

function anchorNoteNode(anchor: JsonObject): TeiElementNode {
	const rest: JsonObject = { ...anchor };
	const pointers: TeiElementNode[] = [];
	for (const [key, type] of ANCHOR_POINTERS) {
		const value = anchor[key];
		if (typeof value !== 'string' || !isPointerSafe(value)) continue;
		pointers.push(element('ptr', { type, target: `#${value}` }));
		delete rest[key];
	}
	const role =
		typeof anchor.role === 'string' && isAttrSafe(anchor.role) ? anchor.role : undefined;
	if (role !== undefined) delete rest.role;
	const quote = typeof anchor.quote === 'string' ? anchor.quote : undefined;
	if (quote !== undefined) delete rest.quote;
	return element('note', { type: ANCHOR_NOTE, subtype: role }, [
		...pointers,
		quote === undefined ? null : element('quote', {}, text(quote)),
		Object.keys(rest).length > 0 ? jsonNode(rest) : null,
	]);
}

function parseFacsimile(facsimile: TeiElementNode): {
	source: ManifestSource;
	links: PageCanvasLink[];
} {
	const id = facsimile.attrs!['xml:id']!.slice(FACSIMILE_ID_PREFIX.length);
	const surfaces = children(facsimile, 'surface');
	const manifest = surfaces.find(node => node.attrs?.type === MANIFEST_SURFACE);
	const overflow = readStateFs(manifest);
	const manifestUrl = take(overflow, 'manifestUrl', facsimile.attrs?.sameAs) ?? '';
	const source: ManifestSource = {
		id,
		manifest_url: manifestUrl,
		label: textContent(child(manifest, 'label')),
		source_kind: textContent(
			children(manifest, 'desc').find(node => node.attrs?.type === SOURCE_KIND_DESC)
		),
		default_canvas_id: take(
			overflow,
			'defaultCanvasId',
			children(manifest, 'surface').find(node => node.attrs?.type === DEFAULT_CANVAS_SURFACE)
				?.attrs?.sameAs
		),
		default_image_service_url: take(
			overflow,
			'defaultImageServiceUrl',
			graphicUrl(manifest, DEFAULT_IMAGE_GRAPHIC)
		),
		synthetic_canvases: surfaces
			.filter(node => node.attrs?.type === SYNTHETIC_CANVAS_SURFACE)
			.map(parseSyntheticCanvas),
	};
	const links = surfaces
		.filter(node => node.attrs?.['xml:id']?.startsWith(LINK_ID_PREFIX))
		.map(node => parseLinkSurface(node, source));
	return { source, links };
}

function parseSyntheticCanvas(surface: TeiElementNode): SyntheticCanvas {
	const overflow = readStateFs(surface);
	const metadata = overflow.metadata;
	return {
		canvas_id: take(overflow, 'canvasId', surface.attrs?.sameAs) ?? '',
		label: textContent(child(surface, 'label')),
		width: overflow.width as number,
		height: overflow.height as number,
		image_url: take(overflow, 'imageUrl', graphicUrl(surface, undefined)) ?? '',
		thumbnail_url: take(overflow, 'thumbnailUrl', graphicUrl(surface, THUMBNAIL_GRAPHIC)),
		metadata:
			metadata !== undefined
				? (metadata as SyntheticCanvas['metadata'])
				: children(surface, 'desc').map(node => ({
						label: node.attrs?.type ?? '',
						value: textContent(node),
					})),
	};
}

function parseLinkSurface(surface: TeiElementNode, source: ManifestSource): PageCanvasLink {
	const overflow = readStateFs(surface);
	const corresp = surface.attrs?.corresp;
	return {
		id: surface.attrs!['xml:id']!.slice(LINK_ID_PREFIX.length),
		page_id:
			take(overflow, 'pageId', corresp?.startsWith('#') ? corresp.slice(1) : undefined) ?? '',
		page_name_snapshot: textContent(
			children(surface, 'label').find(node => node.attrs?.type === PAGE_LABEL)
		),
		page_order: overflow.pageOrder as number,
		manifest_source_id: source.id,
		manifest_url_snapshot:
			(overflow.manifestUrlSnapshot as string | undefined) ?? source.manifest_url,
		canvas_id: take(overflow, 'canvasId', surface.attrs?.sameAs) ?? '',
		canvas_order: overflow.canvasOrder as number,
		canvas_label: take(overflow, 'canvasLabel', surface.attrs?.n) ?? '',
		image_service_url: take(overflow, 'imageServiceUrl', graphicUrl(surface, undefined)),
		thumbnail_url: take(overflow, 'thumbnailUrl', graphicUrl(surface, THUMBNAIL_GRAPHIC)),
		link_role: take(overflow, 'linkRole', surface.attrs?.type) ?? '',
	};
}

function parseAnnotation(
	annotation: TeiElementNode,
	linkById: Map<string, PageCanvasLink>
): CanvasAnnotation {
	const notes = children(annotation, 'note');
	const stateNote = notes.find(node => node.attrs?.type === STATE_NOTE);
	const anchorNote = notes.find(node => node.attrs?.type === ANCHOR_NOTE);
	const bodyNotes = notes.filter(node => node !== stateNote && node !== anchorNote);
	const overflow = readStateFs(stateNote);
	const [surfacePointer = '', canvasPointer] = (annotation.attrs?.target ?? '').split(/\s+/);
	const link = surfacePointer.startsWith(`#${LINK_ID_PREFIX}`)
		? linkById.get(surfacePointer.slice(LINK_ID_PREFIX.length + 1))
		: undefined;
	const hashIndex = canvasPointer?.indexOf('#') ?? -1;
	const pointerCanvas = hashIndex === -1 ? canvasPointer : canvasPointer!.slice(0, hashIndex);
	const fragment = hashIndex === -1 ? null : canvasPointer!.slice(hashIndex + 1);
	const canvasId =
		(overflow.canvasId as string | undefined) ?? link?.canvas_id ?? pointerCanvas ?? '';
	return {
		id: annotation.attrs!['xml:id']!.slice(ANNOTATION_ID_PREFIX.length),
		manifest_source_id:
			link?.manifest_source_id ?? surfacePointer.slice(FACSIMILE_ID_PREFIX.length + 1),
		canvas_id: canvasId,
		page_id:
			'pageId' in overflow ? (overflow.pageId as string | null) : (link?.page_id ?? null),
		annotation_id: take(overflow, 'annotationId', annotation.attrs?.n) ?? '',
		annotation_kind: 'kind' in overflow ? (overflow.kind as string | null) : null,
		body_json:
			'body' in overflow
				? overflow.body
				: bodyNotes.map(note => ({
						type: 'TextualBody',
						value: textContent(note),
						...(note.attrs?.type !== undefined ? { format: note.attrs.type } : {}),
						...(note.attrs?.subtype !== undefined
							? { purpose: note.attrs.subtype }
							: {}),
						...(note.attrs?.['xml:lang'] !== undefined
							? { language: note.attrs['xml:lang'] }
							: {}),
					})),
		target_json: 'target' in overflow ? overflow.target : targetFromPointer(canvasId, fragment),
		anchor_json: anchorNote
			? parseAnchorNote(anchorNote)
			: 'anchor' in overflow
				? overflow.anchor
				: null,
		motivation: take(overflow, 'motivation', annotation.attrs?.motivation) ?? '',
		created_by: take(overflow, 'createdBy', annotation.attrs?.resp),
	};
}

function parseAnchorNote(note: TeiElementNode): JsonObject {
	const fs = child(note, 'fs');
	const anchor: JsonObject = fs ? (fsToJson(fs) as JsonObject) : {};
	for (const ptr of children(note, 'ptr')) {
		const key = ANCHOR_POINTERS.find(([, type]) => type === ptr.attrs?.type)?.[0];
		if (key && ptr.attrs?.target?.startsWith('#')) anchor[key] = ptr.attrs.target.slice(1);
	}
	if (note.attrs?.subtype !== undefined) anchor.role = note.attrs.subtype;
	const quote = child(note, 'quote');
	if (quote) anchor.quote = textContent(quote);
	return anchor;
}

function fragmentSelectorValue(target: JsonValue): string | null {
	if (!isObject(target) || !isObject(target.selector)) return null;
	const { type, value } = target.selector;
	return type === 'FragmentSelector' && typeof value === 'string' && isPointerSafe(value)
		? value
		: null;
}

function targetFromPointer(canvasId: string, fragment: string | null): JsonObject {
	return fragment === null
		? { source: canvasId }
		: {
				source: canvasId,
				selector: {
					type: 'FragmentSelector',
					conformsTo: MEDIA_FRAGMENTS,
					value: fragment,
				},
			};
}

// Values that attributes cannot carry losslessly go to the element's feature structure.
function attr(overflow: TeiElementNode[], name: string, value: string | null): string | undefined {
	if (value === null) return undefined;
	if (isAttrSafe(value)) return value;
	overflow.push(feature(name, jsonNode(value)));
	return undefined;
}

function pointerAttr(
	overflow: TeiElementNode[],
	name: string,
	value: string | null
): string | undefined {
	if (value === null) return undefined;
	if (isPointerSafe(value)) return value;
	overflow.push(feature(name, jsonNode(value)));
	return undefined;
}

function take(
	overflow: Record<string, JsonValue>,
	name: string,
	attrValue: string | undefined
): string | null {
	if (name in overflow) return overflow[name] as string | null;
	return attrValue ?? null;
}

function isAttrSafe(value: string): boolean {
	return value !== '' && !/[\t\n\r]/.test(value);
}

function isPointerSafe(value: string): boolean {
	return value !== '' && !/\s/.test(value);
}

function stateFs(features: TeiElementNode[]): TeiElementNode | null {
	return features.length > 0 ? element('fs', { type: STATE_FS }, features) : null;
}

function readStateFs(node: TeiElementNode | undefined): Record<string, JsonValue> {
	const fs = children(node, 'fs').find(entry => entry.attrs?.type === STATE_FS);
	return fs ? (fsToJson(fs) as Record<string, JsonValue>) : {};
}

function feature(name: string, value: TeiElementNode): TeiElementNode {
	return element('f', { name }, [value]);
}

// Encodes JSON as TEI feature-structure values so no JSON text is embedded.
function jsonNode(value: JsonValue): TeiElementNode {
	if (value === null) return element('symbol', { value: 'null' });
	if (typeof value === 'string') return element('string', {}, text(value));
	if (typeof value === 'number') return element('numeric', { value: String(value) });
	if (typeof value === 'boolean') return element('binary', { value: String(value) });
	if (Array.isArray(value)) return element('vColl', { org: 'list' }, value.map(jsonNode));
	return element(
		'fs',
		{},
		Object.keys(value)
			.sort()
			.map(key => feature(key, jsonNode(value[key])))
	);
}

function fsToJson(node: TeiElementNode): JsonValue {
	switch (node.tag) {
		case 'symbol':
			return null;
		case 'string':
			return textContent(node);
		case 'numeric':
			return Number(node.attrs?.value);
		case 'binary':
			return node.attrs?.value === 'true';
		case 'vColl':
			return children(node).map(fsToJson);
		default:
			return Object.fromEntries(
				children(node, 'f').map(entry => [
					entry.attrs?.name ?? '',
					fsToJson(children(entry)[0] ?? element('string')),
				])
			);
	}
}

function canonical(value: JsonValue): string {
	return JSON.stringify(jsonNode(value));
}

function isObject(value: JsonValue | undefined): value is JsonObject {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function facsTokens(facs: string | undefined): string[] {
	return facs ? facs.split(/\s+/).filter(Boolean) : [];
}

function graphicUrl(
	node: TeiElementNode | undefined,
	type: string | undefined
): string | undefined {
	return children(node, 'graphic').find(entry => entry.attrs?.type === type)?.attrs?.url;
}

function compareStrings(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function compareIds(left: { id: string }, right: { id: string }): number {
	return compareStrings(left.id, right.id);
}

function comparePageCanvasLinks(left: PageCanvasLink, right: PageCanvasLink): number {
	return (
		left.page_order - right.page_order ||
		left.canvas_order - right.canvas_order ||
		compareStrings(left.id, right.id)
	);
}

function compareCanvasAnnotations(left: CanvasAnnotation, right: CanvasAnnotation): number {
	return (
		compareStrings(left.annotation_id, right.annotation_id) || compareStrings(left.id, right.id)
	);
}

function element(
	tag: string,
	attrs: Record<string, string | undefined> = {},
	nodeChildren: Array<TeiNode | null> = []
): TeiElementNode {
	const definedAttrs = Object.fromEntries(
		Object.entries(attrs).filter((entry): entry is [string, string] => entry[1] !== undefined)
	);
	const kids = nodeChildren.filter(node => node !== null);
	return {
		type: 'element',
		tag,
		...(Object.keys(definedAttrs).length ? { attrs: definedAttrs } : {}),
		...(kids.length ? { children: kids } : {}),
	};
}

function text(value: string): TeiNode[] {
	return value ? [{ type: 'text', text: value }] : [];
}

function textContent(node: TeiNode | undefined): string {
	if (!node) return '';
	if (node.type === 'text') return node.text;
	return (node.children ?? []).map(textContent).join('');
}

function children(node: TeiElementNode | undefined, tag?: string): TeiElementNode[] {
	return (node?.children ?? []).filter(
		(entry): entry is TeiElementNode =>
			entry.type === 'element' && (tag === undefined || entry.tag === tag)
	);
}

function child(node: TeiElementNode | undefined, tag: string): TeiElementNode | undefined {
	return children(node, tag)[0];
}
