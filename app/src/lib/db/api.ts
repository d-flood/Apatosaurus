import type { Kysely } from 'kysely';

import { backupProject } from '$lib/backup/sync-manager';
import { deriveProjectBackupSummary } from '$lib/backup/backup-summary';
import type { SyncProjectContext } from '$lib/backup/backup-status';
import { exportAllProjectsZip, exportProjectZip } from '$lib/backup/project-zip-export';
import {
	importProjectZip,
	restoreReferenceEditionsZip,
	type ProjectZipImportCollisionMode,
} from '$lib/backup/project-zip-import';
import { createProviderForSyncTarget } from '$lib/backup/provider-factory';
import type { SavePageCanvasLinkInput } from '$lib/iiif/types';
import type { DbInvalidationDomain } from './rpc';
import type { Database } from './types.generated';
import {
	createCollationWithFilesResult,
	createCommittedCollationCheckpointWithFiles,
	getCollationVersionStatusWithWorkingFile,
	listProjectCollationVersionStatusesWithWorkingFiles,
	loadCollationWithWorkingFile,
	saveWorkingCollationArtifact,
	saveWorkingCollationMetadata,
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
	listCommittedTranscriptionCheckpoints,
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
	saveWorkingTranscriptionContent,
	saveWorkingTranscriptionMetadata,
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
}

const fileOnly = { allowIndexFallback: false };
const fileBacked = { requireFileBackedContent: true };

export type DbApi = typeof dbApi;

export const dbApi = defineApi({
	listTranscriptionSummaries: ({ db }) => listTranscriptionSummaries(db),
	getTranscriptionSummary: ({ db }, id: string) => getTranscriptionSummary(db, id),
	getTranscription: ({ db }, id: string) => loadTranscriptionWithWorkingFile(db, id, fileOnly),
	getTranscriptionsByIds: ({ db }, ids: string[]) =>
		getTranscriptionsWithWorkingFilesByIds(db, ids, fileOnly),
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
		const result = await rebuildVerseIndexForTranscriptionsWithFiles(
			db,
			transcriptionIds,
			fileOnly
		);
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
	) => listProjectTranscriptionStatuses(db, projectId, { ...options, ...fileBacked }),
	listProjectDocumentTitles: ({ db }, projectId: string) =>
		listProjectDocumentTitles(db, projectId),
	getProjectTranscriptionStatusForOwnedTranscription: (
		{ db },
		projectOwnedTranscriptionId: string,
		options?: ProjectTranscriptionStatusOptions
	) =>
		getProjectTranscriptionStatusForOwnedTranscription(db, projectOwnedTranscriptionId, {
			...options,
			...fileBacked,
		}),
	loadProjectTranscriptionContent: ({ db }, transcriptionId: string) =>
		loadTranscriptionContentWithFiles(db, transcriptionId, fileOnly),
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
		const status = await refreshProjectTranscription(db, input, fileBacked);
		invalidate('projects', 'transcriptions', 'iiif');
		warn(status.warnings ?? []);
		return status;
	},
	async addProjectTranscriptionFromProject(
		{ db, invalidate, warn },
		input: AddProjectTranscriptionFromProjectInput
	) {
		const result = await addProjectTranscriptionFromProject(db, input, fileBacked);
		invalidate('projects', 'transcriptions', 'iiif');
		warn(result.warnings);
		return result;
	},
	listProjectTranscriptionSourceCandidates: ({ db }, targetProjectId: string) =>
		listProjectTranscriptionSourceCandidates(db, targetProjectId, fileBacked),

	listCollationsWithProjectNames: ({ db }) => listCollationsWithProjectNames(db),
	async createCollation({ db, invalidate, warn }, input: CreateCollationInput) {
		const result = await createCollationWithFilesResult(db, input);
		invalidate('collations');
		warn(result.warnings);
		return result.value;
	},
	loadCollation: ({ db }, id: string) => loadCollationWithWorkingFile(db, id, fileOnly),
	listProjectCollationVersionStatuses: (
		{ db },
		projectId: string,
		options?: CollationVersionStatusOptions
	) => listProjectCollationVersionStatusesWithWorkingFiles(db, projectId, options, fileOnly),
	getCollationVersionStatus: (
		{ db },
		collationId: string,
		options?: CollationVersionStatusOptions
	) => getCollationVersionStatusWithWorkingFile(db, collationId, options, fileOnly),
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
		const checkpoint = await createCommittedTranscriptionCheckpointWithFiles(db, input);
		invalidate('transcriptions');
		return checkpoint;
	},
	async createCommittedCollationCheckpoint({ db, invalidate }, input: CommitCollationInput) {
		const checkpoint = await createCommittedCollationCheckpointWithFiles(db, input);
		invalidate('collations');
		return checkpoint;
	},
	listCommittedTranscriptionCheckpoints: ({ db }, transcriptionId: string) =>
		listCommittedTranscriptionCheckpoints(db, transcriptionId),
	getLatestProjectCommitTimestamp: ({ db }, projectId: string) =>
		getLatestProjectCommitTimestamp(db, projectId),
	loadCommittedTranscriptionCheckpointPayload: (
		{ db },
		transcriptionId: string,
		checkpointId: string
	) => loadCommittedTranscriptionCheckpointPayload(db, transcriptionId, checkpointId),

	deriveProjectBackupSummary: ({ db }, context: SyncProjectContext) =>
		deriveProjectBackupSummary(db, context),
	async backupProject({ db, invalidate }, context: SyncProjectContext, strict: boolean) {
		const provider = await createProviderForSyncTarget(context.connectionId);
		const result = await backupProject(db, provider, context, { strict });
		invalidate('sync-targets');
		if (result.downloadedPaths.length || result.deletedPaths.length || result.conflictCopyId) {
			invalidate('projects', 'transcriptions', 'collations', 'iiif');
		}
		return result;
	},
	exportProjectZip: ({ db }, projectId: string, includeDrafts = false) =>
		exportProjectZip(db, projectId, { includeDrafts }),
	exportAllProjectsZip: ({ db }, includeDrafts = false) =>
		exportAllProjectsZip(db, { includeDrafts }),
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

function defineApi<T extends Record<string, (context: DbApiContext, ...args: never[]) => unknown>>(
	api: T
): T {
	return api;
}
