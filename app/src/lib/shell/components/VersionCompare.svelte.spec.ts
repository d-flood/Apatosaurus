import { page } from '@vitest/browser/context';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';

import type { ComparePart } from '$lib/shell/version-compare';
import VersionCompare from './VersionCompare.svelte';

const browserPage = page as any;

const parts: ComparePart[] = [
	{ key: 'John 1:1', label: 'John 1:1', left: 'en arche', right: 'en arche', differs: false },
	{ key: 'John 1:2', label: 'John 1:2', left: 'houtos en', right: 'houtos hn', differs: true },
	{ key: 'John 1:3', label: 'John 1:3', left: null, right: 'panta', differs: true },
];

describe('VersionCompare', () => {
	it('shows both sides, highlights differing parts and collapses unchanged ones', async () => {
		render(VersionCompare, {
			parts,
			leftLabel: 'Version 1',
			rightLabel: 'Current',
			format: (value: unknown) => String(value),
		});

		await expect
			.element(browserPage.getByTestId('version-compare-summary'))
			.toHaveTextContent('2 of 3 parts differ');
		const rendered = browserPage.getByTestId('compare-part');
		await expect.element(rendered.nth(0)).not.toHaveAttribute('open');
		await expect.element(rendered.nth(0)).toHaveAttribute('data-differs', 'false');
		await expect.element(rendered.nth(1)).toHaveAttribute('open');
		await expect.element(rendered.nth(1)).toHaveAttribute('data-differs', 'true');
		await expect.element(rendered.nth(1).getByText('houtos en')).toBeVisible();
		await expect.element(rendered.nth(1).getByText('houtos hn')).toBeVisible();
		await expect.element(rendered.nth(2).getByText('Not present')).toBeVisible();
		expect(browserPage.getByRole('radio').elements()).toHaveLength(0);
	});
});
