<script lang="ts">
	let {
		loaderMode,
		manifestInput,
		imageUrlsInput,
		intfJsonInput,
		intfAutoAssociate,
		busy = false,
		intfBusyLabel = null,
		onLoaderModeChange,
		onManifestInputChange,
		onImageUrlsInputChange,
		onIntfJsonInputChange,
		onIntfAutoAssociateChange,
		onLoadManifest,
		onLoadImageUrls,
		onLoadIntfJson,
	}: {
		loaderMode: 'manifest' | 'images' | 'intf';
		manifestInput: string;
		imageUrlsInput: string;
		intfJsonInput: string;
		intfAutoAssociate: boolean;
		busy?: boolean;
		intfBusyLabel?: string | null;
		onLoaderModeChange: (value: 'manifest' | 'images' | 'intf') => void;
		onManifestInputChange: (value: string) => void;
		onImageUrlsInputChange: (value: string) => void;
		onIntfJsonInputChange: (value: string) => void;
		onIntfAutoAssociateChange: (value: boolean) => void;
		onLoadManifest: () => void;
		onLoadImageUrls: () => void;
		onLoadIntfJson: () => void;
	} = $props();
</script>

<div class="space-y-3">
	<div class="tabs tabs-box bg-base-200 p-1">
		<button
			class={['tab tab-sm flex-1 whitespace-nowrap px-1 text-xs', loaderMode === 'manifest' && 'tab-active']}
			onclick={() => onLoaderModeChange('manifest')}
		>
			Manifest URL
		</button>
		<button
			class={['tab tab-sm flex-1 whitespace-nowrap px-1 text-xs', loaderMode === 'images' && 'tab-active']}
			onclick={() => onLoaderModeChange('images')}
		>
			Image URLs
		</button>
		<button
			class={['tab tab-sm flex-1 whitespace-nowrap px-1 text-xs', loaderMode === 'intf' && 'tab-active']}
			onclick={() => onLoaderModeChange('intf')}
		>
			INTF JSON
		</button>
	</div>

	<div class="flex flex-col gap-2">
		{#if loaderMode === 'manifest'}
			<input
				type="url"
				class="input input-bordered w-full"
				placeholder="https://example.org/iiif/manifest.json"
				value={manifestInput}
				oninput={event =>
					onManifestInputChange((event.currentTarget as HTMLInputElement).value)}
			/>
			<button
				class="btn btn-primary w-full"
				onclick={onLoadManifest}
				disabled={busy || !manifestInput.trim()}
			>
				{busy ? 'Loading...' : 'Load manifest'}
			</button>
		{:else if loaderMode === 'images'}
			<textarea
				class="textarea textarea-bordered min-h-28 w-full"
				placeholder="https://example.org/image-1.jpg
https://example.org/image-2.png"
				value={imageUrlsInput}
				oninput={event =>
					onImageUrlsInputChange((event.currentTarget as HTMLTextAreaElement).value)}
			></textarea>
			<button
				class="btn btn-primary w-full"
				onclick={onLoadImageUrls}
				disabled={busy || !imageUrlsInput.trim()}
			>
				{busy ? 'Loading...' : 'Load images'}
			</button>
			<p class="text-xs text-base-content/60">
				One external image URL per line. A synthetic IIIF manifest will be created locally.
			</p>
		{:else}
			<textarea
				class="textarea textarea-bordered min-h-36 w-full"
				placeholder="Paste the INTF manuscript JSON response here."
				value={intfJsonInput}
				oninput={event =>
					onIntfJsonInputChange((event.currentTarget as HTMLTextAreaElement).value)}
			></textarea>
			<label class="label cursor-pointer justify-start gap-3 px-1">
				<input
					type="checkbox"
					class="checkbox checkbox-sm"
					checked={intfAutoAssociate}
					onchange={event =>
						onIntfAutoAssociateChange((event.currentTarget as HTMLInputElement).checked)}
				/>
				<span class="label-text text-sm flex-1 whitespace-normal text-left leading-tight">Auto-associate pages by folio when possible</span>
			</label>
			<button
				class="btn btn-primary w-full"
				onclick={onLoadIntfJson}
				disabled={busy || !intfJsonInput.trim()}
			>
				{#if busy}
					<span class="loading loading-spinner loading-xs" aria-hidden="true"></span>
					<span>{intfBusyLabel || 'Loading...'}</span>
				{:else}
					<span>Import INTF manuscript</span>
				{/if}
			</button>
			<p class="text-xs text-base-content/60">
				Paste the manuscript metadata JSON from INTF. The app will create a local synthetic IIIF manifest.
			</p>
		{/if}
	</div>
</div>
