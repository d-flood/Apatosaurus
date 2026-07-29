import { mount, tick, unmount } from 'svelte';
import { describe, expect, it } from 'vitest';

import CorrectionWorkspace from './CorrectionWorkspace.svelte';
import type { Correction } from './types';

const corrections: Correction[] = [
	{ hand: 'first', content: [{ type: 'text', text: 'one' }] },
	{ hand: 'second', content: [{ type: 'text', text: 'two' }] },
	{ hand: 'third', content: [{ type: 'text', text: 'three' }] },
];

async function mountWorkspace() {
	const container = document.createElement('div');
	document.body.append(container);
	const applied: Correction[][] = [];
	const component = mount(CorrectionWorkspace, {
		target: container,
		props: {
			idPrefix: 'correction-workspace-spec',
			title: 'Correction readings',
			initialCorrections: corrections,
			onApply: next => applied.push(next),
		},
	});
	await new Promise(resolve => setTimeout(resolve, 30));
	return {
		container,
		applied,
		dispose: () => {
			void unmount(component);
			container.remove();
		},
	};
}

function readingCards(container: ParentNode): HTMLElement[] {
	return Array.from(container.querySelectorAll('button'))
		.filter(element => element.textContent?.includes('Edit'))
		.map(element => element.closest<HTMLElement>('.rounded.border') as HTMLElement);
}

function clickButton(card: HTMLElement, label: string) {
	const button = Array.from(card.querySelectorAll('button')).find(element =>
		element.textContent?.includes(label)
	);
	if (!button) throw new Error(`no ${label} button`);
	button.click();
}

function removeReading(card: HTMLElement) {
	const button = card.querySelectorAll('button')[1];
	if (!button) throw new Error('no Remove button');
	button.click();
}

function setHand(container: ParentNode, hand: string) {
	const input = container.querySelector<HTMLInputElement>('input[placeholder="corrector"]');
	if (!input) throw new Error('no hand input');
	input.value = hand;
	input.dispatchEvent(new Event('input', { bubbles: true }));
}

function button(container: ParentNode, label: string): HTMLButtonElement {
	const result = Array.from(container.querySelectorAll('button')).find(element =>
		element.textContent?.includes(label)
	);
	if (!result) throw new Error(`no ${label} button`);
	return result;
}

describe('CorrectionWorkspace reading identity', () => {
	it('saves reading 2 after reading 1 is removed', async () => {
		const harness = await mountWorkspace();
		try {
			clickButton(readingCards(harness.container)[1], 'Edit');
			await tick();
			removeReading(readingCards(harness.container)[0]);
			await tick();
			setHand(harness.container, 'updated second');
			await tick();
			button(harness.container, 'Save Reading').click();
			await tick();
			button(harness.container, 'Apply').click();

			expect(harness.applied.at(-1)?.map(reading => reading.hand)).toEqual([
				'updated second',
				'third',
			]);
		} finally {
			harness.dispose();
		}
	});

	it('saves the last reading after reading 1 is removed', async () => {
		const harness = await mountWorkspace();
		try {
			clickButton(readingCards(harness.container)[2], 'Edit');
			await tick();
			removeReading(readingCards(harness.container)[0]);
			await tick();
			setHand(harness.container, 'updated third');
			await tick();
			button(harness.container, 'Save Reading').click();
			await tick();
			button(harness.container, 'Apply').click();

			expect(harness.applied.at(-1)?.map(reading => reading.hand)).toEqual([
				'second',
				'updated third',
			]);
		} finally {
			harness.dispose();
		}
	});

	it('closes the draft when the reading under edit is removed', async () => {
		const harness = await mountWorkspace();
		try {
			clickButton(readingCards(harness.container)[1], 'Edit');
			await tick();
			removeReading(readingCards(harness.container)[1]);
			await tick();

			expect(button(harness.container, 'Add Reading')).toBeTruthy();
			expect(
				harness.container.querySelector<HTMLInputElement>('input[placeholder="corrector"]')
					?.value
			).toBe('');
		} finally {
			harness.dispose();
		}
	});
});
