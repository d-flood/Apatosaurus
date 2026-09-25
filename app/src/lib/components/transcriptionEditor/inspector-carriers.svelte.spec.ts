import { page } from '@vitest/browser/context';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import { editorColumn, editorLine, editorPlainPage } from '$lib/client/testing/editorFixtures';
import { fromProseMirror, serializeTei } from '$lib/tei/tei-transcription';

import InspectorTestHarness from './InspectorTestHarness.svelte';
import SimpleCarrierInspector from './SimpleCarrierInspector.svelte';

const browserPage = page as any;

function wrapInTei(bodyContent: string): string {
	return `<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <teiHeader></teiHeader>
  <text><body>${bodyContent}</body></text>
</TEI>`;
}

async function selectCarrier(type: string) {
	await browserPage.getByTestId(`select-${type}`).click();
	await expect.element(browserPage.getByTestId('selected-carrier')).toHaveTextContent(type);
}

async function exportedXml(): Promise<string> {
	return browserPage.getByTestId('exported-xml').element().textContent || '';
}

function latestInlineEditor(): Element | null {
	const editors = Array.from(
		document.querySelectorAll('.inline-carrier-editor-input .ProseMirror')
	);
	return editors.at(-1) ?? null;
}

function compactXml(xml: string): string {
	return xml.replace(/\s+/g, '');
}

function setSelectValue(label: string, value: string) {
	const select = document.querySelector(`[aria-label="${label}"]`) as HTMLSelectElement | null;
	if (!select) throw new Error(`Missing select: ${label}`);
	select.value = value;
	select.dispatchEvent(new Event('input', { bubbles: true }));
	select.dispatchEvent(new Event('change', { bubbles: true }));
}

async function replaceTextarea(label: string, value: string) {
	const input = browserPage.getByLabelText(label);
	await input.fill(value);
}

async function fillFormWorkContent(value: string) {
	const editor = (document.querySelector('.ProseMirror') as any)?.editor;
	expect(editor).toBeTruthy();
	let position = -1;
	let size = 0;
	editor.state.doc.descendants((node: any, pos: number) => {
		if (position === -1 && node.type.name === 'fw') {
			position = pos;
			size = node.content.size;
		}
		return position === -1;
	});
	expect(position).toBeGreaterThanOrEqual(0);
	editor.commands.setTextSelection({ from: position + 1, to: position + 1 + size });
	editor.commands.insertContent(value);
}

describe('transcription editor carrier inspectors', () => {
	it('edits teiWrapper, gap, space, handShift, teiMilestone, and untranscribed carriers through the real inspector UI', async () => {
		render(InspectorTestHarness, {
			xml: wrapInTei(
				'<pb n="1r"/><cb n="1"/><lb/>' +
					'<foreign xml:lang="la"><w>ab<lb break="no" facs="#break-zone" xml:id="break1"/>cd</w></foreign>' +
					'<gap reason="lost-folio" unit="chars" extent="2"/>' +
					'<space extent="1" unit="chars" facs="#space-zone" xml:id="space1"/>' +
					'<handShift new="#h2" facs="#hand-zone" resp="#editor"/>' +
					'<milestone unit="section" n="A" facs="#milestone-zone" resp="#editor"/>' +
					'<note type="untranscribed" reason="damage" extent="partial"/>'
			),
		});

		await selectCarrier('teiWrapper');
		await replaceTextarea('Text 1', 'ave');
		await browserPage.getByRole('button', { name: 'Apply' }).click();
		expect(compactXml(await exportedXml())).toContain(
			compactXml(
				'<foreign xml:lang="la"><w>ave<lb break="no" facs="#break-zone" xml:id="break1"/>cd</w></foreign>'
			)
		);

		await selectCarrier('gap');
		await browserPage.getByLabelText('Extent').fill('3');
		await browserPage.getByRole('button', { name: 'Apply' }).click();
		expect(compactXml(await exportedXml())).toContain(
			compactXml('<gap reason="lost-folio" unit="chars" extent="3"/>')
		);

		await selectCarrier('space');
		await browserPage.getByLabelText('Extent').fill('2');
		await browserPage.getByLabelText('Dimension').fill('horizontal');
		await browserPage.getByRole('button', { name: 'Apply' }).click();
		expect(compactXml(await exportedXml())).toContain(
			compactXml(
				'<space extent="2" unit="chars" facs="#space-zone" xml:id="space1" dim="horizontal"/>'
			)
		);

		await selectCarrier('handShift');
		await browserPage.getByLabelText('Hand').fill('#h3');
		await browserPage.getByLabelText('Medium').fill('ink');
		await browserPage.getByRole('button', { name: 'Apply' }).click();
		expect(compactXml(await exportedXml())).toContain(
			compactXml('<handShift new="#h3" facs="#hand-zone" resp="#editor" medium="ink"/>')
		);

		await selectCarrier('teiMilestone');
		await browserPage.getByLabelText('Value').fill('B');
		await browserPage.getByLabelText('Edition').fill('NA28');
		await browserPage.getByRole('button', { name: 'Apply' }).click();
		expect(compactXml(await exportedXml())).toContain(
			compactXml(
				'<milestone unit="section" n="B" facs="#milestone-zone" resp="#editor" ed="NA28"/>'
			)
		);

		await selectCarrier('untranscribed');
		await browserPage.getByLabelText('Reason').fill('illegible');
		await browserPage.getByRole('button', { name: 'Apply' }).click();
		expect(compactXml(await exportedXml())).toContain(
			compactXml('<note type="untranscribed" subtype="illegible" n="partial"/>')
		);
	}, 30_000);

	it('preserves unexposed break attributes when applying a displayed field', async () => {
		let appliedAttrs: Record<string, any> | undefined;
		const rendered = render(SimpleCarrierInspector, {
			type: 'lineBreak',
			attrs: { teiAttrs: { facs: '#break-zone', 'xml:id': 'break1' } },
			onApply: attrs => (appliedAttrs = attrs),
		});

		await browserPage.getByLabelText('Edition').fill('NA28');
		await browserPage.getByRole('button', { name: 'Apply' }).click();

		const pm = {
			type: 'manuscript',
			content: [
				editorPlainPage({
					columns: [
						editorColumn({
							lines: [
								editorLine({
									content: [
										{
											type: 'correctionNode',
											attrs: {
												corrections: [
													{
														hand: 'c1',
														content: [
															{
																type: 'lineBreak',
																attrs: appliedAttrs,
															},
														],
													},
												],
											},
										},
									],
								}),
							],
						}),
					],
				}),
			],
		};
		expect(compactXml(serializeTei(fromProseMirror(pm as any)))).toContain(
			compactXml('<lb facs="#break-zone" xml:id="break1" ed="NA28"/>')
		);

		rendered.unmount();
	});

	it('edits formwork, TEI atoms, and metamarks through inspector components', async () => {
		render(InspectorTestHarness, {
			xml: wrapInTei(
				'<pb n="1r"/><cb n="1"/><lb/>' +
					'<seg type="margin" subtype="lineright" n="@P1"><fw place="margin right"/></seg>' +
					'<note place="margin">aside</note>' +
					'<metamark function="omission" target="#omit1"/>'
			),
		});

		await selectCarrier('fw');
		await fillFormWorkContent('updated note');
		await browserPage.getByRole('button', { name: 'Apply' }).click();
		expect(compactXml(await exportedXml())).toMatch(
			/<segtype="margin"subtype="lineright"n="@P1"><fwplace="marginright"><w>updated<\/w><w>note<\/w><\/fw><\/seg>/
		);

		await selectCarrier('teiAtom');
		await browserPage.getByLabelText('Note Type').fill('local');
		await replaceTextarea('Text Content', 'annotated aside');
		await browserPage.getByRole('button', { name: 'Apply' }).click();
		expect(compactXml(await exportedXml())).toContain(
			compactXml('<note place="margin" type="local">annotated aside</note>')
		);

		await selectCarrier('metamark');
		setSelectValue('Function', 'transposition');
		await browserPage.getByRole('button', { name: 'Apply' }).click();
		expect(compactXml(await exportedXml())).toContain(
			compactXml('<metamark function="transposition" target="#omit1"/>')
		);
	});

	it(
		'preserves correctionNode reading metadata and its segment when editing content',
		{ timeout: 60_000 },
		async () => {
		render(InspectorTestHarness, {
			xml: wrapInTei('<pb n="1r"/><cb n="1"/><lb/>'),
			seedNodes: [
				{
					type: 'correctionNode',
					attrs: {
						corrections: [
							{
								hand: 'c2',
								content: [{ type: 'text', text: 'alpha' }],
								rend: 'superscript',
								readingAttrs: {
									type: 'alt',
									rend: 'superscript',
									source: '#src1',
									resp: '#editor',
								},
								type: 'margin',
								position: 'pagetop',
								segmentAttrs: {
									type: 'margin',
									subtype: 'pagetop',
									n: '@P1',
									'xml:id': 'seg1',
								},
							},
						],
					},
				},
			],
		});

		await selectCarrier('correctionNode');
		await browserPage.getByRole('button', { name: 'Edit', exact: true }).click();
		const correctionEditorElement = latestInlineEditor();
		expect(correctionEditorElement).toBeTruthy();
		const correctionEditor = browserPage.elementLocator(correctionEditorElement!);
		await correctionEditor.click();
		await correctionEditor.fill('beta');
		// The fill resolves once the keystrokes are dispatched; the editor applies
		// them in a later transaction, so wait for the content before saving.
		await vi.waitFor(() => expect.element(correctionEditor).toHaveTextContent('beta'), {
			timeout: 30_000,
		});
		await browserPage.getByRole('button', { name: 'Save Reading' }).click();
		await browserPage.getByRole('button', { name: 'Apply to Node' }).click();
		expect(compactXml(await exportedXml())).toMatch(
			/<rdgtype="alt"hand="c2"rend="superscript"source="#src1"resp="#editor"><segtype="margin"subtype="pagetop"n="@P1"xml:id="seg1"><w>[^<]*beta[^<]*<\/w><\/seg><\/rdg>/
		);
	});
});
