import { page, userEvent } from '@vitest/browser/context';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

const {
	ensureLocalDbRuntime,
	loadReferenceEdition,
	loadUserReferenceEditionXml,
	listUserReferenceEditions,
	registerUserReferenceEdition,
	removeUserReferenceEdition,
	userEntries,
	userXml,
	updateTranscriptionContent,
} = vi.hoisted(() => ({
	ensureLocalDbRuntime: vi.fn(async () => undefined),
	loadReferenceEdition: vi.fn(async () => ({
		units: [
			{
				position: 0,
				label: { book: 'book', chapter: 'chapter', verse: 'verse' },
				content: [
					{ type: 'milestone', kind: 'book', attrs: { book: 'book' } },
					{
						type: 'milestone',
						kind: 'chapter',
						attrs: { book: 'book', chapter: 'chapter' },
					},
					{
						type: 'milestone',
						kind: 'verse',
						attrs: { book: 'book', chapter: 'chapter', verse: 'verse' },
					},
					{ type: 'text', text: 'seeded', marks: [] },
				],
			},
		],
	})),
	userEntries: [] as Array<Record<string, string>>,
	userXml: new Map<string, string>(),
	listUserReferenceEditions: vi.fn(),
	loadUserReferenceEditionXml: vi.fn(),
	registerUserReferenceEdition: vi.fn(),
	removeUserReferenceEdition: vi.fn(),
	updateTranscriptionContent: vi.fn(async (_input: Record<string, any>) => undefined),
}));

vi.mock('$lib/client/db/client', () => ({
	createTranscription: vi.fn(),
	createTranscriptions: vi.fn(),
	ensureDefaultProject: vi.fn(),
	getTranscription: vi.fn(),
	listProjects: vi.fn(),
	updateTranscriptionMetadata: vi.fn(),
	updateTranscriptionContent,
}));
vi.mock('$lib/client/db/runtime', () => ({
	checkpointLocalDb: vi.fn(),
	ensureLocalDbRuntime,
}));

vi.mock('$lib/client/reference-editions/reference-edition-worker', async importOriginal => ({
	...(await importOriginal()),
	loadReferenceEdition,
}));
vi.mock('$lib/client/store/user-reference-editions', () => ({
	listUserReferenceEditions,
	loadUserReferenceEditionXml,
	registerUserReferenceEdition,
	removeUserReferenceEdition,
}));
import { transcriptionDocument } from '$lib/client/testing/editorFixtures';
import {
	mountTranscriptionEditor,
	placeCaretAtEndOf,
	tick,
} from '$lib/client/testing/editorHarnesses.svelte';
import type { StoredTranscriptionDocument } from '$lib/client/transcription/content';
import ReferenceEditionHarness from './ReferenceEditionHarness.svelte';

const browserPage = page as any;

function compactXml(xml: string): string {
	return xml.replace(/\s+/g, '');
}

async function exportedXml(): Promise<string> {
	return browserPage.getByTestId('exported-xml').element().textContent || '';
}

function productionDocument(): StoredTranscriptionDocument {
	return {
		...transcriptionDocument(),
		metadata: {
			title: 'Canonical title',
			transcriber: 'Canonical transcriber',
			repository: 'Canonical repository',
			settlement: 'Canonical settlement',
			language: 'grc',
		},
	};
}

const TRANSCRIPTION_FIELDS = {
	title: 'Record title',
	siglum: 'MS-01',
	transcriber: 'Record transcriber',
	repository: 'Record repository',
	settlement: 'Record settlement',
	language: 'grc',
};

async function seedThroughProductionEditor(container: ParentNode) {
	const lineContent = container.querySelector<HTMLElement>('.line-content');
	if (!lineContent) throw new Error('Production editor line is missing.');
	placeCaretAtEndOf(lineContent);
	await browserPage.getByRole('button', { name: 'Seed', exact: true }).click();
	await expect.element(browserPage.getByTestId('reference-edition-unit-0')).toBeVisible();
	await browserPage.getByTestId('reference-edition-unit-0').click();
	await browserPage.getByTestId('insert-reference-edition').click();
	await tick();
}

describe('reference edition seeding', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		localStorage.clear();
		updateTranscriptionContent.mockClear();
		updateTranscriptionContent.mockResolvedValue(undefined);
		loadReferenceEdition.mockClear();
		userEntries.splice(0);
		userXml.clear();
		listUserReferenceEditions.mockReset();
		listUserReferenceEditions.mockImplementation(async () => [...userEntries]);
		loadUserReferenceEditionXml.mockReset();
		loadUserReferenceEditionXml.mockImplementation(async (entry: { id: string }) => {
			const xml = userXml.get(entry.id);
			if (!xml) throw new Error('User edition XML is missing.');
			return xml;
		});
		registerUserReferenceEdition.mockReset();
		registerUserReferenceEdition.mockImplementation(
			async ({ xml }: { xml: string; fileName: string }) => {
				const entry = {
					id: 'user-uploaded',
					title: 'Local Edition',
					attribution: 'Scholar licence',
					source: 'user',
					storePath: 'app/reference-editions/user-uploaded.json',
				};
				userXml.set(entry.id, xml);
				userEntries.push(entry);
				return entry;
			}
		);
		removeUserReferenceEdition.mockReset();
	});

	it('registers and loads user XML from the picker before seeding it as unconfirmed', async () => {
		render(ReferenceEditionHarness, { useAvailableSource: true });
		await browserPage.getByTestId('open-seed-picker').click();
		const input = document.querySelector<HTMLInputElement>('input[type="file"]');
		if (!input) throw new Error('Edition file input is missing.');
		const xml = `<?xml version="1.0"?>
			<TEI xmlns="http://www.tei-c.org/ns/1.0">
				<teiHeader><fileDesc><titleStmt><title>Local Edition</title></titleStmt></fileDesc></teiHeader>
				<text><body><div type="book" n="local-book"><div type="chapter" n="local-chapter"><ab n="local-verse"><w>uploaded</w></ab></div></div></body></text>
			</TEI>`;
		Object.defineProperty(input, 'files', {
			configurable: true,
			value: [new File([xml], 'local.xml', { type: 'text/xml' })],
		});
		input.dispatchEvent(new Event('change', { bubbles: true }));

		await expect
			.element(browserPage.getByTestId('reference-edition-entry-user-uploaded'))
			.toBeVisible();
		expect(
			browserPage.getByRole('list', { name: 'Reference editions' }).element().textContent
		).toContain('Robinson-Pierpont');
		await expect.element(browserPage.getByTestId('reference-edition-unit-0')).toBeVisible();
		await browserPage.getByTestId('reference-edition-unit-0').click();
		await browserPage.getByTestId('insert-reference-edition').click();

		expect(registerUserReferenceEdition).toHaveBeenCalledWith(
			expect.objectContaining({ xml, fileName: 'local.xml' })
		);
		expect(loadUserReferenceEditionXml).toHaveBeenCalledWith(
			expect.objectContaining({ id: 'user-uploaded' })
		);
		expect(compactXml(await exportedXml())).toContain('<segtype="unconfirmed">uploaded</seg>');
		await expect
			.element(browserPage.getByTestId('editions-used'))
			.toHaveTextContent('user-uploaded');
	});

	it('explains when a referenced edition is not on this device and offers file supply', async () => {
		render(ReferenceEditionHarness, { missingEditionId: 'user-absent' });
		await browserPage.getByTestId('open-seed-picker').click();

		await expect
			.element(browserPage.getByTestId('missing-reference-edition'))
			.toHaveTextContent('not on this device');
		await expect.element(browserPage.getByText('Add edition file')).toBeVisible();
	});

	it('drills through every structural level present in the edition', async () => {
		render(ReferenceEditionHarness);
		await browserPage.getByTestId('open-seed-picker').click();

		await expect.element(browserPage.getByTestId('reference-edition-level-book')).toBeVisible();
		await expect
			.element(browserPage.getByTestId('reference-edition-level-chapter'))
			.toBeVisible();
		await expect
			.element(browserPage.getByTestId('reference-edition-level-verse'))
			.toBeVisible();

		await userEvent.selectOptions(
			browserPage.getByTestId('reference-edition-level-book'),
			'B02'
		);
		await expect.element(browserPage.getByTestId('reference-edition-unit-3')).toBeVisible();
		expect(browserPage.getByTestId('reference-edition-unit-0').query()).toBeNull();
	});

	it('constrains range controls and visible units when drilling into a chapter', async () => {
		render(ReferenceEditionHarness);
		await browserPage.getByTestId('open-seed-picker').click();
		await userEvent.selectOptions(
			browserPage.getByTestId('reference-edition-level-chapter'),
			'B01K2'
		);

		await expect.element(browserPage.getByTestId('reference-edition-unit-2')).toBeVisible();
		expect(browserPage.getByTestId('reference-edition-unit-0').query()).toBeNull();
		const startOptions = Array.from(
			(browserPage.getByTestId('reference-edition-start').element() as HTMLSelectElement)
				.options
		).map(option => option.value);
		expect(startOptions).toEqual(['', '2']);
	});

	it('renders a single flat level for generic unit references', async () => {
		render(ReferenceEditionHarness, { sourceVariant: 'flat' });
		await browserPage.getByTestId('open-seed-picker').click();

		await expect.element(browserPage.getByTestId('reference-edition-level-unit')).toBeVisible();
		expect(browserPage.getByTestId('reference-edition-level-book').query()).toBeNull();
		expect(browserPage.getByTestId('reference-edition-level-chapter').query()).toBeNull();
		expect(browserPage.getByTestId('reference-edition-level-verse').query()).toBeNull();
	});

	it('omits a missing intermediate structural level', async () => {
		render(ReferenceEditionHarness, { sourceVariant: 'missing-chapter' });
		await browserPage.getByTestId('open-seed-picker').click();

		await expect.element(browserPage.getByTestId('reference-edition-level-book')).toBeVisible();
		await expect
			.element(browserPage.getByTestId('reference-edition-level-verse'))
			.toBeVisible();
		expect(browserPage.getByTestId('reference-edition-level-chapter').query()).toBeNull();
	});

	it('previews the selected range and updates when it changes', async () => {
		render(ReferenceEditionHarness);
		await browserPage.getByTestId('open-seed-picker').click();
		await browserPage.getByTestId('reference-edition-unit-0').click();

		await expect
			.element(browserPage.getByTestId('reference-edition-preview'))
			.toHaveTextContent('alpha beta');
		expect(
			browserPage.getByTestId('reference-edition-preview').element().textContent
		).not.toContain('gamma');

		await browserPage.getByTestId('reference-edition-unit-1').click();
		await expect
			.element(browserPage.getByTestId('reference-edition-preview'))
			.toHaveTextContent('gamma');
	});

	it('restores isolated positions when the transcription prop changes on one picker', async () => {
		localStorage.setItem(
			'transcription:second-transcription:reference-edition-picker',
			JSON.stringify({
				entryId: 'robinson-pierpont',
				startPosition: 0,
				endPosition: 0,
				levelSelections: { book: 'B01', chapter: 'B01K1' },
			})
		);
		const view = render(ReferenceEditionHarness, { transcriptionId: 'first-transcription' });
		await browserPage.getByTestId('open-seed-picker').click();
		await browserPage.getByTestId('reference-edition-unit-1').click();

		expect(
			(browserPage.getByTestId('reference-edition-start').element() as HTMLSelectElement)
				.value
		).toBe('1');
		await view.rerender({ transcriptionId: 'second-transcription' });
		await expect.element(browserPage.getByTestId('reference-edition-start')).toHaveValue('0');
		expect(
			(browserPage.getByTestId('reference-edition-start').element() as HTMLSelectElement)
				.value
		).toBe('0');

		await view.rerender({ transcriptionId: 'first-transcription' });
		await expect.element(browserPage.getByTestId('reference-edition-start')).toHaveValue('1');
	});

	it('resets to the catalog default when the next transcription has no saved picker state', async () => {
		userEntries.push({
			id: 'user-previous',
			title: 'Previous User Edition',
			attribution: 'Scholar licence',
			source: 'user',
			storePath: 'app/reference-editions/user-previous.json',
		});
		userXml.set(
			'user-previous',
			`<TEI xmlns="http://www.tei-c.org/ns/1.0"><text><body><ab n="user-verse"><w>previous</w></ab></body></text></TEI>`
		);
		localStorage.setItem(
			'transcription:first-transcription:reference-edition-picker',
			JSON.stringify({
				entryId: 'user-previous',
				startPosition: 0,
				endPosition: 0,
				levelSelections: {},
			})
		);
		const view = render(ReferenceEditionHarness, {
			transcriptionId: 'first-transcription',
			useAvailableSource: true,
		});
		await browserPage.getByTestId('open-seed-picker').click();
		await expect.element(browserPage.getByTestId('reference-edition-start')).toHaveValue('0');

		await view.rerender({
			transcriptionId: 'transcription-without-state',
			useAvailableSource: true,
		});

		await expect
			.poll(() =>
				browserPage
					.getByTestId('reference-edition-entry-robinson-pierpont')
					.element()
					.classList.contains('border-primary')
			)
			.toBe(true);
		await expect.element(browserPage.getByTestId('reference-edition-start')).toHaveValue('');
	});

	it('waits for the user catalog before restoring a saved user edition', async () => {
		let resolveCatalog!: (entries: Array<Record<string, string>>) => void;
		listUserReferenceEditions.mockImplementationOnce(
			() => new Promise(resolve => (resolveCatalog = resolve))
		);
		localStorage.setItem(
			'transcription:user-restoration:reference-edition-picker',
			JSON.stringify({
				entryId: 'user-saved',
				startPosition: 1,
				endPosition: 1,
				levelSelections: { book: 'B01', chapter: 'B01K1' },
			})
		);
		userXml.set(
			'user-saved',
			`<TEI xmlns="http://www.tei-c.org/ns/1.0"><text><body><div type="book" n="B01"><div type="chapter" n="B01K1"><ab n="B01K1V1"><w>first</w></ab><ab n="B01K1V2"><w>restored</w></ab></div></div></body></text></TEI>`
		);
		render(ReferenceEditionHarness, {
			transcriptionId: 'user-restoration',
			useAvailableSource: true,
		});
		await browserPage.getByTestId('open-seed-picker').click();
		expect(browserPage.getByTestId('reference-edition-unit-0').query()).toBeNull();

		resolveCatalog([
			{
				id: 'user-saved',
				title: 'Saved User Edition',
				attribution: 'Scholar licence',
				source: 'user',
				storePath: 'app/reference-editions/user-saved.json',
			},
		]);
		await expect
			.element(browserPage.getByTestId('reference-edition-entry-user-saved'))
			.toBeVisible();
		await expect.element(browserPage.getByTestId('reference-edition-start')).toHaveValue('1');
		expect(loadUserReferenceEditionXml).toHaveBeenCalledWith(
			expect.objectContaining({ id: 'user-saved' })
		);
	});

	it('inserts a positional range with milestones and unconfirmed text', async () => {
		render(ReferenceEditionHarness);
		await browserPage.getByTestId('open-seed-picker').click();
		await expect.element(browserPage.getByTestId('reference-edition-picker')).toBeVisible();
		expect(browserPage.getByTestId('reference-edition-unit-0').element().textContent).toContain(
			'B01 / B01K1 / B01K1V1'
		);
		await browserPage.getByTestId('reference-edition-unit-0').click();
		await browserPage.getByTestId('reference-edition-unit-1').click();
		await browserPage.getByTestId('insert-reference-edition').click();

		const xml = compactXml(await exportedXml());
		expect(xml).toContain('<segtype="unconfirmed">alpha</seg>');
		expect(xml).toContain('<segtype="unconfirmed">beta</seg>');
		expect(xml).toContain('<segtype="unconfirmed">gamma</seg>');
		expect(xml).toContain('<divtype="book"n="B01">');
		expect(xml).toContain('<divtype="chapter"n="B01K1">');
		expect(xml).toContain('<abn="B01K1V1">');
		expect(xml).toContain('<abn="B01K1V2">');
	});

	it('seeds punctuation as unconfirmed content', async () => {
		render(ReferenceEditionHarness);
		await browserPage.getByTestId('open-seed-picker').click();
		await browserPage.getByTestId('reference-edition-unit-0').click();
		await browserPage.getByTestId('insert-reference-edition').click();

		expect(compactXml(await exportedXml())).toContain(
			'<segtype="unconfirmed"><pc>.</pc></seg>'
		);
	});

	it('creates the minimal structure when seeding an empty document', async () => {
		render(ReferenceEditionHarness, { empty: true });
		expect(browserPage.getByTestId('structure-counts').element().textContent).toBe('0/0/0');

		await browserPage.getByTestId('open-seed-picker').click();
		await browserPage.getByTestId('reference-edition-unit-0').click();
		await browserPage.getByTestId('insert-reference-edition').click();

		expect(browserPage.getByTestId('structure-counts').element().textContent).toBe('1/1/1');
		expect(compactXml(await exportedXml())).toContain('<segtype="unconfirmed">alpha</seg>');
	});

	it('keeps nested structured source content unconfirmed with its attributes', async () => {
		render(ReferenceEditionHarness);
		await browserPage.getByTestId('open-seed-picker').click();
		await browserPage.getByTestId('reference-edition-unit-0').click();
		await browserPage.getByTestId('insert-reference-edition').click();

		const xml = compactXml(await exportedXml());
		expect(xml).toContain(
			'<segtype="unconfirmed"><foreignxml:lang="la"><w>locus</w></foreign></seg>'
		);
		expect(xml).toContain('<segtype="unconfirmed"><noteplace="margin">source</note></seg>');
	});

	it('keeps target structure, metadata, and editions-used provenance after editing', async () => {
		render(ReferenceEditionHarness);
		const initialCounts = browserPage.getByTestId('structure-counts').element().textContent;
		const initialMetadata = browserPage.getByTestId('metadata-snapshot').element().textContent;

		await browserPage.getByTestId('open-seed-picker').click();
		await browserPage.getByTestId('reference-edition-unit-0').click();
		await browserPage.getByTestId('insert-reference-edition').click();

		expect(browserPage.getByTestId('structure-counts').element().textContent).toBe(
			initialCounts
		);
		expect(browserPage.getByTestId('metadata-snapshot').element().textContent).toBe(
			initialMetadata
		);
		expect(browserPage.getByTestId('editions-used').element().textContent).toBe(
			'["robinson-pierpont"]'
		);

		await browserPage.getByTestId('select-seeded-text').click();
		await userEvent.keyboard('edited');
		await expect
			.element(browserPage.getByTestId('editions-used'))
			.toHaveTextContent('robinson-pierpont');
		expect(compactXml(await exportedXml())).not.toContain(
			'<segtype="unconfirmed">edited</seg>'
		);
	});

	it('rejects a structure-spanning selection without changing structure', async () => {
		render(ReferenceEditionHarness);
		const initialCounts = browserPage.getByTestId('structure-counts').element().textContent;

		await browserPage.getByTestId('select-structure-span').click();
		await browserPage.getByTestId('open-seed-picker').click();
		await browserPage.getByTestId('reference-edition-unit-0').click();
		await browserPage.getByTestId('insert-reference-edition').click();

		expect(browserPage.getByTestId('structure-counts').element().textContent).toBe(
			initialCounts
		);
		expect(browserPage.getByTestId('editions-used').element().textContent).toBe('[]');
	});

	it('uses the production seed callback and persists provenance with metadata intact', async () => {
		const document = productionDocument();
		const transcription = {
			id: 'production-seed',
			content_json: document,
			format: 'normalized_ast_v3',
			...TRANSCRIPTION_FIELDS,
		} as any;
		const callbackValues: string[][] = [];
		const harness = await mountTranscriptionEditor({
			id: transcription.id,
			document,
			props: {
				transcription,
				onReferenceEditionsUsedChange: (editionIds: string[]) =>
					callbackValues.push([...editionIds]),
			},
		});

		try {
			await seedThroughProductionEditor(harness.container);
			expect(await harness.component.flushPendingAutosave()).toBe(true);

			const persisted = updateTranscriptionContent.mock.calls.at(-1)?.[0]?.document;
			expect(persisted.referenceEditionsUsed).toEqual(['robinson-pierpont']);
			expect(persisted.referenceEditionAttributions).toEqual({
				'robinson-pierpont':
					'Maurice A. Robinson and William G. Pierpont, The New Testament in the Original Greek: The Byzantine Textform (2018), public domain.',
			});
			expect(persisted.metadata).toEqual(document.metadata);
			expect(transcription).toMatchObject(TRANSCRIPTION_FIELDS);
			expect(callbackValues).toEqual([['robinson-pierpont']]);
		} finally {
			harness.dispose();
		}
	});

	it('does not advance production provenance until a failed save is retried successfully', async () => {
		const document = productionDocument();
		const callbackValues: string[][] = [];
		const harness = await mountTranscriptionEditor({
			id: 'production-seed-failure',
			document,
			props: {
				transcription: {
					id: 'production-seed-failure',
					content_json: document,
					format: 'normalized_ast_v3',
					...TRANSCRIPTION_FIELDS,
				} as any,
				onReferenceEditionsUsedChange: (editionIds: string[]) =>
					callbackValues.push([...editionIds]),
			},
		});

		try {
			updateTranscriptionContent.mockRejectedValueOnce(new Error('disk full'));
			await seedThroughProductionEditor(harness.container);
			expect(await harness.component.flushPendingAutosave()).toBe(false);
			expect(callbackValues).toEqual([]);

			updateTranscriptionContent.mockResolvedValue(undefined);
			expect(await harness.component.flushPendingAutosave()).toBe(true);
			expect(callbackValues).toEqual([['robinson-pierpont']]);
			expect(
				updateTranscriptionContent.mock.calls.at(-1)?.[0]?.document.referenceEditionsUsed
			).toEqual(['robinson-pierpont']);
		} finally {
			harness.dispose();
		}
	});
});
