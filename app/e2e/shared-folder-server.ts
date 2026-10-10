import type { Route } from '@playwright/test';

type SharedFile = { content: string; revision: number; modifiedAt: string };

export class SharedFolderServer {
	private readonly files = new Map<string, SharedFile>();
	private readonly folders = new Set<string>(['']);
	private nextRevision = 0;
	private available = true;

	setAvailable(available: boolean): void {
		this.available = available;
	}

	paths(): string[] {
		return [...this.files.keys()];
	}

	forgetLocationMarker(): void {
		this.files.delete('apatosaurus-location.json');
	}

	async handle(route: Route): Promise<void> {
		if (!this.available) {
			await route.fulfill({
				status: 503,
				contentType: 'application/json',
				body: JSON.stringify({
					code: 'provider-unavailable',
					message: 'Shared folder is paused while both committee members edit.',
				}),
			});
			return;
		}
		const request = route.request().postDataJSON() as Record<string, unknown>;
		try {
			const result = this.dispatch(request);
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify(result),
			});
		} catch (error) {
			const failure = error as Error & { code?: string };
			await route.fulfill({
				status: failure.code === 'conflict' ? 409 : 404,
				contentType: 'application/json',
				body: JSON.stringify({
					code: failure.code ?? 'not-found',
					message: failure.message,
				}),
			});
		}
	}

	private dispatch(request: Record<string, unknown>): unknown {
		const operation = String(request.operation);
		if (operation === 'create-folder') {
			const path = joinRemotePath(String(request.parentId ?? '.'), String(request.name));
			this.ensureFolders(path);
			return { id: path };
		}
		if (operation === 'list-files') {
			const folder = normalizeRemotePath(String(request.folderId ?? '.'));
			const recursive = request.recursive === true;
			const entries = [
				...[...this.folders]
					.filter(path => path && isListedPath(path, folder, recursive))
					.map(path => ({
						id: path,
						path,
						name: path.split('/').at(-1),
						revision: 'directory',
						modifiedAt: new Date(0).toISOString(),
						size: 0,
						isFolder: true,
					})),
				...[...this.files.entries()]
					.filter(([path]) => isListedPath(path, folder, recursive))
					.map(([path, file]) => ({
						id: path,
						path,
						name: path.split('/').at(-1),
						revision: `rev-${file.revision}`,
						modifiedAt: file.modifiedAt,
						size: new TextEncoder().encode(file.content).byteLength,
						isFolder: false,
					})),
			].sort((left, right) => left.path.localeCompare(right.path));
			return { entries, hasMore: false };
		}
		if (operation === 'download-file') {
			return { content: this.requireFile(String(request.fileId)).content };
		}
		if (operation === 'write-file') {
			const path = request.fileId
				? normalizeRemotePath(String(request.fileId))
				: joinRemotePath(String(request.folderId ?? '.'), String(request.path));
			const existing = this.files.get(path);
			const expectedRevision = request.expectedRevision;
			if (request.createOnly === true && existing)
				throw remoteError('conflict', `${path} exists.`);
			if (
				typeof expectedRevision === 'string' &&
				(!existing || `rev-${existing.revision}` !== expectedRevision)
			) {
				throw remoteError('conflict', `Revision changed for ${path}.`);
			}
			this.ensureFolders(parentRemotePath(path));
			const file = {
				content: String(request.content ?? ''),
				revision: ++this.nextRevision,
				modifiedAt: new Date().toISOString(),
			};
			this.files.set(path, file);
			return {
				id: path,
				path,
				revision: `rev-${file.revision}`,
				modifiedAt: file.modifiedAt,
				size: new TextEncoder().encode(file.content).byteLength,
			};
		}
		if (operation === 'delete-file') {
			const path = normalizeRemotePath(String(request.fileId));
			const file = this.requireFile(path);
			if (
				typeof request.expectedRevision === 'string' &&
				request.expectedRevision !== `rev-${file.revision}`
			) {
				throw remoteError('conflict', `Revision changed for ${path}.`);
			}
			this.files.delete(path);
			return {};
		}
		throw remoteError('not-found', `Unknown shared-folder operation ${operation}.`);
	}

	private requireFile(path: string): SharedFile {
		const file = this.files.get(normalizeRemotePath(path));
		if (!file) throw remoteError('not-found', `${path} was not found.`);
		return file;
	}

	private ensureFolders(path: string): void {
		const segments = normalizeRemotePath(path).split('/').filter(Boolean);
		let current = '';
		for (const segment of segments) {
			current = current ? `${current}/${segment}` : segment;
			this.folders.add(current);
		}
	}
}

function normalizeRemotePath(path: string): string {
	return path === '.' ? '' : path.replace(/^\/+|\/+$/g, '');
}

function joinRemotePath(parent: string, child: string): string {
	return [normalizeRemotePath(parent), normalizeRemotePath(child)].filter(Boolean).join('/');
}

function parentRemotePath(path: string): string {
	return path.split('/').slice(0, -1).join('/');
}

function isListedPath(path: string, folder: string, recursive: boolean): boolean {
	const parent = parentRemotePath(path);
	return recursive ? path.startsWith(folder ? `${folder}/` : '') : parent === folder;
}

function remoteError(code: string, message: string): Error & { code: string } {
	return Object.assign(new Error(message), { code });
}
