import { page } from '@vitest/browser/context';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

const { importProjectZip } = vi.hoisted(() => ({ importProjectZip: vi.fn() }));

vi.mock('$lib/client/db/client', () => ({ importProjectZip }));

import ProjectZipImportPanel from './ProjectZipImportPanel.svelte';

describe('ProjectZipImportPanel', () => {
	beforeEach(() => importProjectZip.mockReset());

	it('shows collision timestamps and requires an explicit replace or copy action', async () => {
		importProjectZip.mockResolvedValueOnce({
			ok: false,
			projectId: 'project-1',
			storageSlug: '',
			mode: 'created',
			draftFilesRestored: [],
			projectsRestored: 0,
			transcriptionsRestored: 0,
			collationsRestored: 0,
			transcriptionCheckpointsRestored: 0,
			collationCheckpointsRestored: 0,
			tombstonesRestored: 0,
			quarantinedFiles: [],
			orphanedFiles: [],
			collision: {
				projectId: 'project-1',
				localUpdatedAt: '2026-07-08T00:00:00.000Z',
				importedUpdatedAt: '2026-07-07T00:00:00.000Z',
			},
		});
		importProjectZip.mockResolvedValueOnce({ ok: true, mode: 'replaced' });
		render(ProjectZipImportPanel);
		const input = document.querySelector('input[type="file"]') as HTMLInputElement;
		Object.defineProperty(input, 'files', {
			configurable: true,
			value: [
				new File([new Uint8Array([1, 2, 3])], 'project.zip', { type: 'application/zip' }),
			],
		});
		input.dispatchEvent(new Event('change', { bubbles: true }));

		await expect
			.element(page.getByText('This project already exists on this device.'))
			.toBeInTheDocument();
		await expect.element(page.getByText(/Local updated:/)).toBeInTheDocument();
		await expect.element(page.getByText(/Imported updated:/)).toBeInTheDocument();
		expect(importProjectZip).toHaveBeenCalledTimes(1);
		expect(importProjectZip).toHaveBeenLastCalledWith(expect.any(Uint8Array), undefined);

		await page.getByRole('button', { name: 'Replace local project' }).click();
		expect(importProjectZip).toHaveBeenLastCalledWith(expect.any(Uint8Array), 'replace');
	});

	it('renders validation paths, codes, and messages', async () => {
		importProjectZip.mockResolvedValueOnce({
			ok: false,
			mode: 'created',
			quarantinedFiles: [
				{
					path: 'metadata.json',
					code: 'invalid_shape',
					message: 'Unsupported project file.',
					timestamp: '',
				},
			],
		});
		render(ProjectZipImportPanel);
		const input = document.querySelector('input[type="file"]') as HTMLInputElement;
		Object.defineProperty(input, 'files', {
			configurable: true,
			value: [new File(['zip'], 'invalid.zip', { type: 'application/zip' })],
		});
		input.dispatchEvent(new Event('change', { bubbles: true }));

		await expect.element(page.getByText('metadata.json')).toBeInTheDocument();
		await expect
			.element(page.getByText('invalid_shape: Unsupported project file.'))
			.toBeInTheDocument();
	});

	it('reports the imported project so its owner can open it', async () => {
		const onImported = vi.fn();
		importProjectZip.mockResolvedValueOnce({
			ok: true,
			projectId: 'project-imported',
			mode: 'created',
			quarantinedFiles: [],
		});
		render(ProjectZipImportPanel, { onImported });
		const input = document.querySelector('input[type="file"]') as HTMLInputElement;
		Object.defineProperty(input, 'files', {
			configurable: true,
			value: [new File(['zip'], 'project.zip', { type: 'application/zip' })],
		});
		input.dispatchEvent(new Event('change', { bubbles: true }));

		await expect
			.element(page.getByText('Imported the project successfully.'))
			.toBeInTheDocument();
		expect(onImported).toHaveBeenCalledWith('project-imported');
	});
});
