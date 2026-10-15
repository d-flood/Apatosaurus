import { page } from '@vitest/browser/context';
import { expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { ProjectRecord } from '$lib/db/repositories/projects';

vi.mock('$lib/db/client', () => ({
	listCbgmAnalyses: vi.fn(async () => [
		{
			id: 'broken',
			project_id: 'project',
			name: 'Stale index name',
			coherence: 'ready',
			global_stemma: 'ready',
			inputs_frozen_at: '2026-10-01',
			completed_at: null,
			collation_ids: '[]',
			witness_count: 99,
		},
	]),
	loadCbgmCollationSnapshots: vi.fn(async () => ({ collations: [], unavailable: [] })),
	readCbgmAnalysis: vi.fn(async () => {
		throw new Error('Unreadable');
	}),
	readCbgmCollationHashes: vi.fn(async () => ({ hashes: {}, unavailable: [] })),
	subscribeLocalDbInvalidations: vi.fn(() => () => {}),
}));
vi.mock('$lib/cbgm/cbgm-analysis-runs', () => ({
	deleteAnalysis: vi.fn(),
	recomputePrefill: vi.fn(),
	startCbgmAnalysis: vi.fn(),
}));
vi.mock('$lib/storage/project-locations', () => ({
	listProjectLocations: vi.fn(async () => []),
	listProjectPlacements: vi.fn(async () => []),
}));

import CbgmPage from './+page.svelte';

it('surfaces unreadable metadata without presenting cached index content as an analysis', async () => {
	render(CbgmPage, {
		data: { project: { id: 'project', collationSettings: '{}' } as ProjectRecord },
	});
	await expect
		.element(page.getByText('Analysis metadata is missing or unreadable.'))
		.toBeVisible();
	await expect.element(page.getByRole('link', { name: 'Unavailable analysis' })).toBeVisible();
	await expect.element(page.getByText('Stale index name')).not.toBeInTheDocument();
	await expect.element(page.getByText('Ready', { exact: true })).not.toBeInTheDocument();
	await expect.element(page.getByText('Global stemma ready')).not.toBeInTheDocument();
	await expect.element(page.getByRole('button', { name: 'Compute again' })).toBeDisabled();
});
