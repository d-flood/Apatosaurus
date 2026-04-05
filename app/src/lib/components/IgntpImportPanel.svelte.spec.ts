import { page } from '@vitest/browser/context';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import type { IgntpCatalog } from '$lib/igntp/types';

import IgntpImportPanel from './IgntpImportPanel.svelte';

const browserPage = page as any;

const catalog: IgntpCatalog = {
	generatedAt: '2026-03-13T00:00:00.000Z',
	groups: [
		{
			name: 'Romans_Greek_transcriptions',
			entries: [
				{
					directory: 'Romans_Greek_transcriptions',
					fileName: 'NT_GRC_01_Rom.xml',
					path: 'Romans_Greek_transcriptions/NT_GRC_01_Rom.xml',
					title: 'Romans witness 01',
					siglum: '01',
					duplicateKey: '01',
					isSupported: true,
				},
				{
					directory: 'Romans_Greek_transcriptions',
					fileName: 'NT_GRC_02_Rom.xml',
					path: 'Romans_Greek_transcriptions/NT_GRC_02_Rom.xml',
					title: 'Romans witness 02',
					siglum: '02',
					duplicateKey: '02',
					isSupported: true,
				},
			],
		},
	],
};

describe('IgntpImportPanel', () => {
	it('renders grouped entries and disables already imported witnesses', async () => {
		render(IgntpImportPanel, {
			catalog,
			importedKeys: ['01'],
			isImporting: false,
			onImport: vi.fn(),
		});

		await expect.element(
			browserPage.getByRole('heading', { name: 'Romans_Greek_transcriptions' })
		).toBeInTheDocument();
		await expect.element(browserPage.getByLabelText('NT_GRC_01_Rom.xml')).toBeDisabled();
	});

	it('filters, selects visible entries, and submits the selected paths', async () => {
		const onImport = vi.fn(async () => undefined);

		render(IgntpImportPanel, {
			catalog,
			importedKeys: [],
			isImporting: false,
			onImport,
		});

		await browserPage.getByLabelText('Search provided transcriptions').fill('02');
		await browserPage.getByRole('button', { name: 'Select Visible' }).click();
		await browserPage.getByRole('button', { name: 'Import Selected (1)' }).click();

		expect(onImport).toHaveBeenCalledOnce();
		expect(onImport).toHaveBeenCalledWith(['Romans_Greek_transcriptions/NT_GRC_02_Rom.xml']);
	});
});
