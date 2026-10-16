import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { execFile, type ExecFileException } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const supportDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(supportDir, '..');
const schemaPath = join(supportDir, 'tei_all.rng');
const validatorPath = join(repoRoot, 'scripts', 'validate_tei_xsd.py');
const execFileAsync = promisify(execFile);

export async function validateTeiP5(xml: string): Promise<void> {
	const tempDir = mkdtempSync(join(tmpdir(), 'apatopwa-tei-p5-'));
	const xmlPath = join(tempDir, 'document.xml');

	try {
		writeFileSync(xmlPath, xml, 'utf8');

		await execFileAsync(
			'uv',
			[
				'run',
				'--python',
				'3.14',
				'python',
				validatorPath,
				'--schema',
				schemaPath,
				'--schema-kind',
				'relaxng',
				'--xml',
				xmlPath,
			],
			{
				cwd: repoRoot,
				encoding: 'utf8',
				env: {
					...process.env,
					UV_CACHE_DIR: process.env.UV_CACHE_DIR || '/tmp/uv-cache',
				},
			}
		).catch((error: ExecFileException & { stdout?: string; stderr?: string }) => {
			if (typeof error.code === 'string') {
				throw new Error(`Failed to start TEI P5 validation: ${error.message}`);
			}

			const output = [error.stdout, error.stderr].filter(Boolean).join('\n').trim();
			throw new Error(
				output ||
					`TEI P5 validation exited with status ${error.code}${error.signal ? ` (signal: ${error.signal})` : ''}`
			);
		});
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
}
