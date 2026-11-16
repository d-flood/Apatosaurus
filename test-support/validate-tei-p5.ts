import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const supportDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(supportDir, '..');
const schemaPath = join(supportDir, 'tei_all.rng');
const validatorPath = join(repoRoot, 'scripts', 'validate_tei_xsd.py');

type Verdict = { ok: boolean; errors: string[] };
type Validator = { ready: Promise<void>; validate(xmlPath: string): Promise<Verdict> };

let validator: Validator | null = null;

// Compiling tei_all.rng takes ~25 s, so one validator process serves every document of a test file.
function startValidator(): Validator {
	const child = spawn(
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
			'--serve',
		],
		{
			cwd: repoRoot,
			env: { ...process.env, UV_CACHE_DIR: process.env.UV_CACHE_DIR || '/tmp/uv-cache' },
			stdio: ['pipe', 'pipe', 'pipe'],
		}
	);
	// Stays referenced only while compiling or answering, so an idle validator never keeps a process alive.
	const output = child.stdout as unknown as { ref(): void; unref(): void };
	child.unref();
	for (const stream of [child.stdin, child.stderr])
		(stream as unknown as { unref(): void }).unref();
	process.once('exit', () => child.kill());

	let stderr = '';
	child.stderr.setEncoding('utf8').on('data', chunk => (stderr += chunk));

	let markReady!: () => void;
	let failReady!: (error: Error) => void;
	const ready = new Promise<void>((resolve, reject) => {
		markReady = resolve;
		failReady = reject;
	});
	const pending: Array<{ resolve(verdict: Verdict): void; reject(error: Error): void }> = [];

	createInterface({ input: child.stdout }).on('line', line => {
		if (line === 'ready') markReady();
		else pending.shift()?.resolve(JSON.parse(line) as Verdict);
		if (pending.length === 0) output.unref();
	});

	const fail = (error: Error) => {
		validator = null;
		failReady(error);
		for (const request of pending.splice(0)) request.reject(error);
	};
	child.on('error', error =>
		fail(new Error(`Failed to start TEI P5 validation: ${error.message}`))
	);
	child.on('exit', (code, signal) =>
		fail(
			new Error(
				stderr.trim() ||
					`TEI P5 validation exited with status ${code}${signal ? ` (signal: ${signal})` : ''}`
			)
		)
	);

	return {
		ready,
		async validate(xmlPath) {
			await ready;
			return new Promise<Verdict>((resolve, reject) => {
				pending.push({ resolve, reject });
				output.ref();
				child.stdin.write(`${xmlPath}\n`);
			});
		},
	};
}

function currentValidator(): Validator {
	validator ??= startValidator();
	return validator;
}

export function warmTeiP5Validator(): Promise<void> {
	return currentValidator().ready;
}

export async function validateTeiP5(xml: string): Promise<void> {
	const tempDir = mkdtempSync(join(tmpdir(), 'apatopwa-tei-p5-'));
	const xmlPath = join(tempDir, 'document.xml');

	try {
		writeFileSync(xmlPath, xml, 'utf8');
		const verdict = await currentValidator().validate(xmlPath);
		if (!verdict.ok)
			throw new Error(`RELAXNG validation failed:\n  ${verdict.errors.join('\n  ')}`);
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
}
