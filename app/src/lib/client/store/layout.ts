export const APP_STORE_ROOT = 'apatosaurus/v1';

export function projectsFolder(): string {
	return 'projects';
}

export function projectFolder(projectSlug: string): string {
	return joinStorePath(projectsFolder(), projectSlug);
}

export function projectManifestFile(projectSlug: string): string {
	return joinStorePath(projectFolder(projectSlug), 'project.json');
}

export function projectTranscriptionsFolder(projectSlug: string): string {
	return joinStorePath(projectFolder(projectSlug), 'transcriptions');
}

export function transcriptionPrimaryFile(projectSlug: string, transcriptionId: string): string {
	return joinStorePath(projectTranscriptionsFolder(projectSlug), `${validateFileStem(transcriptionId)}.json`);
}

export function transcriptionWorkingFile(projectSlug: string, transcriptionId: string): string {
	return joinStorePath(
		projectTranscriptionsFolder(projectSlug),
		`${validateFileStem(transcriptionId)}.working.json`
	);
}

export function transcriptionTeiFile(projectSlug: string, transcriptionId: string): string {
	return joinStorePath(projectTranscriptionsFolder(projectSlug), `${validateFileStem(transcriptionId)}.tei.xml`);
}

export function projectCollationsFolder(projectSlug: string): string {
	return joinStorePath(projectFolder(projectSlug), 'collations');
}

export function collationPrimaryFile(projectSlug: string, collationId: string): string {
	return joinStorePath(projectCollationsFolder(projectSlug), `${validateFileStem(collationId)}.json`);
}

export function collationWorkingFile(projectSlug: string, collationId: string): string {
	return joinStorePath(
		projectCollationsFolder(projectSlug),
		`${validateFileStem(collationId)}.working.json`
	);
}

export function collationTeiFile(projectSlug: string, collationId: string): string {
	return joinStorePath(projectCollationsFolder(projectSlug), `${validateFileStem(collationId)}.tei.xml`);
}

export function projectHistoryFolder(projectSlug: string): string {
	return joinStorePath(projectFolder(projectSlug), 'history');
}

export function transcriptionHistoryFolder(projectSlug: string, transcriptionId: string): string {
	return joinStorePath(projectHistoryFolder(projectSlug), 'transcriptions', transcriptionId);
}

export function transcriptionCheckpointFile(
	projectSlug: string,
	transcriptionId: string,
	checkpointId: string
): string {
	return joinStorePath(
		transcriptionHistoryFolder(projectSlug, transcriptionId),
		`${validateFileStem(checkpointId)}.json`
	);
}

export function collationHistoryFolder(projectSlug: string, collationId: string): string {
	return joinStorePath(projectHistoryFolder(projectSlug), 'collations', collationId);
}

export function collationCheckpointFile(
	projectSlug: string,
	collationId: string,
	checkpointId: string
): string {
	return joinStorePath(
		collationHistoryFolder(projectSlug, collationId),
		`${validateFileStem(checkpointId)}.json`
	);
}

export function projectTombstonesFolder(projectSlug: string): string {
	return joinStorePath(projectFolder(projectSlug), 'tombstones');
}

export function tombstoneFile(projectSlug: string, entityType: string, entityId: string): string {
	return joinStorePath(
		projectTombstonesFolder(projectSlug),
		`${validateFileStem(entityType)}--${validateFileStem(entityId)}.json`
	);
}

export function appFolder(): string {
	return 'app';
}

export function appSettingsFile(): string {
	return joinStorePath(appFolder(), 'settings.json');
}

export function syncTargetsFile(): string {
	return joinStorePath(appFolder(), 'sync-targets.json');
}

export function backupMetadataFile(): string {
	return joinStorePath(appFolder(), 'backup-metadata.json');
}

export function indexFolder(): string {
	return 'index';
}

export function indexDatabaseFile(indexSchemaVersion: number): string {
	if (!Number.isInteger(indexSchemaVersion) || indexSchemaVersion < 1) {
		throw new Error('Index schema version must be a positive integer.');
	}
	return joinStorePath(indexFolder(), `apatosaurus-index-v${indexSchemaVersion}.db`);
}

export function joinStorePath(...parts: string[]): string {
	const segments: string[] = [];
	for (const part of parts) {
		const normalized = normalizeStorePath(part);
		if (normalized) segments.push(...normalized.split('/'));
	}
	return segments.join('/');
}

export function normalizeStorePath(path: string): string {
	const normalized = path.trim().replace(/^\/+|\/+$/g, '');
	if (!normalized) return '';
	const segments = normalized.split('/').filter(Boolean);
	for (const segment of segments) validatePathSegment(segment);
	return segments.join('/');
}

export function normalizeStoreFilePath(path: string): string {
	const normalized = normalizeStorePath(path);
	if (!normalized) throw new Error('Store file path is required.');
	return normalized;
}

export function storePathDirname(path: string): string {
	const normalized = normalizeStoreFilePath(path);
	const parts = normalized.split('/');
	parts.pop();
	return parts.join('/');
}

export function storePathBasename(path: string): string {
	const normalized = normalizeStoreFilePath(path);
	return normalized.split('/').at(-1) ?? normalized;
}

function validateFileStem(value: string): string {
	validatePathSegment(value);
	return value;
}

function validatePathSegment(segment: string): void {
	if (!segment || segment === '.' || segment === '..' || segment.includes('/') || segment.includes('\\')) {
		throw new Error(`Invalid store path segment ${JSON.stringify(segment)}.`);
	}
}
