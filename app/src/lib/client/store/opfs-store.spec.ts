import { describe, expect, it } from 'vitest';

import { openEnvelope, sealDocument } from './envelope';
import { joinStorePath, normalizeStorePath, storePathBasename, storePathDirname } from './layout';
import { createMigrationRegistry } from './migrate-on-read';
import {
	deleteFile,
	ensureDirectory,
	listDirectory,
	moveFile,
	readTextFile,
	StoreMoveUnavailableError,
	type StoreBackend,
	type StoreBackendDirectoryEntry,
	writeTextFileAtomic,
} from './opfs-store';
import { createQuarantineReport, recordQuarantineResult } from './quarantine';

describe('OPFS document store operations', () => {
	it('keeps the target intact when atomic move is interrupted after the temp write', async () => {
		const backend = new MemoryStoreBackend();
		await writeTextFileAtomic('projects/default/project.json', 'old', {
			backend,
			nonce: () => 'initial',
		});

		backend.failMoveWith = new Error('simulated interruption');
		await expect(
			writeTextFileAtomic('projects/default/project.json', 'new', {
				backend,
				nonce: () => 'interrupted',
			})
		).rejects.toThrow('simulated interruption');

		expect(await readTextFile('projects/default/project.json', { backend })).toBe('old');
		expect(
			(await listDirectory('projects/default', { backend })).map(entry => entry.name)
		).toEqual(['project.json', 'project.json.tmp-interrupted']);
	});

	it('uses the copy/delete fallback when move is unavailable', async () => {
		const backend = new MemoryStoreBackend();
		backend.moveUnavailable = true;

		await writeTextFileAtomic('projects/default/project.json', 'old', {
			backend,
			nonce: () => 'first',
		});
		await writeTextFileAtomic('projects/default/project.json', 'new', {
			backend,
			nonce: () => 'fallback',
		});

		expect(await readTextFile('projects/default/project.json', { backend })).toBe('new');
		expect(
			(await listDirectory('projects/default', { backend })).map(entry => entry.name)
		).toEqual(['project.json']);
	});

	it('uses transactional replacement when move rejects as unsupported', async () => {
		const backend = new MemoryStoreBackend();
		backend.failMoveWith = new DOMException('move is not implemented', 'NotSupportedError');

		await writeTextFileAtomic('projects/default/project.json', 'new', {
			backend,
			nonce: () => 'unsupported',
		});

		expect(await readTextFile('projects/default/project.json', { backend })).toBe('new');
		expect(backend.replacedPaths).toEqual(['apatosaurus/v1/projects/default/project.json']);
	});

	it('retains the old target and verified temp when fallback replacement is interrupted', async () => {
		const backend = new MemoryStoreBackend();
		await writeTextFileAtomic('projects/default/project.json', 'old', {
			backend,
			nonce: () => 'initial',
		});
		backend.moveUnavailable = true;
		backend.failReplacement = true;

		await expect(
			writeTextFileAtomic('projects/default/project.json', 'new', {
				backend,
				nonce: () => 'recoverable',
			})
		).rejects.toThrow('simulated replacement interruption');

		expect(await readTextFile('projects/default/project.json', { backend })).toBe('old');
		expect(
			await readTextFile('projects/default/project.json.tmp-recoverable', { backend })
		).toBe('new');
	});

	it('serializes canonical mutations through one writer boundary', async () => {
		const backend = new MemoryStoreBackend();
		await writeTextFileAtomic('projects/default/project.json', 'old', { backend });
		backend.moveUnavailable = true;
		const replacementStarted = Promise.withResolvers<void>();
		const releaseReplacement = Promise.withResolvers<void>();
		backend.onReplacementStart = () => replacementStarted.resolve();
		backend.replacementGate = releaseReplacement.promise;

		const first = writeTextFileAtomic('projects/default/project.json', 'first', {
			backend,
			nonce: () => 'first',
		});
		await replacementStarted.promise;
		const second = writeTextFileAtomic('projects/default/project.json', 'second', {
			backend,
			nonce: () => 'second',
		});
		await Promise.resolve();

		expect(
			(await listDirectory('projects/default', { backend })).map(entry => entry.name)
		).toEqual(['project.json', 'project.json.tmp-first']);
		releaseReplacement.resolve();
		await Promise.all([first, second]);
		expect(await readTextFile('projects/default/project.json', { backend })).toBe('second');
	});

	it('ensures directories, lists unknown files, moves files, and deletes files', async () => {
		const backend = new MemoryStoreBackend();

		await ensureDirectory('projects/default/transcriptions', { backend });
		await writeTextFileAtomic('projects/default/transcriptions/unknown.dat', 'unknown', {
			backend,
		});
		await moveFile(
			'projects/default/transcriptions/unknown.dat',
			'projects/default/transcriptions/known.dat',
			{
				backend,
			}
		);
		const listing = await listDirectory('projects/default/transcriptions', { backend });
		await deleteFile('projects/default/transcriptions/known.dat', { backend });

		expect(listing).toEqual([
			{ name: 'known.dat', kind: 'file', path: 'projects/default/transcriptions/known.dat' },
		]);
		expect(await listDirectory('projects/default/transcriptions', { backend })).toEqual([]);
	});

	it('records a failed document read without mutating the source file', async () => {
		const backend = new MemoryStoreBackend();
		const registry = createMigrationRegistry();
		registry.registerFormat('apatosaurus.test', 1, [], payload => payload);
		const valid = await sealDocument('apatosaurus.test', 1, { title: 'Valid' });
		const path = 'projects/default/transcriptions/bad.json';
		await writeTextFileAtomic(path, JSON.stringify({ ...valid, title: 'Tampered' }), {
			backend,
		});

		const before = await readTextFile(path, { backend });
		const result = await registry.readDocument(
			'apatosaurus.test',
			openEnvelope(before).document
		);
		const report = createQuarantineReport();
		recordQuarantineResult(report, path, result, '2026-07-03T00:00:00.000Z');
		const after = await readTextFile(path, { backend });

		expect(result).toMatchObject({ ok: false, quarantine: { code: 'hash_mismatch' } });
		expect(after).toBe(before);
		expect(report.list()).toEqual([expect.objectContaining({ path, code: 'hash_mismatch' })]);
	});
});

class MemoryStoreBackend implements StoreBackend {
	readonly files = new Map<string, string>();
	readonly directories = new Set<string>(['']);
	moveUnavailable = false;
	failMoveWith: Error | null = null;
	failReplacement = false;
	readonly replacedPaths: string[] = [];
	onReplacementStart: (() => void) | null = null;
	replacementGate: Promise<void> | null = null;

	async readTextFile(path: string): Promise<string> {
		const normalized = normalizeStorePath(path);
		const content = this.files.get(normalized);
		if (content === undefined) throw new Error(`File ${path} was not found.`);
		return content;
	}

	async writeTextFile(path: string, content: string): Promise<void> {
		const normalized = normalizeStorePath(path);
		this.addDirectory(storePathDirname(normalized));
		this.files.set(normalized, content);
	}

	async replaceTextFile(path: string, content: string): Promise<void> {
		if (this.failReplacement) throw new Error('simulated replacement interruption');
		this.onReplacementStart?.();
		if (this.replacementGate) await this.replacementGate;
		const normalized = normalizeStorePath(path);
		this.addDirectory(storePathDirname(normalized));
		this.files.set(normalized, content);
		this.replacedPaths.push(normalized);
	}

	async deleteFile(path: string): Promise<void> {
		const normalized = normalizeStorePath(path);
		if (!this.files.delete(normalized)) throw new Error(`File ${path} was not found.`);
	}

	async listDirectory(path: string): Promise<StoreBackendDirectoryEntry[]> {
		const normalized = normalizeStorePath(path);
		if (!this.directories.has(normalized)) throw new Error(`Directory ${path} was not found.`);
		const entries = new Map<string, StoreBackendDirectoryEntry>();
		for (const directory of this.directories) {
			if (!directory || directory === normalized) continue;
			if (storePathDirname(directory) === normalized) {
				entries.set(storePathBasename(directory), {
					name: storePathBasename(directory),
					kind: 'directory',
				});
			}
		}
		for (const file of this.files.keys()) {
			if (storePathDirname(file) === normalized) {
				entries.set(storePathBasename(file), {
					name: storePathBasename(file),
					kind: 'file',
				});
			}
		}
		return [...entries.values()].sort((left, right) => left.name.localeCompare(right.name));
	}

	async ensureDirectory(path: string): Promise<void> {
		this.addDirectory(path);
	}

	async moveFile(fromPath: string, toPath: string): Promise<void> {
		if (this.moveUnavailable) throw new StoreMoveUnavailableError();
		if (this.failMoveWith) throw this.failMoveWith;
		const normalizedFrom = normalizeStorePath(fromPath);
		const normalizedTo = normalizeStorePath(toPath);
		const content = this.files.get(normalizedFrom);
		if (content === undefined) throw new Error(`File ${fromPath} was not found.`);
		this.addDirectory(storePathDirname(normalizedTo));
		this.files.delete(normalizedFrom);
		this.files.set(normalizedTo, content);
	}

	private addDirectory(path: string): void {
		const normalized = normalizeStorePath(path);
		let current = '';
		this.directories.add(current);
		for (const segment of normalized ? normalized.split('/') : []) {
			current = joinStorePath(current, segment);
			this.directories.add(current);
		}
	}
}
