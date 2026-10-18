import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { hashCanonicalPayload } from '../src/lib/storage/canonical-json';
import { sealDocument, serializeSealedDocument } from '../src/lib/storage/envelope';

const PROJECT_ID = 'full-control-project';
const CLASSIC = fileURLToPath(new URL('./fixtures/full-control-classic.xml', import.meta.url));
const TRANSCRIPTION = new URL('./fixtures/full-control-transcription.xml', import.meta.url);
const MIGRATION = fileURLToPath(
	new URL('../src/lib/collation/__fixtures__/classic/metadata.xml', import.meta.url)
);

test.setTimeout(180_000);
test.use({ actionTimeout: 15_000 });

test('a scholar imports, extends, reviews and exports a classic collation on a phone', async ({
	page,
}) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await seedProject(page);
	await page.goto(`/projects/${PROJECT_ID}/collations`);
	await page.getByRole('button', { name: 'Import classic collation' }).click();
	const dialog = page.getByRole('dialog', { name: 'Import classic collation' });
	await dialog.getByLabel(/Classic export/).setInputFiles(CLASSIC);
	await expect(dialog.getByRole('status')).toHaveText('1 verses · 2 witnesses');
	await dialog.getByRole('combobox', { name: 'Base text siglum' }).selectOption({ label: 'A' });
	for (const [name, value] of Object.entries({
		transcriber: 'Editor',
		repository: 'Library',
		settlement: 'Cambridge',
		language: 'Greek',
	})) {
		await dialog.getByRole('textbox', { name, exact: true }).fill(value);
	}
	await expectControlsFit(dialog);
	await dialog.getByRole('button', { name: 'Import collation', exact: true }).click();
	await expect(dialog).toHaveCount(0, { timeout: 30_000 });
	await page.getByRole('link', { name: 'Open', exact: true }).click();
	await expect(page).toHaveURL(/\/review$/);
	const collationUrl = page.url().replace(/\/review$/, '');
	await page.getByRole('link', { name: 'Readings', exact: true }).click();
	await expect(page.getByRole('textbox', { name: 'Text of reading a', exact: true })).toHaveValue(
		'αλφα'
	);
	await page
		.getByRole('combobox', { name: 'Manual witness for reading b', exact: true })
		.fill('Father');
	const attach = page.getByRole('button', {
		name: 'Attach manual witness to reading b',
		exact: true,
	});
	await expectControlFits(attach);
	await expectControlFits(
		page.getByRole('combobox', { name: 'Manual witness for reading b', exact: true })
	);
	await attach.click();
	await expect(
		page.getByRole('button', { name: 'Detach Father from reading b', exact: true })
	).toBeVisible();
	await page.getByLabel('More actions for reading b', { exact: true }).click();
	const tag = page.getByRole('combobox', { name: 'Tag for reading b', exact: true });
	await tag.fill('Nomen sacrum');
	await expectControlFits(tag);
	await expectControlFits(
		page.getByRole('button', { name: 'Add tag to reading b', exact: true })
	);
	await page.getByRole('button', { name: 'Add tag to reading b', exact: true }).click();
	await expect(
		page.getByRole('button', { name: 'Remove tag Nomen sacrum from reading b' })
	).toBeVisible();
	await page.getByLabel('More actions for reading b', { exact: true }).click();
	await expect(page.getByText('Saved', { exact: true })).toBeVisible();

	await addTranscription(page, 'Twin', false);
	await page.goto(`${collationUrl}/setup`);
	await page.getByRole('button', { name: 'Rebuild Verse Index' }).click();
	await expect(page.getByText('Rebuilt verse index for 2 transcriptions.')).toBeVisible();
	await page.getByRole('button', { name: /Acts 1:1.*1 witness source/ }).click();
	await page.getByRole('link', { name: 'Alignment', exact: true }).click();
	await page.getByRole('button', { name: 'Refresh', exact: true }).click();
	await page.getByRole('link', { name: 'Readings', exact: true }).click();
	const confirmation = page.getByRole('region', {
		name: 'Unconfirmed attestations',
		exact: true,
	});
	await expect(confirmation).toContainText('Twin');
	await expectControlsFit(confirmation);
	await page.getByRole('button', { name: 'Confirm attestations', exact: true }).click();
	await expect(confirmation).toHaveCount(0);
	await page.getByRole('button', { name: 'Twin', exact: true }).click();
	await page.getByRole('button', { name: 'Split into a new reading', exact: true }).click();
	await expect(page.getByRole('textbox', { name: /Text of reading/ })).toHaveCount(3);
	await expect(page.getByText('Saved', { exact: true })).toBeVisible();

	await addTranscription(page, 'Different', true);
	await page.goto(`${collationUrl}/setup`);
	await page.getByRole('button', { name: 'Rebuild Verse Index' }).click();
	await expect(page.getByText('Rebuilt verse index for 3 transcriptions.')).toBeVisible();
	await page.getByRole('link', { name: 'Alignment', exact: true }).click();
	await page.getByRole('button', { name: 'Refresh', exact: true }).click();
	await page.getByRole('link', { name: 'Readings', exact: true }).click();
	const resolution = page.getByRole('region', { name: 'Unresolved attestations', exact: true });
	await expect(resolution).toContainText('Different');
	await expectControlsFit(resolution);
	await resolution
		.getByRole('button', { name: 'Assign Different to reading a1 (candidate)', exact: true })
		.click();
	await expect(resolution).toHaveCount(0);
	await expect(confirmation).toHaveCount(0);
	await page.getByRole('button', { name: /^βητα / }).click();
	await expect(page.getByRole('textbox', { name: 'Text of reading b', exact: true })).toHaveValue(
		'ζητα'
	);
	await page.getByRole('button', { name: 'Set B uncited', exact: true }).click();

	await page.getByRole('link', { name: 'Alignment', exact: true }).click();
	await page.getByRole('radio', { name: 'Grid', exact: true }).check();
	await page.getByRole('columnheader', { name: '6', exact: true }).click();
	const declare = page.getByRole('button', { name: 'Declare unit', exact: true });
	await expectControlFits(declare);
	await declare.click();
	await expect(
		page.getByRole('button', { name: 'Remove declaration', exact: true })
	).toBeVisible();
	await page.getByRole('link', { name: 'Readings', exact: true }).click();
	await page.getByRole('button', { name: /^γαμμα / }).click();
	await expect(page.getByRole('textbox', { name: 'Text of reading a', exact: true })).toHaveValue(
		'γαμμα'
	);
	await page.getByRole('button', { name: 'Set B uncited', exact: true }).click();
	await expect(page.getByText('Saved', { exact: true })).toBeVisible();
	await page.reload();
	await page.getByRole('link', { name: 'Review', exact: true }).click();
	await expect(
		page.getByRole('button', {
			name: /Confirm placed witness|Resolve placement|Resolve overlapping testimony/,
		})
	).toHaveCount(0);
	const download = page.waitForEvent('download');
	await page.getByRole('button', { name: 'Export TEI apparatus', exact: true }).click();
	const exported = await download;
	expect(exported.suggestedFilename()).toContain('-apparatus.xml');
	const xml = await readFile((await exported.path())!, 'utf8');
	expect(xml).toContain('Father');
	expect(xml).toContain('Twin');
	expect(xml).toContain('Different');
	expect(xml).toContain('Nomen sacrum');
	expect(xml).toContain('ζητα');
	expect(xml.match(/<app /g)).toHaveLength(3);
	await expectNoHorizontalScroll(page);
});

test('a scholar migrates sections, notes and witness descriptions from a classic export on a phone', async ({
	page,
}) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await seedProject(page);
	await page.goto(`/projects/${PROJECT_ID}/collations`);
	await page.getByRole('button', { name: 'Import classic collation' }).click();
	const dialog = page.getByRole('dialog', { name: 'Import classic collation' });
	await dialog.getByLabel(/Classic export/).setInputFiles(MIGRATION);
	await expect(dialog.getByRole('status')).toHaveText('2 verses · 3 witnesses');
	await expect(dialog.getByRole('textbox', { name: 'Transcription title' })).toHaveValue('RP');
	for (const [name, value] of Object.entries({
		transcriber: 'Editor',
		repository: 'Library',
		settlement: 'Cambridge',
		language: 'Greek',
	})) {
		await dialog.getByRole('textbox', { name, exact: true }).fill(value);
	}
	await dialog.getByRole('checkbox', { name: /non-attestation/ }).check();
	await expectControlsFit(dialog);
	await dialog.getByRole('button', { name: 'Import collation', exact: true }).click();
	await expect(dialog).toHaveCount(0, { timeout: 30_000 });
	await expect(page.getByText('Chapter 1 · 1')).toBeVisible();
	await expect(page.getByText('Chapter 2 · 1')).toBeVisible();
	await page.getByRole('link', { name: 'Open', exact: true }).first().click();
	await expect(page).toHaveURL(/\/review$/);
	await page.getByLabel('Verse note', { exact: true }).click();
	await expect(page.getByRole('textbox', { name: 'Verse note text' })).toHaveValue(
		'Verse remark\n\nClassic reading b at 4: Leaf damaged'
	);
	await page.getByLabel('Verse note', { exact: true }).click();
	await page.getByRole('radio', { name: 'Parallel', exact: true }).check();
	await expect(page.getByRole('button', { name: 'C', exact: true }).first()).toHaveAttribute(
		'title',
		'Vaticanus'
	);
	await expectNoHorizontalScroll(page);
	const download = page.waitForEvent('download');
	await page.getByRole('button', { name: 'Export TEI apparatus', exact: true }).click();
	const xml = await readFile((await (await download).path())!, 'utf8');
	expect(xml).toContain('<note type="verse">Verse remark');
	expect(xml).toMatch(/<note type="reading" target="#[^"]+">Reading remark<\/note>/);
});

async function expectControlFits(control: Locator): Promise<void> {
	await expect(control).toBeVisible();
	let previous = '';
	await expect
		.poll(async () => {
			const box = await control.boundingBox();
			const current = JSON.stringify(box);
			const stable = current === previous;
			previous = current;
			return stable && box !== null && box.x >= 0 && box.x + box.width <= 390;
		})
		.toBe(true);
}

async function expectControlsFit(region: Locator): Promise<void> {
	await expect(region).toBeVisible();
	for (const role of ['button', 'textbox', 'combobox'] as const) {
		for (const control of await region.getByRole(role).all()) await expectControlFits(control);
	}
}

async function expectNoHorizontalScroll(page: Page): Promise<void> {
	let previous = '';
	await expect
		.poll(async () => {
			const dimensions = await page.evaluate(() => ({
				width: document.documentElement.scrollWidth,
				viewport: innerWidth,
			}));
			const current = JSON.stringify(dimensions);
			const stable = current === previous;
			previous = current;
			return stable && dimensions.width <= dimensions.viewport;
		})
		.toBe(true);
}

async function addTranscription(page: Page, siglum: string, different: boolean): Promise<void> {
	await page.goto(`/transcription/new?projectId=${PROJECT_ID}`);
	await expect(page.getByRole('combobox', { name: 'Project*', exact: true })).toHaveValue(
		PROJECT_ID
	);
	await page.getByRole('button', { name: 'Import TEI', exact: true }).click();
	const xml = (await readFile(TRANSCRIPTION, 'utf8')).replace(
		'βητα',
		different ? 'ζητα' : 'βητα'
	);
	await page.getByLabel(/TEI File/).setInputFiles({
		name: `${siglum}.xml`,
		mimeType: 'application/xml',
		buffer: Buffer.from(xml),
	});
	await expect(page.getByText(`Imported ${siglum}.xml`)).toBeVisible();
	for (const [name, value] of Object.entries({
		'Title*': siglum,
		'Siglum*': siglum,
		'Transcriber*': 'Editor',
		'Repository*': 'Library',
		'Settlement*': 'Cambridge',
		'Language*': 'Greek',
	})) {
		await page.getByRole('textbox', { name, exact: true }).fill(value);
	}
	await page.getByRole('button', { name: 'Create Transcription', exact: true }).click();
	await expect(page.getByRole('heading', { name: siglum, exact: true })).toBeVisible({
		timeout: 30_000,
	});
}

async function seedProject(page: Page): Promise<void> {
	const content = serializeSealedDocument(
		await sealDocument('apatosaurus.project-manifest', 5, {
			id: PROJECT_ID,
			name: 'Full control',
			description: '',
			charter: '',
			collation_settings: {},
			forked_from: null,
			manifest_content_hash: await hashCanonicalPayload({
				project_id: PROJECT_ID,
				transcriptions: [],
				collations: [],
				tombstones: [],
			}),
			transcriptions: [],
			collations: [],
			tombstones: [],
			created_at: '2026-10-01T00:00:00.000Z',
			updated_at: '2026-10-01T00:00:00.000Z',
		})
	);
	await page.route('**/__seed', route =>
		route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Seed</title>' })
	);
	await page.goto('/__seed');
	await page.evaluate(async content => {
		let directory = await navigator.storage.getDirectory();
		for (const part of ['apatosaurus', 'v1', 'projects', 'full-control'])
			directory = await directory.getDirectoryHandle(part, { create: true });
		const writer = await (
			await directory.getFileHandle('project.json', { create: true })
		).createWritable();
		await writer.write(content);
		await writer.close();
	}, content);
}
