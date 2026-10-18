import { page } from '@vitest/browser/context';
import { expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { ProjectRecord } from '$lib/db/repositories/projects';

const { statuses } = vi.hoisted(() => ({
	statuses: [
		['loose', '', 0],
		['Rom_2.1', 'Chapter 2', 3],
		['Rom_1.2', 'Chapter 1', 2],
		['Rom_1.1', 'Chapter 1', 1],
	].map(([title, groupPath, sortKey]) => ({
		collationId: title,
		title,
		verseIdentifier: title,
		groupPath,
		sortKey,
		workflowStatus: 'complete',
	})),
}));
vi.mock('$lib/collation/components/ClassicCollationImportDialog.svelte', () => ({
	default: () => {},
}));
vi.mock('$lib/db/client', () => ({
	deleteCollation: vi.fn(),
	listConflictCopies: vi.fn(async () => []),
	subscribeLocalDbInvalidations: vi.fn(() => () => {}),
	listProjectCollationVersionStatuses: vi.fn(async () => statuses),
}));

import CollationsPage from './+page.svelte';

const project: ProjectRecord = {
	id: 'project',
	storageSlug: 'project',
	name: 'Romans',
	description: '',
	charter: '',
	collationSettings: null,
	createdAt: '2026-10-18',
	updatedAt: '2026-10-18',
};

it('groups collations by section in imported order, ungrouped first', async () => {
	render(CollationsPage, { data: { project } });
	await expect.element(page.getByText('Rom_1.1', { exact: true }).first()).toBeVisible();
	const titles = () =>
		[...document.querySelectorAll('li .font-serif.font-medium')].map(node => node.textContent);
	expect(titles()).toEqual(['loose', 'Rom_1.1', 'Rom_1.2', 'Rom_2.1']);
	const sections = [...document.querySelectorAll('details:not(.dropdown) > summary')].map(node =>
		node.textContent?.replace(/\s+/g, ' ').trim()
	);
	expect(sections).toEqual(['Chapter 1 · 2', 'Chapter 2 · 1']);
	await page.getByText('Chapter 1 · 2').click();
	await expect.element(page.getByText('Rom_1.1', { exact: true }).first()).not.toBeVisible();
	await expect.element(page.getByText('Rom_2.1', { exact: true }).first()).toBeVisible();
});
