import { beforeEach, describe, expect, it, vi } from 'vitest';

import { load as loadCollationList } from './collation/+page';
import { load as loadProjectWorkspace } from './projects/[id]/+layout';
import { load as loadProjectRoot } from './projects/[id]/+page';
import { load as loadTranscriptionIgntp } from './transcription/(library)/igntp/+page';
import { load as loadTranscriptionList } from './transcription/(library)/+page';
import { getProject, listProjects } from '$lib/client/collation/project-collation';

vi.mock('$lib/client/collation/project-collation', () => ({
	getProject: vi.fn(),
	listProjects: vi.fn(),
}));

type TestLoad = (event: { params?: { id: string }; url: URL }) => unknown;

async function expectRedirect(
	load: TestLoad,
	location: string,
	path = '/',
	params?: { id: string }
) {
	try {
		await load({ params, url: new URL(`https://apatosaurus.test${path}`) });
	} catch (error) {
		expect(error).toMatchObject({ status: 302, location });
		return;
	}
	throw new Error(`Expected redirect to ${location}`);
}

beforeEach(() => {
	vi.mocked(getProject).mockReset();
	vi.mocked(listProjects).mockReset();
	vi.unstubAllGlobals();
});

describe('project-first navigation redirects', () => {
	it('redirects the legacy transcription library to the project transcriptions section', async () => {
		await expectRedirect(
			loadTranscriptionList as TestLoad,
			'/projects#transcriptions',
			'/transcription'
		);
	});

	it('redirects the legacy IGNTP import route without a project to the project transcriptions section', async () => {
		await expectRedirect(
			loadTranscriptionIgntp as unknown as TestLoad,
			'/projects#transcriptions',
			'/transcription/igntp'
		);
	});

	it('allows the IGNTP import route when a project is explicit', async () => {
		expect(
			(loadTranscriptionIgntp as unknown as TestLoad)({
				url: new URL('https://apatosaurus.test/transcription/igntp?projectId=p1'),
			})
		).toEqual({ projectId: 'p1' });
	});

	it('redirects the legacy collation list to the project collations section', async () => {
		await expectRedirect(loadCollationList as TestLoad, '/projects#collations', '/collation');
	});

	it('redirects a project root to its transcription library', async () => {
		await expectRedirect(
			loadProjectRoot as TestLoad,
			'/projects/project-a/transcriptions',
			'/projects/project-a',
			{ id: 'project-a' }
		);
	});

	it('loads a project workspace and records it as last-opened', async () => {
		const values = new Map<string, string>();
		vi.stubGlobal('localStorage', {
			getItem: (key: string) => values.get(key) ?? null,
			setItem: (key: string, value: string) => values.set(key, value),
		});
		const project = {
			id: 'project-a',
			storageSlug: 'project-a',
			name: 'Project A',
			description: '',
			charter: '',
			collationSettings: {},
			createdAt: '2026-01-01T00:00:00.000Z',
			updatedAt: '2026-01-01T00:00:00.000Z',
		};
		vi.mocked(getProject).mockResolvedValue(project);

		await expect(
			(loadProjectWorkspace as TestLoad)({
				params: { id: 'project-a' },
				url: new URL('https://apatosaurus.test/projects/project-a/settings'),
			})
		).resolves.toEqual({ project });
		expect(values.get('lastOpenedProjectId')).toBe('project-a');
	});

	it('redirects a missing project to the valid last-opened project in the same section', async () => {
		vi.stubGlobal('localStorage', {
			getItem: () => 'project-a',
			setItem: vi.fn(),
		});
		vi.mocked(getProject).mockResolvedValue(null);
		vi.mocked(listProjects).mockResolvedValue([
			{
				id: 'project-a',
				storageSlug: 'project-a',
				name: 'Project A',
				description: '',
				createdAt: '2026-01-01T00:00:00.000Z',
				updatedAt: '2026-01-01T00:00:00.000Z',
			},
		]);

		await expectRedirect(
			loadProjectWorkspace as TestLoad,
			'/projects/project-a/collations',
			'/projects/deleted-project/collations',
			{ id: 'deleted-project' }
		);
	});

	it('redirects a missing project to the most recent project when stored state is stale', async () => {
		vi.stubGlobal('localStorage', {
			getItem: () => 'also-deleted',
			setItem: vi.fn(),
		});
		vi.mocked(getProject).mockResolvedValue(null);
		vi.mocked(listProjects).mockResolvedValue([
			{
				id: 'project-a',
				storageSlug: 'project-a',
				name: 'Project A',
				description: '',
				createdAt: '2026-01-01T00:00:00.000Z',
				updatedAt: '2026-01-01T00:00:00.000Z',
			},
			{
				id: 'project-b',
				storageSlug: 'project-b',
				name: 'Project B',
				description: '',
				createdAt: '2026-02-01T00:00:00.000Z',
				updatedAt: '2026-02-01T00:00:00.000Z',
			},
		]);

		await expectRedirect(
			loadProjectWorkspace as TestLoad,
			'/projects/project-b/backup',
			'/projects/deleted-project/backup',
			{ id: 'deleted-project' }
		);
	});

	it('redirects a missing project to the picker when no projects exist', async () => {
		vi.stubGlobal('localStorage', {
			getItem: () => 'deleted-project',
			setItem: vi.fn(),
		});
		vi.mocked(getProject).mockResolvedValue(null);
		vi.mocked(listProjects).mockResolvedValue([]);

		await expectRedirect(
			loadProjectWorkspace as TestLoad,
			'/projects',
			'/projects/deleted-project/transcriptions',
			{ id: 'deleted-project' }
		);
	});
});
