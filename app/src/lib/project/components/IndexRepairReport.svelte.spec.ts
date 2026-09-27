import { page } from '@vitest/browser/context';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import IndexRepairReport from './IndexRepairReport.svelte';

const browserPage = page as any;

describe('IndexRepairReport', () => {
	it('shows file-level diagnostics and only offers safe primary recovery', async () => {
		const onRestore = vi.fn();
		render(IndexRepairReport, {
			report: {
				projectsRestored: 1,
				transcriptionsRestored: 0,
				collationsRestored: 0,
				transcriptionCheckpointsRestored: 0,
				collationCheckpointsRestored: 0,
				tombstonesRestored: 0,
				quarantinedFiles: [
					{
						path: 'projects/p/transcriptions/bad.json',
						code: 'hash_mismatch',
						message: 'Content hash does not match.',
						timestamp: '2026-07-13T00:00:00.000Z',
					},
				],
				orphanedFiles: [
					{
						path: 'projects/p/transcriptions/good.json',
						code: 'unreferenced_primary',
						message: 'Valid canonical primary is not referenced by the project manifest.',
						recoverable: true,
						projectSlug: 'p',
						entityType: 'transcription',
						entityId: 'good',
					},
					{
						path: 'projects/p/history/transcriptions/lost/cp.json',
						code: 'unreferenced_history',
						message: 'History file has no manifest entity.',
						recoverable: false,
						projectSlug: 'p',
					},
				],
			},
			onRestore,
		});

		await expect.element(browserPage.getByText('projects/p/transcriptions/bad.json')).toBeVisible();
		await expect.element(browserPage.getByText('hash_mismatch')).toBeVisible();
		await expect.element(browserPage.getByText('Content hash does not match.')).toBeVisible();
		await expect.element(browserPage.getByText('projects/p/history/transcriptions/lost/cp.json')).toBeVisible();
		await expect.element(browserPage.getByText('History file has no manifest entity.')).toBeVisible();
		const restoreButton = browserPage.getByRole('button', { name: 'Restore good' });
		await expect.element(restoreButton).toBeVisible();
		await restoreButton.click();
		expect(onRestore).toHaveBeenCalledWith('projects/p/transcriptions/good.json');
		await expect.element(browserPage.getByRole('button', { name: 'Restore lost' })).not.toBeInTheDocument();
	});
});
