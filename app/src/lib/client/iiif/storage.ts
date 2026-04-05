import { ensureDjazzkitRuntime } from '$lib/client/djazzkit-runtime';
import { IiifCanvasAnnotation } from '$generated/models/IiifCanvasAnnotation';
import { IiifManifestSource } from '$generated/models/IiifManifestSource';
import { TranscriptionPageCanvasLink } from '$generated/models/TranscriptionPageCanvasLink';
import type { W3CAnnotation, W3CAnnotationBody } from 'triiiceratops/plugins/annotation-editor';

import type {
	AnnotationAnchor,
	ManifestSourceSummary,
	PageCanvasLink,
	SavePageCanvasLinkInput,
} from './types';

function nowIso(): string {
	return new Date().toISOString();
}

function createDjazzkitFields(id: string, timestamp: string) {
	return {
		_djazzkit_id: id,
		_djazzkit_rev: 0,
		_djazzkit_deleted: false,
		_djazzkit_updated_at: timestamp,
	};
}

function safeJsonParse<T>(value: string, fallback: T): T {
	try {
		return JSON.parse(value) as T;
	} catch {
		return fallback;
	}
}

function rowToManifestSource(row: any): ManifestSourceSummary {
	const metadata = safeJsonParse<Record<string, unknown>>(row.metadata_json || '{}', {});
	const manifestJson =
		metadata.manifestJson && typeof metadata.manifestJson === 'object'
			? (metadata.manifestJson as Record<string, any>)
			: null;
	return {
		id: row._djazzkit_id,
		transcriptionId: row.transcription_id,
		manifestUrl: row.manifest_url,
		label: row.label,
		sourceKind: row.source_kind,
		defaultCanvasId: row.default_canvas_id || null,
		defaultImageServiceUrl: row.default_image_service_url || null,
		manifestJson,
		metadata,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function rowToPageCanvasLink(row: any): PageCanvasLink {
	return {
		id: row._djazzkit_id,
		transcriptionId: row.transcription_id,
		pageId: row.page_id,
		pageNameSnapshot: row.page_name_snapshot,
		pageOrder: row.page_order,
		manifestSourceId: row.manifest_source_id,
		manifestUrlSnapshot: row.manifest_url_snapshot,
		canvasId: row.canvas_id,
		canvasOrder: row.canvas_order,
		canvasLabel: row.canvas_label,
		imageServiceUrl: row.image_service_url || null,
		thumbnailUrl: row.thumbnail_url || null,
		linkRole: row.link_role,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function normalizeAnnotationBodies(body: unknown): W3CAnnotationBody[] {
	if (Array.isArray(body)) return body as W3CAnnotationBody[];
	if (body && typeof body === 'object') return [body as W3CAnnotationBody];
	return [];
}

function truncateAnnotationText(value: string, maxLength: number): string {
	if (value.length <= maxLength) return value;
	return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`;
}

function buildPreviewBodies(body: unknown, maxLength: number): {
	bodies: W3CAnnotationBody[];
	preview: string | null;
} {
	const normalized = normalizeAnnotationBodies(body);
	const preview = normalized
		.map((entry) => (typeof entry.value === 'string' ? entry.value.trim() : ''))
		.find((value) => value.length > 0) || null;

	const bodies = normalized.map((entry) => {
		if (typeof entry.value !== 'string') {
			return { ...entry };
		}
		return {
			...entry,
			value: truncateAnnotationText(entry.value, maxLength),
		};
	});

	return { bodies, preview };
}

function rowToCanvasAnnotation(
	row: any,
	options: { mode: 'headers' | 'full'; previewLength: number }
): W3CAnnotation {
	const rawBody = safeJsonParse(row.body_json || '[]', []);
	const { bodies, preview } =
		options.mode === 'full'
			? {
				bodies: normalizeAnnotationBodies(rawBody),
				preview:
					normalizeAnnotationBodies(rawBody)
						.map((entry) => (typeof entry.value === 'string' ? entry.value.trim() : ''))
						.find((value) => value.length > 0) || null,
			  }
			: buildPreviewBodies(rawBody, options.previewLength);

	return {
		'@context': 'http://www.w3.org/ns/anno.jsonld',
		id: row.annotation_id,
		type: 'Annotation',
		body: bodies,
		target: safeJsonParse(row.target_json || '{}', { source: row.canvas_id }),
		created: row.created_at,
		modified: row.updated_at,
		motivation: row.motivation || 'commenting',
		creator: row.created_by ? { id: row.created_by, name: row.created_by } : undefined,
		apatopwa: {
			anchor: safeJsonParse(row.anchor_json || 'null', null),
			annotationKind: row.annotation_kind || null,
			createdBy: row.created_by || null,
		},
		__fullBodyLoaded: options.mode === 'full',
		__bodyPreview: preview,
	};
}

export async function listManifestSources(transcriptionId: string): Promise<ManifestSourceSummary[]> {
	await ensureDjazzkitRuntime();
	const rows = await IiifManifestSource.objects
		.filter(fields => fields.transcription_id.eq(transcriptionId))
		.filter(fields => fields._djazzkit_deleted.eq(false))
		.all();

	return rows
		.map(rowToManifestSource)
		.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function listManifestSourcesForUrl(
	transcriptionId: string,
	manifestUrl: string
): Promise<ManifestSourceSummary[]> {
	await ensureDjazzkitRuntime();
	const rows = await IiifManifestSource.objects
		.filter(fields => fields.transcription_id.eq(transcriptionId))
		.filter(fields => fields.manifest_url.eq(manifestUrl))
		.filter(fields => fields._djazzkit_deleted.eq(false))
		.all();
	return rows.map(rowToManifestSource);
}

export async function ensureManifestSource(input: {
	transcriptionId: string;
	manifestUrl: string;
	label?: string;
	sourceKind?: 'external' | 'app';
	defaultCanvasId?: string | null;
	defaultImageServiceUrl?: string | null;
	manifestJson?: Record<string, any> | null;
	metadata?: Record<string, unknown>;
}): Promise<ManifestSourceSummary> {
	await ensureDjazzkitRuntime();
	const existing = await IiifManifestSource.objects
		.filter(fields => fields.transcription_id.eq(input.transcriptionId))
		.filter(fields => fields.manifest_url.eq(input.manifestUrl))
		.filter(fields => fields._djazzkit_deleted.eq(false))
		.first();

	const existingMetadata = safeJsonParse<Record<string, unknown>>(existing?.metadata_json || '{}', {});
	const mergedMetadata = {
		...existingMetadata,
		...(input.metadata || {}),
		...(input.manifestJson ? { manifestJson: input.manifestJson } : {}),
	};

	const timestamp = nowIso();
	const payload = {
		transcription_id: input.transcriptionId,
		manifest_url: input.manifestUrl,
		label: input.label || input.manifestUrl,
		source_kind: input.sourceKind || 'external',
		default_canvas_id: input.defaultCanvasId || null,
		default_image_service_url: input.defaultImageServiceUrl || null,
		metadata_json: JSON.stringify(mergedMetadata),
		updated_at: timestamp,
		_djazzkit_updated_at: timestamp,
	};

	if (existing?._djazzkit_id) {
		await IiifManifestSource.objects.update(existing._djazzkit_id, payload);
		const refreshed = await IiifManifestSource.objects
			.filter(fields => fields._djazzkit_id.eq(existing._djazzkit_id))
			.first();
		return rowToManifestSource(refreshed);
	}

	const id = crypto.randomUUID();
	await IiifManifestSource.objects.create({
		...createDjazzkitFields(id, timestamp),
		created_at: timestamp,
		...payload,
	});
	const created = await IiifManifestSource.objects.filter(fields => fields._djazzkit_id.eq(id)).first();
	return rowToManifestSource(created);
}

export async function getManifestSource(
	transcriptionId: string,
	manifestSourceId: string
): Promise<ManifestSourceSummary | null> {
	await ensureDjazzkitRuntime();
	const row = await IiifManifestSource.objects
		.filter(fields => fields.transcription_id.eq(transcriptionId))
		.filter(fields => fields._djazzkit_id.eq(manifestSourceId))
		.filter(fields => fields._djazzkit_deleted.eq(false))
		.first();
	return row ? rowToManifestSource(row) : null;
}

export async function listPageCanvasLinks(transcriptionId: string): Promise<PageCanvasLink[]> {
	await ensureDjazzkitRuntime();
	const rows = await TranscriptionPageCanvasLink.objects
		.filter(fields => fields.transcription_id.eq(transcriptionId))
		.filter(fields => fields._djazzkit_deleted.eq(false))
		.all();

	return rows
		.map(rowToPageCanvasLink)
		.sort((a, b) => a.pageOrder - b.pageOrder || a.canvasOrder - b.canvasOrder);
}

export async function upsertPageCanvasLink(input: SavePageCanvasLinkInput): Promise<PageCanvasLink> {
	await ensureDjazzkitRuntime();
	const existingRows = await TranscriptionPageCanvasLink.objects
		.filter(fields => fields.transcription_id.eq(input.transcriptionId))
		.filter(fields => fields.page_id.eq(input.pageId))
		.filter(fields => fields.manifest_source_id.eq(input.manifestSourceId))
		.filter(fields => fields.link_role.eq(input.linkRole || 'primary'))
		.filter(fields => fields._djazzkit_deleted.eq(false))
		.all();

	const timestamp = nowIso();
	const payload = {
		transcription_id: input.transcriptionId,
		page_id: input.pageId,
		page_name_snapshot: input.pageNameSnapshot,
		page_order: input.pageOrder,
		manifest_source_id: input.manifestSourceId,
		manifest_url_snapshot: input.manifestUrlSnapshot,
		canvas_id: input.canvasId,
		canvas_order: input.canvasOrder,
		canvas_label: input.canvasLabel,
		image_service_url: input.imageServiceUrl,
		thumbnail_url: input.thumbnailUrl,
		link_role: input.linkRole || 'primary',
		updated_at: timestamp,
		_djazzkit_updated_at: timestamp,
	};

	const [primary, ...duplicates] = existingRows;
	for (const duplicate of duplicates) {
		await TranscriptionPageCanvasLink.objects.update(duplicate._djazzkit_id, {
			_djazzkit_deleted: true,
			updated_at: timestamp,
			_djazzkit_updated_at: timestamp,
		});
	}

	if (primary?._djazzkit_id) {
		await TranscriptionPageCanvasLink.objects.update(primary._djazzkit_id, payload);
		const refreshed = await TranscriptionPageCanvasLink.objects
			.filter(fields => fields._djazzkit_id.eq(primary._djazzkit_id))
			.first();
		return rowToPageCanvasLink(refreshed);
	}

	const id = crypto.randomUUID();
	await TranscriptionPageCanvasLink.objects.create({
		...createDjazzkitFields(id, timestamp),
		created_at: timestamp,
		...payload,
	});
	const created = await TranscriptionPageCanvasLink.objects
		.filter(fields => fields._djazzkit_id.eq(id))
		.first();
	return rowToPageCanvasLink(created);
}

export async function savePageCanvasLinks(inputs: SavePageCanvasLinkInput[]): Promise<PageCanvasLink[]> {
	const saved: PageCanvasLink[] = [];
	for (const input of inputs) {
		saved.push(await upsertPageCanvasLink(input));
	}
	return saved;
}

async function softDeletePageCanvasLinks(
	rows: Array<{ _djazzkit_id?: string | null }>
): Promise<number> {
	const timestamp = nowIso();
	let deletedCount = 0;
	for (const row of rows) {
		if (!row._djazzkit_id) continue;
		await TranscriptionPageCanvasLink.objects.update(row._djazzkit_id, {
			_djazzkit_deleted: true,
			updated_at: timestamp,
			_djazzkit_updated_at: timestamp,
		});
		deletedCount += 1;
	}
	return deletedCount;
}

export async function deletePageCanvasLink(input: {
	transcriptionId: string;
	pageId: string;
	manifestSourceId: string;
	canvasId: string;
}): Promise<number> {
	await ensureDjazzkitRuntime();
	const rows = await TranscriptionPageCanvasLink.objects
		.filter(fields => fields.transcription_id.eq(input.transcriptionId))
		.filter(fields => fields.page_id.eq(input.pageId))
		.filter(fields => fields.manifest_source_id.eq(input.manifestSourceId))
		.filter(fields => fields.canvas_id.eq(input.canvasId))
		.filter(fields => fields._djazzkit_deleted.eq(false))
		.all();
	return softDeletePageCanvasLinks(rows);
}

export async function deletePageCanvasLinksForPage(input: {
	transcriptionId: string;
	pageId: string;
}): Promise<number> {
	await ensureDjazzkitRuntime();
	const rows = await TranscriptionPageCanvasLink.objects
		.filter(fields => fields.transcription_id.eq(input.transcriptionId))
		.filter(fields => fields.page_id.eq(input.pageId))
		.filter(fields => fields._djazzkit_deleted.eq(false))
		.all();
	return softDeletePageCanvasLinks(rows);
}

export async function deleteAllPageCanvasLinks(transcriptionId: string): Promise<number> {
	await ensureDjazzkitRuntime();
	const rows = await TranscriptionPageCanvasLink.objects
		.filter(fields => fields.transcription_id.eq(transcriptionId))
		.filter(fields => fields._djazzkit_deleted.eq(false))
		.all();
	return softDeletePageCanvasLinks(rows);
}

export async function deleteManifestSource(input: {
	transcriptionId: string;
	manifestSourceId: string;
}): Promise<boolean> {
	await ensureDjazzkitRuntime();
	await deleteManifestSourceLinks(input);
	const existing = await IiifManifestSource.objects
		.filter(fields => fields.transcription_id.eq(input.transcriptionId))
		.filter(fields => fields._djazzkit_id.eq(input.manifestSourceId))
		.filter(fields => fields._djazzkit_deleted.eq(false))
		.first();
	if (!existing?._djazzkit_id) return false;
	const timestamp = nowIso();
	await IiifManifestSource.objects.update(existing._djazzkit_id, {
		_djazzkit_deleted: true,
		updated_at: timestamp,
		_djazzkit_updated_at: timestamp,
	});
	return true;
}

export async function deleteManifestSourceLinks(input: {
	transcriptionId: string;
	manifestSourceId: string;
}): Promise<number> {
	await ensureDjazzkitRuntime();
	const rows = await TranscriptionPageCanvasLink.objects
		.filter(fields => fields.transcription_id.eq(input.transcriptionId))
		.filter(fields => fields.manifest_source_id.eq(input.manifestSourceId))
		.filter(fields => fields._djazzkit_deleted.eq(false))
		.all();
	return softDeletePageCanvasLinks(rows);
}

export async function findLinkedPageForCanvas(input: {
	transcriptionId: string;
	manifestSourceId: string;
	canvasId: string;
}): Promise<PageCanvasLink | null> {
	await ensureDjazzkitRuntime();
	const row = await TranscriptionPageCanvasLink.objects
		.filter(fields => fields.transcription_id.eq(input.transcriptionId))
		.filter(fields => fields.manifest_source_id.eq(input.manifestSourceId))
		.filter(fields => fields.canvas_id.eq(input.canvasId))
		.filter(fields => fields._djazzkit_deleted.eq(false))
		.first();
	return row ? rowToPageCanvasLink(row) : null;
}

export async function listCanvasAnnotations(input: {
	transcriptionId: string;
	manifestSourceIds: string[];
	canvasId: string;
	mode?: 'headers' | 'full';
	previewLength?: number;
}): Promise<W3CAnnotation[]> {
	if (input.manifestSourceIds.length === 0) return [];
	await ensureDjazzkitRuntime();
	const rows = await IiifCanvasAnnotation.objects
		.filter(fields => fields.transcription_id.eq(input.transcriptionId))
		.filter(fields => fields.manifest_source_id.inList(input.manifestSourceIds))
		.filter(fields => fields.canvas_id.eq(input.canvasId))
		.filter(fields => fields._djazzkit_deleted.eq(false))
		.all();

	const mode = input.mode || 'full';
	const previewLength = input.previewLength || 280;
	return rows.map(row => rowToCanvasAnnotation(row, { mode, previewLength }));
}

export async function getCanvasAnnotation(input: {
	transcriptionId: string;
	manifestSourceId: string;
	annotationId: string;
}): Promise<W3CAnnotation | null> {
	await ensureDjazzkitRuntime();
	const row = await IiifCanvasAnnotation.objects
		.filter(fields => fields.transcription_id.eq(input.transcriptionId))
		.filter(fields => fields.manifest_source_id.eq(input.manifestSourceId))
		.filter(fields => fields.annotation_id.eq(input.annotationId))
		.filter(fields => fields._djazzkit_deleted.eq(false))
		.first();
	return row ? rowToCanvasAnnotation(row, { mode: 'full', previewLength: 280 }) : null;
}

export async function upsertCanvasAnnotation(input: {
	transcriptionId: string;
	pageId: string;
	manifestSourceId: string;
	canvasId: string;
	annotation: W3CAnnotation;
	anchor: AnnotationAnchor;
	createdBy?: string;
}): Promise<void> {
	await ensureDjazzkitRuntime();
	const existing = await IiifCanvasAnnotation.objects
		.filter(fields => fields.transcription_id.eq(input.transcriptionId))
		.filter(fields => fields.manifest_source_id.eq(input.manifestSourceId))
		.filter(fields => fields.annotation_id.eq(input.annotation.id))
		.filter(fields => fields._djazzkit_deleted.eq(false))
		.first();

	const timestamp = nowIso();
	const firstBody = Array.isArray(input.annotation.body)
		? input.annotation.body[0] || {}
		: input.annotation.body || {};
	const payload = {
		transcription_id: input.transcriptionId,
		page_id: input.pageId,
		manifest_source_id: input.manifestSourceId,
		canvas_id: input.canvasId,
		annotation_id: input.annotation.id,
		target_json: JSON.stringify(input.annotation.target || { source: input.canvasId }),
		body_json: JSON.stringify(input.annotation.body || []),
		motivation: String((firstBody as Record<string, unknown>).purpose || 'commenting'),
		annotation_kind: String(input.annotation.target?.selector?.type || 'annotation'),
		anchor_json: JSON.stringify(input.anchor),
		created_by: input.createdBy || input.annotation.creator?.id || input.annotation.creator?.name || '',
		updated_at: timestamp,
		_djazzkit_updated_at: timestamp,
	};

	if (existing?._djazzkit_id) {
		await IiifCanvasAnnotation.objects.update(existing._djazzkit_id, payload);
		return;
	}

	const annotationId = crypto.randomUUID();
	await IiifCanvasAnnotation.objects.create({
		...createDjazzkitFields(annotationId, timestamp),
		created_at: input.annotation.created || timestamp,
		...payload,
	});
}

export async function deleteCanvasAnnotation(input: {
	transcriptionId: string;
	manifestSourceId: string;
	annotationId: string;
}): Promise<void> {
	await ensureDjazzkitRuntime();
	const existing = await IiifCanvasAnnotation.objects
		.filter(fields => fields.transcription_id.eq(input.transcriptionId))
		.filter(fields => fields.manifest_source_id.eq(input.manifestSourceId))
		.filter(fields => fields.annotation_id.eq(input.annotationId))
		.filter(fields => fields._djazzkit_deleted.eq(false))
		.first();
	if (!existing?._djazzkit_id) return;
	const timestamp = nowIso();
	await IiifCanvasAnnotation.objects.update(existing._djazzkit_id, {
		_djazzkit_deleted: true,
		updated_at: timestamp,
		_djazzkit_updated_at: timestamp,
	});
}
