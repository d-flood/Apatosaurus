import { sql, type Insertable, type Kysely, type Transaction } from 'kysely';

import {
	COLLATION_CHECKPOINT_FORMAT,
	COLLATION_FORMAT,
	PROJECT_MANIFEST_FORMAT,
	PROJECT_TRANSCRIPTION_FORMAT,
	TOMBSTONE_FORMAT,
	TRANSCRIPTION_CHECKPOINT_FORMAT,
	WORKING_COLLATION_FORMAT,
	WORKING_TRANSCRIPTION_FORMAT,
	assertCollationCheckpointPayloadIntegrity,
	assertCollationRevisionHash,
	assertProjectTranscriptionRevisionHash,
	collationWorkingFile,
	assertTranscriptionCheckpointPayloadIntegrity,
	collationHistoryFolder,
	joinStorePath,
	listDirectory,
	projectFolder,
	projectManifestFile,
	projectsFolder,
	quarantineFromError,
	readCanonicalDocument,
	readTextFile,
	transcriptionHistoryFolder,
	transcriptionWorkingFile,
	type CollationCheckpointPayload,
	type CollationPayload,
	type JsonObject,
	type ProjectManifestPayload,
	type ProjectTranscriptionPayload,
	type StoreDirectoryEntry,
	type StoreOperationOptions,
	type StoreQuarantineReason,
	type StoreQuarantineRecord,
	type TombstonePayload,
	type TranscriptionCheckpointPayload,
	type WorkingCollationPayload,
	type WorkingTranscriptionPayload,
} from '$lib/client/store';

import type {
	CollationArtifacts,
	CollationCheckpoints,
	CollationReadingWitnesses,
	CollationReadings,
	CollationTokens,
	CollationVariationUnits,
	CollationWitnesses,
	Collations,
	Database,
	IiifCanvasAnnotations,
	IiifManifestSources,
	ProjectTranscriptions,
	Projects,
	SyncTombstones,
	TranscriptionCheckpoints,
	TranscriptionPageCanvasLinks,
	Transcriptions,
} from '../types.generated';
import { replaceTranscriptionVerseIndexRows } from './transcriptions';
import { buildCollationProjectionFromDocument } from '$lib/client/collation/collation-projection';

type DbTransaction = Transaction<Database>;

export interface IndexRebuildReport {
	projectsRestored: number;
	transcriptionsRestored: number;
	collationsRestored: number;
	transcriptionCheckpointsRestored: number;
	collationCheckpointsRestored: number;
	tombstonesRestored: number;
	quarantinedFiles: StoreQuarantineRecord[];
	orphanedFiles: string[];
}

interface RebuildRows {
	projects: Insertable<Projects>[];
	transcriptions: Insertable<Transcriptions>[];
	projectTranscriptions: Insertable<ProjectTranscriptions>[];
	iiifManifestSources: Insertable<IiifManifestSources>[];
	pageCanvasLinks: Insertable<TranscriptionPageCanvasLinks>[];
	canvasAnnotations: Insertable<IiifCanvasAnnotations>[];
	transcriptionCheckpoints: Insertable<TranscriptionCheckpoints>[];
	transcriptionVerseInputs: Array<{ transcriptionId: string; contentJson: string }>;
	collations: Insertable<Collations>[];
	collationArtifacts: Insertable<CollationArtifacts>[];
	collationWitnesses: Insertable<CollationWitnesses>[];
	collationTokens: Insertable<CollationTokens>[];
	collationVariationUnits: Insertable<CollationVariationUnits>[];
	collationReadings: Insertable<CollationReadings>[];
	collationReadingWitnesses: Insertable<CollationReadingWitnesses>[];
	collationCheckpoints: Insertable<CollationCheckpoints>[];
	tombstones: Insertable<SyncTombstones>[];
}

const INDEX_TABLE_DELETE_ORDER = [
	'sync_file_fingerprints',
	'cloud_sync_metadata',
	'cloud_project_folders',
	'cloud_connections',
	'collation_reading_witnesses',
	'collation_readings',
	'collation_variation_units',
	'collation_tokens',
	'collation_witnesses',
	'collation_artifacts',
	'collation_checkpoints',
	'collations',
	'iiif_canvas_annotations',
	'transcription_page_canvas_links',
	'iiif_manifest_sources',
	'transcription_verse_index',
	'transcription_verse_index_state',
	'transcription_checkpoints',
	'project_transcriptions',
	'transcriptions',
	'sync_tombstones',
	'projects',
] as const satisfies ReadonlyArray<keyof Database>;

export async function rebuildIndexFromStore(
	db: Kysely<Database>,
	storeOptions: StoreOperationOptions = {}
): Promise<IndexRebuildReport> {
	const report = createEmptyReport();
	const rows = await collectIndexRowsFromStore(report, storeOptions);

	await db.transaction().execute(async trx => {
		await clearIndexTables(trx);
		await insertIndexRows(trx, rows);
	});

	report.projectsRestored = rows.projects.length;
	report.transcriptionsRestored = rows.transcriptions.length;
	report.collationsRestored = rows.collations.length;
	report.transcriptionCheckpointsRestored = rows.transcriptionCheckpoints.length;
	report.collationCheckpointsRestored = rows.collationCheckpoints.length;
	report.tombstonesRestored = rows.tombstones.length;
	return report;
}

async function collectIndexRowsFromStore(
	report: IndexRebuildReport,
	storeOptions: StoreOperationOptions
): Promise<RebuildRows> {
	const rows = createEmptyRows();
	const projectEntries = await listDirectoryIfExists(projectsFolder(), storeOptions);
	for (const entry of projectEntries) {
		if (entry.kind !== 'directory') continue;
		await collectProjectRows(entry.name, rows, report, storeOptions);
	}
	return rows;
}

async function collectProjectRows(
	projectSlug: string,
	rows: RebuildRows,
	report: IndexRebuildReport,
	storeOptions: StoreOperationOptions
): Promise<void> {
	const manifestPath = projectManifestFile(projectSlug);
	const manifest = await readCanonicalFile<ProjectManifestPayload>(
		PROJECT_MANIFEST_FORMAT,
		manifestPath,
		report,
		storeOptions
	);
	if (!manifest) return;

	rows.projects.push({
		id: manifest.id,
		storage_slug: projectSlug,
		name: manifest.name,
		description: manifest.description,
		charter: manifest.charter,
		collation_settings: JSON.stringify(manifest.collation_settings),
		created_at: manifest.created_at,
		updated_at: manifest.updated_at,
	});

	const referencedTranscriptionPrimaries = new Set<string>();
	for (const head of manifest.transcriptions) {
		referencedTranscriptionPrimaries.add(head.primary_path);
		await collectTranscriptionRows(
			projectSlug,
			manifest.id,
			head.primary_path,
			rows,
			report,
			storeOptions
		);
	}
	await recordOrphanedPrimaries(
		projectSlug,
		'transcriptions',
		referencedTranscriptionPrimaries,
		report,
		storeOptions
	);

	const referencedCollationPrimaries = new Set<string>();
	for (const head of manifest.collations) {
		referencedCollationPrimaries.add(head.primary_path);
		await collectCollationRows(
			projectSlug,
			manifest.id,
			head.primary_path,
			rows,
			report,
			storeOptions
		);
	}
	await recordOrphanedPrimaries(
		projectSlug,
		'collations',
		referencedCollationPrimaries,
		report,
		storeOptions
	);

	for (const head of manifest.tombstones) {
		await collectTombstoneRow(projectSlug, head.primary_path, rows, report, storeOptions);
	}
}

async function collectTranscriptionRows(
	projectSlug: string,
	projectId: string,
	primaryRelativePath: string,
	rows: RebuildRows,
	report: IndexRebuildReport,
	storeOptions: StoreOperationOptions
): Promise<void> {
	const primaryPath = joinStorePath(projectFolder(projectSlug), primaryRelativePath);
	const payload = await readCanonicalFile<ProjectTranscriptionPayload>(
		PROJECT_TRANSCRIPTION_FORMAT,
		primaryPath,
		report,
		storeOptions
	);
	if (
		!payload ||
		!(await validateFilePayload(primaryPath, report, () =>
			assertProjectTranscriptionRevisionHash(payload)
		))
	) {
		return;
	}

	const workingPayload = await readWorkingTranscriptionPayload(
		projectSlug,
		payload,
		report,
		storeOptions
	);
	const indexPayload = workingPayload ?? payload;
	const contentJson = JSON.stringify(indexPayload.content_json);
	rows.transcriptions.push({
		id: payload.id,
		project_id: projectId,
		origin_type: indexPayload.origin.source_type,
		origin_project_id: indexPayload.origin.source_project_id,
		origin_transcription_id: indexPayload.origin.source_transcription_id,
		origin_revision_id: indexPayload.origin.source_revision_id ?? '',
		origin_content_hash: indexPayload.origin.source_content_hash ?? '',
		current_revision_id: payload.current_revision.id,
		current_content_hash: payload.current_revision.content_hash,
		title: indexPayload.title,
		siglum: indexPayload.siglum,
		description: indexPayload.description,
		content_json: contentJson,
		format: indexPayload.content_format,
		created_at: indexPayload.created_at,
		updated_at: indexPayload.updated_at,
		owner: indexPayload.owner,
		is_public: indexPayload.is_public ? 1 : 0,
		tags: JSON.stringify(indexPayload.tags),
		transcriber: indexPayload.transcriber,
		repository: indexPayload.repository,
		settlement: indexPayload.settlement,
		language: indexPayload.language,
	});
	rows.projectTranscriptions.push({
		id: payload.project_transcription_id,
		project_id: projectId,
		transcription_id: payload.id,
		canonical_transcription_id: payload.canonical_transcription_id,
		added_at: payload.created_at,
	});
	rows.transcriptionVerseInputs.push({ transcriptionId: payload.id, contentJson });

	for (const source of indexPayload.iiif_manifest_sources) {
		rows.iiifManifestSources.push({
			id: source.id,
			transcription_id: payload.id,
			manifest_url: source.manifest_url,
			label: source.label,
			source_kind: source.source_kind,
			default_canvas_id: source.default_canvas_id,
			default_image_service_url: source.default_image_service_url,
			metadata_json: JSON.stringify(source.metadata_json),
			created_at: indexPayload.created_at,
			updated_at: indexPayload.updated_at,
		});
	}
	for (const link of indexPayload.page_canvas_links) {
		rows.pageCanvasLinks.push({
			id: link.id,
			transcription_id: payload.id,
			page_id: link.page_id,
			page_name_snapshot: link.page_name_snapshot,
			page_order: link.page_order,
			manifest_source_id: link.manifest_source_id,
			manifest_url_snapshot: link.manifest_url_snapshot,
			canvas_id: link.canvas_id,
			canvas_order: link.canvas_order,
			canvas_label: link.canvas_label,
			image_service_url: link.image_service_url,
			thumbnail_url: link.thumbnail_url,
			link_role: link.link_role,
			created_at: indexPayload.created_at,
			updated_at: indexPayload.updated_at,
		});
	}
	for (const annotation of indexPayload.canvas_annotations) {
		rows.canvasAnnotations.push({
			id: annotation.id,
			transcription_id: payload.id,
			manifest_source_id: annotation.manifest_source_id,
			canvas_id: annotation.canvas_id,
			page_id: annotation.page_id,
			annotation_id: annotation.annotation_id,
			annotation_kind: annotation.annotation_kind,
			body_json: JSON.stringify(annotation.body_json),
			target_json: JSON.stringify(annotation.target_json),
			anchor_json: JSON.stringify(annotation.anchor_json),
			motivation: annotation.motivation,
			created_by: annotation.created_by,
			created_at: indexPayload.created_at,
			updated_at: indexPayload.updated_at,
		});
	}

	await collectTranscriptionCheckpointRows(
		projectSlug,
		payload.project_transcription_id,
		rows,
		report,
		storeOptions
	);
}

async function collectCollationRows(
	projectSlug: string,
	projectId: string,
	primaryRelativePath: string,
	rows: RebuildRows,
	report: IndexRebuildReport,
	storeOptions: StoreOperationOptions
): Promise<void> {
	const primaryPath = joinStorePath(projectFolder(projectSlug), primaryRelativePath);
	const payload = await readCanonicalFile<CollationPayload>(
		COLLATION_FORMAT,
		primaryPath,
		report,
		storeOptions
	);
	if (
		!payload ||
		!(await validateFilePayload(primaryPath, report, () =>
			assertCollationRevisionHash(payload)
		))
	) {
		return;
	}

	const workingPayload = await readWorkingCollationPayload(
		projectSlug,
		payload,
		report,
		storeOptions
	);
	const indexPayload = workingPayload ?? payload;

	rows.collations.push({
		id: payload.id,
		project_id: projectId,
		current_revision_id: payload.current_revision.id,
		current_content_hash: payload.current_revision.content_hash,
		title: indexPayload.title,
		verse_identifier: indexPayload.verse_identifier,
		status: indexPayload.status,
		group_path: indexPayload.group_path,
		notes: indexPayload.notes,
		sort_key: indexPayload.sort_key,
		created_at: indexPayload.created_at,
		updated_at: indexPayload.updated_at,
	});
	const projection = buildCollationProjectionFromDocument(indexPayload.document);
	for (const [index, witness] of projection.witnesses.entries()) {
		rows.collationWitnesses.push({
			id: `${payload.id}:witness:${index}`,
			collation_id: payload.id,
			witness_id: witness.witnessId,
			content: witness.content,
			position: witness.position,
			project_transcription_id: null,
			transcription_id: witness.transcriptionId,
			source_revision_id: witness.sourceVersion,
			source_content_hash: witness.sourceContentHash ?? '',
		});
	}
	for (const [index, token] of projection.tokens.entries()) {
		rows.collationTokens.push({
			id: `${payload.id}:token:${index}`,
			collation_id: payload.id,
			witness_id: token.witnessId,
			token_index: token.tokenIndex,
			token_text: token.tokenText,
		});
	}
	for (const [unitIndex, unit] of projection.variationUnits.entries()) {
		const unitId = `${payload.id}:unit:${unitIndex}`;
		rows.collationVariationUnits.push({
			id: unitId,
			collation_id: payload.id,
			start_index: unit.startIndex,
			end_index: unit.endIndex,
			unit_type: unit.unitType,
			base_text: unit.baseText,
		});
		for (const [readingIndex, reading] of unit.readings.entries()) {
			const readingId = `${unitId}:reading:${readingIndex}`;
			rows.collationReadings.push({
				id: readingId,
				variation_unit_id: unitId,
				reading_order: reading.readingOrder,
				reading_text: reading.readingText,
				is_lacuna: reading.isLacuna ? 1 : 0,
				is_omission: reading.isOmission ? 1 : 0,
			});
			for (const [witnessIndex, witnessId] of reading.witnessIds.entries()) {
				rows.collationReadingWitnesses.push({
					id: `${readingId}:witness:${witnessIndex}`,
					reading_id: readingId,
					witness_id: witnessId,
				});
			}
		}
	}

	await collectCollationCheckpointRows(projectSlug, payload.id, rows, report, storeOptions);
}

async function readWorkingTranscriptionPayload(
	projectSlug: string,
	primaryPayload: ProjectTranscriptionPayload,
	report: IndexRebuildReport,
	storeOptions: StoreOperationOptions
): Promise<ProjectTranscriptionPayload | null> {
	const path = transcriptionWorkingFile(projectSlug, primaryPayload.project_transcription_id);
	const payload = await readOptionalCanonicalFile<WorkingTranscriptionPayload>(
		WORKING_TRANSCRIPTION_FORMAT,
		path,
		report,
		storeOptions
	);
	if (!payload) return null;
	if (
		payload.id !== primaryPayload.id ||
		payload.project_transcription_id !== primaryPayload.project_transcription_id
	) {
		recordQuarantine(report, path, {
			code: 'invalid_shape',
			message: `Working transcription does not match manifest primary ${primaryPayload.id}.`,
		});
		return null;
	}
	// Working transcription payloads are primary payloads minus current_revision; rebuild only
	// uses the live index fields from them and keeps committed revision heads from primaries.
	return payload as unknown as ProjectTranscriptionPayload;
}

async function readWorkingCollationPayload(
	projectSlug: string,
	primaryPayload: CollationPayload,
	report: IndexRebuildReport,
	storeOptions: StoreOperationOptions
): Promise<CollationPayload | null> {
	const path = collationWorkingFile(projectSlug, primaryPayload.id);
	const payload = await readOptionalCanonicalFile<WorkingCollationPayload>(
		WORKING_COLLATION_FORMAT,
		path,
		report,
		storeOptions
	);
	if (!payload) return null;
	if (payload.id !== primaryPayload.id || payload.project_id !== primaryPayload.project_id) {
		recordQuarantine(report, path, {
			code: 'invalid_shape',
			message: `Working collation does not match manifest primary ${primaryPayload.id}.`,
		});
		return null;
	}
	// Working collation payloads are primary payloads minus current_revision; rebuild only
	// uses the live index fields from them and keeps committed revision heads from primaries.
	return payload as unknown as CollationPayload;
}

async function collectTranscriptionCheckpointRows(
	projectSlug: string,
	projectTranscriptionId: string,
	rows: RebuildRows,
	report: IndexRebuildReport,
	storeOptions: StoreOperationOptions
): Promise<void> {
	const folder = transcriptionHistoryFolder(projectSlug, projectTranscriptionId);
	for (const entry of await listDirectoryIfExists(folder, storeOptions)) {
		if (!isJsonFile(entry)) continue;
		const path = joinStorePath(folder, entry.name);
		const payload = await readCanonicalFile<TranscriptionCheckpointPayload>(
			TRANSCRIPTION_CHECKPOINT_FORMAT,
			path,
			report,
			storeOptions
		);
		if (!payload) continue;
		if (payload.entity_id !== projectTranscriptionId) {
			recordQuarantine(report, path, {
				code: 'invalid_shape',
				message: `Checkpoint entity_id ${payload.entity_id} does not match ${projectTranscriptionId}.`,
			});
			continue;
		}
		if (
			!(await validateFilePayload(path, report, () =>
				assertTranscriptionCheckpointPayloadIntegrity(payload)
			))
		) {
			continue;
		}
		rows.transcriptionCheckpoints.push({
			id: payload.checkpoint_id,
			transcription_id: payload.payload_transcription_id,
			parent_checkpoint_id: payload.parent_checkpoint_id,
			format: payload.content_format,
			content_hash: payload.payload_content_hash,
			is_committed: 1,
			commit_message: payload.commit_message,
			author_name: payload.author_name,
			created_at: payload.created_at,
		});
	}
}

async function collectCollationCheckpointRows(
	projectSlug: string,
	collationId: string,
	rows: RebuildRows,
	report: IndexRebuildReport,
	storeOptions: StoreOperationOptions
): Promise<void> {
	const folder = collationHistoryFolder(projectSlug, collationId);
	for (const entry of await listDirectoryIfExists(folder, storeOptions)) {
		if (!isJsonFile(entry)) continue;
		const path = joinStorePath(folder, entry.name);
		const payload = await readCanonicalFile<CollationCheckpointPayload>(
			COLLATION_CHECKPOINT_FORMAT,
			path,
			report,
			storeOptions
		);
		if (!payload) continue;
		if (payload.entity_id !== collationId) {
			recordQuarantine(report, path, {
				code: 'invalid_shape',
				message: `Checkpoint entity_id ${payload.entity_id} does not match ${collationId}.`,
			});
			continue;
		}
		if (
			!(await validateFilePayload(path, report, () =>
				assertCollationCheckpointPayloadIntegrity(payload)
			))
		) {
			continue;
		}
		rows.collationCheckpoints.push({
			id: payload.checkpoint_id,
			collation_id: payload.entity_id,
			parent_checkpoint_id: payload.parent_checkpoint_id,
			content_hash: payload.payload_content_hash,
			is_committed: 1,
			commit_message: payload.commit_message,
			author_name: payload.author_name,
			created_at: payload.created_at,
		});
	}
}

async function collectTombstoneRow(
	projectSlug: string,
	primaryRelativePath: string,
	rows: RebuildRows,
	report: IndexRebuildReport,
	storeOptions: StoreOperationOptions
): Promise<void> {
	const path = joinStorePath(projectFolder(projectSlug), primaryRelativePath);
	const payload = await readCanonicalFile<TombstonePayload>(
		TOMBSTONE_FORMAT,
		path,
		report,
		storeOptions
	);
	if (!payload) return;
	rows.tombstones.push({
		id: payload.id,
		project_id: payload.project_id,
		entity_type: payload.entity_type,
		entity_id: payload.entity_id,
		cloud_path: payload.cloud_path,
		deletion_revision_id: payload.deletion_revision_id,
		deleted_by: payload.deleted_by,
		deleted_at: payload.deleted_at,
	});
}

async function insertIndexRows(trx: DbTransaction, rows: RebuildRows): Promise<void> {
	if (rows.projects.length) await trx.insertInto('projects').values(rows.projects).execute();
	if (rows.transcriptions.length)
		await trx.insertInto('transcriptions').values(rows.transcriptions).execute();
	if (rows.projectTranscriptions.length)
		await trx.insertInto('project_transcriptions').values(rows.projectTranscriptions).execute();
	if (rows.iiifManifestSources.length)
		await trx.insertInto('iiif_manifest_sources').values(rows.iiifManifestSources).execute();
	if (rows.pageCanvasLinks.length)
		await trx
			.insertInto('transcription_page_canvas_links')
			.values(rows.pageCanvasLinks)
			.execute();
	if (rows.canvasAnnotations.length)
		await trx.insertInto('iiif_canvas_annotations').values(rows.canvasAnnotations).execute();
	const transcriptionCheckpoints = sortCheckpointRowsByParent(rows.transcriptionCheckpoints);
	if (transcriptionCheckpoints.length)
		await trx
			.insertInto('transcription_checkpoints')
			.values(transcriptionCheckpoints)
			.execute();
	for (const input of rows.transcriptionVerseInputs) {
		await replaceTranscriptionVerseIndexRows(trx, input.transcriptionId, input.contentJson);
	}
	if (rows.collations.length)
		await trx.insertInto('collations').values(rows.collations).execute();
	if (rows.collationArtifacts.length)
		await trx.insertInto('collation_artifacts').values(rows.collationArtifacts).execute();
	if (rows.collationWitnesses.length)
		await trx.insertInto('collation_witnesses').values(rows.collationWitnesses).execute();
	if (rows.collationTokens.length)
		await trx.insertInto('collation_tokens').values(rows.collationTokens).execute();
	if (rows.collationVariationUnits.length)
		await trx
			.insertInto('collation_variation_units')
			.values(rows.collationVariationUnits)
			.execute();
	if (rows.collationReadings.length)
		await trx.insertInto('collation_readings').values(rows.collationReadings).execute();
	if (rows.collationReadingWitnesses.length)
		await trx
			.insertInto('collation_reading_witnesses')
			.values(rows.collationReadingWitnesses)
			.execute();
	const collationCheckpoints = sortCheckpointRowsByParent(rows.collationCheckpoints);
	if (collationCheckpoints.length)
		await trx.insertInto('collation_checkpoints').values(collationCheckpoints).execute();
	if (rows.tombstones.length)
		await trx.insertInto('sync_tombstones').values(rows.tombstones).execute();
}

function sortCheckpointRowsByParent<
	TRow extends { id?: string | null; parent_checkpoint_id?: string | null },
>(rows: TRow[]): TRow[] {
	const byId = new Map(rows.flatMap(row => (row.id ? [[row.id, row] as const] : [])));
	const sorted: TRow[] = [];
	const visited = new Set<string>();
	const visiting = new Set<string>();

	for (const row of rows) visit(row);
	return sorted;

	function visit(row: TRow): void {
		const id = row.id;
		if (!id || visited.has(id)) return;
		if (visiting.has(id)) return;
		visiting.add(id);
		const parent = row.parent_checkpoint_id ? byId.get(row.parent_checkpoint_id) : null;
		if (parent) visit(parent);
		visiting.delete(id);
		visited.add(id);
		sorted.push(row);
	}
}

async function clearIndexTables(trx: DbTransaction): Promise<void> {
	for (const tableName of INDEX_TABLE_DELETE_ORDER) {
		await sql.raw(`DELETE FROM ${quoteIdent(tableName)}`).execute(trx);
	}
}

async function recordOrphanedPrimaries(
	projectSlug: string,
	folderName: 'transcriptions' | 'collations',
	referencedRelativePaths: Set<string>,
	report: IndexRebuildReport,
	storeOptions: StoreOperationOptions
): Promise<void> {
	const folder = joinStorePath(projectFolder(projectSlug), folderName);
	for (const entry of await listDirectoryIfExists(folder, storeOptions)) {
		if (!isPrimaryJsonFile(entry)) continue;
		const relativePath = joinStorePath(folderName, entry.name);
		if (!referencedRelativePaths.has(relativePath)) {
			report.orphanedFiles.push(joinStorePath(projectFolder(projectSlug), relativePath));
		}
	}
}

async function readCanonicalFile<TPayload extends JsonObject>(
	format: string,
	path: string,
	report: IndexRebuildReport,
	storeOptions: StoreOperationOptions
): Promise<TPayload | null> {
	try {
		const raw = await readTextFile(path, storeOptions);
		const result = await readCanonicalDocument<TPayload>(format, raw);
		if (result.ok) return result.payload;
		recordQuarantine(report, path, result.quarantine);
	} catch (error) {
		recordQuarantine(report, path, quarantineFromError(error));
	}
	return null;
}

async function readOptionalCanonicalFile<TPayload extends JsonObject>(
	format: string,
	path: string,
	report: IndexRebuildReport,
	storeOptions: StoreOperationOptions
): Promise<TPayload | null> {
	try {
		const raw = await readTextFile(path, storeOptions);
		const result = await readCanonicalDocument<TPayload>(format, raw);
		if (result.ok) return result.payload;
		recordQuarantine(report, path, result.quarantine);
	} catch (error) {
		if (isMissingStoreEntryError(error)) return null;
		recordQuarantine(report, path, quarantineFromError(error));
	}
	return null;
}

async function validateFilePayload(
	path: string,
	report: IndexRebuildReport,
	validate: () => Promise<void>
): Promise<boolean> {
	try {
		await validate();
		return true;
	} catch (error) {
		recordQuarantine(report, path, quarantineFromError(error));
		return false;
	}
}

async function listDirectoryIfExists(
	path: string,
	storeOptions: StoreOperationOptions
): Promise<StoreDirectoryEntry[]> {
	try {
		return await listDirectory(path, storeOptions);
	} catch (error) {
		if (isMissingStoreEntryError(error)) return [];
		throw error;
	}
}

function recordQuarantine(
	report: IndexRebuildReport,
	path: string,
	quarantine: StoreQuarantineReason
): void {
	report.quarantinedFiles.push({ path, timestamp: new Date().toISOString(), ...quarantine });
}

function isJsonFile(entry: StoreDirectoryEntry): boolean {
	return entry.kind === 'file' && entry.name.endsWith('.json');
}

function isPrimaryJsonFile(entry: StoreDirectoryEntry): boolean {
	return (
		isJsonFile(entry) && !entry.name.endsWith('.working.json') && !entry.name.includes('.tmp-')
	);
}

function isMissingStoreEntryError(error: unknown): boolean {
	if (typeof DOMException !== 'undefined' && error instanceof DOMException) {
		return error.name === 'NotFoundError';
	}
	return error instanceof Error && /not found/i.test(error.message);
}

function createEmptyReport(): IndexRebuildReport {
	return {
		projectsRestored: 0,
		transcriptionsRestored: 0,
		collationsRestored: 0,
		transcriptionCheckpointsRestored: 0,
		collationCheckpointsRestored: 0,
		tombstonesRestored: 0,
		quarantinedFiles: [],
		orphanedFiles: [],
	};
}

function createEmptyRows(): RebuildRows {
	return {
		projects: [],
		transcriptions: [],
		projectTranscriptions: [],
		iiifManifestSources: [],
		pageCanvasLinks: [],
		canvasAnnotations: [],
		transcriptionCheckpoints: [],
		transcriptionVerseInputs: [],
		collations: [],
		collationArtifacts: [],
		collationWitnesses: [],
		collationTokens: [],
		collationVariationUnits: [],
		collationReadings: [],
		collationReadingWitnesses: [],
		collationCheckpoints: [],
		tombstones: [],
	};
}

function quoteIdent(value: string): string {
	return `"${value.replace(/"/g, '""')}"`;
}
