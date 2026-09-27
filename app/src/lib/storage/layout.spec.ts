import { describe, expect, it } from 'vitest';

import {
	APP_STORE_ROOT,
	appSettingsFile,
	collationCheckpointRelativeFile,
	collationCheckpointFile,
	collationPrimaryRelativeFile,
	collationPrimaryFile,
	collationTeiFile,
	collationWorkingFile,
	indexDatabaseFile,
	joinStorePath,
	normalizeStorePath,
	projectManifestFile,
	projectManifestRelativeFile,
	syncTargetsFile,
	tombstoneFile,
	tombstoneRelativeFile,
	transcriptionCheckpointRelativeFile,
	transcriptionCheckpointFile,
	transcriptionPrimaryRelativeFile,
	transcriptionPrimaryFile,
	transcriptionTeiFile,
	transcriptionWorkingFile,
} from './layout';

describe('store layout path builders', () => {
	it('builds canonical project document paths relative to the app store root', () => {
		expect(APP_STORE_ROOT).toBe('apatosaurus/v1');
		expect(projectManifestFile('default-a1')).toBe('projects/default-a1/project.json');
		expect(transcriptionPrimaryFile('default-a1', 'tx-1')).toBe(
			'projects/default-a1/transcriptions/tx-1.json'
		);
		expect(transcriptionWorkingFile('default-a1', 'tx-1')).toBe(
			'projects/default-a1/transcriptions/tx-1.working.json'
		);
		expect(transcriptionTeiFile('default-a1', 'tx-1')).toBe(
			'projects/default-a1/transcriptions/tx-1.tei.xml'
		);
		expect(collationPrimaryFile('default-a1', 'col-1')).toBe(
			'projects/default-a1/collations/col-1.json'
		);
		expect(collationWorkingFile('default-a1', 'col-1')).toBe(
			'projects/default-a1/collations/col-1.working.json'
		);
		expect(collationTeiFile('default-a1', 'col-1')).toBe(
			'projects/default-a1/collations/col-1.tei.xml'
		);
	});

	it('builds history, tombstone, app, and index paths', () => {
		expect(transcriptionCheckpointFile('default-a1', 'tx-1', 'cp-1')).toBe(
			'projects/default-a1/history/transcriptions/tx-1/cp-1.json'
		);
		expect(collationCheckpointFile('default-a1', 'col-1', 'cp-2')).toBe(
			'projects/default-a1/history/collations/col-1/cp-2.json'
		);
		expect(tombstoneFile('default-a1', 'project-transcription', 'tx-1')).toBe(
			'projects/default-a1/tombstones/project-transcription--tx-1.json'
		);
		expect(appSettingsFile()).toBe('app/settings.json');
		expect(syncTargetsFile()).toBe('app/sync-targets.json');
		expect(indexDatabaseFile(7)).toBe('index/apatosaurus-index-v7.db');
	});

	it('uses the same project-relative paths for manifests, sync mirrors, and archives', () => {
		expect(projectManifestRelativeFile()).toBe('project.json');
		expect(transcriptionPrimaryRelativeFile('tx-1')).toBe('transcriptions/tx-1.json');
		expect(collationPrimaryRelativeFile('col-1')).toBe('collations/col-1.json');
		expect(transcriptionCheckpointRelativeFile('tx-1', 'cp-1')).toBe(
			'history/transcriptions/tx-1/cp-1.json'
		);
		expect(collationCheckpointRelativeFile('col-1', 'cp-2')).toBe(
			'history/collations/col-1/cp-2.json'
		);
		expect(tombstoneRelativeFile('project-transcription', 'tx-1')).toBe(
			'tombstones/project-transcription--tx-1.json'
		);
		expect(projectManifestFile('default-a1')).toBe(
			joinStorePath('projects/default-a1', projectManifestRelativeFile())
		);
		expect(transcriptionPrimaryFile('default-a1', 'tx-1')).toBe(
			joinStorePath('projects/default-a1', transcriptionPrimaryRelativeFile('tx-1'))
		);
	});

	it('normalizes paths and rejects traversal segments', () => {
		expect(normalizeStorePath('/projects/default-a1//project.json/')).toBe(
			'projects/default-a1/project.json'
		);
		expect(joinStorePath('/projects/', 'default-a1', '/transcriptions/tx-1.json')).toBe(
			'projects/default-a1/transcriptions/tx-1.json'
		);
		expect(() => projectManifestFile('../escape')).toThrow('Invalid store path segment');
		expect(() => indexDatabaseFile(0)).toThrow('positive integer');
	});
});
