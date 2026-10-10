import { page } from '@vitest/browser/context';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import type { VersionSummary } from '$lib/db/repositories/revisions';
import VersionHistoryDrawer from './VersionHistoryDrawer.svelte';

const browserPage = page as any;

const versions: VersionSummary[] = [
	{
		id: 'v2',
		parentCheckpointId: 'v1',
		contentHash: 'sha256:2',
		label: 'Version 2',
		note: 'Second pass',
		authorName: 'Editor',
		createdAt: '2026-09-02T10:00:00.000Z',
	},
	{
		id: 'v1',
		parentCheckpointId: null,
		contentHash: 'sha256:1',
		label: 'Version 1',
		note: null,
		authorName: '',
		createdAt: '2026-09-01T10:00:00.000Z',
	},
];

function renderDrawer() {
	const undo = vi.fn(async () => {});
	const onRestore = vi.fn(async () => undo);
	const onEditNote = vi.fn(async () => {});
	const onCompare = vi.fn(async () => [
		{ key: 'John 1:1', label: 'John 1:1', left: 'en arche', right: 'en arche', differs: false },
		{
			key: 'John 1:2',
			label: 'John 1:2',
			left: 'houtos en',
			right: 'houtos hn',
			differs: true,
		},
	]);
	render(VersionHistoryDrawer, {
		open: true,
		versions,
		basedOnVersionId: 'v2',
		changedSinceBase: true,
		onClose: () => {},
		onRestore,
		onEditNote,
		onCompare,
		formatPart: (value: unknown) => String(value),
	});
	return { undo, onRestore, onEditNote, onCompare };
}

describe('VersionHistoryDrawer', () => {
	it('lists versions newest first with label, note, author and change state', async () => {
		renderDrawer();

		await expect
			.element(browserPage.getByTestId('version-history-status'))
			.toHaveTextContent('Changed since Version 2');
		const entries = browserPage.getByTestId('version-entry');
		await expect.element(entries.nth(0)).toHaveTextContent('Version 2');
		await expect.element(entries.nth(0)).toHaveTextContent('Second pass');
		await expect.element(entries.nth(0)).toHaveTextContent('Editor');
		await expect.element(entries.nth(1)).toHaveTextContent('Version 1');
	});

	it('restores a version and offers undo', async () => {
		const { undo, onRestore } = renderDrawer();

		await browserPage
			.getByTestId('version-entry')
			.nth(1)
			.getByRole('button', { name: 'Restore' })
			.click();

		await expect.element(browserPage.getByText('Restored Version 1')).toBeVisible();
		expect(onRestore).toHaveBeenCalledWith('v1');
		await browserPage.getByRole('button', { name: 'Undo' }).click();
		await expect.element(browserPage.getByText('Restore undone')).toBeVisible();
		expect(undo).toHaveBeenCalledOnce();
	});

	it('edits a version note', async () => {
		const { onEditNote } = renderDrawer();

		await browserPage.getByRole('button', { name: 'Edit note' }).click();
		await browserPage.getByRole('textbox', { name: 'Version note' }).fill('Revised note');
		await browserPage.getByRole('button', { name: 'Save note' }).click();

		await expect
			.element(browserPage.getByRole('textbox', { name: 'Version note' }))
			.not.toBeInTheDocument();
		expect(onEditNote).toHaveBeenCalledWith('v2', 'Revised note');
	});

	it('compares a version against Current with only changed parts expanded', async () => {
		const { onCompare } = renderDrawer();

		await browserPage
			.getByTestId('version-entry')
			.nth(1)
			.getByRole('button', { name: 'Compare' })
			.click();

		const parts = browserPage.getByTestId('compare-part');
		await expect.element(parts.nth(1)).toHaveAttribute('open');
		await expect.element(parts.nth(0)).not.toHaveAttribute('open');
		expect(onCompare).toHaveBeenCalledWith('v1', null);

		await browserPage.getByRole('combobox', { name: 'Compare with' }).selectOptions('v2');
		await expect.poll(() => onCompare.mock.calls.at(-1)).toEqual(['v1', 'v2']);
	});

	it('offers no way to delete a version', async () => {
		renderDrawer();

		await expect.element(browserPage.getByTestId('version-entry').first()).toBeVisible();
		expect(browserPage.getByRole('button', { name: /delete/i }).elements()).toHaveLength(0);
	});
});
