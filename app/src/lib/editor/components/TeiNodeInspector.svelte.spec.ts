import { page } from '@vitest/browser/context';
import { expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import TeiNodeInspector from './TeiNodeInspector.svelte';

it('resets drafts when selecting another node with identical attributes', async () => {
	const attrs = { unit: 'chars', extent: '3' };
	const view = render(TeiNodeInspector, {
		selectedNode: { pos: 1, type: 'gap', attrs },
		onUpdateNodeAttrs: vi.fn(),
	});
	const extent = page.getByRole('textbox', { name: 'Extent', exact: true });
	await expect.element(extent).toHaveValue('3');
	await extent.fill('7');
	await view.rerender({ selectedNode: { pos: 10, type: 'gap', attrs: { ...attrs } } });
	await expect.element(extent).toHaveValue('3');
	await extent.fill('9');
	await view.rerender({
		selectedNode: { pos: 10, type: 'gap', attrs: { ...attrs, extent: '4' } },
	});
	await expect.element(extent).toHaveValue('9');
});
