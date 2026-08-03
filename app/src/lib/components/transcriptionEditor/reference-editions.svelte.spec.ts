import { page, userEvent } from '@vitest/browser/context';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';

import ReferenceEditionHarness from './ReferenceEditionHarness.svelte';

const browserPage = page as any;

function compactXml(xml: string): string {
	return xml.replace(/\s+/g, '');
}

async function exportedXml(): Promise<string> {
	return browserPage.getByTestId('exported-xml').element().textContent || '';
}

describe('reference edition seeding', () => {
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
});
