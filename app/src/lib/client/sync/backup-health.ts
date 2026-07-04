import type { Kysely } from 'kysely';

import type { Database } from '$lib/client/db/types.generated';
import {
	deriveProjectBackupSummary,
	type BackupItemState,
	type SyncProjectContext,
	type SyncQuarantine,
} from './sync-manager';
import {
	parseCollationCloudFile,
	parseHistoryCloudFile,
	parseProjectCloudFile,
	parseProjectTranscriptionCloudFile,
	parseTombstoneCloudFile,
	projectRelativeCloudPaths,
	serializeProjectCloudFile,
	validateCollationHeadMatchesCheckpoint,
	validateProjectTranscriptionHeadMatchesCheckpoint,
	type CloudFileQuarantine,
	type CollationCloudFile,
	type HistoryCloudFile,
	type ProjectCloudFile,
	type ProjectTranscriptionCloudFile,
} from './cloud-files';
import {
	isCloudProviderError,
	type CloudFileMetadata,
	type CloudProviderErrorCode,
	type CloudStorageProvider,
} from './providers/provider';

export type ProjectBackupHealthStatus =
	| 'local-only'
	| 'uncommitted-changes'
	| 'committed-pending-backup'
	| 'backed-up-local-metadata'
	| 'restorable-now'
	| 'conflict'
	| 'unknown-provider-state'
	| 'incomplete-backup';

export interface BackupHealthCheck {
	id: string;
	label: string;
	status: 'pass' | 'fail' | 'warning' | 'unknown';
	message: string;
	blocking: boolean;
}

export interface ProjectBackupHealth {
	projectId: string;
	connectionId: string | null;
	status: ProjectBackupHealthStatus;
	safeToRemove: boolean;
	checks: BackupHealthCheck[];
	blockingChecks: BackupHealthCheck[];
	lastFullySyncedAt: string | null;
	providerError?: CloudProviderErrorCode;
	providerMessage?: string;
	quarantines: SyncQuarantine[];
}

export async function deriveLocalProjectBackupHealth(
	db: Kysely<Database>,
	projectId: string,
	context?: SyncProjectContext | null
): Promise<ProjectBackupHealth> {
	if (!context) {
		return finalizeHealth({
			projectId,
			connectionId: null,
			status: 'local-only',
			lastFullySyncedAt: null,
			checks: [
				check(
					'backup-location',
					'Backup location',
					'fail',
					'This project has no selected backup location.',
					true
				),
			],
			quarantines: [],
		});
	}

	const summary = await deriveProjectBackupSummary(db, context);
	const checks = localSummaryChecks(summary.blockingItems, summary.pendingItems);
	const status = localStatusFromSummary(summary.blockingItems, summary.pendingItems);
	return finalizeHealth({
		projectId,
		connectionId: context.connectionId,
		status,
		lastFullySyncedAt: summary.lastFullySyncedAt,
		checks,
		quarantines: [],
	});
}

export async function verifyRemoteProjectBackupHealth(
	db: Kysely<Database>,
	provider: CloudStorageProvider,
	context: SyncProjectContext
): Promise<ProjectBackupHealth> {
	const localSummary = await deriveProjectBackupSummary(db, context);
	const checks = localSummaryChecks(localSummary.blockingItems, localSummary.pendingItems);
	const quarantines: SyncQuarantine[] = [];
	let filesByRelativePath: Map<string, CloudFileMetadata>;

	try {
		filesByRelativePath = await listRemoteFilesByRelativePath(provider, context);
		checks.push(
			check(
				'provider-reachable',
				'Provider reachable',
				'pass',
				'The selected backup provider is reachable now.',
				true
			)
		);
	} catch (error) {
		if (isCloudProviderError(error)) {
			checks.push(
				check(
					'provider-reachable',
					'Provider reachable',
					'fail',
					error.message,
					true
				)
			);
			return finalizeHealth({
				projectId: context.projectId,
				connectionId: context.connectionId,
				status: 'unknown-provider-state',
				lastFullySyncedAt: localSummary.lastFullySyncedAt,
				checks,
				providerError: error.code,
				providerMessage: error.message,
				quarantines,
			});
		}
		throw error;
	}

	const manifestMetadata = filesByRelativePath.get(projectRelativeCloudPaths().project);
	if (!manifestMetadata) {
		checks.push(
			check(
				'remote-manifest',
				'Remote project manifest',
				'fail',
				'The selected backup folder does not contain project.json.',
				true
			)
		);
		return finalizeHealth({
			projectId: context.projectId,
			connectionId: context.connectionId,
			status: 'incomplete-backup',
			lastFullySyncedAt: localSummary.lastFullySyncedAt,
			checks,
			quarantines,
		});
	}

	const manifestContent = await provider.downloadFile(manifestMetadata.id);
	const parsedManifest = await parseProjectCloudFile(manifestContent);
	if (!parsedManifest.ok) {
		const quarantine = quarantineFor(manifestMetadata.path, parsedManifest.quarantine);
		quarantines.push(quarantine);
		checks.push(quarantineCheck('remote-manifest', 'Remote project manifest', quarantine));
		return finalizeHealth({
			projectId: context.projectId,
			connectionId: context.connectionId,
			status: 'incomplete-backup',
			lastFullySyncedAt: localSummary.lastFullySyncedAt,
			checks,
			quarantines,
		});
	}

	const remoteManifest = parsedManifest.value;
	checks.push(
		remoteManifest.id === context.projectId
			? check(
					'remote-manifest',
					'Remote project manifest',
					'pass',
					'project.json is valid and belongs to this project.',
					true
				)
			: check(
					'remote-manifest',
					'Remote project manifest',
					'fail',
					'project.json belongs to a different project.',
					true
				)
	);

	await addManifestHeadCheck(db, context, remoteManifest, checks);
	await addRemoteFileChecks(provider, filesByRelativePath, remoteManifest, checks, quarantines);

	const status = remoteStatusFromChecks(checks, localSummary.pendingItems);
	return finalizeHealth({
		projectId: context.projectId,
		connectionId: context.connectionId,
		status,
		lastFullySyncedAt: localSummary.lastFullySyncedAt,
		checks,
		quarantines,
	});
}

export const deriveSafeRemovalChecklist = verifyRemoteProjectBackupHealth;

function localSummaryChecks(
	blockingItems: BackupItemState[],
	pendingItems: BackupItemState[]
): BackupHealthCheck[] {
	const uncommitted = blockingItems.filter(item => item.status === 'uncommitted-local-changes');
	const neverCommitted = blockingItems.filter(item => item.status === 'never-committed');
	return [
		uncommitted.length === 0 && neverCommitted.length === 0
			? check(
					'local-committed-state',
					'Local committed state',
					'pass',
					'All project entities are committed locally.',
					true
				)
			: check(
					'local-committed-state',
					'Local committed state',
					'fail',
					`${uncommitted.length + neverCommitted.length} project item(s) need a committed version before local removal.`,
					true
				),
		pendingItems.length === 0
			? check(
					'local-sync-metadata',
					'Last known backup metadata',
					'pass',
					'Local metadata has no committed items pending backup.',
					false
				)
			: check(
					'local-sync-metadata',
					'Last known backup metadata',
					'warning',
					`${pendingItems.length} committed item(s) are pending backup according to local metadata.`,
					false
				),
	];
}

async function addManifestHeadCheck(
	db: Kysely<Database>,
	context: SyncProjectContext,
	remoteManifest: ProjectCloudFile,
	checks: BackupHealthCheck[]
): Promise<void> {
	try {
		const localManifest = await serializeProjectCloudFile(db, context.projectId);
		checks.push(
			remoteManifest.manifest_content_hash === localManifest.manifest_content_hash
				? check(
						'manifest-heads-match',
						'Manifest heads match',
						'pass',
						'Remote project heads match the local committed project heads.',
						true
					)
				: check(
						'manifest-heads-match',
						'Manifest heads match',
						'fail',
						'Remote project heads differ from the local committed project heads.',
						true
					)
		);
	} catch (error) {
		checks.push(
			check(
				'manifest-heads-match',
				'Manifest heads match',
				'fail',
				`Local project heads could not be serialized: ${messageFor(error)}`,
				true
			)
		);
	}
}

async function addRemoteFileChecks(
	provider: CloudStorageProvider,
	filesByRelativePath: Map<string, CloudFileMetadata>,
	manifest: ProjectCloudFile,
	checks: BackupHealthCheck[],
	quarantines: SyncQuarantine[]
): Promise<void> {
	let primaryFailures = 0;
	let historyFailures = 0;
	let tombstoneFailures = 0;

	for (const head of manifest.transcriptions) {
		const primary = await loadProjectTranscriptionPrimary(provider, filesByRelativePath, head.primary_path);
		if (!primary.ok) {
			primaryFailures += 1;
			quarantines.push(primary.quarantine);
			continue;
		}
		if (
			primary.value.project_transcription_id !== head.project_transcription_id ||
			primary.value.current_revision.id !== head.current_revision?.id ||
			primary.value.current_revision.content_hash !== head.current_revision?.content_hash
		) {
			primaryFailures += 1;
			quarantines.push({
				path: head.primary_path,
				code: 'hash_mismatch',
				message: 'Project transcription primary does not match project manifest.',
			});
			continue;
		}
		const historyPath = projectRelativeCloudPaths().transcriptionHistory(
			head.project_transcription_id,
			primary.value.current_revision.id
		);
		const history = await loadHistory(provider, filesByRelativePath, historyPath);
		if (!history.ok) {
			historyFailures += 1;
			quarantines.push(history.quarantine);
			continue;
		}
		const validation = validateProjectTranscriptionHeadMatchesCheckpoint(
			primary.value,
			history.value
		);
		if (!validation.ok) {
			historyFailures += 1;
			quarantines.push(quarantineFor(historyPath, validation.quarantine));
		}
	}

	for (const head of manifest.collations) {
		const primary = await loadCollationPrimary(provider, filesByRelativePath, head.primary_path);
		if (!primary.ok) {
			primaryFailures += 1;
			quarantines.push(primary.quarantine);
			continue;
		}
		if (
			primary.value.id !== head.collation_id ||
			primary.value.project_id !== manifest.id ||
			primary.value.current_revision.id !== head.current_revision?.id ||
			primary.value.current_revision.content_hash !== head.current_revision?.content_hash
		) {
			primaryFailures += 1;
			quarantines.push({
				path: head.primary_path,
				code: 'hash_mismatch',
				message: 'Collation primary does not match project manifest.',
			});
			continue;
		}
		const historyPath = projectRelativeCloudPaths().collationHistory(
			head.collation_id,
			primary.value.current_revision.id
		);
		const history = await loadHistory(provider, filesByRelativePath, historyPath);
		if (!history.ok) {
			historyFailures += 1;
			quarantines.push(history.quarantine);
			continue;
		}
		const validation = validateCollationHeadMatchesCheckpoint(primary.value, history.value);
		if (!validation.ok) {
			historyFailures += 1;
			quarantines.push(quarantineFor(historyPath, validation.quarantine));
		}
	}

	for (const head of manifest.tombstones) {
		const metadata = filesByRelativePath.get(head.primary_path);
		if (!metadata) {
			tombstoneFailures += 1;
			quarantines.push({
				path: head.primary_path,
				code: 'invalid_shape',
				message: 'Tombstone file is missing.',
			});
			continue;
		}
		const parsed = await parseTombstoneCloudFile(await provider.downloadFile(metadata.id));
		if (!parsed.ok) {
			tombstoneFailures += 1;
			quarantines.push(quarantineFor(metadata.path, parsed.quarantine));
			continue;
		}
		if (parsed.value.id !== head.tombstone_id || parsed.value.project_id !== manifest.id) {
			tombstoneFailures += 1;
			quarantines.push({
				path: head.primary_path,
				code: 'invalid_shape',
				message: 'Tombstone file does not match project manifest.',
			});
		}
	}

	checks.push(
		primaryFailures === 0
			? check('remote-primaries', 'Remote primary files', 'pass', 'All manifest primary files are present and valid.', true)
			: check('remote-primaries', 'Remote primary files', 'fail', `${primaryFailures} remote primary file(s) are missing or invalid.`, true),
		historyFailures === 0
			? check('remote-history', 'Remote history files', 'pass', 'All current committed heads have valid history files.', true)
			: check('remote-history', 'Remote history files', 'fail', `${historyFailures} current history file(s) are missing or invalid.`, true),
		tombstoneFailures === 0
			? check('remote-tombstones', 'Remote tombstones', 'pass', 'All manifest tombstones are present and valid.', true)
			: check('remote-tombstones', 'Remote tombstones', 'fail', `${tombstoneFailures} tombstone file(s) are missing or invalid.`, true)
	);
}

type LoadResult<T> = { ok: true; value: T } | { ok: false; quarantine: SyncQuarantine };

async function loadProjectTranscriptionPrimary(
	provider: CloudStorageProvider,
	filesByRelativePath: Map<string, CloudFileMetadata>,
	path: string
): Promise<LoadResult<ProjectTranscriptionCloudFile>> {
	const metadata = filesByRelativePath.get(path);
	if (!metadata) return missingFile(path, 'Project transcription primary file is missing.');
	const parsed = await parseProjectTranscriptionCloudFile(await provider.downloadFile(metadata.id));
	return parsed.ok
		? { ok: true, value: parsed.value }
		: { ok: false, quarantine: quarantineFor(metadata.path, parsed.quarantine) };
}

async function loadCollationPrimary(
	provider: CloudStorageProvider,
	filesByRelativePath: Map<string, CloudFileMetadata>,
	path: string
): Promise<LoadResult<CollationCloudFile>> {
	const metadata = filesByRelativePath.get(path);
	if (!metadata) return missingFile(path, 'Collation primary file is missing.');
	const parsed = await parseCollationCloudFile(await provider.downloadFile(metadata.id));
	return parsed.ok
		? { ok: true, value: parsed.value }
		: { ok: false, quarantine: quarantineFor(metadata.path, parsed.quarantine) };
}

async function loadHistory(
	provider: CloudStorageProvider,
	filesByRelativePath: Map<string, CloudFileMetadata>,
	path: string
): Promise<LoadResult<HistoryCloudFile>> {
	const metadata = filesByRelativePath.get(path);
	if (!metadata) return missingFile(path, 'Current checkpoint history file is missing.');
	const parsed = await parseHistoryCloudFile(await provider.downloadFile(metadata.id));
	return parsed.ok
		? { ok: true, value: parsed.value }
		: { ok: false, quarantine: quarantineFor(metadata.path, parsed.quarantine) };
}

function missingFile<T>(path: string, message: string): LoadResult<T> {
	return { ok: false, quarantine: { path, code: 'invalid_shape', message } };
}

async function listRemoteFilesByRelativePath(
	provider: CloudStorageProvider,
	context: SyncProjectContext
): Promise<Map<string, CloudFileMetadata>> {
	let cursor: string | undefined;
	const entries: CloudFileMetadata[] = [];
	do {
		const page = await provider.listFiles(context.cloudFolderId, { recursive: true, cursor });
		entries.push(...page.entries.filter(entry => !entry.isFolder && !entry.isDeleted));
		cursor = page.hasMore ? page.cursor : undefined;
	} while (cursor);
	return new Map(entries.map(entry => [relativeEntryPath(entry.path, context), entry]));
}

function remoteStatusFromChecks(
	checks: BackupHealthCheck[],
	pendingItems: BackupItemState[]
): ProjectBackupHealthStatus {
	if (checks.some(item => item.id === 'local-committed-state' && item.status === 'fail')) {
		return 'uncommitted-changes';
	}
	if (checks.some(item => item.id === 'manifest-heads-match' && item.status === 'fail')) {
		return 'conflict';
	}
	if (checks.some(item => item.blocking && item.status === 'fail')) return 'incomplete-backup';
	if (pendingItems.length > 0) return 'backed-up-local-metadata';
	return 'restorable-now';
}

function localStatusFromSummary(
	blockingItems: BackupItemState[],
	pendingItems: BackupItemState[]
): ProjectBackupHealthStatus {
	if (blockingItems.length > 0) return 'uncommitted-changes';
	if (pendingItems.length > 0) return 'committed-pending-backup';
	return 'backed-up-local-metadata';
}

function finalizeHealth(input: Omit<ProjectBackupHealth, 'safeToRemove' | 'blockingChecks'>): ProjectBackupHealth {
	const blockingChecks = input.checks.filter(
		item => item.blocking && (item.status === 'fail' || item.status === 'unknown')
	);
	const safeToRemove = input.status === 'restorable-now' && blockingChecks.length === 0;
	return { ...input, safeToRemove, blockingChecks };
}

function check(
	id: string,
	label: string,
	status: BackupHealthCheck['status'],
	message: string,
	blocking: boolean
): BackupHealthCheck {
	return { id, label, status, message, blocking };
}

function quarantineCheck(id: string, label: string, quarantine: SyncQuarantine): BackupHealthCheck {
	return check(id, label, 'fail', quarantine.message, true);
}

function quarantineFor(path: string, quarantine: CloudFileQuarantine): SyncQuarantine {
	return {
		path,
		code: quarantine.code,
		message: quarantine.message,
		expected: quarantine.expected,
		actual: quarantine.actual,
	};
}

function relativeEntryPath(path: string, context: SyncProjectContext): string {
	const normalizedPath = normalizeSlashes(path);
	const root = normalizeSlashes(context.cloudFolderPath ?? '');
	if (root && normalizedPath === root) return '';
	if (root && normalizedPath.startsWith(`${root}/`)) return normalizedPath.slice(root.length + 1);
	return normalizedPath.replace(/^\/+/, '');
}

function normalizeSlashes(path: string): string {
	return path.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
}

function messageFor(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
