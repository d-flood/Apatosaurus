import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createLocalDbTestHarness, type LocalDbTestHarness } from '../test-harness';
import { clearDomainTables } from './maintenance';

let harness: LocalDbTestHarness;

beforeEach(() => {
	harness = createLocalDbTestHarness();
});

afterEach(async () => {
	await harness.destroy();
});

describe('maintenance repository', () => {
	it('clears local domain tables while preserving schema migration history', async () => {
		seedDomainRows();

		const clearedTables = await clearDomainTables(harness.db);

		expect(clearedTables).toContain('transcriptions');
		expect(clearedTables).toContain('projects');
		expect(clearedTables).toContain('iiif_manifest_sources');
		expect(countRows('transcriptions')).toBe(0);
		expect(countRows('projects')).toBe(0);
		expect(countRows('iiif_manifest_sources')).toBe(0);
		expect(countRows('schema_migrations')).toBeGreaterThan(0);
	});
});

function seedDomainRows(): void {
	harness.sqlite
		.prepare(
			`
		INSERT INTO schema_migrations (version, name, applied_at)
		VALUES (999, 'test-migration', '2024-01-01T00:00:00.000Z')
	`
		)
		.run();
	harness.sqlite
		.prepare(
			`
		INSERT INTO projects (id, storage_slug, name, created_at, updated_at)
		VALUES ('project-1', 'project-1-test', 'Project', '2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z')
	`
		)
		.run();
	harness.sqlite
		.prepare(
			`
		INSERT INTO transcriptions (id, project_id, title, siglum, content_json, format, created_at, updated_at)
		VALUES ('tx-1', 'project-1', 'Romans Witness', 'P46', '{}', 'json', '2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z')
	`
		)
		.run();
	harness.sqlite
		.prepare(
			`
		INSERT INTO iiif_manifest_sources (id, transcription_id, manifest_url, label, created_at, updated_at)
		VALUES ('source-1', 'tx-1', 'https://example.test/manifest.json', 'Manifest', '2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z')
	`
		)
		.run();
}

function countRows(tableName: string): number {
	const row = harness.sqlite.prepare(`SELECT COUNT(*) AS count FROM "${tableName}"`).get() as {
		count: number;
	};
	return row.count;
}
