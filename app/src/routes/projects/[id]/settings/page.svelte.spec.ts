import { page, userEvent } from '@vitest/browser/context';
import { expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { ProjectRecord } from '$lib/db/repositories/projects';

const mocks = vi.hoisted(() => ({
	getProjectTranscriptionIds: vi.fn(async () => []),
	updateProjectMetadata: vi.fn<(input: unknown) => Promise<void>>(async () => undefined),
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
	await name.fill('  Saved name  ');
	await page.getByRole('button', { name: 'Save Details' }).click();
	await expect.poll(() => mocks.invalidateAll.mock.calls.length).toBe(1);
	await view.rerender({ data: { project: { ...project, name: 'Saved name' } } });
	await expect.element(name).toHaveValue('Saved name');
	expect(mocks.updateProjectMetadata).toHaveBeenCalledWith({
		projectId: project.id,
		name: 'Saved name',
		description: '',
	});
	expect(mocks.getProjectTranscriptionIds).toHaveBeenCalledOnce();
});

it('adds full manual witnesses and changes treatment at phone width', async () => {
	const original = { width: window.innerWidth, height: window.innerHeight };
	await page.viewport(390, 844);
	try {
		render(SettingsPage, {
			data: {
				project: {
					id: 'manual-project',
					storageSlug: 'manual-project',
					name: 'Manual',
					description: '',
					charter: '',
					collationSettings: null,
					createdAt: '2026-10-14',
					updatedAt: '2026-10-14',
				},
			},
		});
		await page.getByRole('textbox', { name: 'Manual witness siglum' }).fill(' Syriac ');
		await page.getByRole('button', { name: 'Add full witness' }).click();
		const treatment = page.getByRole('combobox', { name: 'Treatment for Syriac' });
		await expect.element(treatment).toHaveValue('full');
		await treatment.selectOptions('fragmentary');
		await expect
			.poll(() => mocks.updateProjectMetadata.mock.lastCall?.[0])
			.toMatchObject({
				collationSettings: {
					manualWitnesses: [
						{ siglum: 'Syriac', treatment: 'fragmentary', includeInCbgm: false },
					],
				},
			});
		await expect.element(treatment).toHaveValue('fragmentary');
		const cbgmDefault = page.getByRole('checkbox', {
			name: 'Include Syriac in CBGM by default',
		});
		await expect.element(cbgmDefault).not.toBeChecked();
		await cbgmDefault.click();
		await expect
			.poll(() => mocks.updateProjectMetadata.mock.lastCall?.[0])
			.toMatchObject({
				collationSettings: {
					manualWitnesses: [
						{ siglum: 'Syriac', treatment: 'fragmentary', includeInCbgm: true },
					],
				},
			});
		await expect.element(cbgmDefault).toBeChecked();
		await page.getByRole('textbox', { name: 'Description for Syriac' }).fill(' Peshitta ');
		await userEvent.tab();
		await expect
			.poll(() => mocks.updateProjectMetadata.mock.lastCall?.[0])
			.toMatchObject({
				collationSettings: {
					manualWitnesses: [{ siglum: 'Syriac', description: 'Peshitta' }],
				},
			});
		await expect
			.poll(() =>
				[
					...document.querySelectorAll<HTMLElement>(
						'section[aria-label="Manual witnesses"] input, section[aria-label="Manual witnesses"] select, section[aria-label="Manual witnesses"] button'
					),
				].every(element => {
					const rect = element.getBoundingClientRect();
					return rect.left >= 0 && rect.right <= 390;
				})
			)
			.toBe(true);
	} finally {
		await page.viewport(original.width, original.height);
	}
});

it('adds project reading tags at phone width', async () => {
	const original = { width: window.innerWidth, height: window.innerHeight };
	await page.viewport(390, 844);
	try {
		render(SettingsPage, {
			data: {
				project: {
					id: 'tag-project',
					storageSlug: 'tag-project',
					name: 'Tags',
					description: '',
					charter: '',
					collationSettings: { readingTags: [{ id: 'ns', label: 'Nomen sacrum' }] },
					createdAt: '2026-10-14',
					updatedAt: '2026-10-14',
				},
			},
		});
		const tags = page.getByRole('region', { name: 'Reading tags' });
		await expect.element(tags.getByText('Nomen sacrum')).toBeVisible();
		await page.getByRole('textbox', { name: 'Reading tag label' }).fill(' Itacism ');
		await page.getByRole('button', { name: 'Add tag' }).click();
		await expect
			.poll(() => mocks.updateProjectMetadata.mock.lastCall?.[0])
			.toMatchObject({
				collationSettings: {
					readingTags: [
						{ id: 'ns', label: 'Nomen sacrum' },
						{ id: expect.any(String), label: 'Itacism' },
					],
				},
			});
		await expect.element(tags.getByText('Itacism')).toBeVisible();
		await expect
			.poll(() =>
				[
					...document.querySelectorAll<HTMLElement>(
						'section[aria-label="Reading tags"] input, section[aria-label="Reading tags"] button, section[aria-label="Reading tags"] li'
					),
				].every(element => {
					const rect = element.getBoundingClientRect();
					return rect.left >= 0 && rect.right <= 390;
				})
			)
			.toBe(true);
	} finally {
		await page.viewport(original.width, original.height);
	}
});

it('refuses making a manual witness full when a transcription has its siglum', async () => {
	const { listTranscriptions } = await import('$lib/project/projects');
	vi.mocked(listTranscriptions).mockResolvedValue([
		{ id: 'b-tx', siglum: 'B', displayLabel: 'B', title: '', description: '', hands: [] },
	]);
	vi.mocked(listTranscriptions).mockClear();
	mocks.updateProjectMetadata.mockClear();
	try {
		render(SettingsPage, {
			data: {
				project: {
					id: 'promote-project',
					storageSlug: 'promote-project',
					name: 'Promote',
					description: '',
					charter: '',
					collationSettings: {
						manualWitnesses: [
							{
								id: 'b',
								siglum: 'B',
								treatment: 'fragmentary',
								includeInCbgm: false,
							},
						],
					},
					createdAt: '2026-10-14',
					updatedAt: '2026-10-14',
				},
			},
		});
		await expect.poll(() => vi.mocked(listTranscriptions).mock.calls.length).toBeGreaterThan(0);
		const treatment = page.getByRole('combobox', { name: 'Treatment for B' });
		await treatment.selectOptions('full');
		await expect.element(page.getByText(/belongs to a transcription/)).toBeVisible();
		await expect.element(treatment).toHaveValue('fragmentary');
		expect(mocks.updateProjectMetadata).not.toHaveBeenCalled();
	} finally {
		vi.mocked(listTranscriptions).mockResolvedValue([]);
	}
});
