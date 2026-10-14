import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';

test('Go To changes verse without remounting the editor', async ({ page }) => {
	await page.goto('/transcription/new');
	await expect(page.getByRole('combobox', { name: 'Project*' })).not.toHaveValue('');
	await page.getByRole('button', { name: 'Import TEI' }).click();
	await page
		.locator('input[type="file"][accept*="xml"]')
		.setInputFiles(
			fileURLToPath(new URL('../src/lib/tei/NT_GRC_P118_Rom.xml', import.meta.url))
		);
	await expect(page.getByText(/Imported NT_GRC_P118_Rom\.xml/)).toBeVisible();
	await page.locator('input[name="title"]').fill('Verse navigation');
	await page.locator('input[name="siglum"]').fill('VN');
	await page.locator('input[name="transcriber"]').fill('Tester');
	await page.locator('input[name="repository"]').fill('Library');
	await page.locator('input[name="settlement"]').fill('City');
	await page.locator('input[name="language"]').fill('Greek');
	await page.getByRole('button', { name: 'Create Transcription' }).click();
	const editor = page.locator('.tiptap');
	await expect(editor).toBeVisible();
	const options = page.locator('#transcription-verse-index option');
	await expect.poll(() => options.count()).toBeGreaterThanOrEqual(2);
	const identifier = await options.nth(1).getAttribute('value');
	if (!identifier) throw new Error('Missing indexed verse');
	await editor.evaluate(element => {
		(element as HTMLElement).dataset.probe = '1';
	});
	await page.getByPlaceholder('Select or type a verse').fill(identifier);
	await page.getByRole('button', { name: 'Go To', exact: true }).click();
	await expect(page).toHaveURL(new RegExp(`verse=${identifier.split(':').at(-1)}`));
	await expect(page.locator('.tiptap[data-probe="1"]')).toBeVisible();
});
