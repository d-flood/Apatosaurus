import { page } from '@vitest/browser/context';
import { afterEach, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

import flows from '../../../../../packages/open-cbgm-wasm/tests/fixtures/default/textual-flow-plain.json';
import { renderDot } from '../render-dot';
import GraphView from './GraphView.svelte';

const dot = flows['B25K1V1U2'].flow;
const nodeLabels = [...dot.matchAll(/^\t+\d+ \[label="([^"]+)"/gm)].map(match => match[1]);

afterEach(() => {
	vi.restoreAllMocks();
});

it('draws a textual flow graph with every witness node label', async () => {
	expect(nodeLabels).toContain('A (a)');
	expect(nodeLabels.length).toBeGreaterThan(100);

	const svg = await renderDot(dot);

	const root = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
	const texts = new Set([...root.querySelectorAll('g.node text')].map(text => text.textContent));
	expect(root.tagName).toBe('svg');
	expect(nodeLabels.filter(label => !texts.has(label))).toEqual([]);
});

it('offers the graph as SVG and DOT downloads', async () => {
	const downloads: { name: string; blob: Blob }[] = [];
	let pending: Blob | undefined;
	vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => {
		pending = blob as Blob;
		return 'blob:graph-download';
	});
	vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
	vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
		this: HTMLAnchorElement
	) {
		downloads.push({ name: this.download, blob: pending! });
	});

	render(GraphView, { dot, title: '3Jo 1:1/2', filenameBase: 'analysis-flow' });

	await expect.element(page.getByText('A (a)', { exact: true })).toBeInTheDocument();
	await page.getByRole('button', { name: 'Download SVG' }).click();
	await page.getByRole('button', { name: 'Download DOT' }).click();

	expect(downloads.map(download => download.name)).toEqual([
		'analysis-flow.svg',
		'analysis-flow.dot',
	]);
	expect(downloads[0].blob.type).toBe('image/svg+xml');
	expect(await downloads[0].blob.text()).toContain('<svg');
	expect(await downloads[0].blob.text()).toContain('>A (a)</text>');
	expect(await downloads[1].blob.text()).toBe(dot);
});
