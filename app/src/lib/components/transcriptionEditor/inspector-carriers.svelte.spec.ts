import { page } from '@vitest/browser/context';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';

import InspectorTestHarness from './InspectorTestHarness.svelte';

const browserPage = page as any;

function toolbar(id: string) {
	const element = document.getElementById(id);
	if (!element) throw new Error(`Missing toolbar: ${id}`);
	return browserPage.elementLocator(element);
}

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
	const editors = Array.from(document.querySelectorAll('.inline-carrier-editor-input .ProseMirror'));
	return editors.at(-1) ?? null;
}

function compactXml(xml: string): string {
	return xml.replace(/\s+/g, '');
}

function setInputValue(id: string, value: string) {
	const input = document.getElementById(id) as HTMLInputElement | null;
	if (!input) throw new Error(`Missing input: ${id}`);
	input.value = value;
	input.dispatchEvent(new Event('input', { bubbles: true }));
	input.dispatchEvent(new Event('change', { bubbles: true }));
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

async function fillInlineCarrierEditor(value: string) {
	const editorElement = document.querySelector('.inline-carrier-editor-input .ProseMirror') as
		| Element
		| null;
	expect(editorElement).toBeTruthy();
	const editorLocator = browserPage.elementLocator(editorElement!);
	await editorLocator.click();
	await editorLocator.fill(value);
}

describe('transcription editor carrier inspectors', () => {
	it('edits teiWrapper, gap, space, handShift, teiMilestone, and untranscribed carriers through the real inspector UI', async () => {
		render(InspectorTestHarness, {
			xml: wrapInTei(
				'<pb n="1r"/><cb n="1"/><lb/>' +
					'<foreign xml:lang="la"><w>ab<lb break="no"/>cd</w></foreign>' +
					'<gap reason="lost-folio" unit="chars" extent="2"/>' +
					'<space extent="1" unit="chars"/>' +
					'<handShift new="#h2"/>' +
					'<milestone unit="section" n="A"/>' +
					'<note type="untranscribed" reason="damage" extent="partial"/>'
			),
		});

		await selectCarrier('teiWrapper');
		await replaceTextarea('Text 1', 'ave');
		await browserPage.getByRole('button', { name: 'Apply' }).click();
		expect(compactXml(await exportedXml())).toContain(
			compactXml('<foreign xml:lang="la"><w>ave<lb break="no"/>cd</w></foreign>')
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
			compactXml('<space unit="chars" extent="2" dim="horizontal"/>')
		);

		await selectCarrier('handShift');
		await browserPage.getByLabelText('Hand').fill('#h3');
		await browserPage.getByLabelText('Medium').fill('ink');
		await browserPage.getByRole('button', { name: 'Apply' }).click();
		expect(compactXml(await exportedXml())).toContain(
			compactXml('<handShift new="#h3" medium="ink"/>')
		);

		await selectCarrier('teiMilestone');
		await browserPage.getByLabelText('Value').fill('B');
		await browserPage.getByLabelText('Edition').fill('NA28');
		await browserPage.getByRole('button', { name: 'Apply' }).click();
		expect(compactXml(await exportedXml())).toContain(
			compactXml('<milestone unit="section" n="B" ed="NA28"/>')
		);

		await selectCarrier('untranscribed');
		await browserPage.getByLabelText('Reason').fill('illegible');
		await browserPage.getByRole('button', { name: 'Apply' }).click();
		expect(compactXml(await exportedXml())).toContain(
			compactXml('<note type="untranscribed" subtype="illegible" n="partial"/>')
		);
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
		await fillInlineCarrierEditor('updated note');
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

	it('edits correctionNode through the correction workspace inspector', async () => {
		render(InspectorTestHarness, {
			xml: wrapInTei('<pb n="1r"/><cb n="1"/><lb/>'),
			seedNodes: [{ type: 'correctionNode', attrs: { corrections: [] } }],
		});

		await selectCarrier('correctionNode');
		await browserPage.getByRole('textbox', { name: 'Hand', exact: true }).fill('corrector2');
		const correctionEditorElement = latestInlineEditor();
		expect(correctionEditorElement).toBeTruthy();
		const correctionEditor = browserPage.elementLocator(correctionEditorElement!);
		await correctionEditor.click();
		await correctionEditor.fill('gamma');
		await browserPage.getByRole('button', { name: 'Add Reading' }).click();
		await browserPage.getByRole('button', { name: 'Apply to Node' }).click();
		expect(compactXml(await exportedXml())).toContain(
			compactXml('<rdg type="corr" hand="corrector2"><w>gamma</w></rdg>')
		);
	});

	it('allows nested correction nodes inside marginalia through the dedicated inline workspace', async () => {
		render(InspectorTestHarness, {
			xml: wrapInTei(
				'<pb n="1r"/><cb n="1"/><lb/>' +
					'<seg type="margin" subtype="lineright" n="@P1"><fw place="margin right"/></seg>'
			),
		});

		await selectCarrier('fw');
		await toolbar('inline-carrier-toolbar')
			.getByRole('button', { name: 'Insert Scribal Correction' })
			.click();
		await expect.element(browserPage.getByText('Scribal Corrections')).toBeInTheDocument();
		await browserPage.getByRole('textbox', { name: 'Hand', exact: true }).fill('corrector2');
		const correctionEditorElement = latestInlineEditor();
		expect(correctionEditorElement).toBeTruthy();
		const correctionEditor = browserPage.elementLocator(correctionEditorElement!);
		await correctionEditor.click();
		await correctionEditor.fill('gamma');
		await browserPage.getByRole('button', { name: 'Add Reading' }).click();
		await browserPage.getByRole('button', { name: 'Apply to Node' }).click();
		await browserPage.getByRole('button', { name: 'Apply' }).click();

		expect(compactXml(await exportedXml())).toContain(
			compactXml(
				'<seg type="margin" subtype="lineright" n="@P1"><fw place="margin right"><app><rdg type="orig" hand="firsthand"/><rdg type="corr" hand="corrector2"><w>gamma</w></rdg></app></fw></seg>'
			)
		);
	});

	it('inserts marginalia line and column breaks plus hand shifts through the inline workspace', async () => {
		render(InspectorTestHarness, {
			xml: wrapInTei(
				'<pb n="1r"/><cb n="1"/><lb/>' +
					'<seg type="margin" subtype="lineright" n="@P1"><fw place="margin right"/></seg>'
			),
		});

		await selectCarrier('fw');
		const nestedToolbar = toolbar('inline-carrier-toolbar');
		await nestedToolbar.getByRole('button', { name: 'Split Into New Column' }).click();
		const nestedEditorElement = latestInlineEditor();
		expect(nestedEditorElement).toBeTruthy();
		(nestedEditorElement as HTMLElement).focus();
		nestedEditorElement!.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
		);

		await nestedToolbar.getByLabelText('Change of Scribe').click();
		const handInput = document.getElementById(
			'inline-carrier-toolbar-hand-shift-target-input'
		) as HTMLInputElement | null;
		expect(handInput).toBeTruthy();
		handInput!.value = '#corrector1';
		handInput!.dispatchEvent(new Event('input', { bubbles: true }));
		handInput!.dispatchEvent(new Event('change', { bubbles: true }));
		const mediumInput = document.getElementById(
			'inline-carrier-toolbar-hand-shift-medium-input'
		) as HTMLInputElement | null;
		expect(mediumInput).toBeTruthy();
		mediumInput!.value = 'ink';
		mediumInput!.dispatchEvent(new Event('input', { bubbles: true }));
		mediumInput!.dispatchEvent(new Event('change', { bubbles: true }));
		const applyHandShiftButton = document.querySelector(
			'#inline-carrier-toolbar-popover-hand-shift .btn-neutral'
		) as Element | null;
		expect(applyHandShiftButton).toBeTruthy();
		await browserPage.elementLocator(applyHandShiftButton!).click();
		const applyButtons = Array.from(document.querySelectorAll('button')).filter(
			button => button.textContent?.trim() === 'Apply'
		);
		expect(applyButtons.length).toBeGreaterThan(0);
		await browserPage.elementLocator(applyButtons[applyButtons.length - 1]!).click();

		expect(compactXml(await exportedXml())).toContain(
			compactXml(
				'<seg type="margin" subtype="lineright" n="@P1"><fw place="margin right"><cb/><lb/><handShift new="#corrector1" medium="ink"/></fw></seg>'
			)
		);
	});

	it('inserts editor note atoms through the inline workspace toolbar', async () => {
		render(InspectorTestHarness, {
			xml: wrapInTei(
				'<pb n="1r"/><cb n="1"/><lb/>' +
					'<seg type="margin" subtype="lineright" n="@P1"><fw place="margin right"/></seg>'
			),
		});

		await selectCarrier('fw');
		const nestedToolbar = toolbar('inline-carrier-toolbar');
		await nestedToolbar.getByLabelText('Insert Editor Note').click();
		setInputValue('inline-carrier-toolbar-note-type-select', 'local');
		setInputValue('inline-carrier-toolbar-note-text-input', 'check this hand');
		await browserPage.getByRole('button', { name: 'Insert Note' }).click();
		const applyButtons = Array.from(document.querySelectorAll('button')).filter(
			button => button.textContent?.trim() === 'Apply'
		);
		expect(applyButtons.length).toBeGreaterThan(0);
		await browserPage.elementLocator(applyButtons[applyButtons.length - 1]!).click();

		expect(compactXml(await exportedXml())).toContain(
			compactXml(
				'<seg type="margin" subtype="lineright" n="@P1"><fw place="margin right"><note type="local">check this hand</note></fw></seg>'
			)
		);
	});

	it('handles a mixed carrier document with multiple inspector edits before export', async () => {
		render(InspectorTestHarness, {
			xml: wrapInTei(
				'<pb n="1r"/><cb n="1"/><lb/>' +
					'<foreign xml:lang="la"><w>ab<lb break="no"/>cd</w></foreign>' +
					'<seg type="margin" subtype="lineright" n="@P1"><fw place="margin right"/></seg>' +
					'<gap reason="lost-folio" unit="chars" extent="2"/>' +
					'<note place="margin">aside</note>' +
					'<metamark function="omission" target="#omit1"/>'
			),
		});

		await selectCarrier('teiWrapper');
		await replaceTextarea('Text 1', 'nova');
		await browserPage.getByRole('button', { name: 'Apply' }).click();

		await selectCarrier('fw');
		await fillInlineCarrierEditor('margin note');
		await browserPage.getByRole('button', { name: 'Apply' }).click();

		await selectCarrier('gap');
		await browserPage.getByLabelText('Reason').selectOptions('Illegible');
		await browserPage.getByLabelText('Extent').fill('4');
		await browserPage.getByRole('button', { name: 'Apply' }).click();

		await selectCarrier('teiAtom');
		await browserPage.getByLabelText('Note Type').fill('local');
		await replaceTextarea('Text Content', 'reviewed aside');
		await browserPage.getByRole('button', { name: 'Apply' }).click();

		await selectCarrier('metamark');
		setSelectValue('Function', 'insertion');
		await browserPage.getByRole('button', { name: 'Apply' }).click();

		const xml = await exportedXml();
		expect(compactXml(xml)).toContain(
			compactXml('<foreign xml:lang="la"><w>nova<lb break="no"/>cd</w></foreign>')
		);
		expect(compactXml(xml)).toMatch(
			/<segtype="margin"subtype="lineright"n="@P1"><fwplace="marginright"><w>margin<\/w><w>note<\/w><\/fw><\/seg>/
		);
		expect(compactXml(xml)).toContain(compactXml('<gap reason="Illegible" unit="chars" extent="4"/>'));
		expect(compactXml(xml)).toContain(
			compactXml('<note place="margin" type="local">reviewed aside</note>')
		);
		expect(compactXml(xml)).toContain(compactXml('<metamark function="insertion" target="#omit1"/>'));
	});
});
