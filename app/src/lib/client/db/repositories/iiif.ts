import type { Kysely, Selectable, Transaction } from 'kysely';
import type { W3CAnnotation, W3CAnnotationBody } from 'triiiceratops/plugins/annotation-editor';

import type { AnnotationAnchor, ManifestSourceSummary, PageCanvasLink, SavePageCanvasLinkInput } from '../../iiif/types';
import type { Database, IiifCanvasAnnotations, IiifManifestSources, TranscriptionPageCanvasLinks } from '../types.generated';

type DbExecutor = Kysely<Database> | Transaction<Database>;

export interface EnsureManifestSourceInput {
	transcriptionId: string;
	manifestUrl: string;
	label?: string;
	sourceKind?: 'external' | 'app';
	defaultCanvasId?: string | null;
	defaultImageServiceUrl?: string | null;
	manifestJson?: Record<string, any> | null;
	metadata?: Record<string, unknown>;
}

export interface DeletePageCanvasLinkInput {
	transcriptionId: string;
	pageId: string;
	manifestSourceId: string;
	canvasId: string;
}

export interface ManifestSourceIdInput {
	transcriptionId: string;
	manifestSourceId: string;
}

export interface FindLinkedPageForCanvasInput extends ManifestSourceIdInput {
	canvasId: string;
}

export interface ListCanvasAnnotationsInput {
	transcriptionId: string;
	manifestSourceIds: string[];
	canvasId: string;
	mode?: 'headers' | 'full';
	previewLength?: number;
}

export interface CanvasAnnotationIdInput extends ManifestSourceIdInput {
	annotationId: string;
}

export interface UpsertCanvasAnnotationInput extends ManifestSourceIdInput {
	pageId: string;
	canvasId: string;
	annotation: W3CAnnotation;
	anchor: AnnotationAnchor;
	createdBy?: string;
}

export async function listManifestSources(db: DbExecutor, transcriptionId: string): Promise<ManifestSourceSummary[]> {
	const rows = await db.selectFrom('iiif_manifest_sources').selectAll().where('transcription_id', '=', transcriptionId).orderBy('updated_at', 'desc').execute();
	return rows.map(rowToManifestSource);
}

export async function listManifestSourcesForUrl(db: DbExecutor, transcriptionId: string, manifestUrl: string): Promise<ManifestSourceSummary[]> {
	const rows = await db.selectFrom('iiif_manifest_sources').selectAll().where('transcription_id', '=', transcriptionId).where('manifest_url', '=', manifestUrl).execute();
	return rows.map(rowToManifestSource);
}

export async function ensureManifestSource(db: DbExecutor, input: EnsureManifestSourceInput): Promise<ManifestSourceSummary> {
	const existing = await db.selectFrom('iiif_manifest_sources').selectAll().where('transcription_id', '=', input.transcriptionId).where('manifest_url', '=', input.manifestUrl).executeTakeFirst();
	const existingMetadata = safeJsonParse<Record<string, unknown>>(existing?.metadata_json || '{}', {});
	const metadata = { ...existingMetadata, ...(input.metadata || {}), ...(input.manifestJson ? { manifestJson: input.manifestJson } : {}) };
	const now = new Date().toISOString();
	const id = existing?.id || crypto.randomUUID();
	await db.insertInto('iiif_manifest_sources').values({
		id,
		transcription_id: input.transcriptionId,
		manifest_url: input.manifestUrl,
		label: input.label || input.manifestUrl,
		source_kind: input.sourceKind || 'external',
		default_canvas_id: input.defaultCanvasId || null,
		default_image_service_url: input.defaultImageServiceUrl || null,
		metadata_json: JSON.stringify(metadata),
		created_at: existing?.created_at || now,
		updated_at: now,
	}).onConflict((oc) => oc.columns(['transcription_id', 'manifest_url']).doUpdateSet({
		label: input.label || input.manifestUrl,
		source_kind: input.sourceKind || 'external',
		default_canvas_id: input.defaultCanvasId || null,
		default_image_service_url: input.defaultImageServiceUrl || null,
		metadata_json: JSON.stringify(metadata),
		updated_at: now,
	})).execute();
	const row = await db.selectFrom('iiif_manifest_sources').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
	return rowToManifestSource(row);
}

export async function getManifestSource(db: DbExecutor, input: ManifestSourceIdInput): Promise<ManifestSourceSummary | null> {
	const row = await db.selectFrom('iiif_manifest_sources').selectAll().where('transcription_id', '=', input.transcriptionId).where('id', '=', input.manifestSourceId).executeTakeFirst();
	return row ? rowToManifestSource(row) : null;
}

export async function listPageCanvasLinks(db: DbExecutor, transcriptionId: string): Promise<PageCanvasLink[]> {
	const rows = await db.selectFrom('transcription_page_canvas_links').selectAll().where('transcription_id', '=', transcriptionId).orderBy('page_order').orderBy('canvas_order').execute();
	return rows.map(rowToPageCanvasLink);
}

export async function upsertPageCanvasLink(db: DbExecutor, input: SavePageCanvasLinkInput): Promise<PageCanvasLink> {
	const now = new Date().toISOString();
	const existing = await db.selectFrom('transcription_page_canvas_links').select(['id', 'created_at']).where('transcription_id', '=', input.transcriptionId).where('page_id', '=', input.pageId).where('manifest_source_id', '=', input.manifestSourceId).where('link_role', '=', input.linkRole || 'primary').executeTakeFirst();
	const id = existing?.id || crypto.randomUUID();
	await db.insertInto('transcription_page_canvas_links').values({ ...linkInputToRow(input, id, existing?.created_at || now, now) }).onConflict((oc) => oc.columns(['transcription_id', 'page_id', 'manifest_source_id', 'link_role']).doUpdateSet({
		page_name_snapshot: input.pageNameSnapshot,
		page_order: input.pageOrder,
		manifest_url_snapshot: input.manifestUrlSnapshot,
		canvas_id: input.canvasId,
		canvas_order: input.canvasOrder,
		canvas_label: input.canvasLabel,
		image_service_url: input.imageServiceUrl,
		thumbnail_url: input.thumbnailUrl,
		updated_at: now,
	})).execute();
	const row = await db.selectFrom('transcription_page_canvas_links').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
	return rowToPageCanvasLink(row);
}

export async function savePageCanvasLinks(db: Kysely<Database>, inputs: SavePageCanvasLinkInput[]): Promise<PageCanvasLink[]> {
	return db.transaction().execute(async (trx) => {
		const saved: PageCanvasLink[] = [];
		for (const input of inputs) saved.push(await upsertPageCanvasLink(trx, input));
		return saved;
	});
}

export async function deletePageCanvasLink(db: DbExecutor, input: DeletePageCanvasLinkInput): Promise<number> {
	const result = await db.deleteFrom('transcription_page_canvas_links').where('transcription_id', '=', input.transcriptionId).where('page_id', '=', input.pageId).where('manifest_source_id', '=', input.manifestSourceId).where('canvas_id', '=', input.canvasId).executeTakeFirst();
	return Number(result.numDeletedRows);
}

export async function deletePageCanvasLinksForPage(db: DbExecutor, input: { transcriptionId: string; pageId: string }): Promise<number> {
	const result = await db.deleteFrom('transcription_page_canvas_links').where('transcription_id', '=', input.transcriptionId).where('page_id', '=', input.pageId).executeTakeFirst();
	return Number(result.numDeletedRows);
}

export async function deleteAllPageCanvasLinks(db: DbExecutor, transcriptionId: string): Promise<number> {
	const result = await db.deleteFrom('transcription_page_canvas_links').where('transcription_id', '=', transcriptionId).executeTakeFirst();
	return Number(result.numDeletedRows);
}

export async function deleteManifestSource(db: DbExecutor, input: ManifestSourceIdInput): Promise<boolean> {
	const result = await db.deleteFrom('iiif_manifest_sources').where('transcription_id', '=', input.transcriptionId).where('id', '=', input.manifestSourceId).executeTakeFirst();
	return Number(result.numDeletedRows) > 0;
}

export async function deleteManifestSourceLinks(db: DbExecutor, input: ManifestSourceIdInput): Promise<number> {
	const result = await db.deleteFrom('transcription_page_canvas_links').where('transcription_id', '=', input.transcriptionId).where('manifest_source_id', '=', input.manifestSourceId).executeTakeFirst();
	return Number(result.numDeletedRows);
}

export async function findLinkedPageForCanvas(db: DbExecutor, input: FindLinkedPageForCanvasInput): Promise<PageCanvasLink | null> {
	const row = await db.selectFrom('transcription_page_canvas_links').selectAll().where('transcription_id', '=', input.transcriptionId).where('manifest_source_id', '=', input.manifestSourceId).where('canvas_id', '=', input.canvasId).executeTakeFirst();
	return row ? rowToPageCanvasLink(row) : null;
}

export async function listCanvasAnnotations(db: DbExecutor, input: ListCanvasAnnotationsInput): Promise<W3CAnnotation[]> {
	if (input.manifestSourceIds.length === 0) return [];
	const rows = await db.selectFrom('iiif_canvas_annotations').selectAll().where('transcription_id', '=', input.transcriptionId).where('manifest_source_id', 'in', input.manifestSourceIds).where('canvas_id', '=', input.canvasId).execute();
	return rows.map((row) => rowToCanvasAnnotation(row, { mode: input.mode || 'full', previewLength: input.previewLength || 280 }));
}

export async function getCanvasAnnotation(db: DbExecutor, input: CanvasAnnotationIdInput): Promise<W3CAnnotation | null> {
	const row = await db.selectFrom('iiif_canvas_annotations').selectAll().where('transcription_id', '=', input.transcriptionId).where('manifest_source_id', '=', input.manifestSourceId).where('annotation_id', '=', input.annotationId).executeTakeFirst();
	return row ? rowToCanvasAnnotation(row, { mode: 'full', previewLength: 280 }) : null;
}

export async function upsertCanvasAnnotation(db: DbExecutor, input: UpsertCanvasAnnotationInput): Promise<void> {
	const now = new Date().toISOString();
	const existing = await db.selectFrom('iiif_canvas_annotations').select(['id', 'created_at']).where('transcription_id', '=', input.transcriptionId).where('manifest_source_id', '=', input.manifestSourceId).where('annotation_id', '=', input.annotation.id).executeTakeFirst();
	const firstBody = Array.isArray(input.annotation.body) ? input.annotation.body[0] || {} : input.annotation.body || {};
	const id = existing?.id || crypto.randomUUID();
	await db.insertInto('iiif_canvas_annotations').values({
		id,
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
		created_at: existing?.created_at || input.annotation.created || now,
		updated_at: now,
	}).onConflict((oc) => oc.columns(['transcription_id', 'manifest_source_id', 'annotation_id']).doUpdateSet({
		page_id: input.pageId,
		canvas_id: input.canvasId,
		target_json: JSON.stringify(input.annotation.target || { source: input.canvasId }),
		body_json: JSON.stringify(input.annotation.body || []),
		motivation: String((firstBody as Record<string, unknown>).purpose || 'commenting'),
		annotation_kind: String(input.annotation.target?.selector?.type || 'annotation'),
		anchor_json: JSON.stringify(input.anchor),
		created_by: input.createdBy || input.annotation.creator?.id || input.annotation.creator?.name || '',
		updated_at: now,
	})).execute();
}

export async function deleteCanvasAnnotation(db: DbExecutor, input: CanvasAnnotationIdInput): Promise<void> {
	await db.deleteFrom('iiif_canvas_annotations').where('transcription_id', '=', input.transcriptionId).where('manifest_source_id', '=', input.manifestSourceId).where('annotation_id', '=', input.annotationId).execute();
}

function linkInputToRow(input: SavePageCanvasLinkInput, id: string, createdAt: string, updatedAt: string): Selectable<TranscriptionPageCanvasLinks> {
	return { id, transcription_id: input.transcriptionId, page_id: input.pageId, page_name_snapshot: input.pageNameSnapshot, page_order: input.pageOrder, manifest_source_id: input.manifestSourceId, manifest_url_snapshot: input.manifestUrlSnapshot, canvas_id: input.canvasId, canvas_order: input.canvasOrder, canvas_label: input.canvasLabel, image_service_url: input.imageServiceUrl, thumbnail_url: input.thumbnailUrl, link_role: input.linkRole || 'primary', created_at: createdAt, updated_at: updatedAt };
}

function rowToManifestSource(row: Selectable<IiifManifestSources>): ManifestSourceSummary {
	const metadata = safeJsonParse<Record<string, unknown>>(row.metadata_json || '{}', {});
	const manifestJson = metadata.manifestJson && typeof metadata.manifestJson === 'object' ? (metadata.manifestJson as Record<string, any>) : null;
	return { id: requireId(row.id, 'manifest source'), transcriptionId: row.transcription_id, manifestUrl: row.manifest_url, label: row.label, sourceKind: row.source_kind as 'external' | 'app', defaultCanvasId: row.default_canvas_id || null, defaultImageServiceUrl: row.default_image_service_url || null, manifestJson, metadata, createdAt: row.created_at, updatedAt: row.updated_at };
}

function rowToPageCanvasLink(row: Selectable<TranscriptionPageCanvasLinks>): PageCanvasLink {
	return { id: requireId(row.id, 'page canvas link'), transcriptionId: row.transcription_id, pageId: row.page_id, pageNameSnapshot: row.page_name_snapshot, pageOrder: row.page_order, manifestSourceId: row.manifest_source_id, manifestUrlSnapshot: row.manifest_url_snapshot, canvasId: row.canvas_id, canvasOrder: row.canvas_order, canvasLabel: row.canvas_label, imageServiceUrl: row.image_service_url || null, thumbnailUrl: row.thumbnail_url || null, linkRole: row.link_role, createdAt: row.created_at, updatedAt: row.updated_at };
}

function rowToCanvasAnnotation(row: Selectable<IiifCanvasAnnotations>, options: { mode: 'headers' | 'full'; previewLength: number }): W3CAnnotation {
	const rawBody = safeJsonParse(row.body_json || '[]', []);
	const { bodies, preview } = options.mode === 'full' ? { bodies: normalizeAnnotationBodies(rawBody), preview: normalizeAnnotationBodies(rawBody).map((entry) => (typeof entry.value === 'string' ? entry.value.trim() : '')).find((value) => value.length > 0) || null } : buildPreviewBodies(rawBody, options.previewLength);
	return { '@context': 'http://www.w3.org/ns/anno.jsonld', id: row.annotation_id, type: 'Annotation', body: bodies, target: safeJsonParse(row.target_json || '{}', { source: row.canvas_id }), created: row.created_at, modified: row.updated_at, motivation: row.motivation || 'commenting', creator: row.created_by ? { id: row.created_by, name: row.created_by } : undefined, apatopwa: { anchor: safeJsonParse(row.anchor_json || 'null', null), annotationKind: row.annotation_kind || null, createdBy: row.created_by || null }, __fullBodyLoaded: options.mode === 'full', __bodyPreview: preview };
}

function normalizeAnnotationBodies(body: unknown): W3CAnnotationBody[] {
	if (Array.isArray(body)) return body as W3CAnnotationBody[];
	if (body && typeof body === 'object') return [body as W3CAnnotationBody];
	return [];
}

function buildPreviewBodies(body: unknown, maxLength: number): { bodies: W3CAnnotationBody[]; preview: string | null } {
	const normalized = normalizeAnnotationBodies(body);
	const preview = normalized.map((entry) => (typeof entry.value === 'string' ? entry.value.trim() : '')).find((value) => value.length > 0) || null;
	return { bodies: normalized.map((entry) => typeof entry.value === 'string' ? { ...entry, value: truncateAnnotationText(entry.value, maxLength) } : { ...entry }), preview };
}

function truncateAnnotationText(value: string, maxLength: number): string {
	if (value.length <= maxLength) return value;
	return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`;
}

function safeJsonParse<T>(value: string, fallback: T): T {
	try { return JSON.parse(value) as T; } catch { return fallback; }
}

function requireId(value: string | null, label: string): string {
	if (!value) throw new Error(`Missing ${label} id`);
	return value;
}
