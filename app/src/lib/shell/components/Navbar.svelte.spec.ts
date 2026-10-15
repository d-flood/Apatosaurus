import { page } from '@vitest/browser/context';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import type { CbgmComputationProgress, ComputationState } from '$lib/cbgm/cbgm-scheduler.svelte';

const mocks = vi.hoisted(() => ({
	page: { url: new URL('http://localhost/') },
	listProjects: vi.fn(),
}));

vi.mock('$app/state', () => ({ page: mocks.page }));

vi.mock('$lib/db/client', () => ({
	listProjects: mocks.listProjects,
	subscribeLocalDbInvalidations: vi.fn(() => vi.fn()),
}));

vi.mock('$lib/backup/sync-service.svelte', () => ({
	syncService: { overallStatus: () => ({ state: 'synced' }) },
}));

import Navbar from './Navbar.svelte';

class StubScheduler {
	progress = $state.raw<CbgmComputationProgress | null>(null);
}

const projects = [
	{ id: 'project-a', name: 'Romans', updatedAt: '2026-01-01T00:00:00.000Z' },
	{ id: 'project-b', name: 'Galatians', updatedAt: '2026-02-01T00:00:00.000Z' },
];

function progress(state: ComputationState): CbgmComputationProgress {
	return {
		analysisId: 'analysis-1',
		projectId: 'project-a',
		phase: 'coherence',
		state,
		done: 2,
		total: 5,
		currentWitnesses: ['01'],
		failure: null,
	};
}

function renderNavbar() {
	const scheduler = new StubScheduler();
	const view = render(Navbar, { scheduler });
	const cbgmLinks = page.getByRole('link', { name: /^CBGM/ });
	return {
		view,
		scheduler,
		targets: () => cbgmLinks.elements().map(link => link.getAttribute('href')),
		computing: () => page.getByRole('img', { name: 'Computing' }).elements().length,
		paused: () => page.getByRole('img', { name: 'Paused' }).elements().length,
	};
}

const desktopAndMobile = (target: string) => [target, target];

describe('Navbar CBGM link', () => {
	beforeEach(() => {
		mocks.page.url = new URL('http://localhost/');
		mocks.listProjects.mockResolvedValue(projects);
		localStorage.setItem('lastOpenedProjectId', 'project-a');
	});

	afterEach(() => {
		localStorage.removeItem('lastOpenedProjectId');
	});

	it('shows the activity indicator while computing and drops it when done', async () => {
		const { scheduler, targets, computing } = renderNavbar();

		await expect.poll(targets).toEqual(desktopAndMobile('/projects/project-a/cbgm'));
		expect(computing()).toBe(0);

		scheduler.progress = progress('queued');
		await expect.poll(targets).toEqual(desktopAndMobile('/cbgm/analysis-1'));
		expect(computing()).toBe(0);

		scheduler.progress = progress('running');
		await expect.poll(computing).toBe(2);
		await expect.poll(targets).toEqual(desktopAndMobile('/cbgm/analysis-1'));

		scheduler.progress = progress('writing');
		await expect.poll(computing).toBe(2);

		scheduler.progress = progress('done');
		await expect.poll(computing).toBe(0);
		await expect.poll(targets).toEqual(desktopAndMobile('/projects/project-a/cbgm'));
	});

	it('marks a paused computation distinctly and still links to it', async () => {
		const { scheduler, targets, computing, paused } = renderNavbar();

		scheduler.progress = progress('paused');
		await expect.poll(paused).toBe(2);
		expect(computing()).toBe(0);
		await expect.poll(targets).toEqual(desktopAndMobile('/cbgm/analysis-1'));

		scheduler.progress = progress('failed');
		await expect.poll(paused).toBe(0);
		await expect.poll(targets).toEqual(desktopAndMobile('/projects/project-a/cbgm'));
	});

	it('targets the current project, falling back to the project list', async () => {
		mocks.page.url = new URL('http://localhost/projects/project-b/collations');
		const first = renderNavbar();
		await expect.poll(first.targets).toEqual(desktopAndMobile('/projects/project-b/cbgm'));
		first.view.unmount();

		mocks.page.url = new URL('http://localhost/');
		mocks.listProjects.mockResolvedValue([]);
		localStorage.removeItem('lastOpenedProjectId');
		const { targets } = renderNavbar();
		await expect.poll(targets).toEqual(desktopAndMobile('/projects'));
	});
});
