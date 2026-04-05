import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

describe('IGNTP support matrix', () => {
	it('tracks the single-witness transcription subset and stays in sync with the generator', () => {
		const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');
		const matrixPath = join(repoRoot, 'packages', 'tei-transcription', 'igntp-support-matrix.json');
		const schemaPath = 'NT_Manuscripts_TEI_Schema/document.xsd';

		expect(existsSync(matrixPath)).toBe(true);

		const result = spawnSync(
			'uv',
			[
				'run',
				'--python',
				'3.14',
				'python',
				'packages/tei-transcription/generate_igntp_support_matrix.py',
				'--schema',
				schemaPath,
				'--check',
				matrixPath,
			],
			{
				cwd: repoRoot,
				encoding: 'utf8',
			}
		);

		expect(result.status).toBe(0);
		expect(result.stderr).toBe('');

		const matrix = JSON.parse(readFileSync(matrixPath, 'utf8')) as {
			scope: string;
			statuses: string[];
			constructs: Array<{
				construct: string;
				status: 'supported-editor-addressable' | 'supported-carrier-ui' | 'out-of-scope';
				mechanism: string;
				editor_surface: string;
			}>;
		};

		expect(matrix.scope).toBe('single-witness-transcription');
		expect(matrix.statuses).toEqual([
			'out-of-scope',
			'supported-carrier-ui',
			'supported-editor-addressable',
		]);
		expect(matrix.constructs.length).toBeGreaterThan(0);
		expect(new Set(matrix.constructs.map(entry => entry.construct)).size).toBe(
			matrix.constructs.length
		);
		expect(
			matrix.constructs.find(entry => entry.construct === 'structured-inline-wrappers')?.status
		).toBe('supported-carrier-ui');
		expect(
			matrix.constructs.find(entry => entry.construct === 'multi-witness-apparatus')?.status
		).toBe('out-of-scope');
		expect(matrix.constructs.every(entry => entry.mechanism.length > 0)).toBe(true);
		expect(matrix.constructs.every(entry => entry.editor_surface.length > 0)).toBe(true);
	});
});
