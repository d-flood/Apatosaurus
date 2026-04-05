import { describe, expect, it } from 'vitest';

import { resolveIiifWorkspaceSelection } from './selection';
import type { ManifestSourceSummary } from './types';

function createManifestSource(id: string): ManifestSourceSummary {
	return {
		id,
		transcriptionId: 'tx-1',
		manifestUrl: `https://example.org/${id}/manifest`,
		label: id,
		sourceKind: 'app',
		defaultCanvasId: null,
		defaultImageServiceUrl: null,
		manifestJson: null,
		metadata: {},
		createdAt: '2026-03-25T00:00:00.000Z',
		updatedAt: '2026-03-25T00:00:00.000Z',
	};
}

describe('resolveIiifWorkspaceSelection', () => {
	it('defaults to the composite manifest when available', () => {
		expect(
			resolveIiifWorkspaceSelection({
				selection: null,
				manifestSources: [createManifestSource('source-a')],
				hasCompositeManifest: true,
			})
		).toBe('composite');
	});

	it('keeps an existing valid source selection', () => {
		expect(
			resolveIiifWorkspaceSelection({
				selection: 'source-a',
				preserveCurrentSelection: true,
				manifestSources: [createManifestSource('source-a')],
				hasCompositeManifest: true,
			})
		).toBe('source-a');
	});

	it('does not keep an auto-selected source when composite becomes available', () => {
		expect(
			resolveIiifWorkspaceSelection({
				selection: 'source-a',
				preserveCurrentSelection: false,
				manifestSources: [createManifestSource('source-a')],
				hasCompositeManifest: true,
			})
		).toBe('composite');
	});

	it('honors an explicit initial source selection when present', () => {
		expect(
			resolveIiifWorkspaceSelection({
				selection: null,
				initialManifestSourceId: 'source-b',
				manifestSources: [createManifestSource('source-a'), createManifestSource('source-b')],
				hasCompositeManifest: true,
			})
		).toBe('source-b');
	});

	it('falls back to the first saved source when no composite exists', () => {
		expect(
			resolveIiifWorkspaceSelection({
				selection: null,
				manifestSources: [createManifestSource('source-a'), createManifestSource('source-b')],
				hasCompositeManifest: false,
			})
		).toBe('source-a');
	});
});
