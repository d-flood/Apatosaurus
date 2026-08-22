import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { placeCaretAtLineEnd } from './editor-helpers';

const TEI_FIXTURE_PATH = fileURLToPath(
	new URL('../src/lib/tei/NT_GRC_P118_Rom.xml', import.meta.url)
);

test.setTimeout(180_000);

test('the local stemma has one tabstop and supports keyboard source decisions', async ({
	page,
}) => {
	const projectId = await createProject(page, `Stemma editor ${Date.now().toString(36)}`);
	await createAndCommitWitness(page, projectId, 'Stemma Alpha', 'SA', 'αλφα');
	await createAndCommitWitness(page, projectId, 'Stemma Beta', 'SB', 'βητα');
	await createCollation(page, projectId);

	await page.getByRole('button', { name: 'Readings' }).click();
	await page.getByRole('button', { name: 'Stemma', exact: true }).click();
	const absoluteConnectivity = page.getByRole('button', { name: 'Absolute', exact: true });
	await expect(absoluteConnectivity).toBeVisible();
	await absoluteConnectivity.click();
	await expect(absoluteConnectivity).toHaveAttribute('aria-pressed', 'true');

	const sourceControls = page.getByRole('combobox', { name: /Source of reading/ });
	await expect(sourceControls).toHaveCount(2);
	const diagram = page.getByRole('group', { name: /Local stemma for unit/ });
	const nodes = diagram.getByRole('button');
	await expect(nodes).toHaveCount(2);
	await expect(diagram.locator('button[tabindex="0"]')).toHaveCount(1);

	await sourceControls.last().focus();
	await page.keyboard.press('Tab');
	await expect(diagram.locator('button:focus')).toHaveCount(1);
	await expect(diagram.locator('button:focus')).toHaveAttribute('tabindex', '0');

	const firstLabel = await diagram.locator('button:focus').getAttribute('aria-label');
	await page.keyboard.press('ArrowRight');
	await expect
		.poll(() => diagram.locator('button:focus').getAttribute('aria-label'))
		.not.toBe(firstLabel);

	const announcer = page.getByTestId('stemma-announcer');
	await page.keyboard.press('Enter');
	await expect(announcer).toContainText('Lifted reading');
	await page.keyboard.press('ArrowLeft');
	await expect(announcer).toContainText('selected as the prior reading');
	await page.keyboard.press('Enter');
	await expect(announcer).toContainText('now derives from');
	await expect(diagram.getByRole('button', { name: /derived from/ })).toHaveCount(1);

	const placedReading = diagram.getByRole('button', { name: /derived from/ });
	await placedReading.focus();
	const placedReadingDescription = await placedReading.getAttribute('aria-label');
	const placedReadingLabel = readingLabel(placedReadingDescription);
	await page.keyboard.press('Enter');
	await expect(announcer).toContainText(`Lifted reading ${placedReadingLabel}`);
	await page.keyboard.press('ArrowUp');
	const pendingTargetDescription = await diagram
		.locator('button:focus')
		.getAttribute('aria-label');
	const pendingTargetLabel = readingLabel(pendingTargetDescription);
	await expect(announcer).toContainText(
		`Reading ${pendingTargetLabel} is selected as the prior reading for lifted reading ${placedReadingLabel}`
	);
	await page.keyboard.press('Escape');
	await expect(announcer).toContainText(
		`Cancelled placing reading ${placedReadingLabel} on reading ${pendingTargetLabel}. Focus returned to reading ${placedReadingLabel}`
	);
	await expect(placedReading).toBeFocused();
	await expect(placedReading).toHaveAttribute('aria-label', placedReadingDescription!);

	await page.keyboard.press('u');
	await expect(announcer).toContainText('is marked unclear');
	await expect(diagram.locator('button:focus')).toHaveAttribute(
		'aria-label',
		/origin undeterminable/
	);
	await page.keyboard.press('r');
	await expect(announcer).toContainText('is now a root');

	const rootsBeforeCanvasDrop = diagram.getByRole('button', {
		name: /origin not yet considered|roots this stemma/,
	});
	await rootsBeforeCanvasDrop.nth(0).dragTo(rootsBeforeCanvasDrop.nth(1));
	await expect(announcer).toContainText('now derives from');
	await diagram.getByRole('button', { name: /derived from/ }).dragTo(diagram, {
		targetPosition: { x: 4, y: 4 },
	});
	await expect(announcer).toContainText('is detached');
	const roots = diagram.getByRole('button', {
		name: /origin not yet considered|roots this stemma/,
	});
	await expect(roots).toHaveCount(2);
	await roots.nth(0).dragTo(roots.nth(1));
	await expect(announcer).toContainText('now derives from');
	await diagram.getByRole('button', { name: /derived from/ }).focus();
	await page.keyboard.press('d');
	await expect(announcer).toContainText('is detached');
	const unsourced = diagram.getByRole('button', {
		name: /origin not yet considered|roots this stemma/,
	});
	await expect(unsourced).toHaveCount(2);
	const rootsAfterDetach = unsourced;
	await rootsAfterDetach.nth(0).dragTo(rootsAfterDetach.nth(1));
	await expect(announcer).toContainText('now derives from');

	const root = diagram.getByRole('button', {
		name: /origin not yet considered|roots this stemma/,
	});
	const derived = diagram.getByRole('button', { name: /derived from/ });
	await expect(root).toHaveCount(1);
	await expect(derived).toHaveCount(1);
	await root.dragTo(derived);
	await expect(announcer).toContainText('Cannot make reading');
	await expect(page.getByRole('alert').last()).toContainText('form a cycle');

	// The lemma roots its own stemma and needs no source decision; every other reading does.
	for (let index = 0; index < (await sourceControls.count()); index += 1) {
		const control = sourceControls.nth(index);
		const selected = await control.locator('option:checked').textContent();
		if ((await control.inputValue()) === 'undecided' && !selected?.startsWith('Root')) {
			await control.selectOption('unclear');
		}
	}

	await page.getByRole('link', { name: 'Review', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Review', exact: true })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Verse apparatus' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Local stemmata' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Commit version' })).toBeVisible();
	await page.getByRole('button', { name: 'Commit version' }).click();
	await expect(page.getByPlaceholder('Describe this version')).toBeVisible();
	await page.getByRole('button', { name: 'Cancel' }).click();

	const download = page.waitForEvent('download');
	await page.getByRole('button', { name: 'Export TEI apparatus' }).click();
	const exported = await download;
	expect(exported.suggestedFilename()).toContain('-apparatus.xml');
	const downloadedPath = await exported.path();
	if (!downloadedPath) throw new Error('Expected a downloaded apparatus file.');
	const xml = await readFile(downloadedPath, 'utf8');
	expect(xml).toContain('<app ');
	expect(xml).toContain('<graph type="directed">');
	expect(xml).not.toContain('<f name="connectivity">');

	await page.getByRole('link', { name: 'Stemma', exact: true }).click();
	await page
		.getByRole('combobox', { name: /Source of reading/ })
		.first()
		.selectOption('undecided');
	await page.getByRole('link', { name: 'Review', exact: true }).click();
	await page.getByRole('button', { name: 'Export TEI apparatus' }).click();
	await expect(page.getByRole('alert')).toContainText('Export needs more editorial decisions.');
	const refusal = page.getByRole('link', { name: /Unit .*set every reading source/ });
	await expect(refusal).toBeVisible();
	await refusal.click();
	await expect(page).toHaveURL(/\/stemma$/);
	await expect(page.getByRole('combobox', { name: /Source of reading/ }).first()).toBeVisible();
});

async function createProject(page: Page, name: string): Promise<string> {
	await page.goto('/projects');
	await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
	const input = page.getByPlaceholder('New project name');
	await input.fill(name);
	const create = page.getByRole('button', { name: 'Create' });
	await expect(create).toBeEnabled();
	await create.click();
	await expect(page.getByRole('heading', { name })).toBeVisible();
	const href = await page.getByRole('link', { name: 'New Transcription' }).getAttribute('href');
	const projectId = new URL(href!, page.url()).searchParams.get('projectId');
	if (!projectId) throw new Error('New transcription link did not identify the project.');
	return projectId;
}

function readingLabel(description: string | null): string {
	const label = description?.match(/^([^:(]+)(?: \([^)]*\))?:/)?.[1];
	if (!label)
		throw new Error(
			`Could not identify reading label from ${description ?? 'no description'}.`
		);
	return label;
}

async function createAndCommitWitness(
	page: Page,
	projectId: string,
	title: string,
	siglum: string,
	marker: string
): Promise<void> {
	await page.goto(`/transcription/new?projectId=${projectId}`);
	await expect(page.getByRole('combobox', { name: 'Project*' })).toHaveValue(projectId);
	await page.getByRole('button', { name: 'Import TEI' }).click();
	await page.locator('input[type="file"][accept*="xml"]').setInputFiles(TEI_FIXTURE_PATH);
	await expect(page.getByText(/Imported NT_GRC_P118_Rom\.xml/)).toBeVisible();
	await page.locator('input[name="title"]').fill(title);
	await page.locator('input[name="siglum"]').fill(siglum);
	await page.locator('input[name="transcriber"]').fill('E2E Editor');
	await page.locator('input[name="repository"]').fill('E2E Library');
	await page.locator('input[name="settlement"]').fill('Test City');
	await page.locator('input[name="language"]').fill('Greek');
	await page.getByRole('button', { name: 'Create Transcription' }).click();
	await expect(page.getByRole('heading', { name: title })).toBeVisible({ timeout: 30_000 });

	const line = page.locator('.line-content').filter({ hasText: /\S/ }).first();
	await placeCaretAtLineEnd(line);
	await page.keyboard.type(` ${marker}`);
	await expect(page.getByText('Unsaved local edits')).toBeVisible();
	await page.getByRole('button', { name: 'Commit version' }).first().click();
	const form = page.locator('form', { has: page.getByPlaceholder('Describe this version') });
	await form.getByPlaceholder('Describe this version').fill(`Commit ${title}`);
	await form.getByRole('button', { name: 'Commit version' }).click();
	await expect(page.getByText('Committed locally', { exact: true })).toBeVisible({
		timeout: 30_000,
	});
}

async function createCollation(page: Page, projectId: string): Promise<void> {
	await page.goto(`/collation/new?projectId=${projectId}`);
	await expect(page.getByRole('heading', { name: 'Textual Scope' })).toBeVisible();
	await expect(page.getByText('Loading verses...')).not.toBeVisible({ timeout: 30_000 });
	await page.getByRole('button', { name: 'Rebuild Verse Index' }).click();
	await expect(page.getByText('Rebuilt verse index for 2 transcriptions.')).toBeVisible({
		timeout: 30_000,
	});
	const verseSelector = page.locator('section', {
		has: page.getByRole('heading', { name: 'Verse Selector' }),
	});
	const verse = verseSelector.getByRole('button', { name: /Rom 15:.*2 witness sources/ }).first();
	await expect(verse).toBeVisible();
	await verse.click();
	await expect(page.getByText('Loading witnesses...')).not.toBeVisible({ timeout: 30_000 });
	await expect(page.locator('tbody tr')).toHaveCount(2, { timeout: 30_000 });
	await page.getByRole('textbox', { name: /Segment name/ }).fill('Romans 15:26');
	const proceed = page.getByRole('button', { name: 'Proceed to Alignment' });
	await expect(proceed).toBeEnabled();
	await proceed.click();
	const runCollation = page.getByRole('button', { name: 'Run Collation' });
	await expect(runCollation).toBeEnabled({ timeout: 30_000 });
	await runCollation.click();
	await expect(page.getByText('Collating…')).not.toBeVisible({ timeout: 30_000 });
}
