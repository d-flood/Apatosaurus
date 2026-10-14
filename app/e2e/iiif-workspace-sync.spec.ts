import { expect, test, type Locator, type Page } from '@playwright/test';
import { placeCaretAtLineEnd } from './editor-helpers';

test.setTimeout(120_000);

test('IIIF restores inline and popup sessions and synchronizes linked pages and canvases', async ({
	page,
	context,
	baseURL,
}) => {
	page.setDefaultTimeout(10_000);
	await page.setViewportSize({ width: 1600, height: 1000 });
	const origin = baseURL!;
	await context.route('**/__iiif/*', async route => {
		const url = route.request().url();
		if (url.endsWith('.svg')) {
			await route.fulfill({
				contentType: 'image/svg+xml',
				body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="600" height="800" fill="lightgray"/></svg>',
			});
			return;
		}
		const source = url.endsWith('a.json') ? 'A' : 'B';
		await route.fulfill({
			json: {
				'@context': 'http://iiif.io/api/presentation/3/context.json',
				id: url,
				type: 'Manifest',
				label: { en: [`Sync source ${source}`] },
				items: [1, 2].map(index => ({
					id: `${url}/canvas/${index}`,
					type: 'Canvas',
					width: 600,
					height: 800,
					label: { en: [`Canvas ${source}${index}`] },
					items: [
						{
							id: `${url}/page/${index}`,
							type: 'AnnotationPage',
							items: [
								{
									id: `${url}/annotation/${index}`,
									type: 'Annotation',
									motivation: 'painting',
									target: `${url}/canvas/${index}`,
									body: {
										id: `${origin}/__iiif/image.svg`,
										type: 'Image',
										format: 'image/svg+xml',
										width: 600,
										height: 800,
									},
								},
							],
						},
					],
				})),
			},
		});
	});
	await page.goto('/transcription/harness');
	await expect(page.getByTestId('harness-ready')).toBeVisible();
	await page.goto('/transcription/11111111-1111-4111-8111-111111111111');
	const firstLine = page.locator(
		'[data-page-id="harness-page-1"] .column[data-zone="top"] .line-content'
	);
	const secondLine = page.locator(
		'[data-page-id="harness-page-2"] .column[data-zone="top"] .line-content'
	);
	await expect(firstLine).toBeVisible();
	await placeCaretAtLineEnd(firstLine);
	await page.getByRole('button', { name: 'Image Workspace', exact: true }).click();
	await loadSource(page, `${origin}/__iiif/a.json`);
	const index = page.locator('#triiiceratops-viewer .nav-index');
	await expect(index).toHaveText('1 / 2');
	await page.getByRole('button', { name: 'Link active page to current canvas' }).click();
	await expect(page.getByRole('button', { name: 'Jump', exact: true })).toHaveCount(1);
	await page.getByRole('button', { name: 'Next Canvas', exact: true }).press('Enter');
	await expect(index).toHaveText('2 / 2');
	await placeCaretAtLineEnd(secondLine);
	await page.getByRole('button', { name: 'Link active page to current canvas' }).click();
	await expect(page.getByRole('button', { name: 'Jump', exact: true })).toHaveCount(2);
	await placeCaretAtLineEnd(firstLine);
	await expect(index).toHaveText('1 / 2');
	await page.getByRole('button', { name: 'Next Canvas', exact: true }).press('Enter');
	await expect(index).toHaveText('2 / 2');
	await expectPageJump(secondLine);
	await page.getByRole('button', { name: 'Jump', exact: true }).first().click();
	await expect(index).toHaveText('1 / 2');
	const start = page
		.locator('label')
		.filter({ has: page.getByText('Start canvas', { exact: true }) })
		.locator('select');
	const end = page
		.locator('label')
		.filter({ has: page.getByText('End canvas', { exact: true }) })
		.locator('select');
	await start.selectOption(`${origin}/__iiif/a.json/canvas/1`);
	await end.selectOption(`${origin}/__iiif/a.json/canvas/2`);
	await page.getByRole('button', { name: 'Sources', exact: true }).click();
	await loadSource(page, `${origin}/__iiif/b.json`);
	await expect(start).toHaveValue('');
	await expect(end).toHaveValue('');
	await page.getByRole('radio', { name: /Sync source A|a[.]json/ }).check();
	await expect(start).toHaveValue(`${origin}/__iiif/a.json/canvas/1`);
	await expect(end).toHaveValue(`${origin}/__iiif/a.json/canvas/2`);
	await page.getByRole('radio', { name: /Composite local manifest/ }).check();
	await page.getByRole('button', { name: 'Image Workspace', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Linking', exact: true })).toHaveCount(0);
	await page.getByRole('button', { name: 'Image Workspace', exact: true }).click();
	await expect(page.getByRole('radio', { name: /Composite local manifest/ })).toBeChecked();
	await expect(page.getByRole('button', { name: 'Linking', exact: true })).toHaveClass(
		/tab-active/
	);
	const popupPromise = page.waitForEvent('popup');
	await page.getByRole('button', { name: 'Pop out', exact: true }).click();
	const popup = await popupPromise;
	await expect(popup.getByRole('radio', { name: /Composite local manifest/ })).toBeChecked();
	await expect(popup.getByRole('button', { name: 'Linking', exact: true })).toHaveClass(
		/tab-active/
	);
	await expect(popup.locator('#triiiceratops-viewer .nav-index')).toHaveText('1 / 2');
	await popup.getByRole('button', { name: 'Next Canvas', exact: true }).press('Enter');
	await expect(popup.locator('#triiiceratops-viewer .nav-index')).toHaveText('2 / 2');
	await expectPageJump(secondLine);
	await popup.close();
	await expect(page.getByRole('button', { name: 'Linking', exact: true })).toHaveClass(
		/tab-active/
	);
	const reopenedPromise = page.waitForEvent('popup');
	await page.getByRole('button', { name: 'Pop out', exact: true }).click();
	const reopened = await reopenedPromise;
	await expect(reopened.getByRole('radio', { name: /Composite local manifest/ })).toBeChecked();
	await expect(reopened.getByRole('button', { name: 'Linking', exact: true })).toHaveClass(
		/tab-active/
	);
	await reopened.close();
});

async function loadSource(page: Page, url: string) {
	await page.getByPlaceholder('https://example.org/iiif/manifest.json').fill(url);
	await page.getByRole('button', { name: 'Load manifest', exact: true }).click();
	await expect(
		page.getByText(
			'Manifest loaded and saved locally. Choose pages and canvases to start linking.'
		)
	).toBeVisible();
}

async function expectPageJump(line: Locator) {
	await expect
		.poll(async () => {
			const before = (await line.boundingBox())?.y ?? Infinity;
			await line.evaluate(
				() =>
					new Promise<void>(resolve =>
						requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
					)
			);
			const after = (await line.boundingBox())?.y ?? Infinity;
			return after >= 0 && after < 700 && Math.abs(after - before) < 0.5;
		})
		.toBe(true);
}
