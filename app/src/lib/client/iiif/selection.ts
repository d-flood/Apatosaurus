import type { IiifWorkspaceSelection, ManifestSourceSummary } from './types';

interface ResolveIiifWorkspaceSelectionOptions {
	selection: IiifWorkspaceSelection | null;
	preserveCurrentSelection?: boolean;
	initialManifestSourceId?: string | null;
	manifestSources: ManifestSourceSummary[];
	hasCompositeManifest: boolean;
	compositeSelection?: IiifWorkspaceSelection;
}

export function resolveIiifWorkspaceSelection({
	selection,
	preserveCurrentSelection = true,
	initialManifestSourceId = null,
	manifestSources,
	hasCompositeManifest,
	compositeSelection = 'composite',
}: ResolveIiifWorkspaceSelectionOptions): IiifWorkspaceSelection | null {
	if (selection === compositeSelection && hasCompositeManifest) {
		return compositeSelection;
	}

	if (
		preserveCurrentSelection &&
		selection &&
		selection !== compositeSelection &&
		manifestSources.some((source: ManifestSourceSummary) => source.id === selection)
	) {
		return selection;
	}

	if (initialManifestSourceId === compositeSelection && hasCompositeManifest) {
		return compositeSelection;
	}

	if (
		initialManifestSourceId &&
		manifestSources.some((source: ManifestSourceSummary) => source.id === initialManifestSourceId)
	) {
		return initialManifestSourceId;
	}

	if (hasCompositeManifest) {
		return compositeSelection;
	}

	return manifestSources[0]?.id || null;
}
