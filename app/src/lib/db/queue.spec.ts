import { describe, expect, it } from 'vitest';
import { BACKGROUND_AGING_MS, createExclusiveQueue, type QueuePriority } from './queue';

function harness() {
	let clock = 0;
	const exclusive = createExclusiveQueue(() => clock);
	const order: string[] = [];
	const gates = new Map<string, () => void>();
	const submit = (name: string, priority: QueuePriority) =>
		exclusive(async () => {
			order.push(`start ${name}`);
			await new Promise<void>(release => gates.set(name, release));
			order.push(`end ${name}`);
			return name;
		}, priority);
	const release = async (name: string) => {
		await waitFor(() => gates.has(name));
		gates.get(name)!();
	};
	return {
		order,
		submit,
		release,
		advance: (ms: number) => (clock += ms),
	};
}

async function waitFor(condition: () => boolean) {
	for (let tick = 0; tick < 100 && !condition(); tick++) await Promise.resolve();
	if (!condition()) throw new Error('condition never held');
}

describe('exclusive queue', () => {
	it('runs a user section submitted while background sections wait before them', async () => {
		const { order, submit, release } = harness();
		const running = submit('background-1', 'background');
		const waiting = [
			submit('background-2', 'background'),
			submit('background-3', 'background'),
		];
		const user = submit('user', 'user');

		await release('background-1');
		await release('user');
		await release('background-2');
		await release('background-3');
		await Promise.all([running, ...waiting, user]);

		expect(order.filter(entry => entry.startsWith('start'))).toEqual([
			'start background-1',
			'start user',
			'start background-2',
			'start background-3',
		]);
	});

	it('never preempts a running section', async () => {
		const { order, submit, release } = harness();
		const running = submit('background', 'background');
		await waitFor(() => order.length === 1);
		const user = submit('user', 'user');
		await Promise.resolve();

		expect(order).toEqual(['start background']);
		await release('background');
		await release('user');
		await Promise.all([running, user]);
		expect(order).toEqual(['start background', 'end background', 'start user', 'end user']);
	});

	it('runs a background section next once it has waited past the aging limit', async () => {
		const { order, submit, release, advance } = harness();
		const running = submit('user-1', 'user');
		const background = submit('background', 'background');
		const user = submit('user-2', 'user');
		advance(BACKGROUND_AGING_MS + 1);

		await release('user-1');
		await release('background');
		await release('user-2');
		await Promise.all([running, background, user]);

		expect(order.filter(entry => entry.startsWith('start'))).toEqual([
			'start user-1',
			'start background',
			'start user-2',
		]);
	});

	it('lets a waiting user section run after one aged background section, not after the backlog', async () => {
		const { order, submit, release, advance } = harness();
		const running = submit('user-long', 'user');
		const backlog = [
			submit('background-1', 'background'),
			submit('background-2', 'background'),
			submit('background-3', 'background'),
		];
		const user = submit('user-waiting', 'user');
		advance(BACKGROUND_AGING_MS + 1_000);

		await release('user-long');
		await release('background-1');
		await release('user-waiting');
		await release('background-2');
		await release('background-3');
		await Promise.all([running, ...backlog, user]);

		expect(order.filter(entry => entry.startsWith('start'))).toEqual([
			'start user-long',
			'start background-1',
			'start user-waiting',
			'start background-2',
			'start background-3',
		]);
	});

	it('runs sections of one class first in, first out', async () => {
		const { order, submit, release } = harness();
		const sections = [
			submit('user-1', 'user'),
			submit('background-1', 'background'),
			submit('user-2', 'user'),
			submit('background-2', 'background'),
			submit('user-3', 'user'),
		];
		for (const name of ['user-1', 'user-2', 'user-3', 'background-1', 'background-2'])
			await release(name);

		expect(await Promise.all(sections)).toEqual([
			'user-1',
			'background-1',
			'user-2',
			'background-2',
			'user-3',
		]);
		expect(order.filter(entry => entry.startsWith('start'))).toEqual([
			'start user-1',
			'start user-2',
			'start user-3',
			'start background-1',
			'start background-2',
		]);
	});
});
