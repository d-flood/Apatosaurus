import { expect, test } from '@playwright/test';

const HARNESS_TRANSCRIPTION_ID = '11111111-1111-4111-8111-111111111111';

type SelectionSnapshot = {
	activeElementTag: string | null;
	lineNumber: string | null;
	lineText: string | null;
	pageId: string | null;
	zone: string | null;
};

async function readSelectionSnapshot(
	page: Parameters<typeof test>[0]['page']
): Promise<SelectionSnapshot> {
	return page.evaluate(() => {
		const selection = window.getSelection();
		const anchorNode = selection?.anchorNode ?? null;
		const anchorElement =
			anchorNode instanceof Element ? anchorNode : (anchorNode?.parentElement ?? null);
		const line = anchorElement?.closest<HTMLElement>('.line') ?? null;
		const column = anchorElement?.closest<HTMLElement>('.column') ?? null;
		const pageNode = anchorElement?.closest<HTMLElement>('[data-page-id]') ?? null;
		const activeElement =
			document.activeElement instanceof HTMLElement ? document.activeElement : null;

		return {
			activeElementTag: activeElement?.tagName ?? null,
			lineNumber: line?.getAttribute('data-line-number') ?? null,
			lineText:
				line?.querySelector<HTMLElement>('.line-content')?.textContent?.trim() ?? null,
			pageId: pageNode?.getAttribute('data-page-id') ?? null,
			zone: column?.getAttribute('data-zone') ?? null,
		};
	});
}

async function readLineText(
	page: Parameters<typeof test>[0]['page'],
	pageId: string,
	zone: string
): Promise<string | null> {
	return page.evaluate(
		({ currentPageId, currentZone }) => {
			return (
				document
					.querySelector<HTMLElement>(
						`[data-page-id="${currentPageId}"] .column[data-zone="${currentZone}"] .line .line-content`
					)
					?.textContent?.trim() ?? null
			);
		},
		{ currentPageId: pageId, currentZone: zone }
	);
}

async function seedHarnessTranscription(page: Parameters<typeof test>[0]['page']) {
	await page.goto('/transcription/harness');
	await expect(page.getByTestId('harness-ready')).toBeVisible();
}

async function createBlankTranscription(page: Parameters<typeof test>[0]['page']) {
	const suffix = Date.now().toString(36);
	await page.goto('/transcription/new');
	await page.locator('input[name="title"]').fill(`Focus Harness ${suffix}`);
	await page.locator('input[name="siglum"]').fill(`FH-${suffix}`);
	await page.locator('input[name="transcriber"]').fill('OpenCode');
	await page.locator('input[name="repository"]').fill('Harness Repository');
	await page.locator('input[name="settlement"]').fill('Harness Settlement');
	await page.locator('input[name="language"]').fill('Greek');
	await page.getByRole('button', { name: 'Create Transcription' }).click();
	await page.locator('[aria-label="Insert Page"]').waitFor();
}

async function insertFramedPage(page: Parameters<typeof test>[0]['page'], pageName: string) {
	await page.locator('[aria-label="Insert Page"]').click();
	const popover = page.locator('[id$="popover-insert-page"]');
	await expect(popover).toBeVisible();
	await popover.locator('input[placeholder="e.g. 123r"]').fill(pageName);
	await popover.getByRole('button', { name: 'Framed Page (Catena)' }).click();
	await expect(popover).not.toBeVisible();
}

test('typing in a framed-page line keeps focus in the active page and column', async ({ page }) => {
	await seedHarnessTranscription(page);

	const topLine = page.locator(
		'[data-page-id="harness-page-1"] .column[data-zone="top"] .line .line-content'
	);
	await expect(topLine).toBeVisible();

	const box = await topLine.boundingBox();
	if (!box) {
		throw new Error('top line bounding box not available');
	}

	await page.mouse.click(box.x + box.width - 2, box.y + box.height / 2);
	await page.keyboard.type('ab', { delay: 100 });
	await page.waitForTimeout(100);

	const editedText = await readLineText(page, 'harness-page-1', 'top');
	const lastPageBottomText = await readLineText(page, 'harness-page-2', 'bottom');

	expect(editedText).toBe('page one topab');
	expect(lastPageBottomText).toBe('page two bottom');
});

test('arrow-key traversal skips center while moving through commentary columns', async ({
	page,
}) => {
	await seedHarnessTranscription(page);

	const leftLine = page.locator(
		'[data-page-id="harness-page-1"] .column[data-zone="left"] .line .line-content'
	);
	await expect(leftLine).toBeVisible();

	const box = await leftLine.boundingBox();
	if (!box) {
		throw new Error('left line bounding box not available');
	}

	await page.mouse.click(box.x + box.width - 2, box.y + box.height / 2);
	await page.keyboard.press('ArrowRight');
	await page.waitForTimeout(100);

	const selection = await readSelectionSnapshot(page);
	expect(selection.pageId).toBe('harness-page-1');
	expect(selection.zone).toBe('right');
});

test('enter then typing continues in the newly created line', async ({ page }) => {
	await seedHarnessTranscription(page);

	const centerLine = page.locator(
		'[data-page-id="harness-page-1"] .column[data-zone="center"] .line .line-content'
	);
	await expect(centerLine).toBeVisible();

	const box = await centerLine.boundingBox();
	if (!box) {
		throw new Error('center line bounding box not available');
	}

	await page.mouse.click(box.x + box.width - 2, box.y + box.height / 2);
	await page.keyboard.press('Enter');
	await page.keyboard.type('xyz', { delay: 100 });
	await page.waitForTimeout(100);

	const selection = await readSelectionSnapshot(page);

	expect(selection.pageId).toBe('harness-page-1');
	expect(selection.zone).toBe('center');
	expect(selection.lineNumber).toBe('2');
	expect(selection.lineText).toBe('xyz');
	await expect(
		page.locator('[data-page-id="harness-page-1"] .column[data-zone="center"] .line').nth(1)
	).toContainText('xyz');
});

test('pressing Enter on an already empty line adds one new line', async ({ page }) => {
	await createBlankTranscription(page);
	await insertFramedPage(page, '001r');

	const pageId = await page.locator('[data-page-id]').first().getAttribute('data-page-id');
	if (!pageId) {
		throw new Error('created transcription page id not found');
	}

	const topLine = page
		.locator(`[data-page-id="${pageId}"] .column[data-zone="top"] .line`)
		.first();
	await topLine.click();
	await page.keyboard.press('Enter');
	await page.waitForTimeout(150);
	await page.keyboard.press('Enter');
	await page.waitForTimeout(150);

	await expect(
		page.locator(`[data-page-id="${pageId}"] .column[data-zone="top"] .line`)
	).toHaveCount(3);
});

test('typing in the full transcription page keeps focus in the active page and column', async ({
	page,
}) => {
	await seedHarnessTranscription(page);
	await page.goto(`/transcription/${HARNESS_TRANSCRIPTION_ID}`);

	const topLine = page.locator(
		'[data-page-id="harness-page-1"] .column[data-zone="top"] .line .line-content'
	);
	await expect(topLine).toBeVisible();

	const box = await topLine.boundingBox();
	if (!box) {
		throw new Error('top line bounding box not available on full transcription page');
	}

	await page.mouse.click(box.x + box.width - 2, box.y + box.height / 2);
	await page.keyboard.type('a', { delay: 100 });
	await page.waitForTimeout(150);

	const afterFirstCharacter = await readSelectionSnapshot(page);
	expect(afterFirstCharacter.pageId).toBe('harness-page-1');
	expect(afterFirstCharacter.zone).toBe('top');

	await page.keyboard.type('b', { delay: 100 });
	await page.waitForTimeout(150);

	const selection = await readSelectionSnapshot(page);
	const editedText = await readLineText(page, 'harness-page-1', 'top');

	expect(selection.pageId).toBe('harness-page-1');
	expect(selection.zone).toBe('top');
	expect(selection.lineText).toBe('page one topab');
	expect(editedText).toBe('page one topab');
});

test('typing after creating a new transcription with multiple framed pages stays on the active page', async ({
	page,
}) => {
	await createBlankTranscription(page);
	await insertFramedPage(page, '001r');
	await insertFramedPage(page, '001v');

	const pageIds = await page.evaluate(() =>
		Array.from(document.querySelectorAll<HTMLElement>('[data-page-id]')).map(
			node => node.dataset.pageId ?? ''
		)
	);
	expect(pageIds).toHaveLength(2);

	const topLine = page.locator(`
		[data-page-id="${pageIds[0]}"] .column[data-zone="top"] .line
	`);
	await expect(topLine).toBeVisible();

	await topLine.click();
	await page.keyboard.type('a', { delay: 100 });
	await page.waitForTimeout(150);

	const afterFirstCharacter = await readSelectionSnapshot(page);
	expect(afterFirstCharacter.pageId).toBe(pageIds[0]);
	expect(afterFirstCharacter.zone).toBe('top');

	await page.keyboard.type('b', { delay: 100 });
	await page.waitForTimeout(150);

	const selection = await readSelectionSnapshot(page);
	expect(selection.pageId).toBe(pageIds[0]);
	expect(selection.zone).toBe('top');
	await expect(topLine).toContainText('ab');
	await expect(
		page.locator(
			`[data-page-id="${pageIds[1]}"] .column[data-zone="bottom"] .line .line-content`
		)
	).not.toContainText('ab');
});
