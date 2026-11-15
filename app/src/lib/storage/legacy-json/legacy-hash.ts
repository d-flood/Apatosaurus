import { hashCanonicalPayload } from '../canonical-json';
import type {
	ProjectTranscriptionSnapshot,
	SerializedIiifCanvasAnnotation,
	SerializedTranscriptionPageCanvasLink,
} from '$lib/db/repositories/revisions';
import { collationPayloadToContent, type CollationContent } from '../formats/collation';

/** The content hash JSON documents carried before TEI; conversion maps it to the TEI content hash. */
export function legacyTranscriptionContentHash(
	snapshot: ProjectTranscriptionSnapshot
): Promise<string> {
	return hashCanonicalPayload(buildTranscriptionHashPayload(snapshot));
}

export function legacyCollationContentHash(content: CollationContent): Promise<string> {
	return hashCanonicalPayload(collationPayloadToContent(content));
}

export function buildTranscriptionHashPayload(input: ProjectTranscriptionSnapshot): unknown {
	return {
		project_transcription_id: input.project_transcription_id,
		id: input.id,
		format: input.format,
		title: input.title,
		siglum: input.siglum,
		description: input.description,
		content_json: input.content_json,
		owner: input.owner,
		is_public: input.is_public === true,
		tags: [...input.tags],
		transcriber: input.transcriber,
		repository: input.repository,
		settlement: input.settlement,
		language: input.language,
		iiif_manifest_sources: [...input.iiif_manifest_sources].sort(compareById).map(row => ({
			id: row.id,
			manifest_url: row.manifest_url,
			label: row.label,
			source_kind: row.source_kind,
			default_canvas_id: row.default_canvas_id,
			default_image_service_url: row.default_image_service_url,
			synthetic_canvases: row.synthetic_canvases,
		})),
		page_canvas_links: [...input.page_canvas_links].sort(comparePageCanvasLinks).map(row => ({
			id: row.id,
			page_id: row.page_id,
			page_name_snapshot: row.page_name_snapshot,
			page_order: row.page_order,
			manifest_source_id: row.manifest_source_id,
			manifest_url_snapshot: row.manifest_url_snapshot,
			canvas_id: row.canvas_id,
			canvas_order: row.canvas_order,
			canvas_label: row.canvas_label,
			image_service_url: row.image_service_url,
			thumbnail_url: row.thumbnail_url,
			link_role: row.link_role,
		})),
		canvas_annotations: [...input.canvas_annotations]
			.sort(compareCanvasAnnotations)
			.map(row => ({
				id: row.id,
				manifest_source_id: row.manifest_source_id,
				canvas_id: row.canvas_id,
				page_id: row.page_id,
				annotation_id: row.annotation_id,
				annotation_kind: row.annotation_kind,
				body_json: row.body_json,
				target_json: row.target_json,
				anchor_json: row.anchor_json,
				motivation: row.motivation,
				created_by: row.created_by,
			})),
	};
}

function compareById(left: { id: string }, right: { id: string }): number {
	return compareStrings(left.id, right.id);
}

function comparePageCanvasLinks(
	left: SerializedTranscriptionPageCanvasLink,
	right: SerializedTranscriptionPageCanvasLink
): number {
	return (
		compareNumbers(left.page_order, right.page_order) ||
		compareNumbers(left.canvas_order, right.canvas_order) ||
		compareStrings(left.id, right.id)
	);
}

function compareCanvasAnnotations(
	left: SerializedIiifCanvasAnnotation,
	right: SerializedIiifCanvasAnnotation
): number {
	return (
		compareStrings(left.annotation_id, right.annotation_id) || compareStrings(left.id, right.id)
	);
}

function compareNumbers(left: number, right: number): number {
	return left - right;
}

function compareStrings(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}
