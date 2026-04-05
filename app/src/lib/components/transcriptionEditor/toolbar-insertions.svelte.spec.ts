import { page } from '@vitest/browser/context';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';

import ToolbarInsertionHarness from './ToolbarInsertionHarness.svelte';

const browserPage = page as any;

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

function toolbar(id: string) {
	const element = document.getElementById(id);
	if (!element) throw new Error(`Missing toolbar: ${id}`);
	return browserPage.elementLocator(element);
}

async function exportedXml(): Promise<string> {
	return browserPage.getByTestId('exported-xml').element().textContent || '';
}

describe('transcription editor toolbar insertions', () => {
	it('inserts the carrier-first authoring set through real toolbar affordances', async () => {
		render(ToolbarInsertionHarness);
		const mainToolbar = toolbar('editor-toolbar');

		await mainToolbar.getByLabelText('Insert Lacuna').click();
		setInputValue('editor-toolbar-gap-unit-input', 'chars');
		setInputValue('editor-toolbar-gap-extent-input', '3');
		await browserPage.getByText('Insert Lacuna').click();
		expect(browserPage.getByTestId('selected-carrier').element().textContent).toBe('gap');

		await mainToolbar.getByLabelText('Insert Lacuna').click();
		setInputValue('editor-toolbar-space-unit-input', 'chars');
		setInputValue('editor-toolbar-space-extent-input', '2');
		await browserPage.getByRole('button', { name: 'Insert Space' }).click();
		expect(browserPage.getByTestId('selected-carrier').element().textContent).toBe('space');

		await mainToolbar.getByLabelText('Change of Scribe').click();
		setInputValue('editor-toolbar-hand-shift-target-input', '#corrector1');
		setInputValue('editor-toolbar-hand-shift-medium-input', 'ink');
		await browserPage.getByText('Change of Scribe').click();
		expect(browserPage.getByTestId('selected-carrier').element().textContent).toBe('handShift');

		await mainToolbar.getByLabelText('Insert Editor Note').click();
		setInputValue('editor-toolbar-note-type-select', 'local');
		setInputValue('editor-toolbar-note-text-input', 'Needs review');
		await browserPage.getByRole('button', { name: 'Insert Note' }).click();
		expect(browserPage.getByTestId('selected-carrier').element().textContent).toBe('teiAtom');

		await mainToolbar.getByRole('button', { name: 'Insert Marginalia' }).click();
		expect(browserPage.getByTestId('selected-carrier').element().textContent).toBe('fw');

		await browserPage.getByTestId('select-sample-text').click();
		await mainToolbar.getByLabelText('Insert Scribal Mark').click();
		setInputValue('editor-toolbar-metamark-function-input', 'insertion');
		await browserPage.getByRole('button', { name: /^Insert Mark$|^Apply Mark$/ }).click();

		await browserPage.getByTestId('select-editorial-action').click();
		await expect.element(browserPage.getByTestId('selected-carrier')).toHaveTextContent(
			'editorialAction'
		);
		await mainToolbar.getByLabelText('Insert Scribal Mark').click();
		setInputValue('editor-toolbar-metamark-function-input', 'deletion');
		await browserPage.getByRole('button', { name: /^Insert Mark$|^Apply Mark$/ }).click();
		expect(browserPage.getByTestId('selected-carrier').element().textContent).toBe('metamark');

		await mainToolbar.getByRole('button', { name: 'Insert Scribal Correction' }).click();
		expect(browserPage.getByTestId('selected-carrier').element().textContent).toBe('correctionNode');

		await mainToolbar.getByRole('button', { name: 'Insert Book, Chapter, or Verse' }).click();
		setInputValue('editor-toolbar-tei-milestone-unit-input', 'section');
		setInputValue('editor-toolbar-tei-milestone-value-input', 'A');
		setInputValue('editor-toolbar-tei-milestone-ed-input', 'NA28');
		await browserPage.getByRole('button', { name: 'Insert Reference Marker' }).click();
		expect(browserPage.getByTestId('selected-carrier').element().textContent).toBe('teiMilestone');

		const xml = compactXml(await exportedXml());
		expect(xml).toContain(compactXml('<gap reason="Damage/Loss" unit="chars" extent="3"/>'));
		expect(xml).toContain(compactXml('<space unit="chars" extent="2"/>'));
		expect(xml).toContain(compactXml('<handShift new="#corrector1" medium="ink"/>'));
		expect(xml).toContain(compactXml('<note type="local">Needs review</note>'));
		expect(xml).toContain(
			compactXml(
				'<seg type="margin" subtype="lineright" place="margin right"><fw place="margin right"></fw></seg>'
			)
		);
		expect(xml).toContain(compactXml('<w><metamark function="insertion">ab</metamark></w>'));
		expect(xml).toContain(compactXml('<metamark function="deletion" target="#mod1"/>'));
		expect(xml).toContain(compactXml('<milestone unit="section" n="A" ed="NA28"/>'));
	});
});
