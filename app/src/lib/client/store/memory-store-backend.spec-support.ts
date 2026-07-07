import {
	joinStorePath,
	normalizeStorePath,
	storePathBasename,
	storePathDirname,
} from './layout';
import {
	StoreMoveUnavailableError,
	type StoreBackend,
	type StoreBackendDirectoryEntry,
} from './opfs-store';

export class MemoryStoreBackend implements StoreBackend {
	readonly files = new Map<string, string>();
	readonly directories = new Set<string>(['']);
	failWrites = false;
	failWritePathIncludes: string | null = null;

	async readTextFile(path: string): Promise<string> {
		const normalized = normalizeStorePath(path);
		const content = this.files.get(normalized);
		if (content === undefined) throw new Error(`File ${path} was not found.`);
		return content;
	}

	async writeTextFile(path: string, content: string): Promise<void> {
		const normalized = normalizeStorePath(path);
		if (
			this.failWrites ||
			(this.failWritePathIncludes && normalized.includes(this.failWritePathIncludes))
		) {
			throw new Error(`simulated write failure for ${path}`);
		}
		this.addDirectory(storePathDirname(normalized));
		this.files.set(normalized, content);
	}

	async deleteFile(path: string): Promise<void> {
		const normalized = normalizeStorePath(path);
		if (!this.files.delete(normalized)) throw new Error(`File ${path} was not found.`);
	}

	async deleteDirectory(path: string, options: { recursive?: boolean } = {}): Promise<void> {
		const normalized = normalizeStorePath(path);
		if (!this.directories.has(normalized)) throw new Error(`Directory ${path} was not found.`);
		const hasChildren = [...this.directories, ...this.files.keys()].some(
			entry => entry && entry !== normalized && storePathDirname(entry) === normalized
		);
		if (hasChildren && !options.recursive) throw new Error(`Directory ${path} is not empty.`);
		for (const file of [...this.files.keys()]) {
			if (file === normalized || file.startsWith(`${normalized}/`)) this.files.delete(file);
		}
		for (const directory of [...this.directories].sort((left, right) => right.length - left.length)) {
			if (directory === normalized || directory.startsWith(`${normalized}/`)) {
				this.directories.delete(directory);
			}
		}
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
		const normalizedFrom = normalizeStorePath(fromPath);
		const normalizedTo = normalizeStorePath(toPath);
		const content = this.files.get(normalizedFrom);
		if (content === undefined) throw new StoreMoveUnavailableError();
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
