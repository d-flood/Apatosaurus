import { expect, test, type Locator, type Page } from '@playwright/test';
import collations from './fixtures/cbgm-collations.json' with { type: 'json' };
import { hashCanonicalPayload } from '../src/lib/storage/canonical-json';
import { sealDocument, serializeSealedDocument } from '../src/lib/storage/envelope';

const PROJECT_ID = 'cbgm-e2e-project';
const SEEDED_AT = '2026-10-01T00:00:00.000Z';
const ANALYSIS = 'John 1 coherence';
const HOLD_KEY = 'e2e-hold-cbgm-computation';

type CbgmHold = { releaseCbgmWitness(): void; releaseCbgmComputation(): void };

test.setTimeout(240_000);

test('a CBGM analysis computes while the scholar works elsewhere, answers every tool, goes out of date, computes again, and reads on a phone', async ({
	page,
}) => {
	await holdCbgmWitnesses(page);
	await seedProject(page);
	const nav = page.getByRole('navigation', { name: 'Primary' });
	const cbgmLink = nav.getByRole('link', { name: /^CBGM/ }).filter({ visible: true });
	let analysisId = '';

	await test.step('create an analysis and watch it compute', async () => {
		await page.goto(`/projects/${PROJECT_ID}/cbgm`);
		await expect(page.getByText('No analyses in this project yet.')).toBeVisible();
		const chosen = page.getByRole('group', { name: 'Collations' }).getByRole('checkbox');
		await expect(chosen).toHaveCount(2);
		for (const checkbox of await chosen.all()) await expect(checkbox).toBeChecked();

		await page.evaluate(key => sessionStorage.setItem(key, 'on'), HOLD_KEY);
		await page.getByPlaceholder('e.g. Romans, first hands').fill(ANALYSIS);
		await page.getByRole('button', { name: 'Start analysis' }).click();

		const row = analysisRow(page, ANALYSIS);
		await expect(row).toContainText('2 collations · 5 witnesses');
		await expect(row.getByText('Running', { exact: true })).toBeVisible();
		await expect(row).toContainText('0 of 5 witnesses');
		await expect(cbgmLink.getByRole('img', { name: 'Computing' })).toBeVisible();
	});

	await test.step('keep working in another document while it computes', async () => {
		await page.locator('.tabs').getByRole('link', { name: 'Collations' }).click();
		await page
			.getByRole('listitem')
			.filter({ hasText: 'Collation John 1:2' })
			.getByRole('link', { name: 'Open' })
			.click();
		await expect(page).toHaveURL(/\/collation\/cbgm-e2e-john-1-2\/stemma$/);
		const source = page.getByRole('combobox', { name: /Source of reading/ });
		await expect(source).toHaveCount(2);
		await expect(source.last()).toBeEnabled();
		await expect(page.getByRole('group', { name: /Local stemma for unit/ })).toBeVisible();
		await expect(cbgmLink.getByRole('img', { name: 'Computing' })).toBeVisible();
	});

	await test.step('return through the nav link and see progress and completion', async () => {
		await cbgmLink.click();
		await expect(page).toHaveURL(/\/cbgm\/[^/]+$/);
		analysisId = new URL(page.url()).pathname.split('/').at(-1)!;
		await expect(page.getByRole('heading', { level: 1, name: ANALYSIS })).toBeVisible();
		const progress = page.getByRole('progressbar', { name: 'Coherence progress' });
		await expect(progress).toHaveJSProperty('value', 0);

		await page.evaluate(() => (window as unknown as CbgmHold).releaseCbgmWitness());
		await expect(progress).toHaveJSProperty('value', 1);
		await expect(page.getByText('1 of 5 witnesses')).toBeVisible();

		await page.evaluate(() => (window as unknown as CbgmHold).releaseCbgmComputation());
		await expect(page.getByText('Ready', { exact: true })).toBeVisible({ timeout: 60_000 });
		await expect(progress).toHaveCount(0);
		await expect(cbgmLink.getByRole('img', { name: 'Computing' })).toHaveCount(0);

		await nav.locator('div[role="button"]').click();
		const notification = nav
			.locator('.rounded-box.border')
			.filter({ hasText: 'CBGM coherence finished' });
		await expect(notification).toContainText(`Coherence for ${ANALYSIS} is ready.`);
		await expect(notification.getByRole('link', { name: 'Open analysis' })).toHaveAttribute(
			'href',
			`/cbgm/${analysisId}`
		);
		await page.getByRole('heading', { level: 1, name: ANALYSIS }).click();
	});

	await test.step('run every tool', async () => {
		await runTools(page, { computeGlobalStemma: true });
	});

	await test.step('open a specific blocking unit after collation hydration', async () => {
		await page.goto('/collation/cbgm-e2e-john-1-1/readings?unit=unit%3Acbgm-e2e-john-1-1-c3');
		await expect(
			page.getByRole('textbox', { name: 'Text of reading a', exact: true })
		).toHaveValue('λογος');
	});

	await test.step('save a collation edit without a checkpoint and see the analysis go out of date', async () => {
		await page.goto('/collation/cbgm-e2e-john-1-1/stemma');
		const source = page.getByRole('combobox', { name: 'Source of reading c', exact: true });
		await source.selectOption('unclear');
		await expect(source).toHaveValue('unclear');
		await expect(page.getByText('Saved', { exact: true })).toBeVisible();

		await cbgmLink.click();
		await expect(page).toHaveURL(`/projects/${PROJECT_ID}/cbgm`);
		await expect(analysisRow(page, ANALYSIS)).toContainText(
			'Out of date. Changed since frozen: John 1:1.'
		);
	});

	await test.step('compute again and list both analyses', async () => {
		await analysisRow(page, ANALYSIS).getByRole('button', { name: 'Compute again' }).click();
		await expect(page.getByText(`Prefilled from ${ANALYSIS}.`)).toBeVisible();
		const name = page.getByPlaceholder('e.g. Romans, first hands');
		await expect(name).toHaveValue(new RegExp(`^${ANALYSIS} \\d{4}-\\d{2}-\\d{2}$`));
		const recomputed = await name.inputValue();
		await page.getByRole('button', { name: 'Start analysis' }).click();

		const second = analysisRow(page, recomputed);
		await expect(second.getByText('Ready', { exact: true })).toBeVisible({ timeout: 60_000 });
		await expect(second).not.toContainText('Out of date');
		await expect(analysisRow(page, ANALYSIS)).toContainText('Out of date');
		await expect(page.getByRole('link', { name: new RegExp(`^${ANALYSIS}`) })).toHaveCount(2);
	});

	await test.step('read every page and tool result on a phone', async () => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto(`/projects/${PROJECT_ID}/cbgm`);
		await expect(analysisRow(page, ANALYSIS)).toContainText('Out of date');
		await expect(page.getByRole('button', { name: 'Start analysis' })).toBeVisible();
		await expectNoHorizontalScroll(page);

		await page.goto(`/cbgm/${analysisId}`);
		await expect(page.getByRole('heading', { level: 1, name: ANALYSIS })).toBeVisible();
		await expect(page.getByRole('tab', { name: 'Compare witnesses' })).toBeVisible();
		await expectNoHorizontalScroll(page);
		await runTools(page, { check: () => expectNoHorizontalScroll(page) });
	});
});

async function runTools(
	page: Page,
	{
		computeGlobalStemma = false,
		check = async () => {},
	}: { computeGlobalStemma?: boolean; check?: () => Promise<void> }
): Promise<void> {
	const panel = (name: string) => page.getByRole('tabpanel', { name });
	const open = async (name: string) => {
		await page.getByRole('tab', { name }).click();
		await expect(page.getByRole('tab', { name })).toHaveAttribute('aria-selected', 'true');
		return panel(name);
	};

	const compare = await open('Compare witnesses');
	await compare.getByLabel('Witness').selectOption('B');
	await compare.getByRole('button', { name: 'Compare' }).click();
	await expect(compare).toContainText('Genealogical comparisons for B (4 extant units)');
	await expect(compare.locator('tbody tr')).toHaveCount(4);
	await check();

	const relatives = await open('Find relatives');
	await relatives.getByLabel('Witness').selectOption('B');
	await relatives.getByLabel('Variation unit').selectOption({ label: 'John 1:1/1' });
	await relatives.getByRole('button', { name: 'Find relatives' }).click();
	await expect(relatives).toContainText('at John 1:1/1, where it reads a');
	await expect(relatives.locator('tbody tr')).toHaveCount(4);
	await check();

	const substemmata = await open('Optimize substemmata');
	await substemmata.getByLabel('Witness').selectOption('B');
	await substemmata.getByRole('button', { name: 'Optimize' }).click();
	await expect(substemmata).toContainText('Substemmata for B (4 extant units)');
	await expect(substemmata.locator('tbody tr')).toHaveCount(1);
	await expect(substemmata.locator('tbody tr')).toContainText('A');
	await check();

	const flow = await open('Textual flow');
	await flow.getByLabel('Variation unit').selectOption({ label: 'John 1:1/1' });
	await flow.getByRole('button', { name: 'Draw graph' }).click();
	await expectGraph(flow.getByRole('figure'), 'Textual flow, John 1:1/1', 'A (a)', 4);
	await check();

	const stemma = await open('Global stemma');
	if (computeGlobalStemma) {
		await stemma.getByRole('button', { name: 'Compute global stemma' }).click();
	}
	await expectGraph(stemma.getByRole('figure'), 'Global stemma', 'A', 4, 60_000);
	await expect(page.getByText('Global stemma ready', { exact: true })).toBeVisible();
	await check();
}

async function expectGraph(
	figure: Locator,
	title: string,
	node: string,
	edges: number,
	timeout?: number
): Promise<void> {
	await expect(figure.locator('figcaption')).toHaveText(title, { timeout });
	const svg = figure.locator('svg:has(g.node)');
	await expect(svg).toBeVisible({ timeout });
	await settled(() => svg.evaluate(element => element.parentElement!.style.transform));
	await expect(svg.locator('g.node').getByText(node, { exact: true })).toHaveCount(1);
	await expect(svg.locator('g.edge')).toHaveCount(edges);
}

async function expectNoHorizontalScroll(page: Page): Promise<void> {
	const { scrollWidth, innerWidth } = await settled(() =>
		page.evaluate(() => ({
			scrollWidth: document.documentElement.scrollWidth,
			innerWidth: window.innerWidth,
		}))
	);
	expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
}

async function settled<T>(read: () => Promise<T>): Promise<T> {
	let previous: string | undefined;
	let value: T | undefined;
	await expect
		.poll(async () => {
			value = await read();
			const current = JSON.stringify(value);
			const stable = current === previous;
			previous = current;
			return stable;
		})
		.toBe(true);
	return value as T;
}

function analysisRow(page: Page, name: string): Locator {
	return page
		.getByRole('listitem')
		.filter({ has: page.getByRole('link', { name, exact: true }) });
}

async function holdCbgmWitnesses(page: Page): Promise<void> {
	await page.addInitScript(key => {
		const post = Worker.prototype.postMessage;
		const held: Array<() => void> = [];
		Worker.prototype.postMessage = function (this: Worker, ...args: unknown[]) {
			const send = () => post.apply(this, args as Parameters<Worker['postMessage']>);
			const holding = sessionStorage.getItem(key) === 'on';
			if (holding && (args[0] as { type?: string })?.type === 'compute-witness') {
				held.push(send);
			} else {
				send();
			}
		};
		Object.assign(window, {
			releaseCbgmWitness: () => held.shift()?.(),
			releaseCbgmComputation: () => {
				sessionStorage.removeItem(key);
				for (const send of held.splice(0)) send();
			},
		});
	}, HOLD_KEY);
}

async function seedProject(page: Page): Promise<void> {
	const contents = collations.map((document, index) => ({
		id: document.meta.collationId,
		project_id: PROJECT_ID,
		title: `Collation ${document.setup.segment.name}`,
		verse_identifier: document.setup.segment.name,
		status: 'stemma',
		group_path: '',
		notes: '',
		sort_key: index,
		document,
	}));
	const heads = contents.map(content => ({
		collation_id: content.id,
		current_revision: null,
		title: content.title,
		verse_identifier: content.verse_identifier,
		primary_path: `collations/${content.id}.json`,
	}));
	const manifest = {
		id: PROJECT_ID,
		name: 'CBGM fixture',
		description: '',
		charter: '',
		collation_settings: {},
		forked_from: null,
		manifest_content_hash: await hashCanonicalPayload({
			project_id: PROJECT_ID,
			transcriptions: [],
			collations: heads,
			tombstones: [],
		}),
		transcriptions: [],
		collations: heads,
		tombstones: [],
		created_at: SEEDED_AT,
		updated_at: SEEDED_AT,
	};
	const folder = 'apatosaurus/v1/projects/cbgm-fixture';
	const files = [
		{
			path: `${folder}/project.json`,
			content: serializeSealedDocument(
				await sealDocument('apatosaurus.project-manifest', 2, manifest)
			),
		},
		...(await Promise.all(
			contents.map(async content => ({
				path: `${folder}/collations/${content.id}.json`,
				content: serializeSealedDocument(
					await sealDocument('apatosaurus.collation', 9, {
						...content,
						based_on_checkpoint: null,
						draft: { saved_at: SEEDED_AT, author_name: null },
						created_at: SEEDED_AT,
						updated_at: SEEDED_AT,
					})
				),
			}))
		)),
	];

	// Seed before the app first opens its index, so the index is built from these files.
	await page.route('**/__seed', route =>
		route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Seed</title>' })
	);
	await page.goto('/__seed');
	await page.evaluate(async files => {
		const root = await navigator.storage.getDirectory();
		for (const file of files) {
			const parts = file.path.split('/');
			const name = parts.pop()!;
			let directory = root;
			for (const part of parts)
				directory = await directory.getDirectoryHandle(part, { create: true });
			const writer = await (
				await directory.getFileHandle(name, { create: true })
			).createWritable();
			await writer.write(file.content);
			await writer.close();
		}
	}, files);
}
