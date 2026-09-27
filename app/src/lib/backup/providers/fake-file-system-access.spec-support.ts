type FakeHandle = FakeDirectoryHandle | FakeFileHandle;

export class FakeDirectoryHandle {
	readonly kind = 'directory';
	failWith: Error | null = null;
	private readonly children = new Map<string, FakeHandle>();

	constructor(readonly name: string) {}

	async getDirectoryHandle(
		name: string,
		options: { create?: boolean } = {}
	): Promise<FakeDirectoryHandle> {
		this.throwIfFailed();
		const existing = this.children.get(name);
		if (existing) {
			if (existing.kind === 'directory') return existing;
			throw domException('TypeMismatchError');
		}
		if (!options.create) throw domException('NotFoundError');
		const directory = new FakeDirectoryHandle(name);
		this.children.set(name, directory);
		return directory;
	}

	async getFileHandle(name: string, options: { create?: boolean } = {}): Promise<FakeFileHandle> {
		this.throwIfFailed();
		const existing = this.children.get(name);
		if (existing) {
			if (existing.kind === 'file') return existing;
			throw domException('TypeMismatchError');
		}
		if (!options.create) throw domException('NotFoundError');
		const file = new FakeFileHandle(name);
		this.children.set(name, file);
		return file;
	}

	async removeEntry(name: string): Promise<void> {
		this.throwIfFailed();
		if (!this.children.delete(name)) throw domException('NotFoundError');
	}

	async *entries(): AsyncIterableIterator<[string, FakeHandle]> {
		this.throwIfFailed();
		for (const entry of this.children.entries()) yield entry;
	}

	private throwIfFailed(): void {
		if (this.failWith) throw this.failWith;
	}
}

export class FakeFileHandle {
	readonly kind = 'file';
	private content = '';
	private lastModified = Date.parse('2026-06-10T12:00:00.000Z');

	constructor(readonly name: string) {}

	async getFile(): Promise<File> {
		return new File([this.content], this.name, { lastModified: this.lastModified });
	}

	async createWritable(): Promise<{ write: (content: string) => Promise<void>; close: () => Promise<void> }> {
		return {
			write: async (content: string) => {
				this.content = content;
				this.lastModified += 1_000;
			},
			close: async () => {},
		};
	}
}

export function domException(name: string): Error {
	const error = new Error(name);
	error.name = name;
	return error;
}
