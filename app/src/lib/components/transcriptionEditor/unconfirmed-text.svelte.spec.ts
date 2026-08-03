import { page, userEvent } from '@vitest/browser/context';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';

import UnconfirmedTextHarness from './UnconfirmedTextHarness.svelte';

const browserPage = page as any;

function compactXml(xml: string): string {
	return xml.replace(/\s+/g, '');
}

async function exportedXml(): Promise<string> {
	return browserPage.getByTestId('exported-xml').element().textContent || '';
}

async function pasteSample() {
	await browserPage.getByTestId('paste-sample').click();
	await expect.element(browserPage.getByTestId('exported-xml')).toHaveTextContent('alpha');
}

describe('unconfirmed text', () => {
	it('marks pasted plain text in exported TEI', async () => {
		render(UnconfirmedTextHarness);
		await pasteSample();

		expect(compactXml(await exportedXml())).toContain(
			compactXml(
				'<w><seg type="unconfirmed">alpha</seg></w><w><seg type="unconfirmed">beta</seg></w><w><seg type="unconfirmed">gamma</seg></w>'
			)
		);
	});

	it('clears only the edited word and keeps neighbouring words unconfirmed', async () => {
		render(UnconfirmedTextHarness);
		await pasteSample();
		await browserPage.getByTestId('select-middle-word').click();
		await userEvent.keyboard('edited');

		const xml = compactXml(await exportedXml());
		expect(xml).toContain('<w><segtype="unconfirmed">alpha</seg></w>');
		expect(xml).toContain('<w>edited</w>');
		expect(xml).toContain('<w><segtype="unconfirmed">gamma</seg></w>');
	});

	it('does not mark text typed immediately after an unconfirmed run', async () => {
		render(UnconfirmedTextHarness);
		await pasteSample();
		await browserPage.getByTestId('editor-content').click();
		await userEvent.keyboard(' delta');

		const xml = compactXml(await exportedXml());
		expect(xml).toContain(
			'<w><segtype="unconfirmed">alpha</seg></w><w><segtype="unconfirmed">beta</seg></w><w><segtype="unconfirmed">gamma</seg></w>'
		);
		expect(xml).toContain('<w>delta</w>');
		expect(xml).not.toContain('<w><segtype="unconfirmed">delta</seg></w>');
	});
});
