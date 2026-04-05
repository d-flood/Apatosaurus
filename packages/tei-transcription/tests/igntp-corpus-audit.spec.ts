import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

describe('IGNTP corpus audit', () => {
	it('keeps the checked-in audit report in sync with the corpus manifest and scanner', () => {
		const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');
		const manifestPath = join(repoRoot, 'packages', 'tei-transcription', 'igntp-audit-corpus.json');
		const matrixPath = join(repoRoot, 'packages', 'tei-transcription', 'igntp-support-matrix.json');
		const reportPath = join(repoRoot, 'packages', 'tei-transcription', 'igntp-corpus-audit.json');

		expect(existsSync(manifestPath)).toBe(true);
		expect(existsSync(reportPath)).toBe(true);

		const result = spawnSync(
			'python3',
			[
				'packages/tei-transcription/scan_igntp_corpus.py',
				'--manifest',
				manifestPath,
				'--matrix',
				matrixPath,
				'--check',
				reportPath,
			],
			{
				cwd: repoRoot,
				encoding: 'utf8',
			}
		);

		expect(result.status).toBe(0);
		expect(result.stderr).toBe('');

		const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
			scope: string;
			entries: Array<{ id: string; kind: string; path: string }>;
		};
		const report = JSON.parse(readFileSync(reportPath, 'utf8')) as {
			scope: string;
			entries: Array<{ id: string; kind: string; path: string }>;
			matrix_dispositions: Array<{
				construct: string;
				disposition: string;
				status: string;
			}>;
			summary: {
				real_witness_count: number;
				focused_fixture_count: number;
				missing_in_scope_constructs: string[];
				uncategorized_body_tags: string[];
			};
		};

		expect(manifest.scope).toBe('single-witness-transcription');
		expect(report.scope).toBe('single-witness-transcription');
		expect(report.entries.map(entry => entry.id)).toEqual(manifest.entries.map(entry => entry.id));
		expect(report.summary.real_witness_count).toBe(2);
		expect(report.summary.focused_fixture_count).toBe(4);
		expect(report.summary.missing_in_scope_constructs).toEqual([]);
		expect(report.summary.uncategorized_body_tags).toEqual([]);
		expect(
			report.matrix_dispositions.find(entry => entry.construct === 'corrections')?.disposition
		).toBe('already-supported');
		expect(
			report.matrix_dispositions.find(entry => entry.construct === 'formwork-and-marginalia')
				?.disposition
		).toBe('supported-but-inspector-driven');
		expect(
			report.matrix_dispositions.find(entry => entry.construct === 'multi-witness-apparatus')?.status
		).toBe('out-of-scope');
	});
});
