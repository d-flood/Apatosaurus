import { page, userEvent } from '@vitest/browser/context';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

const {
	ensureLocalDbRuntime,
	loadReferenceEdition,
	syncVerseIndexFromDocument,
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
	syncVerseIndexFromDocument: vi.fn(async () => undefined),
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

vi.mock('$lib/client/reference-editions/reference-edition-worker', () => ({
	loadReferenceEdition,
}));
vi.mock('$lib/client/transcription/verse-index', () => ({ syncVerseIndexFromDocument }));

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
		updateTranscriptionContent.mockClear();
		updateTranscriptionContent.mockResolvedValue(undefined);
		loadReferenceEdition.mockClear();
		syncVerseIndexFromDocument.mockClear();
	});

	it('inserts a positional range with milestones and unconfirmed text', async () => {
		render(ReferenceEditionHarness);
		await browserPage.getByTestId('open-seed-picker').click();
		await expect.element(browserPage.getByTestId('reference-edition-picker')).toBeVisible();
		await browserPage.getByTestId('reference-edition-unit-0').click();
		await browserPage.getByTestId('reference-edition-unit-1').click();
		await browserPage.getByTestId('insert-reference-edition').click();

		const xml = compactXml(await exportedXml());
		expect(xml).toContain('<segtype="unconfirmed">alpha</seg>');
		expect(xml).toContain('<segtype="unconfirmed">beta</seg>');
		expect(xml).toContain('<segtype="unconfirmed">gamma</seg>');
		expect(xml).toContain('<divtype="book"n="opaque-book">');
		expect(xml).toContain('<divtype="chapter"n="opaque-book.opaque-chapter">');
		expect(xml).toContain('<abn="opaque-chapter.first">');
		expect(xml).toContain('<abn="opaque-chapter.second">');
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
