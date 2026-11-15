import { sql, type Insertable, type Kysely, type Transaction } from 'kysely';

import {
	CBGM_ANALYSIS_ENTITY_TYPE,
	CBGM_ANALYSIS_FORMAT,
	PROJECT_MANIFEST_FORMAT,
	TOMBSTONE_FORMAT,
	parseCollationPayloadTei,
	parseCollationTeiVersionHeader,
	parseTranscriptionTei,
	parseTranscriptionTeiVersion,
	readCanonicalDocument,
	type CbgmAnalysisMetadata,
	type CollationPayload,
	type ProjectManifestPayload,
	type ProjectTranscriptionPayload,
	type TombstonePayload,
} from '$lib/storage/formats';
import { teiContentHash } from '$lib/storage/tei-content';
import {
	cbgmFolder,
	collationHistoryFolder,
	joinStorePath,
	projectFolder,
	projectManifestFile,
	projectsFolder,
	transcriptionHistoryFolder,
} from '$lib/storage/layout';
import {
	classifyDocumentPath,
	documentCanonicalPath,
	documentStorageOfPath,
	legacyDocumentPaths,
	type DocumentKind,
} from '$lib/storage/document-files';
import { hashContent } from '$lib/storage/content-hash';
import {
	listDirectory,
	readTextFile,
	statFile,
	type StoreDirectoryEntry,
	type StoreOperationOptions,
} from '$lib/storage/opfs-store';
import {
	quarantineFromError,
	type StoreQuarantineReason,
	type StoreQuarantineRecord,
} from '$lib/storage/quarantine';
import type { JsonObject } from '$lib/storage/envelope';

import type {
	CbgmAnalyses,
	CollationArtifacts,
	CollationCheckpoints,
	CollationReadingWitnesses,
	CollationReadings,
	CollationTokens,
	CollationVariationUnits,
	CollationWitnesses,
	Collations,
	Database,
	DocumentFileFingerprints,
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
import { buildSerializedCollationProjectionRows } from '$lib/collation/collation-projection';
import { writeProjectManifestPayloadFile } from './project-files';
import { cbgmAnalysisIndexRow } from './cbgm-analyses';
import { collationIndexRowsFromPayload } from './collations';
import {
	documentFingerprintRow,
	type DocumentFingerprintEntityType,
} from './document-fingerprints';

type DbTransaction = Transaction<Database>;

export interface IndexRebuildReport {
	projectsRestored: number;
	transcriptionsRestored: number;
	collationsRestored: number;
	transcriptionCheckpointsRestored: number;
	collationCheckpointsRestored: number;
	tombstonesRestored: number;
	quarantinedFiles: StoreQuarantineRecord[];
	orphanedFiles: OrphanedFileRecord[];
}

type OrphanedFileCode =
	| 'missing_project_manifest'
	| 'invalid_project_manifest'
	| 'unreferenced_primary'
	| 'unreferenced_working'
	| 'unreferenced_history'
	| 'unreferenced_tombstone'
	| 'unreferenced_tei'
	| 'stale_working';

interface OrphanedFileRecord {
	path: string;
	code: OrphanedFileCode;
	message: string;
	recoverable: boolean;
	projectSlug: string;
	entityType?: 'transcription' | 'collation';
	entityId?: string;
}

interface RebuildRows {
	projects: Insertable<Projects>[];
	transcriptions: Insertable<Transcriptions>[];
	projectTranscriptions: Insertable<ProjectTranscriptions>[];
	iiifManifestSources: Insertable<IiifManifestSources>[];
	pageCanvasLinks: Insertable<TranscriptionPageCanvasLinks>[];
	canvasAnnotations: Insertable<IiifCanvasAnnotations>[];
	transcriptionCheckpoints: Insertable<TranscriptionCheckpoints>[];
	transcriptionVerseInputs: Array<{
		transcriptionId: string;
		projectTranscriptionId: string;
		contentJson: string;
	}>;
	collations: Insertable<Collations>[];
	collationArtifacts: Insertable<CollationArtifacts>[];
	collationWitnesses: Insertable<CollationWitnesses>[];
	collationTokens: Insertable<CollationTokens>[];
	collationVariationUnits: Insertable<CollationVariationUnits>[];
	collationReadings: Insertable<CollationReadings>[];
	collationReadingWitnesses: Insertable<CollationReadingWitnesses>[];
	collationCheckpoints: Insertable<CollationCheckpoints>[];
	cbgmAnalyses: Insertable<CbgmAnalyses>[];
	tombstones: Insertable<SyncTombstones>[];
	documentFingerprints: Insertable<DocumentFileFingerprints>[];
}

const INDEX_TABLE_DELETE_ORDER = [
	'sync_file_fingerprints',
	'document_file_problems',
	'document_file_fingerprints',
	'cbgm_analyses',
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
	'transcription_slice_chunks',
	'transcription_verse_index',
	'transcription_verse_index_state',
	'transcription_checkpoints',
	'project_transcriptions',
	'transcriptions',
	'sync_tombstones',
	'projects',
] as const satisfies ReadonlyArray<keyof Database>;

export interface IndexRebuildProgress {
	done: number;
	total: number;
	phase?: 'conversion';
}

class RebuildProgress {
	done = 0;
	total = 0;
	constructor(private readonly onProgress?: (progress: IndexRebuildProgress) => void) {}

	add(count: number) {
		this.total += count;
		this.onProgress?.({ done: this.done, total: this.total });
	}

	step() {
		this.done += 1;
		this.onProgress?.({ done: this.done, total: this.total });
	}

	finish() {
		this.onProgress?.({ done: this.total, total: this.total });
	}
}

export async function rebuildIndexFromStore(
	db: Kysely<Database>,
	storeOptions: StoreOperationOptions = {},
	onProgress?: (progress: IndexRebuildProgress) => void
): Promise<IndexRebuildReport> {
	const report = createEmptyReport();
	const progress = new RebuildProgress(onProgress);
	const rows = await collectIndexRowsFromStore(report, storeOptions, progress);

	await db.transaction().execute(async trx => {
		await clearIndexTables(trx);
		await insertIndexRows(trx, rows, progress);
	});
	progress.finish();

	report.projectsRestored = rows.projects.length;
	report.transcriptionsRestored = rows.transcriptions.length;
	report.collationsRestored = rows.collations.length;
	report.transcriptionCheckpointsRestored = rows.transcriptionCheckpoints.length;
	report.collationCheckpointsRestored = rows.collationCheckpoints.length;
	report.tombstonesRestored = rows.tombstones.length;
	return report;
}

export async function restoreOrphanPrimaryToProject(
	db: Kysely<Database>,
	path: string,
	storeOptions: StoreOperationOptions = {}
): Promise<IndexRebuildReport> {
	await addOrphanPrimaryToManifest(path, storeOptions);
	return rebuildIndexFromStore(db, storeOptions);
}

export async function addOrphanPrimaryToManifest(
	path: string,
	storeOptions: StoreOperationOptions = {}
): Promise<void> {
	const [, projectSlug = '', relativePath = ''] = /^projects\/([^/]+)\/(.+)$/.exec(path) ?? [];
	const file = classifyDocumentPath(relativePath);
	if (!file || !(await isTeiDocumentPrimary(projectSlug, relativePath, storeOptions)))
		throw new Error('Only canonical orphan primary paths can be restored.');
	const fileId = file.entityId;
	const manifestRead = await readCanonicalDocument<ProjectManifestPayload>(
		PROJECT_MANIFEST_FORMAT,
		await readTextFile(projectManifestFile(projectSlug), storeOptions)
	);
	if (!manifestRead.ok)
		throw new Error(`Project manifest is invalid: ${manifestRead.quarantine.message}`);
	const manifest = manifestRead.payload;

	if (file.kind === 'transcription') {
		const payload = parseTranscriptionTei(await readTextFile(path, storeOptions));
		if (payload.project_transcription_id !== fileId) {
			throw new Error('Orphan transcription identity does not match its canonical path.');
		}
		if (manifest.transcriptions.some(head => head.project_transcription_id === fileId)) {
			throw new Error(`Transcription ${fileId} is already present in the project manifest.`);
		}
		manifest.transcriptions = [
			...manifest.transcriptions,
			{
				project_transcription_id: payload.project_transcription_id,
				transcription_id: payload.id,
				current_revision: payload.based_on_checkpoint && {
					id: payload.based_on_checkpoint.id,
					content_hash: payload.based_on_checkpoint.content_hash,
				},
				title: payload.title,
				siglum: payload.siglum,
				primary_path: documentCanonicalPath('transcription', fileId),
			},
		].sort((left, right) =>
			left.project_transcription_id.localeCompare(right.project_transcription_id)
		);
	} else {
		const payload = parseCollationPayloadTei(await readTextFile(path, storeOptions));
		if (payload.id !== fileId || payload.project_id !== manifest.id) {
			throw new Error(
				'Orphan collation identity does not match its project and canonical path.'
			);
		}
		if (manifest.collations.some(head => head.collation_id === fileId)) {
			throw new Error(`Collation ${fileId} is already present in the project manifest.`);
		}
		manifest.collations = [
			...manifest.collations,
			{
				collation_id: payload.id,
				current_revision: payload.based_on_checkpoint && {
					id: payload.based_on_checkpoint.id,
					content_hash: payload.based_on_checkpoint.content_hash,
				},
				title: payload.title,
				verse_identifier: payload.verse_identifier,
				primary_path: documentCanonicalPath('collation', fileId),
			},
		].sort((left, right) => left.collation_id.localeCompare(right.collation_id));
	}

	await writeProjectManifestPayloadFile(projectSlug, manifest, storeOptions);
}

// Beside a JSON document awaiting conversion, a TEI file is an older build's export.
async function isTeiDocumentPrimary(
	projectSlug: string,
	relativePath: string,
	storeOptions: StoreOperationOptions
): Promise<boolean> {
	const file = classifyDocumentPath(relativePath);
	return (
		file?.role === 'unlisted' &&
		!(await storeFileExists(
			joinStorePath(
				projectFolder(projectSlug),
				legacyDocumentPaths(file.kind, file.entityId).primary
			),
			storeOptions
		))
	);
}

async function collectIndexRowsFromStore(
	report: IndexRebuildReport,
	storeOptions: StoreOperationOptions,
	progress: RebuildProgress
): Promise<RebuildRows> {
	const rows = createEmptyRows();
	const projectEntries = await listDirectoryIfExists(projectsFolder(), storeOptions);
	for (const entry of projectEntries) {
		if (entry.kind !== 'directory') continue;
		await collectProjectRows(entry.name, rows, report, storeOptions, progress);
	}
	return rows;
}

async function collectProjectRows(
	projectSlug: string,
	rows: RebuildRows,
	report: IndexRebuildReport,
	storeOptions: StoreOperationOptions,
	progress: RebuildProgress
): Promise<void> {
	const manifestPath = projectManifestFile(projectSlug);
	const manifestExists = await storeFileExists(manifestPath, storeOptions);
	const manifest = await readCanonicalFile<ProjectManifestPayload>(
		PROJECT_MANIFEST_FORMAT,
		manifestPath,
		report,
		storeOptions
	);
	if (!manifest) {
		report.orphanedFiles.push({
			path: projectFolder(projectSlug),
			code: manifestExists ? 'invalid_project_manifest' : 'missing_project_manifest',
			message: manifestExists
				? 'Project directory has an invalid manifest. Repair the manifest before restoring its files.'
				: 'Project directory has no project.json manifest. Its files were left unchanged.',
			recoverable: false,
			projectSlug,
		});
		await recordProjectOrphans(projectSlug, null, report, storeOptions);
		return;
	}

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

	// Count transcriptions twice: once when read, once when verse-indexed.
	progress.add(manifest.transcriptions.length * 2 + manifest.collations.length);
	// A JSON head awaits conversion to TEI, which indexes it when its project is opened.
	for (const head of manifest.transcriptions) {
		if (documentStorageOfPath(head.primary_path) !== 'tei') continue;
		await collectTranscriptionRows(
			projectSlug,
			manifest.id,
			head.primary_path,
			rows,
			report,
			storeOptions,
			progress
		);
		progress.step();
	}

	for (const head of manifest.collations) {
		if (documentStorageOfPath(head.primary_path) !== 'tei') continue;
		await collectCollationRows(
			projectSlug,
			manifest.id,
			head.primary_path,
			rows,
			report,
			storeOptions,
			progress
		);
		progress.step();
	}

	for (const head of manifest.tombstones) {
		await collectTombstoneRow(projectSlug, head.primary_path, rows, report, storeOptions);
	}
	await collectCbgmAnalysisRows(projectSlug, manifest, rows, report, storeOptions);
	await recordProjectOrphans(projectSlug, manifest, report, storeOptions);
}

async function collectCbgmAnalysisRows(
	projectSlug: string,
	manifest: ProjectManifestPayload,
	rows: RebuildRows,
	report: IndexRebuildReport,
	storeOptions: StoreOperationOptions
): Promise<void> {
	const deleted = new Set(
		manifest.tombstones
			.filter(head => head.entity_type === CBGM_ANALYSIS_ENTITY_TYPE)
			.map(head => head.entity_id)
	);
	for (const entry of await listDirectoryIfExists(cbgmFolder(projectSlug), storeOptions)) {
		if (!isJsonFile(entry)) continue;
		const path = joinStorePath(cbgmFolder(projectSlug), entry.name);
		try {
			const result = await readCanonicalDocument<CbgmAnalysisMetadata>(
				CBGM_ANALYSIS_FORMAT,
				await readTextFile(path, storeOptions),
				{ projectPath: `cbgm/${entry.name}`, projectId: manifest.id }
			);
			if (!result.ok) recordQuarantine(report, path, result.quarantine);
			else if (!deleted.has(result.payload.id))
				rows.cbgmAnalyses.push(cbgmAnalysisIndexRow(result.payload));
		} catch (error) {
			recordQuarantine(report, path, quarantineFromError(error));
		}
	}
}

async function collectTranscriptionRows(
	projectSlug: string,
	projectId: string,
	primaryRelativePath: string,
	rows: RebuildRows,
	report: IndexRebuildReport,
	storeOptions: StoreOperationOptions,
	progress: RebuildProgress
): Promise<void> {
	const primaryPath = joinStorePath(projectFolder(projectSlug), primaryRelativePath);
	const entityId = classifyDocumentPath(primaryRelativePath)?.entityId;
	try {
		const xml = await readTextFile(primaryPath, storeOptions);
		const payload = parseTranscriptionTei(xml);
		if (payload.project_transcription_id !== entityId) {
			recordQuarantine(report, primaryPath, {
				code: 'invalid_shape',
				message: `Transcription TEI identity ${payload.project_transcription_id} does not match ${primaryRelativePath}.`,
			});
			return;
		}
		rows.documentFingerprints.push(
			await readFingerprint(
				primaryPath,
				primaryRelativePath,
				'transcription',
				entityId,
				xml,
				storeOptions
			)
		);
		pushTranscriptionRows(rows, projectId, payload, payload);
	} catch (error) {
		recordQuarantine(report, primaryPath, quarantineFromError(error));
		return;
	}
	await collectTranscriptionCheckpointRows(
		projectSlug,
		entityId,
		rows,
		report,
		storeOptions,
		progress
	);
}

async function readFingerprint(
	storePath: string,
	path: string,
	entityType: DocumentFingerprintEntityType,
	entityId: string,
	xml: string,
	storeOptions: StoreOperationOptions
): Promise<Insertable<DocumentFileFingerprints>> {
	const [fileHash, contentHash, stat] = await Promise.all([
		hashContent(xml),
		teiContentHash(xml),
		statFile(storePath, storeOptions),
	]);
	return documentFingerprintRow(
		{ path, entityType, entityId, xml, fileHash, contentHash },
		stat.lastModified
	);
}

function pushTranscriptionRows(
	rows: RebuildRows,
	projectId: string,
	payload: ProjectTranscriptionPayload,
	indexPayload: ProjectTranscriptionPayload
): void {
	const indexRows = transcriptionIndexRowsFromPrimary(projectId, payload, indexPayload);
	rows.transcriptions.push(indexRows.transcription);
	rows.projectTranscriptions.push(indexRows.projectTranscription);
	rows.transcriptionVerseInputs.push({
		transcriptionId: payload.id,
		projectTranscriptionId: payload.project_transcription_id,
		contentJson: indexRows.transcription.content_json,
	});
	rows.iiifManifestSources.push(...indexRows.iiifManifestSources);
	rows.pageCanvasLinks.push(...indexRows.pageCanvasLinks);
	rows.canvasAnnotations.push(...indexRows.canvasAnnotations);
}

export function transcriptionIndexRowsFromPrimary(
	projectId: string,
	payload: ProjectTranscriptionPayload,
	indexPayload: ProjectTranscriptionPayload = payload
) {
	const contentJson = JSON.stringify(indexPayload.content_json);
	const transcription = {
		id: payload.id,
		project_id: projectId,
		origin_type: indexPayload.origin.source_type,
		origin_project_id: indexPayload.origin.source_project_id,
		origin_transcription_id: indexPayload.origin.source_transcription_id,
		origin_revision_id: indexPayload.origin.source_revision_id ?? '',
		origin_content_hash: indexPayload.origin.source_content_hash ?? '',
		origin_captured_at: indexPayload.origin.source_captured_at ?? '',
		current_revision_id: payload.based_on_checkpoint?.id ?? '',
		current_content_hash: payload.based_on_checkpoint?.content_hash ?? '',
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
	};
	const projectTranscription = {
		id: payload.project_transcription_id,
		project_id: projectId,
		transcription_id: payload.id,
		canonical_transcription_id: payload.canonical_transcription_id,
		added_at: payload.created_at,
	};

	const iiifManifestSources = indexPayload.iiif_manifest_sources.map(source => ({
		id: source.id,
		transcription_id: payload.id,
		manifest_url: source.manifest_url,
		label: source.label,
		source_kind: source.source_kind,
		default_canvas_id: source.default_canvas_id,
		default_image_service_url: source.default_image_service_url,
		synthetic_canvases_json: JSON.stringify(source.synthetic_canvases),
		created_at: indexPayload.created_at,
		updated_at: indexPayload.updated_at,
	}));
	const pageCanvasLinks = indexPayload.page_canvas_links.map(link => ({
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
	}));
	const canvasAnnotations = indexPayload.canvas_annotations.map(annotation => ({
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
	}));
	return {
		transcription,
		projectTranscription,
		iiifManifestSources,
		pageCanvasLinks,
		canvasAnnotations,
	};
}

async function collectCollationRows(
	projectSlug: string,
	projectId: string,
	primaryRelativePath: string,
	rows: RebuildRows,
	report: IndexRebuildReport,
	storeOptions: StoreOperationOptions,
	progress: RebuildProgress
): Promise<void> {
	const primaryPath = joinStorePath(projectFolder(projectSlug), primaryRelativePath);
	const entityId = classifyDocumentPath(primaryRelativePath)?.entityId ?? '';
	try {
		const xml = await readTextFile(primaryPath, storeOptions);
		const payload = parseCollationPayloadTei(xml);
		if (payload.id !== entityId || payload.project_id !== projectId) {
			recordQuarantine(report, primaryPath, {
				code: 'invalid_shape',
				message: `Collation TEI identity ${payload.id} does not match ${primaryRelativePath} in project ${projectId}.`,
			});
			return;
		}
		rows.documentFingerprints.push(
			await readFingerprint(
				primaryPath,
				primaryRelativePath,
				'collation',
				entityId,
				xml,
				storeOptions
			)
		);
		const indexRows = collationIndexRowsFromPayload(projectId, payload);
		rows.collations.push(indexRows.collation);
		rows.collationArtifacts.push(indexRows.artifact);
		pushCollationProjectionRows(rows, projectId, payload.id, payload);
	} catch (error) {
		recordQuarantine(report, primaryPath, quarantineFromError(error));
		return;
	}
	await collectCollationCheckpointRows(
		projectSlug,
		entityId,
		rows,
		report,
		storeOptions,
		progress
	);
}

function pushCollationProjectionRows(
	rows: RebuildRows,
	projectId: string,
	collationId: string,
	payload: CollationPayload
): void {
	const projectTranscriptionIds = new Map(
		rows.projectTranscriptions
			.filter(row => row.project_id === projectId)
			.flatMap(row => (row.id ? [[row.transcription_id, row.id] as const] : []))
	);
	const projection = buildSerializedCollationProjectionRows(
		collationId,
		payload.document,
		projectTranscriptionIds
	);
	for (const witness of projection.witnesses) {
		rows.collationWitnesses.push({
			...witness,
			collation_id: collationId,
		});
	}
	for (const token of projection.tokens) {
		rows.collationTokens.push({
			...token,
			collation_id: collationId,
		});
	}
	for (const unit of projection.variation_units) {
		rows.collationVariationUnits.push({
			...unit,
			collation_id: collationId,
		});
	}
	for (const reading of projection.readings) {
		rows.collationReadings.push({
			...reading,
			is_lacuna: reading.is_lacuna ? 1 : 0,
			is_omission: reading.is_omission ? 1 : 0,
		});
	}
	const witnessIndexByReading = new Map<string, number>();
	for (const witness of projection.reading_witnesses) {
		const index = witnessIndexByReading.get(witness.reading_id) ?? 0;
		witnessIndexByReading.set(witness.reading_id, index + 1);
		rows.collationReadingWitnesses.push({
			id: `${witness.reading_id}:witness:${index}`,
			...witness,
		});
	}
}

async function collectTranscriptionCheckpointRows(
	projectSlug: string,
	projectTranscriptionId: string,
	rows: RebuildRows,
	report: IndexRebuildReport,
	storeOptions: StoreOperationOptions,
	progress: RebuildProgress
): Promise<void> {
	const folder = transcriptionHistoryFolder(projectSlug, projectTranscriptionId);
	const documentRows: Insertable<TranscriptionCheckpoints>[] = [];
	const entries = await listDirectoryIfExists(folder, storeOptions);
	// JSON Version files are strays from an unfinished conversion.
	const teiEntries = entries.filter(isTeiFile);
	progress.add(teiEntries.length);
	for (const entry of teiEntries) {
		const row = await readTeiTranscriptionVersionRow(
			projectSlug,
			projectTranscriptionId,
			entry,
			rows,
			report,
			storeOptions
		);
		if (row) documentRows.push(row);
		progress.step();
	}
	rows.transcriptionCheckpoints.push(...numberUnlabelledVersions(documentRows));
}

async function readTeiTranscriptionVersionRow(
	projectSlug: string,
	projectTranscriptionId: string,
	entry: StoreDirectoryEntry,
	rows: RebuildRows,
	report: IndexRebuildReport,
	storeOptions: StoreOperationOptions
): Promise<Insertable<TranscriptionCheckpoints> | null> {
	const relativePath = entry.path.slice(projectFolder(projectSlug).length + 1);
	const versionId = classifyDocumentPath(relativePath)?.versionId;
	try {
		const xml = await readTextFile(entry.path, storeOptions);
		const header = parseTranscriptionTeiVersion(xml);
		const version = header.version;
		if (
			!version ||
			version.id !== versionId ||
			header.projectTranscriptionId !== projectTranscriptionId
		) {
			recordQuarantine(report, entry.path, {
				code: 'invalid_shape',
				message: `Transcription Version file does not record Version ${versionId} of ${projectTranscriptionId}.`,
			});
			return null;
		}
		const fingerprint = await readFingerprint(
			entry.path,
			relativePath,
			'version',
			version.id,
			xml,
			storeOptions
		);
		rows.documentFingerprints.push(fingerprint);
		return {
			id: version.id,
			transcription_id: header.transcriptionId,
			parent_checkpoint_id: version.parent_id,
			format: header.contentFormat,
			content_hash: fingerprint.content_hash,
			is_committed: 1,
			label: version.label,
			commit_message: version.note,
			author_name: version.author_name,
			created_at: version.created_at,
		};
	} catch (error) {
		recordQuarantine(report, entry.path, quarantineFromError(error));
		return null;
	}
}

async function collectCollationCheckpointRows(
	projectSlug: string,
	collationId: string,
	rows: RebuildRows,
	report: IndexRebuildReport,
	storeOptions: StoreOperationOptions,
	progress: RebuildProgress
): Promise<void> {
	const folder = collationHistoryFolder(projectSlug, collationId);
	const documentRows: Insertable<CollationCheckpoints>[] = [];
	const entries = await listDirectoryIfExists(folder, storeOptions);
	const teiEntries = entries.filter(isTeiFile);
	progress.add(teiEntries.length);
	for (const entry of teiEntries) {
		const row = await readTeiCollationVersionRow(
			projectSlug,
			collationId,
			entry,
			rows,
			report,
			storeOptions
		);
		if (row) documentRows.push(row);
		progress.step();
	}
	rows.collationCheckpoints.push(...numberUnlabelledVersions(documentRows));
}

async function readTeiCollationVersionRow(
	projectSlug: string,
	collationId: string,
	entry: StoreDirectoryEntry,
	rows: RebuildRows,
	report: IndexRebuildReport,
	storeOptions: StoreOperationOptions
): Promise<Insertable<CollationCheckpoints> | null> {
	const relativePath = entry.path.slice(projectFolder(projectSlug).length + 1);
	const versionId = classifyDocumentPath(relativePath)?.versionId;
	try {
		const xml = await readTextFile(entry.path, storeOptions);
		const version = parseCollationTeiVersionHeader(xml);
		if (!version || version.id !== versionId) {
			recordQuarantine(report, entry.path, {
				code: 'invalid_shape',
				message: `Collation Version file does not record Version ${versionId} of ${collationId}.`,
			});
			return null;
		}
		const fingerprint = await readFingerprint(
			entry.path,
			relativePath,
			'version',
			version.id,
			xml,
			storeOptions
		);
		rows.documentFingerprints.push(fingerprint);
		return {
			id: version.id,
			collation_id: collationId,
			parent_checkpoint_id: version.parent_id,
			content_hash: fingerprint.content_hash,
			is_committed: 1,
			label: version.label,
			commit_message: version.note,
			author_name: version.author_name,
			created_at: version.created_at,
		};
	} catch (error) {
		recordQuarantine(report, entry.path, quarantineFromError(error));
		return null;
	}
}

export function numberUnlabelledVersions<
	TRow extends { id?: string | null; label?: string; created_at: string },
>(rows: TRow[]): TRow[] {
	const byDate = [...rows].sort(
		(left, right) =>
			left.created_at.localeCompare(right.created_at) ||
			(left.id ?? '').localeCompare(right.id ?? '')
	);
	return byDate.map((row, index) =>
		row.label ? row : { ...row, label: `Version ${index + 1}` }
	);
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

async function insertIndexRows(
	trx: DbTransaction,
	rows: RebuildRows,
	progress: RebuildProgress
): Promise<void> {
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
	if (rows.documentFingerprints.length)
		await trx
			.insertInto('document_file_fingerprints')
			.values(rows.documentFingerprints)
			.execute();
	const transcriptionCheckpoints = sortCheckpointRowsByParent(rows.transcriptionCheckpoints);
	if (transcriptionCheckpoints.length)
		await trx
			.insertInto('transcription_checkpoints')
			.values(transcriptionCheckpoints)
			.execute();
	for (const input of rows.transcriptionVerseInputs) {
		await replaceTranscriptionVerseIndexRows(trx, input.transcriptionId, input.contentJson);
		progress.step();
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
	if (rows.cbgmAnalyses.length)
		await trx.insertInto('cbgm_analyses').values(rows.cbgmAnalyses).execute();
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

async function recordProjectOrphans(
	projectSlug: string,
	manifest: ProjectManifestPayload | null,
	report: IndexRebuildReport,
	storeOptions: StoreOperationOptions
): Promise<void> {
	const referencedFiles = new Set<string>([projectManifestFile(projectSlug)]);
	const referencedHistoryFolders = new Set<string>();
	const referenceDocument = (kind: DocumentKind, id: string, primaryPath: string) => {
		for (const path of [
			primaryPath,
			documentCanonicalPath(kind, id),
			legacyDocumentPaths(kind, id).working,
		])
			referencedFiles.add(joinStorePath(projectFolder(projectSlug), path));
	};
	for (const head of manifest?.transcriptions ?? []) {
		referenceDocument('transcription', head.project_transcription_id, head.primary_path);
		referencedHistoryFolders.add(
			transcriptionHistoryFolder(projectSlug, head.project_transcription_id)
		);
	}
	for (const head of manifest?.collations ?? []) {
		referenceDocument('collation', head.collation_id, head.primary_path);
		referencedHistoryFolders.add(collationHistoryFolder(projectSlug, head.collation_id));
	}
	for (const head of manifest?.tombstones ?? []) {
		referencedFiles.add(joinStorePath(projectFolder(projectSlug), head.primary_path));
	}

	for (const path of await listFilesRecursively(projectFolder(projectSlug), storeOptions)) {
		if (referencedFiles.has(path)) continue;
		if ([...referencedHistoryFolders].some(folder => path.startsWith(`${folder}/`))) continue;
		const orphan = await classifyOrphan(path, projectSlug, manifest, report, storeOptions);
		if (orphan) report.orphanedFiles.push(orphan);
	}
}

async function classifyOrphan(
	path: string,
	projectSlug: string,
	manifest: ProjectManifestPayload | null,
	report: IndexRebuildReport,
	storeOptions: StoreOperationOptions
): Promise<OrphanedFileRecord | null> {
	const relativePath = path.slice(`${projectFolder(projectSlug)}/`.length);
	const file = classifyDocumentPath(relativePath);
	if (file?.role === 'legacy') {
		if (file.versionId)
			return orphanRecord(
				path,
				projectSlug,
				'unreferenced_history',
				'History file has no manifest entity.'
			);
		return relativePath === legacyDocumentPaths(file.kind, file.entityId).working
			? orphanRecord(
					path,
					projectSlug,
					'unreferenced_working',
					'Working file has no manifest entity.'
				)
			: {
					path,
					code: 'unreferenced_primary',
					message:
						'Unreferenced primary cannot be restored automatically. It is a JSON document from before TEI.',
					recoverable: false,
					projectSlug,
					entityType: file.kind,
					entityId: file.entityId,
				};
	}
	if (file && (await isTeiDocumentPrimary(projectSlug, relativePath, storeOptions))) {
		const entityType = file.kind;
		let entityId: string | undefined;
		let recoverable = false;
		let validationMessage = '';
		try {
			const raw = await readTextFile(path, storeOptions);
			const payload =
				entityType === 'transcription'
					? parseTranscriptionTei(raw)
					: parseCollationPayloadTei(raw);
			entityId =
				entityType === 'transcription'
					? (payload as ProjectTranscriptionPayload).project_transcription_id
					: (payload as CollationPayload).id;
			const ownsProject =
				entityType === 'transcription' ||
				(payload as CollationPayload).project_id === manifest?.id;
			recoverable = Boolean(manifest && entityId === file.entityId && ownsProject);
			if (!recoverable)
				validationMessage = ' The file identity does not match this project path.';
		} catch (error) {
			const quarantine = quarantineFromError(error);
			recordQuarantine(report, path, quarantine);
			validationMessage = ` ${quarantine.message}`;
		}
		return {
			path,
			code: 'unreferenced_primary',
			message: recoverable
				? 'Valid canonical primary is not referenced by the project manifest.'
				: `Unreferenced primary cannot be restored automatically.${validationMessage}`,
			recoverable,
			projectSlug,
			entityType,
			entityId,
		};
	}
	if (file?.role === 'version') {
		return orphanRecord(
			path,
			projectSlug,
			'unreferenced_history',
			'History file has no manifest entity.'
		);
	}
	if (/^tombstones\/.+\.json$/.test(relativePath)) {
		return orphanRecord(
			path,
			projectSlug,
			'unreferenced_tombstone',
			'Tombstone is not referenced by the project manifest.'
		);
	}
	if (file?.role === 'unlisted') {
		return orphanRecord(
			path,
			projectSlug,
			'unreferenced_tei',
			'TEI sibling has no manifest entity.'
		);
	}
	return null;
}

function orphanRecord(
	path: string,
	projectSlug: string,
	code: OrphanedFileCode,
	message: string
): OrphanedFileRecord {
	return { path, code, message, recoverable: false, projectSlug };
}

async function listFilesRecursively(
	folder: string,
	storeOptions: StoreOperationOptions
): Promise<string[]> {
	const files: string[] = [];
	for (const entry of await listDirectoryIfExists(folder, storeOptions)) {
		const path = joinStorePath(folder, entry.name);
		if (entry.kind === 'file') files.push(path);
		else files.push(...(await listFilesRecursively(path, storeOptions)));
	}
	return files;
}

async function storeFileExists(
	path: string,
	storeOptions: StoreOperationOptions
): Promise<boolean> {
	try {
		await readTextFile(path, storeOptions);
		return true;
	} catch (error) {
		if (isMissingStoreEntryError(error)) return false;
		throw error;
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

function isTeiFile(entry: StoreDirectoryEntry): boolean {
	return entry.kind === 'file' && documentStorageOfPath(entry.name) === 'tei';
}

function isJsonFile(entry: StoreDirectoryEntry): boolean {
	return entry.kind === 'file' && entry.name.endsWith('.json');
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
		cbgmAnalyses: [],
		tombstones: [],
		documentFingerprints: [],
	};
}

function quoteIdent(value: string): string {
	return `"${value.replace(/"/g, '""')}"`;
}
