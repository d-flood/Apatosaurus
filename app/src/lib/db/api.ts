import type { Kysely } from 'kysely';

import { backupProject, listPendingUploadPaths } from '$lib/backup/sync-manager';
import {
	listConflictCopies,
	loadConflictCopyContents,
	reconcileConflictCopy,
} from '$lib/backup/conflicts';
import type { CompareChoices } from '$lib/shell/version-compare';
import type { SyncProjectContext } from '$lib/backup/backup-status';
import {
	getProjectLocation,
	isPlacedProject,
	listProjectPlacements,
	type PlacedProject,
} from '$lib/storage/project-locations';
import { deleteProjectFromLocation, moveProject } from '$lib/backup/project-move';
import { exportAllProjectsZip, exportProjectZip } from '$lib/backup/project-zip-export';
import {
	importProjectZip,
	restoreReferenceEditionsZip,
	type ProjectZipImportCollisionMode,
} from '$lib/backup/project-zip-import';
import { createProviderForLocation } from '$lib/backup/provider-factory';
import { discoverLocationProjects } from '$lib/backup/location-discovery';
import { deleteProjectLocally, removeProjectsFromDevice } from '$lib/backup/project-removal';
import { LOCATION_ROOT_FOLDER_ID } from '$lib/backup/providers/provider';
import { effectiveAuthorName } from '$lib/backup/version-author';
import {
	clearEditingPresence,
	readEditingNotice,
	writeEditingPresence,
} from '$lib/backup/editing-presence';
import type { SavePageCanvasLinkInput } from '$lib/iiif/types';
import type { CollationPayload, ProjectTranscriptionPayload } from '$lib/storage/formats';
import type { DbInvalidationDomain } from './rpc';
import type { Database } from './types.generated';
import {
	createCollationWithFilesResult,
	createCommittedCollationCheckpointWithFiles,
	getCollationVersionStatusWithWorkingFile,
	listProjectCollationVersionStatusesWithWorkingFiles,
	loadCollationVersionDocument,
	loadCollationWithWorkingFile,
	replaceCollationCurrent,
	restoreCollationVersion,
	saveWorkingCollationArtifact,
	saveWorkingCollationMetadata,
	updateCollationVersionNote,
} from './repositories/collation-files';
import {
	listCollationsWithProjectNames,
	type CollationVersionStatusOptions,
	type CreateCollationInput,
	type SaveCollationArtifactInput,
	type UpdateCollationMetadataInput,
} from './repositories/collations';
import {
	deleteCollationWithFiles,
	deleteTranscriptionWithFiles,
} from './repositories/entity-deletion';
import * as iiif from './repositories/iiif';
import * as iiifFiles from './repositories/iiif-files';
import { rebuildIndexFromStore, restoreOrphanPrimaryToProject } from './repositories/index-rebuild';
import {
	addProjectTranscriptionFromProject,
	createProject,
	ensureDefaultProject,
	forkProject,
	getProject,
	getProjectTranscriptionIds,
	getProjectTranscriptionStatusForOwnedTranscription,
	listProjectDocumentTitles,
	listProjectIdsWithContent,
	listProjects,
	listProjectTranscriptionOptions,
	listProjectTranscriptionSourceCandidates,
	listProjectTranscriptionStatuses,
	refreshProjectTranscription,
	syncProjectTranscriptionIds,
	updateProjectMetadata,
	type AddProjectTranscriptionFromProjectInput,
	type CreateProjectInput,
	type ForkProjectInput,
	type ProjectTranscriptionStatusOptions,
	type RefreshProjectTranscriptionInput,
	type UpdateProjectMetadataInput,
} from './repositories/projects';
import {
	getLatestProjectCommitTimestamp,
	getTranscriptionCurrentContentHashes,
	getTranscriptionSourceOptions,
	listCollationVersions,
	listCommittedTranscriptionCheckpoints,
	listTranscriptionVersions,
	loadCommittedTranscriptionCheckpointPayload,
	type CommitCollationInput,
	type CommitTranscriptionInput,
	type PersistenceWarning,
} from './repositories/revisions';
import {
	createCommittedTranscriptionCheckpointWithFiles,
	createTranscriptionsWithFilesResult,
	createTranscriptionWithFilesResult,
	getTranscriptionsWithWorkingFilesByIds,
	loadTranscriptionContentWithFiles,
	loadTranscriptionWithWorkingFile,
	rebuildVerseIndexForTranscriptionsWithFiles,
	replaceTranscriptionCurrent,
	restoreTranscriptionVersion,
	saveWorkingTranscriptionContent,
	saveWorkingTranscriptionMetadata,
	updateTranscriptionVersionNote,
} from './repositories/transcription-files';
import {
	getTranscriptionSummary,
	getVerseIndexRowsForVerse,
	listTranscriptionSummaries,
	listVerseIndexRows,
	listVerseIndexRowsForTranscription,
	listVerseIndexRowsForTranscriptions,
	type CreateTranscriptionInput,
	type UpdateTranscriptionContentInput,
	type UpdateTranscriptionMetadataInput,
} from './repositories/transcriptions';

export interface DbApiContext {
	db: Kysely<Database>;
	invalidate: (...domains: DbInvalidationDomain[]) => void;
	warn: (warnings: PersistenceWarning[]) => void;
	exclusive: <T>(work: () => Promise<T>) => Promise<T>;
}

export type DbApi = typeof dbApi;

const lastBackups = new Map<string, { remoteCursor?: string; state: string }>();
const failedImports = new Map<string, string>();

export const dbApi = defineApi({
	listTranscriptionSummaries: ({ db }) => listTranscriptionSummaries(db),
	getTranscriptionSummary: ({ db }, id: string) => getTranscriptionSummary(db, id),
	getTranscription: ({ db }, id: string) => loadTranscriptionWithWorkingFile(db, id),
	getTranscriptionsByIds: ({ db }, ids: string[]) =>
		getTranscriptionsWithWorkingFilesByIds(db, ids),
	async createTranscription({ db, invalidate, warn }, input: CreateTranscriptionInput) {
		const result = await createTranscriptionWithFilesResult(db, input);
		invalidate('transcriptions', 'projects');
		warn(result.warnings);
		return result.value;
	},
	async createTranscriptions({ db, invalidate, warn }, inputs: CreateTranscriptionInput[]) {
		const result = await createTranscriptionsWithFilesResult(db, inputs);
		invalidate('transcriptions', 'projects');
		warn(result.warnings);
		return result.value;
	},
	async updateTranscriptionContent({ db, invalidate }, input: UpdateTranscriptionContentInput) {
		await saveWorkingTranscriptionContent(db, input);
		invalidate('transcriptions');
	},
	async updateTranscriptionMetadata({ db, invalidate }, input: UpdateTranscriptionMetadataInput) {
		await saveWorkingTranscriptionMetadata(db, input);
		invalidate('transcriptions');
	},
	listConflictCopies: ({ db }, projectId?: string) => listConflictCopies(db, projectId),
	loadConflictCopyContents: ({ db }, copyId: string) => loadConflictCopyContents(db, copyId),
	async reconcileConflictCopy({ db, invalidate }, copyId: string, choices: CompareChoices) {
		await reconcileConflictCopy(db, copyId, choices);
		invalidate('transcriptions', 'collations', 'projects');
	},
	async deleteTranscription({ db, invalidate, warn }, id: string) {
		warn(await deleteTranscriptionWithFiles(db, id));
		invalidate('transcriptions', 'projects');
	},
	getVerseIndexRowsForVerse: ({ db }, verseIdentifier: string, transcriptionIds?: string[]) =>
		getVerseIndexRowsForVerse(db, verseIdentifier, transcriptionIds),
	listVerseIndexRows: ({ db }) => listVerseIndexRows(db),
	listVerseIndexRowsForTranscription: ({ db }, transcriptionId: string) =>
		listVerseIndexRowsForTranscription(db, transcriptionId),
	listVerseIndexRowsForTranscriptions: ({ db }, transcriptionIds: string[]) =>
		listVerseIndexRowsForTranscriptions(db, transcriptionIds),
	async rebuildVerseIndexForTranscriptions({ db, invalidate }, transcriptionIds: string[]) {
		const result = await rebuildVerseIndexForTranscriptionsWithFiles(db, transcriptionIds);
		invalidate('transcriptions');
		return result;
	},

	listProjects: ({ db }) => listProjects(db),
	async ensureDefaultProject({ db, invalidate }) {
		const id = await ensureDefaultProject(db);
		invalidate('projects');
		return id;
	},
	getProject: ({ db }, projectId: string) => getProject(db, projectId),
	async createProject({ db, invalidate }, input: CreateProjectInput) {
		const id = await createProject(db, input);
		invalidate('projects');
		return id;
	},
	async forkProject({ db, invalidate, warn }, input: ForkProjectInput) {
		const result = await forkProject(db, input);
		invalidate('projects', 'transcriptions', 'collations', 'iiif');
		warn(result.warnings);
		return result;
	},
	async updateProjectMetadata({ db, invalidate }, input: UpdateProjectMetadataInput) {
		await updateProjectMetadata(db, input);
		invalidate('projects');
	},
	listProjectTranscriptionOptions: ({ db }, projectId?: string) =>
		listProjectTranscriptionOptions(db, projectId),
	listProjectTranscriptionStatuses: (
		{ db },
		projectId: string,
		options?: ProjectTranscriptionStatusOptions
	) => listProjectTranscriptionStatuses(db, projectId, options),
	listProjectDocumentTitles: ({ db }, projectId: string) =>
		listProjectDocumentTitles(db, projectId),
	listProjectIdsWithContent: ({ db }) => listProjectIdsWithContent(db),
	getProjectTranscriptionStatusForOwnedTranscription: (
		{ db },
		projectOwnedTranscriptionId: string,
		options?: ProjectTranscriptionStatusOptions
	) =>
		getProjectTranscriptionStatusForOwnedTranscription(
			db,
			projectOwnedTranscriptionId,
			options
		),
	loadProjectTranscriptionContent: ({ db }, transcriptionId: string) =>
		loadTranscriptionContentWithFiles(db, transcriptionId),
	getProjectTranscriptionIds: ({ db }, projectId: string) =>
		getProjectTranscriptionIds(db, projectId),
	async syncProjectTranscriptionIds({ db, invalidate }, projectId: string, nextIds: string[]) {
		const ids = await syncProjectTranscriptionIds(db, projectId, nextIds);
		invalidate('projects', 'transcriptions', 'iiif');
		return ids;
	},
	async refreshProjectTranscription(
		{ db, invalidate, warn },
		input: RefreshProjectTranscriptionInput
	) {
		const status = await refreshProjectTranscription(db, input);
		invalidate('projects', 'transcriptions', 'iiif');
		warn(status.warnings ?? []);
		return status;
	},
	async addProjectTranscriptionFromProject(
		{ db, invalidate, warn },
		input: AddProjectTranscriptionFromProjectInput
	) {
		const result = await addProjectTranscriptionFromProject(db, input);
		invalidate('projects', 'transcriptions', 'iiif');
		warn(result.warnings);
		return result;
	},
	listProjectTranscriptionSourceCandidates: ({ db }, targetProjectId: string) =>
		listProjectTranscriptionSourceCandidates(db, targetProjectId),

	listCollationsWithProjectNames: ({ db }) => listCollationsWithProjectNames(db),
	async createCollation({ db, invalidate, warn }, input: CreateCollationInput) {
		const result = await createCollationWithFilesResult(db, input);
		invalidate('collations');
		warn(result.warnings);
		return result.value;
	},
	loadCollation: ({ db }, id: string) => loadCollationWithWorkingFile(db, id),
	listProjectCollationVersionStatuses: (
		{ db },
		projectId: string,
		options?: CollationVersionStatusOptions
	) => listProjectCollationVersionStatusesWithWorkingFiles(db, projectId, options),
	getCollationVersionStatus: (
		{ db },
		collationId: string,
		options?: CollationVersionStatusOptions
	) => getCollationVersionStatusWithWorkingFile(db, collationId, options),
	async saveCollationArtifact({ db, invalidate }, input: SaveCollationArtifactInput) {
		const artifactId = await saveWorkingCollationArtifact(db, input);
		invalidate('collations');
		return artifactId;
	},
	async updateCollationMetadata({ db, invalidate }, input: UpdateCollationMetadataInput) {
		await saveWorkingCollationMetadata(db, input);
		invalidate('collations');
	},
	async deleteCollation({ db, invalidate, warn }, id: string) {
		warn(await deleteCollationWithFiles(db, id));
		invalidate('collations', 'projects');
	},

	listManifestSources: ({ db }, transcriptionId: string) =>
		iiif.listManifestSources(db, transcriptionId),
	async ensureManifestSource({ db, invalidate }, input: iiif.EnsureManifestSourceInput) {
		const row = await iiifFiles.ensureManifestSourceWithFiles(db, input);
		invalidate('iiif');
		return row;
	},
	getManifestSource: ({ db }, transcriptionId: string, manifestSourceId: string) =>
		iiif.getManifestSource(db, { transcriptionId, manifestSourceId }),
	listPageCanvasLinks: ({ db }, transcriptionId: string) =>
		iiif.listPageCanvasLinks(db, transcriptionId),
	async upsertPageCanvasLink({ db, invalidate }, input: SavePageCanvasLinkInput) {
		const row = await iiifFiles.upsertPageCanvasLinkWithFiles(db, input);
		invalidate('iiif');
		return row;
	},
	async savePageCanvasLinks({ db, invalidate }, inputs: SavePageCanvasLinkInput[]) {
		const rows = await iiifFiles.savePageCanvasLinksWithFiles(db, inputs);
		invalidate('iiif');
		return rows;
	},
	async deletePageCanvasLink({ db, invalidate }, input: iiif.DeletePageCanvasLinkInput) {
		const count = await iiifFiles.deletePageCanvasLinkWithFiles(db, input);
		invalidate('iiif');
		return count;
	},
	async deletePageCanvasLinksForPage(
		{ db, invalidate },
		input: { transcriptionId: string; pageId: string }
	) {
		const count = await iiifFiles.deletePageCanvasLinksForPageWithFiles(db, input);
		invalidate('iiif');
		return count;
	},
	async deleteAllPageCanvasLinks({ db, invalidate }, transcriptionId: string) {
		const count = await iiifFiles.deleteAllPageCanvasLinksWithFiles(db, transcriptionId);
		invalidate('iiif');
		return count;
	},
	async deleteManifestSource({ db, invalidate }, input: iiif.ManifestSourceIdInput) {
		const deleted = await iiifFiles.deleteManifestSourceWithFiles(db, input);
		invalidate('iiif');
		return deleted;
	},
	findLinkedPageForCanvas: ({ db }, input: iiif.FindLinkedPageForCanvasInput) =>
		iiif.findLinkedPageForCanvas(db, input),
	listCanvasAnnotations: ({ db }, input: iiif.ListCanvasAnnotationsInput) =>
		iiif.listCanvasAnnotations(db, input),
	getCanvasAnnotation: ({ db }, input: iiif.CanvasAnnotationIdInput) =>
		iiif.getCanvasAnnotation(db, input),
	async upsertCanvasAnnotation({ db, invalidate }, input: iiif.UpsertCanvasAnnotationInput) {
		await iiifFiles.upsertCanvasAnnotationWithFiles(db, input);
		invalidate('iiif');
	},
	async deleteCanvasAnnotation({ db, invalidate }, input: iiif.CanvasAnnotationIdInput) {
		await iiifFiles.deleteCanvasAnnotationWithFiles(db, input);
		invalidate('iiif');
	},

	async createCommittedTranscriptionCheckpoint(
		{ db, invalidate },
		input: CommitTranscriptionInput
	) {
		const { project_id } = await db
			.selectFrom('project_transcriptions')
			.select('project_id')
			.where('id', '=', input.projectTranscriptionId)
			.executeTakeFirstOrThrow();
		const checkpoint = await createCommittedTranscriptionCheckpointWithFiles(db, {
			...input,
			authorName: input.authorName ?? (await effectiveAuthorName(project_id)) ?? undefined,
		});
		invalidate('transcriptions');
		return checkpoint;
	},
	async createCommittedCollationCheckpoint({ db, invalidate }, input: CommitCollationInput) {
		const { project_id } = await db
			.selectFrom('collations')
			.select('project_id')
			.where('id', '=', input.collationId)
			.executeTakeFirstOrThrow();
		const checkpoint = await createCommittedCollationCheckpointWithFiles(db, {
			...input,
			authorName: input.authorName ?? (await effectiveAuthorName(project_id)) ?? undefined,
		});
		invalidate('collations');
		return checkpoint;
	},
	listCommittedTranscriptionCheckpoints: ({ db }, transcriptionId: string) =>
		listCommittedTranscriptionCheckpoints(db, transcriptionId),
	listTranscriptionVersions: ({ db }, transcriptionId: string) =>
		listTranscriptionVersions(db, transcriptionId),
	getTranscriptionCurrentContentHashes: ({ db }, transcriptionIds: string[]) =>
		getTranscriptionCurrentContentHashes(db, transcriptionIds),
	getTranscriptionSourceOptions: ({ db }, transcriptionId: string) =>
		getTranscriptionSourceOptions(db, transcriptionId),
	listCollationVersions: ({ db }, collationId: string) => listCollationVersions(db, collationId),
	async restoreTranscriptionVersion(
		{ db, invalidate },
		transcriptionId: string,
		checkpointId: string
	) {
		const previous = await restoreTranscriptionVersion(db, transcriptionId, checkpointId);
		invalidate('transcriptions', 'iiif');
		return previous;
	},
	async replaceTranscriptionCurrent(
		{ db, invalidate },
		transcriptionId: string,
		payload: ProjectTranscriptionPayload
	) {
		await replaceTranscriptionCurrent(db, transcriptionId, payload);
		invalidate('transcriptions', 'iiif');
	},
	async updateTranscriptionVersionNote(
		{ db, invalidate },
		transcriptionId: string,
		checkpointId: string,
		note: string | null
	) {
		await updateTranscriptionVersionNote(db, transcriptionId, checkpointId, note);
		invalidate('transcriptions');
	},
	async restoreCollationVersion({ db, invalidate }, collationId: string, checkpointId: string) {
		const previous = await restoreCollationVersion(db, collationId, checkpointId);
		invalidate('collations');
		return previous;
	},
	async replaceCollationCurrent(
		{ db, invalidate },
		collationId: string,
		payload: CollationPayload
	) {
		await replaceCollationCurrent(db, collationId, payload);
		invalidate('collations');
	},
	async updateCollationVersionNote(
		{ db, invalidate },
		collationId: string,
		checkpointId: string,
		note: string | null
	) {
		await updateCollationVersionNote(db, collationId, checkpointId, note);
		invalidate('collations');
	},
	async loadTranscriptionVersionContent(
		{ db },
		transcriptionId: string,
		checkpointId: string | null
	): Promise<unknown> {
		if (!checkpointId) return loadTranscriptionContentWithFiles(db, transcriptionId);
		const version = await loadCommittedTranscriptionCheckpointPayload(
			db,
			transcriptionId,
			checkpointId
		);
		return version.payload.content_json;
	},
	loadCollationVersionDocument: ({ db }, collationId: string, checkpointId: string | null) =>
		loadCollationVersionDocument(db, collationId, checkpointId),
	getLatestProjectCommitTimestamp: ({ db }, projectId: string) =>
		getLatestProjectCommitTimestamp(db, projectId),
	loadCommittedTranscriptionCheckpointPayload: (
		{ db },
		transcriptionId: string,
		checkpointId: string
	) => loadCommittedTranscriptionCheckpointPayload(db, transcriptionId, checkpointId),

	listPendingUploadPaths: ({ db }, context: SyncProjectContext) =>
		listPendingUploadPaths(db, context),
	async backupProject({ db, invalidate, exclusive }, context: SyncProjectContext) {
		const provider = await createProviderForLocation(context.connectionId);
		const key = `${context.connectionId}/${context.projectId}/${context.cloudFolderId}`;
		const result = await backupProject(db, provider, context, {
			authorName: (await effectiveAuthorName(context.projectId)) ?? undefined,
			remoteCursor: lastBackups.get(key)?.remoteCursor,
			exclusive,
		});
		const state = JSON.stringify([
			result.uiState,
			result.providerError ?? null,
			Boolean(result.hasConflictCopies),
		]);
		const changed =
			lastBackups.get(key)?.state !== state ||
			result.uploadedPaths.length > 0 ||
			result.downloadedPaths.length > 0 ||
			result.deletedPaths.length > 0;
		lastBackups.set(key, { remoteCursor: result.remoteCursor, state });
		if (changed) invalidate('sync-targets');
		if (result.downloadedPaths.length || result.deletedPaths.length || result.conflictCopyId) {
			invalidate('projects', 'transcriptions', 'collations', 'iiif');
		}
		return result;
	},
	writeEditingPresence: (_context, projectId: string, documentId: string) =>
		writeEditingPresence(projectId, documentId),
	clearEditingPresence: (_context, projectId: string, documentId: string) =>
		clearEditingPresence(projectId, documentId),
	readEditingNotice: (_context, projectId: string, documentId: string) =>
		readEditingNotice(projectId, documentId),
	async discoverLocationProjects({ db, invalidate, exclusive }, locationId: string) {
		const provider = await createProviderForLocation(locationId);
		const result = await discoverLocationProjects(db, provider, LOCATION_ROOT_FOLDER_ID, {
			exclusive,
			failedImports,
		});
		if (result.projects.some(project => project.imported)) {
			invalidate('projects', 'transcriptions', 'collations', 'iiif');
		}
		return result;
	},
	async moveProject({ db, invalidate, exclusive }, projectId: string, locationId: string) {
		const placement = (await listProjectPlacements())
			.filter(isPlacedProject)
			.find(candidate => candidate.projectId === projectId);
		if (placement?.locationId === locationId) {
			throw new Error('The project already lives in this location.');
		}
		const location = await getProjectLocation(locationId);
		if (!location) throw new Error('Project location was not found.');
		const project = await exclusive(() =>
			db
				.selectFrom('projects')
				.select('storage_slug')
				.where('id', '=', projectId)
				.executeTakeFirstOrThrow()
		);
		const authorName = (await effectiveAuthorName(projectId)) ?? undefined;
		await moveProject(
			db,
			{
				projectId,
				source: placement
					? {
							provider: await createProviderForLocation(placement.locationId),
							rootFolderId: LOCATION_ROOT_FOLDER_ID,
							locationId: placement.locationId,
							folderName: placement.folderName,
						}
					: null,
				destination: {
					provider: await createProviderForLocation(location.id),
					rootFolderId: LOCATION_ROOT_FOLDER_ID,
					locationId: location.id,
					folderName: project.storage_slug,
					label: location.displayPath,
				},
				movedBy: authorName ?? 'A collaborator',
			},
			{ authorName, exclusive }
		);
		invalidate('sync-targets');
	},
	async deleteProject({ db, invalidate, exclusive }, projectId: string) {
		const placement = (await listProjectPlacements())
			.filter(isPlacedProject)
			.find(candidate => candidate.projectId === projectId);
		if (placement) {
			await deleteProjectFromLocation(
				{
					provider: await createProviderForLocation(placement.locationId),
					rootFolderId: LOCATION_ROOT_FOLDER_ID,
					locationId: placement.locationId,
					folderName: placement.folderName,
				},
				{
					deletedAt: new Date().toISOString(),
					deletedBy: (await effectiveAuthorName(projectId)) ?? 'A collaborator',
				}
			);
		}
		await exclusive(() => deleteProjectLocally(db, projectId));
		invalidate('projects', 'transcriptions', 'collations', 'iiif', 'sync-targets');
	},
	async removeProjectsFromDevice({ db, invalidate }, placements: PlacedProject[]) {
		const result = await removeProjectsFromDevice(db, placements);
		if (result.ok)
			invalidate('projects', 'transcriptions', 'collations', 'iiif', 'sync-targets');
		return result;
	},
	exportProjectZip: ({ db }, projectId: string) => exportProjectZip(db, projectId),
	exportAllProjectsZip: ({ db }) => exportAllProjectsZip(db),
	async importProjectZip(
		{ db, invalidate },
		bytes: Uint8Array,
		collisionMode?: ProjectZipImportCollisionMode
	) {
		const result = await importProjectZip(db, bytes, { collisionMode });
		if (result.ok) invalidate('projects', 'transcriptions', 'collations', 'iiif');
		return result;
	},
	async restoreReferenceEditionsArchive({ invalidate }, bytes: Uint8Array) {
		const result = await restoreReferenceEditionsZip(bytes);
		invalidate('reference-editions');
		return result;
	},

	async rebuildLocalIndex({ db, invalidate }) {
		const report = await rebuildIndexFromStore(db);
		invalidate('all');
		return report;
	},
	async restoreOrphanPrimary({ db, invalidate }, path: string) {
		const report = await restoreOrphanPrimaryToProject(db, path);
		invalidate('all');
		return report;
	},
});

/** Run outside the request queue; local database and store work goes through `exclusive`. */
export const unqueuedMethods = new Set<keyof DbApi>([
	'backupProject',
	'discoverLocationProjects',
	'moveProject',
	'deleteProject',
	'writeEditingPresence',
	'clearEditingPresence',
	'readEditingNotice',
]);

function defineApi<T extends Record<string, (context: DbApiContext, ...args: never[]) => unknown>>(
	api: T
): T {
	return api;
}
