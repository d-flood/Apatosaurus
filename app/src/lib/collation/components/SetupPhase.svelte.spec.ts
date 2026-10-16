import { page } from '@vitest/browser/context';
import { expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { collationState } from '../collation-state.svelte';
import SetupPhase from './SetupPhase.svelte';

it('excludes a full manual witness and makes it fragmentary at phone width', async () => {
	const original = { width: window.innerWidth, height: window.innerHeight };
	await page.viewport(390, 844);
	try {
		collationState.reset();
		collationState
			.getManualWitnesses()
			.push({ id: 'full', siglum: 'Syriac', treatment: 'full', includeInCbgm: false });
		render(SetupPhase);
		const include = page.getByRole('checkbox', { name: 'Include manual witness Syriac' });
		await expect.element(include).toBeChecked();
		await include.click();
		expect(collationState.getManualWitnessMembers()).toEqual([]);
		await include.click();
		expect(collationState.getManualWitnessMembers()).toHaveLength(1);
		const treatment = page.getByRole('combobox', {
			name: 'Treatment for manual witness Syriac',
		});
		await treatment.selectOptions('fragmentary');
		expect(collationState.getManualWitnessMembers()).toEqual([]);
		expect(collationState.getManualWitnessOverride('full')).toEqual({
			manualWitnessId: 'full',
			isExcluded: false,
			treatment: 'fragmentary',
		});
		await expect
			.poll(() =>
				[
					...document.querySelectorAll<HTMLElement>(
						'section[aria-label="Manual witnesses"] input, section[aria-label="Manual witnesses"] select'
					),
				].every(element => {
					const rect = element.getBoundingClientRect();
					return rect.left >= 0 && rect.right <= 390;
				})
			)
			.toBe(true);
	} finally {
		collationState.reset();
		await page.viewport(original.width, original.height);
	}
});
