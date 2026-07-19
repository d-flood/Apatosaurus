import type { Kysely, Selectable, Transaction } from 'kysely';

import type {
	Database,
	IiifCanvasAnnotations,
	IiifManifestSources,
	Projects,
	ProjectTranscriptions,
	TranscriptionCheckpoints,
	TranscriptionPageCanvasLinks,
	Transcriptions,
} from '../types.generated';
import { createId } from './id';
import {
	deriveEntityCloudBackupState,
	type EntityCloudBackupState,
	type SyncProjectContext,
} from '$lib/client/sync/backup-status';
import type { StoreOperationOptions } from '$lib/client/store';
import {
	canonicalJson,
	getTranscriptionCommittedHead,
	loadCommittedTranscriptionCheckpointPayload,
	type EntityCheckpointHead,
	type TranscriptionCheckpointPayload,
	type PersistenceWarning,
} from './revisions';
import { ensureDefaultProject, resolveProjectStorageSlug } from './project-bootstrap';
import {
	createCommittedTranscriptionCheckpointWithFiles,
	getProjectTranscriptionCheckpointStatusWithFiles,
} from './transcription-files';
import { replaceTranscriptionVerseIndexRows } from './transcriptions';
import { writeEmptyProjectManifestFile, writeProjectManifestFile } from './project-files';
import {
	createCommittedCollationCheckpointWithFiles,
	saveWorkingCollationArtifact,
} from './collation-files';
import { deleteTranscriptionWithFiles } from './entity-deletion';
import {
	PROJECT_MANIFEST_CURRENT_VERSION,
	PROJECT_MANIFEST_FORMAT,
	COLLATION_FORMAT,
	PROJECT_TRANSCRIPTION_FORMAT,
	collationPrimaryFile,
	transcriptionPrimaryFile,
	projectManifestFile,
	readCanonicalDocument,
	readTextFile,
	type CollationPayload,
	type ProjectManifestPayload,
	type ProjectTranscriptionPayload,
} from '$lib/client/store';

export { ensureDefaultProject } from './project-bootstrap';

type DbExecutor = Kysely<Database> | Transaction<Database>;

export interface ProjectOption {
	id: string;
	storageSlug: string;
	name: string;
	description: string;
	createdAt: string;
	updatedAt: string;
}

export interface ProjectRecord extends ProjectOption {
	charter: string;
	collationSettings: unknown;
}

export interface ProjectTranscriptionOption {
	id: string;
	siglum: string;
	displayLabel: string;
	title: string;
	description: string;
}

export interface TranscriptionSourceSummary {
	transcriptionId: string;
	projectId: string;
	projectName: string | null;
	title: string;
	siglum: string;
	currentCheckpoint: EntityCheckpointHead | null;
	dirtyToCheckpoint: boolean | null;
}

export interface TranscriptionOriginSummary {
	sourceType: string;
	sourceProjectId: string | null;
	sourceProjectName: string | null;
	sourceTranscriptionId: string | null;
	sourceRevisionId: string | null;
	sourceContentHash: string | null;
}

export type ProjectTranscriptionSourceState =
	| { kind: 'no-source' }
	| { kind: 'source-missing'; sourceTranscriptionId: string }
	| { kind: 'source-has-no-committed-version'; sourceTranscriptionId: string }
	| {
			kind: 'up-to-date';
			sourceTranscriptionId: string;
			sourceRevisionId: string;
			sourceContentHash: string;
	  }
	| {
			kind: 'newer-source-available';
			sourceTranscriptionId: string;
			sourceRevisionId: string;
			sourceContentHash: string;
	  }
	| {
			kind: 'source-has-uncommitted-changes';
			sourceTranscriptionId: string;
			sourceRevisionId: string | null;
			sourceContentHash: string | null;
	  };

export interface ProjectTranscriptionStatus {
	projectId: string;
	projectName: string | null;
	projectTranscriptionId: string;
	projectOwnedTranscriptionId: string;
	siglum: string;
	title: string;
	description: string;
	isProjectOwned: boolean;
	canonicalSource: TranscriptionSourceSummary | null;
	immediateSource: TranscriptionOriginSummary | null;
	currentCheckpoint: EntityCheckpointHead | null;
	workingContentHash: string;
	dirtyToCheckpoint: boolean;
	commitState: 'never-committed' | 'clean' | 'dirty';
	sourceState: ProjectTranscriptionSourceState;
	cloudBackupState?: EntityCloudBackupState;
	warnings?: PersistenceWarning[];
}

export interface ProjectTranscriptionStatusOptions {
	syncContext?: SyncProjectContext | null;
	requireFileBackedContent?: boolean;
	storeOptions?: StoreOperationOptions;
}

export interface ProjectDocumentTitle {
	entityType: 'project-transcription' | 'collation';
	entityId: string;
	title: string;
}

interface ProjectContentLoadOptions {
	requireFileBackedContent?: boolean;
	storeOptions?: StoreOperationOptions;
}

export interface CreateProjectInput {
	id?: string;
	storageSlug?: string;
	name: string;
	description?: string;
	charter?: string;
	collationSettings?: unknown;
	createdAt?: string;
	updatedAt?: string;
}

export interface UpdateProjectMetadataInput {
	projectId: string;
	name?: string;
	description?: string;
	charter?: string;
	collationSettings?: unknown;
	updatedAt?: string;
}

export interface ForkProjectInput {
	sourceProjectId: string;
	name?: string;
	description?: string;
	createdAt?: string;
}

export interface ForkProjectResult {
	projectId: string;
	projectTranscriptionIds: string[];
	projectOwnedTranscriptionIds: string[];
	collationIds: string[];
	warnings: PersistenceWarning[];
}

export async function listProjects(db: DbExecutor): Promise<ProjectOption[]> {
	const rows = await db
		.selectFrom('projects')
		.select(['id', 'storage_slug', 'name', 'description', 'created_at', 'updated_at'])
		.orderBy('updated_at', 'desc')
		.execute();
	return rows.map(mapProjectOption);
}

export async function getProject(db: DbExecutor, projectId: string): Promise<ProjectRecord | null> {
	const row = await db
		.selectFrom('projects')
		.selectAll()
		.where('id', '=', projectId)
		.executeTakeFirst();
	return row ? mapProject(row) : null;
}

export async function createProject(
	db: DbExecutor,
	input: CreateProjectInput,
	storeOptions: StoreOperationOptions = {}
): Promise<string> {
	const now = new Date().toISOString();
	const id = input.id ?? createId();
	const storageSlug = await resolveProjectStorageSlug(db, input.name, input.storageSlug);
	const project = {
		id,
		storageSlug,
		name: input.name.trim(),
		description: input.description?.trim() ?? '',
		charter: input.charter ?? '',
		collationSettings: input.collationSettings ?? {},
		createdAt: input.createdAt ?? now,
		updatedAt: input.updatedAt ?? input.createdAt ?? now,
	};
	await writeEmptyProjectManifestFile(project, storeOptions);
	await db
		.insertInto('projects')
		.values({
			id,
			storage_slug: project.storageSlug,
			name: project.name,
			description: project.description,
			charter: project.charter,
			collation_settings: JSON.stringify(project.collationSettings),
			created_at: project.createdAt,
			updated_at: project.updatedAt,
		})
		.execute();
	return id;
}

export async function updateProjectMetadata(
	db: DbExecutor,
	input: UpdateProjectMetadataInput,
	storeOptions: StoreOperationOptions = {}
): Promise<void> {
	const project = await getProject(db, input.projectId);
	if (!project) throw new Error(`Project ${input.projectId} was not found.`);
	const updates: Partial<Selectable<Projects>> = {
		updated_at: input.updatedAt ?? new Date().toISOString(),
	};
	if (input.name !== undefined) updates.name = input.name.trim();
	if (input.description !== undefined) updates.description = input.description.trim();
	if (input.charter !== undefined) updates.charter = input.charter;
	if (input.collationSettings !== undefined)
		updates.collation_settings = JSON.stringify(input.collationSettings);
	await writeProjectManifestFile(db, input.projectId, {}, storeOptions, {
		...project,
		name: updates.name ?? project.name,
		description: updates.description ?? project.description,
		charter: updates.charter ?? project.charter,
		collationSettings:
			input.collationSettings === undefined
				? project.collationSettings
				: input.collationSettings,
		updatedAt: updates.updated_at ?? project.updatedAt,
	});

	const result = await db
		.updateTable('projects')
		.set(updates)
		.where('id', '=', input.projectId)
		.executeTakeFirst();
	if (Number(result.numUpdatedRows) === 0)
		throw new Error(`Project ${input.projectId} was not found.`);
}

export async function forkProject(
	db: Kysely<Database>,
	input: ForkProjectInput,
	storeOptions: StoreOperationOptions = {}
): Promise<ForkProjectResult> {
	const sourceProject = await getProject(db, input.sourceProjectId);
	if (!sourceProject) throw new Error(`Project ${input.sourceProjectId} was not found.`);
	const sourceManifestRead = await readCanonicalDocument<ProjectManifestPayload>(
		PROJECT_MANIFEST_FORMAT,
		await readTextFile(projectManifestFile(sourceProject.storageSlug), storeOptions)
	);
	if (!sourceManifestRead.ok) {
		throw new Error(`Canonical manifest for project ${input.sourceProjectId} is invalid.`);
	}
	const sourceCollations = new Map<string, CollationPayload>();
	const sourceTranscriptionPayloads = new Map<string, ProjectTranscriptionPayload>();
	for (const head of sourceManifestRead.payload.transcriptions) {
		const read = await readCanonicalDocument<ProjectTranscriptionPayload>(
			PROJECT_TRANSCRIPTION_FORMAT,
			await readTextFile(
				transcriptionPrimaryFile(sourceProject.storageSlug, head.project_transcription_id),
				storeOptions
			)
		);
		if (!read.ok) {
			throw new Error(`Canonical transcription ${head.project_transcription_id} is invalid.`);
		}
		sourceTranscriptionPayloads.set(head.project_transcription_id, read.payload);
		sourceTranscriptionPayloads.set(head.transcription_id, read.payload);
	}
	for (const head of sourceManifestRead.payload.collations) {
		const read = await readCanonicalDocument<CollationPayload>(
			COLLATION_FORMAT,
			await readTextFile(
				collationPrimaryFile(sourceProject.storageSlug, head.collation_id),
				storeOptions
			)
		);
		if (!read.ok) throw new Error(`Canonical collation ${head.collation_id} is invalid.`);
		sourceCollations.set(head.collation_id, read.payload);
	}
	return db.transaction().execute(async trx => {
		const now = input.createdAt ?? new Date().toISOString();
		const targetProjectId = createId();
		const targetName =
			(input.name ?? `${sourceProject.name} Fork`).trim() || `${sourceProject.name} Fork`;
		await createProject(
			trx,
			{
				id: targetProjectId,
				name: targetName,
				description: input.description?.trim() ?? sourceProject.description,
				charter: sourceProject.charter,
				collationSettings: sourceProject.collationSettings,
				createdAt: now,
				updatedAt: now,
			},
			storeOptions
		);

		const transcriptionMap = await forkProjectTranscriptions(
			trx,
			input.sourceProjectId,
			targetProjectId,
			now,
			sourceTranscriptionPayloads
		);
		const forkedTranscriptions = uniqueForkedProjectTranscriptions(transcriptionMap);
		const warnings: PersistenceWarning[] = [];
		for (const transcription of forkedTranscriptions) {
			const checkpoint = await createCommittedTranscriptionCheckpointWithFiles(
				trx,
				{
					projectTranscriptionId: transcription.projectTranscriptionId,
					checkpointId: transcription.checkpointId,
					createdAt: now,
					commitMessage: 'Fork project',
				},
				storeOptions
			);
			transcription.contentHash = checkpoint.contentHash;
			warnings.push(...(checkpoint.warnings ?? []));
		}
		const collationIds = await forkProjectCollations(
			trx,
			input.sourceProjectId,
			targetProjectId,
			transcriptionMap,
			now,
			sourceCollations
		);
		for (const collation of collationIds) {
			await saveWorkingCollationArtifact(
				trx,
				{
					collationId: collation.id,
					artifactType: 'collation_document_v1',
					payload: JSON.stringify(collation.document),
					now,
				},
				storeOptions
			);
			const checkpoint = await createCommittedCollationCheckpointWithFiles(
				trx,
				{
					collationId: collation.id,
					checkpointId: collation.checkpointId,
					createdAt: now,
					commitMessage: 'Fork project',
				},
				storeOptions
			);
			warnings.push(...(checkpoint.warnings ?? []));
		}
		await writeProjectManifestFile(
			trx,
			targetProjectId,
			{
				forkedFrom: {
					source_project_id: input.sourceProjectId,
					source_manifest_content_hash: sourceManifestRead.document.content_hash,
					source_manifest_schema_version: PROJECT_MANIFEST_CURRENT_VERSION,
				},
			},
			storeOptions
		);
		return {
			projectId: targetProjectId,
			projectTranscriptionIds: forkedTranscriptions.map(row => row.projectTranscriptionId),
			projectOwnedTranscriptionIds: forkedTranscriptions.map(row => row.transcriptionId),
			collationIds: collationIds.map(collation => collation.id),
			warnings,
		};
	});
}

function uniqueForkedProjectTranscriptions(
	transcriptionMap: Map<string, ForkedProjectTranscriptionIds>
): ForkedProjectTranscriptionIds[] {
	const seen = new Set<string>();
	const rows: ForkedProjectTranscriptionIds[] = [];
	for (const row of transcriptionMap.values()) {
		if (seen.has(row.projectTranscriptionId)) continue;
		seen.add(row.projectTranscriptionId);
		rows.push(row);
	}
	return rows;
}

export async function listProjectTranscriptionOptions(
	db: DbExecutor,
	projectId?: string | null
): Promise<ProjectTranscriptionOption[]> {
	const linkedRows = projectId
		? await db
				.selectFrom('project_transcriptions')
				.innerJoin(
					'transcriptions',
					'transcriptions.id',
					'project_transcriptions.transcription_id'
				)
				.select([
					'transcriptions.id as id',
					'transcriptions.siglum as siglum',
					'transcriptions.title as title',
					'transcriptions.description as description',
					'transcriptions.origin_transcription_id as origin_transcription_id',
					'project_transcriptions.canonical_transcription_id as canonical_transcription_id',
				])
				.where('project_transcriptions.project_id', '=', projectId)
				.orderBy('project_transcriptions.added_at')
				.execute()
		: [];
	return linkedRows.map(mapProjectTranscriptionOption).sort((a, b) =>
		a.displayLabel.localeCompare(b.displayLabel, undefined, {
			sensitivity: 'base',
			numeric: true,
		})
	);
}

export async function listProjectTranscriptionStatuses(
	db: DbExecutor,
	projectId: string,
	options: ProjectTranscriptionStatusOptions = {}
): Promise<ProjectTranscriptionStatus[]> {
	const rows = await db
		.selectFrom('project_transcriptions')
		.innerJoin('transcriptions', 'transcriptions.id', 'project_transcriptions.transcription_id')
		.leftJoin('projects', 'projects.id', 'project_transcriptions.project_id')
		.leftJoin(
			'projects as origin_projects',
			'origin_projects.id',
			'transcriptions.origin_project_id'
		)
		.select([
			'project_transcriptions.id as project_transcription_id',
			'project_transcriptions.project_id as project_id',
			'projects.name as project_name',
			'project_transcriptions.transcription_id as transcription_id',
			'project_transcriptions.canonical_transcription_id as canonical_transcription_id',
			'transcriptions.project_id as transcription_project_id',
			'transcriptions.origin_type as origin_type',
			'transcriptions.origin_project_id as origin_project_id',
			'origin_projects.name as origin_project_name',
			'transcriptions.origin_transcription_id as origin_transcription_id',
			'transcriptions.origin_revision_id as origin_revision_id',
			'transcriptions.origin_content_hash as origin_content_hash',
			'transcriptions.siglum as siglum',
			'transcriptions.title as title',
			'transcriptions.description as description',
		])
		.where('project_transcriptions.project_id', '=', projectId)
		.orderBy('project_transcriptions.added_at')
		.execute();

	return Promise.all(rows.map(row => mapProjectTranscriptionStatus(db, row, options)));
}

export async function listProjectDocumentTitles(
	db: DbExecutor,
	projectId: string
): Promise<ProjectDocumentTitle[]> {
	const [transcriptions, collations] = await Promise.all([
		db
			.selectFrom('project_transcriptions')
			.innerJoin('transcriptions', 'transcriptions.id', 'project_transcriptions.transcription_id')
			.select(['project_transcriptions.id as entityId', 'transcriptions.title as title'])
			.where('project_transcriptions.project_id', '=', projectId)
			.orderBy('project_transcriptions.added_at')
			.execute(),
		db
			.selectFrom('collations')
			.select(['collations.id as entityId', 'collations.title as title'])
			.where('collations.project_id', '=', projectId)
			.orderBy('collations.created_at')
			.execute(),
	]);

	return [
		...transcriptions.map(row => ({
			entityType: 'project-transcription' as const,
			entityId: requireId(row.entityId, 'project transcription'),
			title: row.title,
		})),
		...collations.map(row => ({
			entityType: 'collation' as const,
			entityId: requireId(row.entityId, 'collation'),
			title: row.title,
		})),
	];
}

export async function getProjectTranscriptionStatus(
	db: DbExecutor,
	projectTranscriptionId: string,
	options: ProjectTranscriptionStatusOptions = {}
): Promise<ProjectTranscriptionStatus> {
	const row = await db
		.selectFrom('project_transcriptions')
		.innerJoin('transcriptions', 'transcriptions.id', 'project_transcriptions.transcription_id')
		.leftJoin('projects', 'projects.id', 'project_transcriptions.project_id')
		.leftJoin(
			'projects as origin_projects',
			'origin_projects.id',
			'transcriptions.origin_project_id'
		)
		.select([
			'project_transcriptions.id as project_transcription_id',
			'project_transcriptions.project_id as project_id',
			'projects.name as project_name',
			'project_transcriptions.transcription_id as transcription_id',
			'project_transcriptions.canonical_transcription_id as canonical_transcription_id',
			'transcriptions.project_id as transcription_project_id',
			'transcriptions.origin_type as origin_type',
			'transcriptions.origin_project_id as origin_project_id',
			'origin_projects.name as origin_project_name',
			'transcriptions.origin_transcription_id as origin_transcription_id',
			'transcriptions.origin_revision_id as origin_revision_id',
			'transcriptions.origin_content_hash as origin_content_hash',
			'transcriptions.siglum as siglum',
			'transcriptions.title as title',
			'transcriptions.description as description',
		])
		.where('project_transcriptions.id', '=', projectTranscriptionId)
		.executeTakeFirst();
	if (!row) throw new Error(`Project transcription ${projectTranscriptionId} was not found.`);
	return mapProjectTranscriptionStatus(db, row, options);
}

export async function getProjectTranscriptionStatusForOwnedTranscription(
	db: DbExecutor,
	projectOwnedTranscriptionId: string,
	options: ProjectTranscriptionStatusOptions = {}
): Promise<ProjectTranscriptionStatus | null> {
	const row = await db
		.selectFrom('project_transcriptions')
		.innerJoin('transcriptions', 'transcriptions.id', 'project_transcriptions.transcription_id')
		.leftJoin('projects', 'projects.id', 'project_transcriptions.project_id')
		.leftJoin(
			'projects as origin_projects',
			'origin_projects.id',
			'transcriptions.origin_project_id'
		)
		.select([
			'project_transcriptions.id as project_transcription_id',
			'project_transcriptions.project_id as project_id',
			'projects.name as project_name',
			'project_transcriptions.transcription_id as transcription_id',
			'project_transcriptions.canonical_transcription_id as canonical_transcription_id',
			'transcriptions.project_id as transcription_project_id',
			'transcriptions.origin_type as origin_type',
			'transcriptions.origin_project_id as origin_project_id',
			'origin_projects.name as origin_project_name',
			'transcriptions.origin_transcription_id as origin_transcription_id',
			'transcriptions.origin_revision_id as origin_revision_id',
			'transcriptions.origin_content_hash as origin_content_hash',
			'transcriptions.siglum as siglum',
			'transcriptions.title as title',
			'transcriptions.description as description',
		])
		.where('project_transcriptions.transcription_id', '=', projectOwnedTranscriptionId)
		.executeTakeFirst();
	if (!row) return null;
	return mapProjectTranscriptionStatus(db, row, options);
}

export async function loadTranscriptionContent(
	db: DbExecutor,
	transcriptionId: string
): Promise<string | null> {
	const row = await db
		.selectFrom('transcriptions')
		.select('content_json')
		.where('transcriptions.id', '=', transcriptionId)
		.executeTakeFirst();
	return row?.content_json ?? null;
}

export async function getProjectTranscriptionIds(
	db: DbExecutor,
	projectId: string
): Promise<string[]> {
	const rows = await db
		.selectFrom('project_transcriptions')
		.select('transcription_id')
		.where('project_id', '=', projectId)
		.orderBy('added_at')
		.execute();
	return rows.map(row => requireId(row.transcription_id, 'project transcription'));
}

export async function syncProjectTranscriptionIds(
	db: Kysely<Database>,
	projectId: string,
	nextIds: string[],
	storeOptions: StoreOperationOptions = {}
): Promise<string[]> {
	const uniqueIds = [...new Set(nextIds.map(id => id.trim()).filter(Boolean))];
	const currentRows = await db
		.selectFrom('project_transcriptions')
		.innerJoin('transcriptions', 'transcriptions.id', 'project_transcriptions.transcription_id')
		.select([
			'project_transcriptions.id as project_transcription_id',
			'project_transcriptions.transcription_id as transcription_id',
			'project_transcriptions.canonical_transcription_id as canonical_transcription_id',
			'transcriptions.origin_transcription_id as origin_transcription_id',
		])
		.where('project_transcriptions.project_id', '=', projectId)
		.orderBy('project_transcriptions.added_at')
		.execute();

	const currentByRequestedId = new Map<string, (typeof currentRows)[number]>();
	for (const row of currentRows) {
		currentByRequestedId.set(requireId(row.transcription_id, 'project transcription'), row);
		if (row.canonical_transcription_id)
			currentByRequestedId.set(row.canonical_transcription_id, row);
		if (row.origin_transcription_id) currentByRequestedId.set(row.origin_transcription_id, row);
	}

	const keptProjectTranscriptionIds = new Set<string>();
	const syncedIds: string[] = [];
	for (const requestedId of uniqueIds) {
		const current = currentByRequestedId.get(requestedId);
		if (current) {
			keptProjectTranscriptionIds.add(
				requireId(current.project_transcription_id, 'project transcription')
			);
			syncedIds.push(requireId(current.transcription_id, 'project transcription'));
			continue;
		}

		const source = await db
			.selectFrom('project_transcriptions')
			.innerJoin(
				'transcriptions',
				'transcriptions.id',
				'project_transcriptions.transcription_id'
			)
			.select([
				'project_transcriptions.id as project_transcription_id',
				'project_transcriptions.project_id as source_project_id',
			])
			.where('project_transcriptions.transcription_id', '=', requestedId)
			.executeTakeFirst();
		if (!source) throw new Error(`Transcription ${requestedId} was not found.`);
		if (source.source_project_id === projectId) {
			throw new Error(`Project transcription ${requestedId} is missing its ownership link.`);
		}
		const copied = await addProjectTranscriptionFromProject(
			db,
			{
				targetProjectId: projectId,
				sourceProjectTranscriptionId: requireId(
					source.project_transcription_id,
					'source project transcription'
				),
			},
			{ storeOptions }
		);
		keptProjectTranscriptionIds.add(copied.projectTranscriptionId);
		syncedIds.push(copied.projectOwnedTranscriptionId);
	}

	for (const row of currentRows) {
		if (
			!keptProjectTranscriptionIds.has(
				requireId(row.project_transcription_id, 'project transcription')
			)
		) {
			await deleteTranscriptionWithFiles(
				db,
				requireId(row.transcription_id, 'project transcription'),
				{},
				storeOptions
			);
		}
	}

	return syncedIds;
}

export interface RefreshProjectTranscriptionInput {
	projectTranscriptionId: string;
	sourceTranscriptionId: string;
	sourceCheckpointId: string;
	allowReplaceDirty?: boolean;
	updatedAt?: string;
}

export class RefreshDirtyProjectTranscriptionError extends Error {
	readonly projectTranscriptionId: string;
	constructor(projectTranscriptionId: string) {
		super(
			'Project transcription has uncommitted changes. Confirm before refreshing from source.'
		);
		this.name = 'RefreshDirtyProjectTranscriptionError';
		this.projectTranscriptionId = projectTranscriptionId;
	}
}

export async function refreshProjectTranscription(
	db: Kysely<Database>,
	input: RefreshProjectTranscriptionInput,
	options: ProjectContentLoadOptions = {}
): Promise<ProjectTranscriptionStatus> {
	const warnings: PersistenceWarning[] = [];
	const target = await db
		.selectFrom('project_transcriptions')
		.innerJoin('transcriptions', 'transcriptions.id', 'project_transcriptions.transcription_id')
		.select([
			'project_transcriptions.id as project_transcription_id',
			'project_transcriptions.project_id as project_id',
			'project_transcriptions.transcription_id as transcription_id',
			'transcriptions.origin_revision_id as origin_revision_id',
			'transcriptions.origin_content_hash as origin_content_hash',
		])
		.where('project_transcriptions.id', '=', input.projectTranscriptionId)
		.executeTakeFirst();
	if (!target) {
		throw new Error(`Project transcription ${input.projectTranscriptionId} was not found.`);
	}
	const targetTranscriptionId = requireId(target.transcription_id, 'project-owned transcription');

	const targetCheckpointStatus = await getProjectTranscriptionCheckpointStatusWithFiles(
		db,
		input.projectTranscriptionId,
		fileBackedLoadOptions(options)
	);
	if (targetCheckpointStatus.dirtyToCheckpoint && !input.allowReplaceDirty) {
		throw new RefreshDirtyProjectTranscriptionError(input.projectTranscriptionId);
	}

	const loaded = await loadCommittedTranscriptionCheckpointPayload(
		db,
		input.sourceTranscriptionId,
		input.sourceCheckpointId,
		options.storeOptions
	);
	const sourceHead = await getTranscriptionCommittedHead(db, input.sourceTranscriptionId);
	if (
		!sourceHead ||
		sourceHead.revisionId !== loaded.id ||
		sourceHead.contentHash !== loaded.contentHash
	) {
		throw new Error(
			'Source checkpoint is not the current committed head. Only the latest committed source version is supported.'
		);
	}
	if (
		!targetCheckpointStatus.dirtyToCheckpoint &&
		target.origin_revision_id === loaded.id &&
		target.origin_content_hash === loaded.contentHash
	) {
		return getProjectTranscriptionStatus(db, input.projectTranscriptionId, options);
	}
	if (targetCheckpointStatus.dirtyToCheckpoint) {
		const checkpoint = await createCommittedTranscriptionCheckpointWithFiles(
			db,
			{
				projectTranscriptionId: input.projectTranscriptionId,
				commitMessage: 'Local state before refresh from source',
				createdAt: input.updatedAt,
			},
			options.storeOptions
		);
		warnings.push(...(checkpoint.warnings ?? []));
	}

	await db.transaction().execute(async trx => {
		const targetLink = await trx
			.selectFrom('project_transcriptions')
			.select(['id', 'project_id', 'transcription_id'])
			.where('id', '=', input.projectTranscriptionId)
			.executeTakeFirst();
		if (!targetLink) {
			throw new Error(`Project transcription ${input.projectTranscriptionId} was not found.`);
		}
		const projectId = requireId(targetLink.project_id, 'project transcription project');
		const targetTranscriptionId = requireId(
			targetLink.transcription_id,
			'project-owned transcription'
		);

		const sourceRow = await trx
			.selectFrom('transcriptions')
			.select(['project_id'])
			.where('id', '=', input.sourceTranscriptionId)
			.executeTakeFirst();
		if (!sourceRow) {
			throw new Error(`Source transcription ${input.sourceTranscriptionId} was not found.`);
		}

		const now = input.updatedAt ?? new Date().toISOString();
		const payload = loaded.payload;
		const contentJson = JSON.stringify(payload.content_json);
		await trx
			.updateTable('transcriptions')
			.set({
				content_json: contentJson,
				format: payload.format,
				title: payload.title,
				siglum: payload.siglum,
				description: payload.description,
				owner: payload.owner,
				is_public: payload.is_public ? 1 : 0,
				tags: JSON.stringify(payload.tags ?? []),
				transcriber: payload.transcriber,
				repository: payload.repository,
				settlement: payload.settlement,
				language: payload.language,
				origin_type: 'project_snapshot',
				origin_project_id: sourceRow.project_id,
				origin_transcription_id: input.sourceTranscriptionId,
				origin_revision_id: loaded.id,
				origin_content_hash: loaded.contentHash,
				updated_at: now,
			})
			.where('id', '=', targetTranscriptionId)
			.executeTakeFirst();

		await replaceTranscriptionVerseIndexRows(trx, targetTranscriptionId, contentJson, now);
		await replaceIiifRowsFromPayload(trx, targetTranscriptionId, payload, now);

		await trx
			.updateTable('projects')
			.set({ updated_at: now })
			.where('id', '=', projectId)
			.execute();
		const checkpoint = await createCommittedTranscriptionCheckpointWithFiles(
			trx,
			{
				projectTranscriptionId: input.projectTranscriptionId,
				commitMessage: 'Refresh from source',
				createdAt: input.updatedAt,
			},
			options.storeOptions
		);
		warnings.push(...(checkpoint.warnings ?? []));
	});
	return {
		...(await getProjectTranscriptionStatus(db, input.projectTranscriptionId, options)),
		warnings,
	};
}

interface ForkedProjectTranscriptionIds {
	projectTranscriptionId: string;
	transcriptionId: string;
	checkpointIds: Map<string, string>;
	checkpointId: string;
	sourceContentHash: string;
	contentHash: string;
}

async function forkProjectTranscriptions(
	db: DbExecutor,
	sourceProjectId: string,
	targetProjectId: string,
	now: string,
	sourceTranscriptionPayloads: Map<string, ProjectTranscriptionPayload>
): Promise<Map<string, ForkedProjectTranscriptionIds>> {
	const links = await db
		.selectFrom('project_transcriptions')
		.innerJoin('transcriptions', 'transcriptions.id', 'project_transcriptions.transcription_id')
		.select([
			'project_transcriptions.id as project_transcription_id',
			'project_transcriptions.transcription_id as transcription_id',
			'project_transcriptions.canonical_transcription_id as canonical_transcription_id',
			'transcriptions.id as source_transcription_id',
			'transcriptions.project_id as project_id',
			'transcriptions.origin_type as origin_type',
			'transcriptions.origin_project_id as origin_project_id',
			'transcriptions.origin_transcription_id as origin_transcription_id',
			'transcriptions.origin_revision_id as origin_revision_id',
			'transcriptions.origin_content_hash as origin_content_hash',
			'transcriptions.current_revision_id as current_revision_id',
			'transcriptions.current_content_hash as current_content_hash',
			'transcriptions.title as title',
			'transcriptions.siglum as siglum',
			'transcriptions.description as description',
			'transcriptions.content_json as content_json',
			'transcriptions.format as format',
			'transcriptions.owner as owner',
			'transcriptions.is_public as is_public',
			'transcriptions.tags as tags',
			'transcriptions.transcriber as transcriber',
			'transcriptions.repository as repository',
			'transcriptions.settlement as settlement',
			'transcriptions.language as language',
		])
		.where('project_transcriptions.project_id', '=', sourceProjectId)
		.orderBy('project_transcriptions.added_at')
		.execute();

	const idMap = new Map<string, ForkedProjectTranscriptionIds>();
	for (const link of links) {
		const sourceTranscriptionId = requireId(
			link.source_transcription_id,
			'source transcription'
		);
		const sourceProjectTranscriptionId = requireId(
			link.project_transcription_id,
			'source project transcription'
		);
		const sourcePayload =
			sourceTranscriptionPayloads.get(sourceProjectTranscriptionId) ??
			sourceTranscriptionPayloads.get(sourceTranscriptionId);
		if (!sourcePayload) {
			throw new Error(
				`Canonical transcription ${sourceProjectTranscriptionId} was not found.`
			);
		}
		const targetTranscriptionId = createId();
		const targetProjectTranscriptionId = createId();
		const checkpointId = createId();
		const checkpointIdMap = new Map<string, string>();
		checkpointIdMap.set(sourcePayload.current_revision.id, checkpointId);
		const embeddedIdMap = new Map([
			[sourceProjectId, targetProjectId],
			[sourceTranscriptionId, targetTranscriptionId],
			[sourceProjectTranscriptionId, targetProjectTranscriptionId],
		]);
		await db
			.insertInto('transcriptions')
			.values({
				id: targetTranscriptionId,
				project_id: targetProjectId,
				origin_type: sourcePayload.origin.source_type,
				origin_project_id: sourcePayload.origin.source_project_id,
				origin_transcription_id: sourcePayload.origin.source_transcription_id,
				origin_revision_id: sourcePayload.origin.source_revision_id ?? '',
				origin_content_hash: sourcePayload.origin.source_content_hash ?? '',
				current_revision_id: '',
				current_content_hash: '',
				title: sourcePayload.title,
				siglum: sourcePayload.siglum,
				description: sourcePayload.description,
				content_json: JSON.stringify(
					rewriteForkIdentifiers(sourcePayload.content_json, embeddedIdMap)
				),
				format: sourcePayload.content_format,
				created_at: now,
				updated_at: now,
				owner: sourcePayload.owner,
				is_public: sourcePayload.is_public ? 1 : 0,
				tags: JSON.stringify(sourcePayload.tags),
				transcriber: sourcePayload.transcriber,
				repository: sourcePayload.repository,
				settlement: sourcePayload.settlement,
				language: sourcePayload.language,
			})
			.execute();
		await replaceTranscriptionVerseIndexRows(
			db,
			targetTranscriptionId,
			JSON.stringify(rewriteForkIdentifiers(sourcePayload.content_json, embeddedIdMap)),
			now
		);
		await replaceIiifRowsFromPayload(db, targetTranscriptionId, sourcePayload, now);
		await db
			.insertInto('project_transcriptions')
			.values({
				id: targetProjectTranscriptionId,
				project_id: targetProjectId,
				transcription_id: targetTranscriptionId,
				canonical_transcription_id: sourcePayload.canonical_transcription_id,
				added_at: now,
			})
			.execute();
		idMap.set(sourceTranscriptionId, {
			projectTranscriptionId: targetProjectTranscriptionId,
			transcriptionId: targetTranscriptionId,
			checkpointIds: checkpointIdMap,
			checkpointId,
			sourceContentHash: sourcePayload.current_revision.content_hash,
			contentHash: '',
		});
		idMap.set(sourceProjectTranscriptionId, {
			projectTranscriptionId: targetProjectTranscriptionId,
			transcriptionId: targetTranscriptionId,
			checkpointIds: checkpointIdMap,
			checkpointId,
			sourceContentHash: sourcePayload.current_revision.content_hash,
			contentHash: '',
		});
	}
	return idMap;
}

async function buildTranscriptionCheckpointIdMap(
	db: DbExecutor,
	sourceTranscriptionId: string
): Promise<Map<string, string>> {
	const rows = await db
		.selectFrom('transcription_checkpoints')
		.select(['id'])
		.where('transcription_id', '=', sourceTranscriptionId)
		.execute();
	return new Map(rows.map(row => [requireId(row.id, 'transcription checkpoint'), createId()]));
}

async function copyTranscriptionCheckpoints(
	db: DbExecutor,
	sourceTranscriptionId: string,
	targetTranscriptionId: string,
	idMap: Map<string, string>
): Promise<void> {
	const rows = await db
		.selectFrom('transcription_checkpoints')
		.selectAll()
		.where('transcription_id', '=', sourceTranscriptionId)
		.orderBy('created_at')
		.execute();
	if (rows.length > 0) {
		await db
			.insertInto('transcription_checkpoints')
			.values(
				rows.map(row => ({
					...row,
					id: mappedId(idMap, row.id),
					transcription_id: targetTranscriptionId,
					parent_checkpoint_id: row.parent_checkpoint_id
						? mappedId(idMap, row.parent_checkpoint_id)
						: null,
				}))
			)
			.execute();
	}
}

async function forkProjectCollations(
	db: DbExecutor,
	sourceProjectId: string,
	targetProjectId: string,
	transcriptionMap: Map<string, ForkedProjectTranscriptionIds>,
	now: string,
	sourceCollations: Map<string, CollationPayload>
): Promise<Array<{ id: string; checkpointId: string; document: unknown }>> {
	const targets: Array<{ id: string; checkpointId: string; document: unknown }> = [];
	for (const [sourceCollationId, source] of sourceCollations) {
		const targetCollationId = createId();
		const checkpointId = createId();
		await db
			.insertInto('collations')
			.values({
				id: targetCollationId,
				project_id: targetProjectId,
				title: source.title,
				verse_identifier: source.verse_identifier,
				status: source.status,
				current_revision_id: '',
				current_content_hash: '',
				group_path: source.group_path,
				notes: source.notes,
				sort_key: source.sort_key,
				created_at: now,
				updated_at: now,
			})
			.execute();
		const document = rewriteForkIdentifiers(
			source.document,
			new Map<string, string>([
				[sourceProjectId, targetProjectId],
				[sourceCollationId, targetCollationId],
				...[...transcriptionMap.entries()].map(
					([sourceId, target]) => [sourceId, target.transcriptionId] as const
				),
				...[...transcriptionMap.values()].flatMap(target => [
					...target.checkpointIds.entries(),
				]),
				...[...transcriptionMap.values()]
					.filter(target => target.sourceContentHash && target.contentHash)
					.map(target => [target.sourceContentHash, target.contentHash] as const),
			])
		);
		targets.push({ id: targetCollationId, checkpointId, document });
	}
	return targets;
}

async function buildCollationCheckpointIdMap(
	db: DbExecutor,
	sourceCollationId: string
): Promise<Map<string, string>> {
	const rows = await db
		.selectFrom('collation_checkpoints')
		.select(['id'])
		.where('collation_id', '=', sourceCollationId)
		.execute();
	return new Map(rows.map(row => [requireId(row.id, 'collation checkpoint'), createId()]));
}

async function copyCollationCheckpoints(
	db: DbExecutor,
	sourceCollationId: string,
	targetCollationId: string,
	idMap: Map<string, string>
): Promise<void> {
	const rows = await db
		.selectFrom('collation_checkpoints')
		.selectAll()
		.where('collation_id', '=', sourceCollationId)
		.orderBy('created_at')
		.execute();
	if (rows.length > 0) {
		await db
			.insertInto('collation_checkpoints')
			.values(
				rows.map(row => ({
					...row,
					id: mappedId(idMap, row.id),
					collation_id: targetCollationId,
					parent_checkpoint_id: row.parent_checkpoint_id
						? mappedId(idMap, row.parent_checkpoint_id)
						: null,
				}))
			)
			.execute();
	}
}

function rewriteForkIdentifiers(value: unknown, idMap: Map<string, string>): unknown {
	if (typeof value === 'string') return idMap.get(value) ?? value;
	if (Array.isArray(value)) return value.map(entry => rewriteForkIdentifiers(entry, idMap));
	if (!value || typeof value !== 'object') return value;
	return Object.fromEntries(
		Object.entries(value).map(([key, entry]) => [key, rewriteForkIdentifiers(entry, idMap)])
	);
}

async function copyCollationProjection(
	db: DbExecutor,
	sourceCollationId: string,
	targetCollationId: string,
	transcriptionMap: Map<string, ForkedProjectTranscriptionIds>
): Promise<void> {
	const witnesses = await db
		.selectFrom('collation_witnesses')
		.selectAll()
		.where('collation_id', '=', sourceCollationId)
		.execute();
	if (witnesses.length > 0) {
		await db
			.insertInto('collation_witnesses')
			.values(
				witnesses.map(row => {
					const mapped = row.project_transcription_id
						? transcriptionMap.get(row.project_transcription_id)
						: row.transcription_id
							? transcriptionMap.get(row.transcription_id)
							: undefined;
					return {
						...row,
						id: createId(),
						collation_id: targetCollationId,
						project_transcription_id: mapped?.projectTranscriptionId ?? null,
						transcription_id: mapped?.transcriptionId ?? null,
						source_revision_id: mapped
							? mappedId(mapped.checkpointIds, row.source_revision_id)
							: row.source_revision_id,
					};
				})
			)
			.execute();
	}

	const tokens = await db
		.selectFrom('collation_tokens')
		.selectAll()
		.where('collation_id', '=', sourceCollationId)
		.execute();
	if (tokens.length > 0) {
		await db
			.insertInto('collation_tokens')
			.values(
				tokens.map(row => ({ ...row, id: createId(), collation_id: targetCollationId }))
			)
			.execute();
	}

	const units = await db
		.selectFrom('collation_variation_units')
		.selectAll()
		.where('collation_id', '=', sourceCollationId)
		.execute();
	const unitIdMap = new Map(units.map(row => [requireId(row.id, 'variation unit'), createId()]));
	if (units.length > 0) {
		await db
			.insertInto('collation_variation_units')
			.values(
				units.map(row => ({
					...row,
					id: mappedId(unitIdMap, row.id),
					collation_id: targetCollationId,
				}))
			)
			.execute();
	}

	const readings =
		units.length > 0
			? await db
					.selectFrom('collation_readings')
					.selectAll()
					.where('variation_unit_id', 'in', [...unitIdMap.keys()])
					.execute()
			: [];
	const readingIdMap = new Map(readings.map(row => [requireId(row.id, 'reading'), createId()]));
	if (readings.length > 0) {
		await db
			.insertInto('collation_readings')
			.values(
				readings.map(row => ({
					...row,
					id: mappedId(readingIdMap, row.id),
					variation_unit_id: mappedId(unitIdMap, row.variation_unit_id),
				}))
			)
			.execute();
	}

	const readingWitnesses =
		readings.length > 0
			? await db
					.selectFrom('collation_reading_witnesses')
					.selectAll()
					.where('reading_id', 'in', [...readingIdMap.keys()])
					.execute()
			: [];
	if (readingWitnesses.length > 0) {
		await db
			.insertInto('collation_reading_witnesses')
			.values(
				readingWitnesses.map(row => ({
					...row,
					id: createId(),
					reading_id: mappedId(readingIdMap, row.reading_id),
				}))
			)
			.execute();
	}
}

function mappedId(idMap: Map<string, string>, id: string | null): string {
	if (!id) return '';
	return idMap.get(id) ?? id;
}

async function replaceIiifRowsFromPayload(
	db: DbExecutor,
	targetTranscriptionId: string,
	payload: TranscriptionCheckpointPayload | ProjectTranscriptionPayload,
	now: string
): Promise<void> {
	await db
		.deleteFrom('iiif_canvas_annotations')
		.where('transcription_id', '=', targetTranscriptionId)
		.execute();
	await db
		.deleteFrom('transcription_page_canvas_links')
		.where('transcription_id', '=', targetTranscriptionId)
		.execute();
	await db
		.deleteFrom('iiif_manifest_sources')
		.where('transcription_id', '=', targetTranscriptionId)
		.execute();

	const manifestIdMap = new Map<string, string>();
	const manifestRows: Selectable<IiifManifestSources>[] = payload.iiif_manifest_sources.map(
		source => {
			const nextId = createId();
			manifestIdMap.set(source.id, nextId);
			return {
				id: nextId,
				transcription_id: targetTranscriptionId,
				manifest_url: source.manifest_url,
				label: source.label,
				source_kind: source.source_kind,
				default_canvas_id: source.default_canvas_id,
				default_image_service_url: source.default_image_service_url,
				metadata_json: JSON.stringify(source.metadata_json ?? {}),
				created_at: now,
				updated_at: now,
			};
		}
	);
	if (manifestRows.length > 0)
		await db.insertInto('iiif_manifest_sources').values(manifestRows).execute();

	const pageLinkRows: Selectable<TranscriptionPageCanvasLinks>[] =
		payload.page_canvas_links.flatMap(row => {
			const manifestSourceId = manifestIdMap.get(row.manifest_source_id);
			return manifestSourceId
				? [
						{
							...row,
							id: createId(),
							transcription_id: targetTranscriptionId,
							manifest_source_id: manifestSourceId,
							created_at: now,
							updated_at: now,
						},
					]
				: [];
		});
	if (pageLinkRows.length > 0)
		await db.insertInto('transcription_page_canvas_links').values(pageLinkRows).execute();

	const annotationRows: Selectable<IiifCanvasAnnotations>[] = payload.canvas_annotations.flatMap(
		row => {
			const manifestSourceId = manifestIdMap.get(row.manifest_source_id);
			return manifestSourceId
				? [
						{
							...row,
							id: createId(),
							transcription_id: targetTranscriptionId,
							manifest_source_id: manifestSourceId,
							body_json: JSON.stringify(row.body_json ?? {}),
							target_json: JSON.stringify(row.target_json ?? {}),
							anchor_json: JSON.stringify(row.anchor_json ?? {}),
							created_at: now,
							updated_at: now,
						},
					]
				: [];
		}
	);
	if (annotationRows.length > 0)
		await db.insertInto('iiif_canvas_annotations').values(annotationRows).execute();
}

export interface AddProjectTranscriptionFromProjectInput {
	targetProjectId: string;
	sourceProjectTranscriptionId: string;
	sourceCheckpointId?: string;
	createdAt?: string;
}

export class AddFromProjectUncommittedSourceError extends Error {
	readonly sourceProjectTranscriptionId: string;
	constructor(sourceProjectTranscriptionId: string) {
		super(
			'Source project transcription has no committed version. Commit it before adding to another project.'
		);
		this.name = 'AddFromProjectUncommittedSourceError';
		this.sourceProjectTranscriptionId = sourceProjectTranscriptionId;
	}
}

export class AddFromProjectSameProjectError extends Error {
	readonly sourceProjectTranscriptionId: string;
	constructor(sourceProjectTranscriptionId: string) {
		super('Cannot add a project transcription from the same project. Use refresh instead.');
		this.name = 'AddFromProjectSameProjectError';
		this.sourceProjectTranscriptionId = sourceProjectTranscriptionId;
	}
}

export async function addProjectTranscriptionFromProject(
	db: Kysely<Database>,
	input: AddProjectTranscriptionFromProjectInput,
	options: ProjectContentLoadOptions = {}
): Promise<{
	projectTranscriptionId: string;
	projectOwnedTranscriptionId: string;
	warnings: PersistenceWarning[];
}> {
	return db.transaction().execute(async trx => {
		const sourceLink = await trx
			.selectFrom('project_transcriptions')
			.innerJoin(
				'transcriptions',
				'transcriptions.id',
				'project_transcriptions.transcription_id'
			)
			.select([
				'project_transcriptions.id as project_transcription_id',
				'project_transcriptions.project_id as source_project_id',
				'project_transcriptions.transcription_id as source_transcription_id',
				'transcriptions.current_revision_id as current_revision_id',
				'transcriptions.current_content_hash as current_content_hash',
			])
			.where('project_transcriptions.id', '=', input.sourceProjectTranscriptionId)
			.executeTakeFirst();
		if (!sourceLink) {
			throw new Error(
				`Source project transcription ${input.sourceProjectTranscriptionId} was not found.`
			);
		}
		const sourceProjectId = requireId(sourceLink.source_project_id, 'source project');
		const sourceTranscriptionId = requireId(
			sourceLink.source_transcription_id,
			'source project-owned transcription'
		);
		if (sourceProjectId === input.targetProjectId) {
			throw new AddFromProjectSameProjectError(input.sourceProjectTranscriptionId);
		}

		const checkpointId = input.sourceCheckpointId ?? sourceLink.current_revision_id ?? '';
		if (!checkpointId) {
			throw new AddFromProjectUncommittedSourceError(input.sourceProjectTranscriptionId);
		}

		const loaded = await loadCommittedTranscriptionCheckpointPayload(
			trx,
			sourceTranscriptionId,
			checkpointId,
			options.storeOptions
		);
		const payload = loaded.payload;
		const now = input.createdAt ?? new Date().toISOString();
		const targetTranscriptionId = createId();
		const contentJson = JSON.stringify(payload.content_json);

		const targetRow: Selectable<Transcriptions> = {
			id: targetTranscriptionId,
			project_id: input.targetProjectId,
			origin_type: 'project_snapshot',
			origin_project_id: sourceProjectId,
			origin_transcription_id: sourceTranscriptionId,
			origin_revision_id: loaded.id,
			origin_content_hash: loaded.contentHash,
			current_revision_id: '',
			current_content_hash: '',
			title: payload.title,
			siglum: payload.siglum,
			description: payload.description,
			content_json: contentJson,
			format: payload.format,
			created_at: now,
			updated_at: now,
			owner: payload.owner,
			is_public: payload.is_public ? 1 : 0,
			tags: JSON.stringify(payload.tags ?? []),
			transcriber: payload.transcriber,
			repository: payload.repository,
			settlement: payload.settlement,
			language: payload.language,
		};
		await trx.insertInto('transcriptions').values(targetRow).execute();

		await replaceTranscriptionVerseIndexRows(trx, targetTranscriptionId, contentJson, now);
		await replaceIiifRowsFromPayload(trx, targetTranscriptionId, payload, now);

		const projectTranscriptionId = createId();
		const linkRow: Selectable<ProjectTranscriptions> = {
			id: projectTranscriptionId,
			project_id: input.targetProjectId,
			transcription_id: targetTranscriptionId,
			canonical_transcription_id: null,
			added_at: now,
		};
		await trx
			.insertInto('project_transcriptions')
			.values(linkRow)
			.onConflict(oc => oc.columns(['project_id', 'transcription_id']).doNothing())
			.execute();

		await trx
			.updateTable('projects')
			.set({ updated_at: now })
			.where('id', '=', input.targetProjectId)
			.execute();

		const created = {
			projectTranscriptionId,
			projectOwnedTranscriptionId: targetTranscriptionId,
		};
		const checkpoint = await createCommittedTranscriptionCheckpointWithFiles(
			trx,
			{
				projectTranscriptionId: created.projectTranscriptionId,
				commitMessage: 'Add from project',
				createdAt: input.createdAt,
			},
			options.storeOptions
		);
		return { ...created, warnings: checkpoint.warnings ?? [] };
	});
}

export interface ProjectTranscriptionSourceCandidate {
	projectTranscriptionId: string;
	projectOwnedTranscriptionId: string;
	projectId: string;
	projectName: string;
	title: string;
	siglum: string;
	description: string;
	currentCheckpoint: EntityCheckpointHead | null;
	dirtyToCheckpoint: boolean;
}

export async function listProjectTranscriptionSourceCandidates(
	db: DbExecutor,
	targetProjectId: string,
	options: ProjectContentLoadOptions = {}
): Promise<ProjectTranscriptionSourceCandidate[]> {
	const rows = await db
		.selectFrom('project_transcriptions')
		.innerJoin('transcriptions', 'transcriptions.id', 'project_transcriptions.transcription_id')
		.innerJoin('projects', 'projects.id', 'project_transcriptions.project_id')
		.select([
			'project_transcriptions.id as project_transcription_id',
			'project_transcriptions.project_id as project_id',
			'project_transcriptions.transcription_id as transcription_id',
			'projects.name as project_name',
			'transcriptions.title as title',
			'transcriptions.siglum as siglum',
			'transcriptions.description as description',
			'transcriptions.current_revision_id as current_revision_id',
			'transcriptions.current_content_hash as current_content_hash',
		])
		.where('project_transcriptions.project_id', '!=', targetProjectId)
		.orderBy('projects.name')
		.orderBy('project_transcriptions.added_at')
		.execute();

	const candidates: ProjectTranscriptionSourceCandidate[] = [];
	for (const row of rows) {
		const projectTranscriptionId = requireId(
			row.project_transcription_id,
			'project transcription'
		);
		const projectOwnedTranscriptionId = requireId(
			row.transcription_id,
			'project-owned transcription'
		);
		const projectId = requireId(row.project_id, 'project');
		const currentCheckpoint = checkpointHeadFromFields(
			row.current_revision_id,
			row.current_content_hash
		);
		const status = await getProjectTranscriptionCheckpointStatusWithFiles(
			db,
			projectTranscriptionId,
			fileBackedLoadOptions(options)
		);
		candidates.push({
			projectTranscriptionId,
			projectOwnedTranscriptionId,
			projectId,
			projectName: row.project_name,
			title: row.title,
			siglum: row.siglum,
			description: row.description,
			currentCheckpoint,
			dirtyToCheckpoint: status.dirtyToCheckpoint,
		});
	}
	return candidates;
}

function fileBackedLoadOptions(options: ProjectContentLoadOptions): {
	allowIndexFallback: boolean;
	backend?: StoreOperationOptions['backend'];
	nonce?: StoreOperationOptions['nonce'];
} {
	return {
		...options.storeOptions,
		allowIndexFallback: options.requireFileBackedContent !== true,
	};
}

interface ProjectTranscriptionStatusQueryRow {
	project_transcription_id: string | null;
	project_id: string;
	project_name: string | null;
	transcription_id: string;
	canonical_transcription_id: string | null;
	transcription_project_id: string;
	origin_type: string;
	origin_project_id: string | null;
	origin_project_name: string | null;
	origin_transcription_id: string | null;
	origin_revision_id: string;
	origin_content_hash: string;
	siglum: string;
	title: string;
	description: string;
}

async function mapProjectTranscriptionStatus(
	db: DbExecutor,
	row: ProjectTranscriptionStatusQueryRow,
	options: ProjectTranscriptionStatusOptions
): Promise<ProjectTranscriptionStatus> {
	const projectTranscriptionId = requireId(row.project_transcription_id, 'project transcription');
	const projectOwnedTranscriptionId = requireId(
		row.transcription_id,
		'project-owned transcription'
	);
	const checkpointStatus = await getProjectTranscriptionCheckpointStatusWithFiles(
		db,
		projectTranscriptionId,
		fileBackedLoadOptions(options)
	);
	const canonicalSource = row.canonical_transcription_id
		? await loadTranscriptionSourceSummary(db, row.canonical_transcription_id, options)
		: null;
	const immediateSource = mapImmediateSource(row);
	const sourceTranscriptionId =
		row.canonical_transcription_id || immediateSource?.sourceTranscriptionId || null;
	const sourceSummary =
		sourceTranscriptionId === row.canonical_transcription_id
			? canonicalSource
			: sourceTranscriptionId
				? await loadTranscriptionSourceSummary(db, sourceTranscriptionId, options)
				: null;
	const cloudBackupState = await deriveEntityCloudBackupState(
		db,
		options.syncContext,
		{ entityType: 'project-transcription', entityId: projectTranscriptionId },
		checkpointStatus.currentCheckpoint,
		checkpointStatus.dirtyToCheckpoint
	);

	return {
		projectId: row.project_id,
		projectName: row.project_name,
		projectTranscriptionId,
		projectOwnedTranscriptionId,
		siglum: row.siglum,
		title: row.title,
		description: row.description,
		isProjectOwned: row.transcription_project_id === row.project_id,
		canonicalSource,
		immediateSource,
		currentCheckpoint: checkpointStatus.currentCheckpoint,
		workingContentHash: checkpointStatus.workingContentHash,
		dirtyToCheckpoint: checkpointStatus.dirtyToCheckpoint,
		commitState: checkpointStatus.commitState,
		sourceState: deriveProjectTranscriptionSourceState(
			sourceTranscriptionId,
			sourceSummary,
			row.origin_revision_id,
			row.origin_content_hash
		),
		cloudBackupState,
	};
}

async function loadTranscriptionSourceSummary(
	db: DbExecutor,
	transcriptionId: string,
	options: ProjectContentLoadOptions
): Promise<TranscriptionSourceSummary | null> {
	const row = await db
		.selectFrom('transcriptions')
		.leftJoin('projects', 'projects.id', 'transcriptions.project_id')
		.select([
			'transcriptions.id as id',
			'transcriptions.project_id as project_id',
			'projects.name as project_name',
			'transcriptions.title as title',
			'transcriptions.siglum as siglum',
			'transcriptions.current_revision_id as current_revision_id',
			'transcriptions.current_content_hash as current_content_hash',
		])
		.where('transcriptions.id', '=', transcriptionId)
		.executeTakeFirst();
	if (!row) return null;
	const sourceId = requireId(row.id, 'source transcription');
	const currentCheckpoint = checkpointHeadFromFields(
		row.current_revision_id,
		row.current_content_hash
	);
	return {
		transcriptionId: sourceId,
		projectId: row.project_id,
		projectName: row.project_name,
		title: row.title,
		siglum: row.siglum,
		currentCheckpoint,
		dirtyToCheckpoint: await loadSourceDirtyToCheckpoint(db, {
			transcriptionId: sourceId,
			projectId: row.project_id,
			currentCheckpoint,
			options,
		}),
	};
}

async function loadSourceDirtyToCheckpoint(
	db: DbExecutor,
	source: {
		transcriptionId: string;
		projectId: string;
		currentCheckpoint: EntityCheckpointHead | null;
		options: ProjectContentLoadOptions;
	}
): Promise<boolean | null> {
	if (!source.currentCheckpoint) return null;
	const projectTranscription = await db
		.selectFrom('project_transcriptions')
		.select('id')
		.where('project_id', '=', source.projectId)
		.where('transcription_id', '=', source.transcriptionId)
		.executeTakeFirst();
	if (!projectTranscription?.id) return null;
	return (
		await getProjectTranscriptionCheckpointStatusWithFiles(
			db,
			projectTranscription.id,
			fileBackedLoadOptions(source.options)
		)
	).dirtyToCheckpoint;
}

function deriveProjectTranscriptionSourceState(
	sourceTranscriptionId: string | null,
	sourceSummary: TranscriptionSourceSummary | null,
	originRevisionId: string,
	originContentHash: string
): ProjectTranscriptionSourceState {
	if (!sourceTranscriptionId) return { kind: 'no-source' };
	if (!sourceSummary) return { kind: 'source-missing', sourceTranscriptionId };
	const sourceHead = sourceSummary.currentCheckpoint;
	if (!sourceHead) return { kind: 'source-has-no-committed-version', sourceTranscriptionId };
	if (sourceSummary.dirtyToCheckpoint === true) {
		return {
			kind: 'source-has-uncommitted-changes',
			sourceTranscriptionId,
			sourceRevisionId: sourceHead.revisionId,
			sourceContentHash: sourceHead.contentHash,
		};
	}
	if (
		sourceHead.revisionId === originRevisionId &&
		sourceHead.contentHash === originContentHash
	) {
		return {
			kind: 'up-to-date',
			sourceTranscriptionId,
			sourceRevisionId: sourceHead.revisionId,
			sourceContentHash: sourceHead.contentHash,
		};
	}
	return {
		kind: 'newer-source-available',
		sourceTranscriptionId,
		sourceRevisionId: sourceHead.revisionId,
		sourceContentHash: sourceHead.contentHash,
	};
}

function mapImmediateSource(
	row: ProjectTranscriptionStatusQueryRow
): TranscriptionOriginSummary | null {
	const sourceRevisionId = nonEmptyStringOrNull(row.origin_revision_id);
	const sourceContentHash = nonEmptyStringOrNull(row.origin_content_hash);
	const sourceTranscriptionId = nonEmptyStringOrNull(row.origin_transcription_id);
	if (
		!row.origin_type &&
		!row.origin_project_id &&
		!sourceTranscriptionId &&
		!sourceRevisionId &&
		!sourceContentHash
	) {
		return null;
	}
	return {
		sourceType: row.origin_type,
		sourceProjectId: row.origin_project_id,
		sourceProjectName: row.origin_project_name,
		sourceTranscriptionId,
		sourceRevisionId,
		sourceContentHash,
	};
}

function checkpointHeadFromFields(
	revisionId: string | null,
	contentHash: string | null
): EntityCheckpointHead | null {
	if (!revisionId || !contentHash) return null;
	return { revisionId, contentHash };
}

function mapProjectOption(
	row: Pick<
		Selectable<Projects>,
		'id' | 'storage_slug' | 'name' | 'description' | 'created_at' | 'updated_at'
	>
): ProjectOption {
	return {
		id: requireId(row.id, 'project'),
		storageSlug: row.storage_slug,
		name: row.name,
		description: row.description,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function mapProject(row: Selectable<Projects>): ProjectRecord {
	return {
		...mapProjectOption(row),
		charter: row.charter,
		collationSettings: parseJson(row.collation_settings),
	};
}

function mapProjectTranscriptionOption(
	row: Pick<Selectable<Transcriptions>, 'id' | 'siglum' | 'title' | 'description'>
): ProjectTranscriptionOption {
	return {
		id: requireId(row.id, 'transcription'),
		siglum: row.siglum,
		displayLabel: getPreferredTranscriptionLabel(row),
		title: row.title,
		description: row.description,
	};
}

function getPreferredTranscriptionLabel(
	row: Pick<Selectable<Transcriptions>, 'id' | 'siglum'>
): string {
	return row.siglum.trim() || requireId(row.id, 'transcription');
}

function isNonEmptyString(value: string | null): value is string {
	return typeof value === 'string' && value.length > 0;
}

function nonEmptyStringOrNull(value: string | null): string | null {
	return isNonEmptyString(value) ? value : null;
}

function parseJson(value: string): unknown {
	try {
		return JSON.parse(value);
	} catch {
		return {};
	}
}

function requireId(value: string | null, label: string): string {
	if (!value) throw new Error(`Missing ${label} id`);
	return value;
}
