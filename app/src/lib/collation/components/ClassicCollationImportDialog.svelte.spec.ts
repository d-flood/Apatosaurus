import { page, userEvent } from '@vitest/browser/context';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ClassicCollationImportDialog from './ClassicCollationImportDialog.svelte';
import fixture from '../__fixtures__/classic/core.xml?raw';

const { importClassicCollationProject } = vi.hoisted(() => ({
	importClassicCollationProject: vi.fn(async () => {}),
}));
vi.mock('../classic-import-project', () => ({ importClassicCollationProject }));
afterEach(() => vi.clearAllMocks());

async function chooseFile() {
	const input = document.querySelector<HTMLInputElement>('[data-testid="classic-export-input"]')!;
	const files = new DataTransfer();
	files.items.add(new File([fixture], 'classic.xml', { type: 'application/xml' }));
	input.files = files.files;
	input.dispatchEvent(new Event('change', { bubbles: true }));
	await expect.element(page.getByText('2 verses · 3 witnesses')).toBeVisible();
}

describe('classic import base siglum', () => {
	it('offers only witnesses agreeing at every unit and imports a chosen candidate', async () => {
		const onimported = vi.fn();
		render(ClassicCollationImportDialog, {
			projectId: 'project',
			onclose: vi.fn(),
			onimported,
		});
		await chooseFile();
		const select = page.getByLabelText('Base text siglum').element() as HTMLSelectElement;
		expect(Array.from(select.options).map(option => option.value)).toEqual(['w:A', 'new']);
		expect(select.value).toBe('w:A');
		for (const field of ['transcriber', 'repository', 'settlement', 'language'])
			await page.getByLabelText(field, { exact: true }).fill(field);
		await page.getByRole('button', { name: 'Import collation', exact: true }).click();
		await expect.poll(() => importClassicCollationProject.mock.calls.length).toBe(1);
		expect(importClassicCollationProject).toHaveBeenCalledWith(
			expect.objectContaining({ baseSiglum: 'A', projectId: 'project', title: 'classic' })
		);
		expect(onimported).toHaveBeenCalledOnce();
	});

	it('accepts a newly named edition and fits a phone viewport', async () => {
		await page.viewport(390, 844);
		render(ClassicCollationImportDialog, {
			projectId: 'project',
			onclose: vi.fn(),
			onimported: vi.fn(),
		});
		await chooseFile();
		await userEvent.selectOptions(
			page.getByLabelText('Base text siglum').element() as HTMLSelectElement,
			'new'
		);
		await page.getByLabelText('New base siglum').fill('Edition');
		for (const field of ['transcriber', 'repository', 'settlement', 'language'])
			await page.getByLabelText(field, { exact: true }).fill(field);
		await expect
			.poll(() => {
				const box = document.querySelector('.modal-box')!.getBoundingClientRect();
				return (
					box.left >= 0 && box.right <= 390 && document.documentElement.scrollWidth <= 390
				);
			})
			.toBe(true);
		await page.getByRole('button', { name: 'Import collation', exact: true }).click();
		await expect.poll(() => importClassicCollationProject.mock.calls.length).toBe(1);
		expect(importClassicCollationProject).toHaveBeenCalledWith(
			expect.objectContaining({ baseSiglum: 'Edition' })
		);
		await page.viewport(1280, 720);
	});
});
