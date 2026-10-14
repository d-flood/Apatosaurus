import { page } from '@vitest/browser/context';
import { expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { render } from 'vitest-browser-svelte';
import type { ProjectRecord } from '$lib/db/repositories/projects';

const mocks = vi.hoisted(() => ({
	getProjectTranscriptionIds: vi.fn(async () => []),
	updateProjectMetadata: vi.fn(async () => undefined),
	invalidateAll: vi.fn(async () => undefined),
}));
vi.mock('$app/navigation', () => ({ invalidateAll: mocks.invalidateAll }));
vi.mock('$lib/project/projects', () => ({
	listTranscriptions: vi.fn(async () => []),
	loadTranscriptionHands: vi.fn(async () => []),
}));
vi.mock('$lib/db/client', () => ({
	getProjectTranscriptionIds: mocks.getProjectTranscriptionIds,
	updateProjectMetadata: mocks.updateProjectMetadata,
	subscribeLocalDbInvalidations: vi.fn(() => () => {}),
	listProjectTranscriptionStatuses: vi.fn(async () => []),
	listProjectTranscriptionSourceCandidates: vi.fn(async () => []),
	addProjectTranscriptionFromProject: vi.fn(),
	refreshProjectTranscription: vi.fn(),
	syncProjectTranscriptionIds: vi.fn(),
	getTranscriptionSourceOptions: vi.fn(),
}));

import SettingsPage from './+page.svelte';

it('saves details and resets saved drafts without reloading transcription membership', async () => {
	const project: ProjectRecord = {
		id: 'settings-project',
		storageSlug: 'settings-project',
		name: 'Original',
		description: '',
		charter: '',
		collationSettings: null,
		createdAt: '2026-10-14T00:00:00Z',
		updatedAt: '2026-10-14T00:00:00Z',
	};
	const view = render(SettingsPage, { data: { project } });
	await expect.poll(() => mocks.getProjectTranscriptionIds.mock.calls.length).toBe(1);
	const name = page.getByRole('textbox', { name: 'Name', exact: true });
	await name.fill('Saved name');
	await page.getByRole('button', { name: 'Save Details' }).click();
	await expect.poll(() => mocks.invalidateAll.mock.calls.length).toBe(1);
	await view.rerender({ data: { project: { ...project, name: 'Saved name' } } });
	await tick();
	await expect.element(name).toHaveValue('Saved name');
	expect(mocks.updateProjectMetadata).toHaveBeenCalledWith({
		projectId: project.id,
		name: 'Saved name',
		description: '',
	});
	expect(mocks.getProjectTranscriptionIds).toHaveBeenCalledOnce();
});
