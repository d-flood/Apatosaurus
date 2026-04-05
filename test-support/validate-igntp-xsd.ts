import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const supportDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(supportDir, '..');
const schemaPath = join(repoRoot, 'NT_Manuscripts_TEI_Schema', 'document.xsd');
const validatorPath = join(repoRoot, 'scripts', 'validate_tei_xsd.py');

export function validateIgntpXsd(xml: string): void {
	const tempDir = mkdtempSync(join(tmpdir(), 'apatopwa-tei-xsd-'));
	const xmlPath = join(tempDir, 'document.xml');

	try {
		writeFileSync(xmlPath, xml, 'utf8');

		const result = spawnSync(
			'uv',
			[
				'run',
				'--python',
				'3.14',
				'python',
				validatorPath,
				'--schema',
				schemaPath,
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
			},
		);

		if (result.status !== 0) {
			const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
			throw new Error(output || `XSD validation exited with status ${result.status}`);
		}
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
}
