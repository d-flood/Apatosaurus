import { page } from '@vitest/browser/context';
import { expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import FormWorkInspector from './FormWorkInspector.svelte';

it('keeps an applied marginalia placement when applying again', async () => {
	const onApply = vi.fn();
	const view = render(FormWorkInspector, {
		attrs: {
			type: 'commentary',
			place: 'margin left',
			segType: 'margin',
			segSubtype: 'lineleft',
			segPlace: 'margin left',
		},
		onApply,
	});
	const placement = page.getByRole('combobox', { name: 'Placement' });
	const apply = page.getByRole('button', { name: 'Apply' });
	await placement.selectOptions('lineRight');
	await apply.click();
	const applied = onApply.mock.lastCall![0];
	expect(applied).toMatchObject({ place: 'margin right', segSubtype: 'lineright' });
	await view.rerender({ attrs: applied });
	await apply.click();
	expect(onApply.mock.lastCall![0]).toMatchObject({
		place: 'margin right',
		segSubtype: 'lineright',
	});
});
