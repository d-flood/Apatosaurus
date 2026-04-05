<script lang="ts">
	import type { Snippet } from 'svelte';
	import X from 'phosphor-svelte/lib/X';

	interface Props {
		open: boolean;
		title: string;
		variant?: 'fixed' | 'embedded';
		onClose: () => void;
		children?: Snippet;
	}

	let { open, title, variant = 'fixed', onClose, children }: Props = $props();
</script>

<div
	class={[
		'inspector-host',
		variant === 'fixed' ? 'inspector-host-fixed' : 'inspector-host-embedded',
		open ? 'inspector-host-open' : '',
	]}
>
	<div class="inspector-host-header">
		<h3 class="inspector-host-title">{title}</h3>
		<button
			type="button"
			class="btn btn-sm btn-circle btn-ghost"
			onclick={onClose}
			aria-label="Close inspector"
		>
			<X size={16} />
		</button>
	</div>
	<div class="inspector-host-body">
		{@render children?.()}
	</div>
</div>

<style>
	:global(.inspector-host) {
		display: flex;
		flex-direction: column;
		overflow: hidden;
		background: var(--color-base-100);
		border-top: 1px solid color-mix(in srgb, var(--color-base-content) 14%, transparent);
		box-shadow: 0 -4px 24px rgb(0 0 0 / 0.10);
	}

	:global(.inspector-host-fixed) {
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		z-index: 40;
		max-height: 50vh;
		transform: translateY(100%);
		transition: transform 0.25s ease;
	}

	:global(.inspector-host-embedded) {
		position: sticky;
		bottom: 0;
		margin-top: 0.75rem;
		max-height: min(24rem, 70vh);
		border: 1px solid color-mix(in srgb, var(--color-base-content) 10%, transparent);
		border-radius: 0.75rem;
		transform: translateY(0.5rem);
		opacity: 0;
		pointer-events: none;
		transition:
			transform 0.2s ease,
			opacity 0.2s ease;
	}

	:global(.inspector-host.inspector-host-open) {
		transform: translateY(0);
		opacity: 1;
		pointer-events: auto;
	}

	:global(.inspector-host-header) {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.5rem 1rem;
		border-bottom: 1px solid color-mix(in srgb, var(--color-base-content) 8%, transparent);
		flex-shrink: 0;
	}

	:global(.inspector-host-title) {
		font-size: 0.875rem;
		font-weight: 700;
	}

	:global(.inspector-host-body) {
		font-size: 0.875rem;
		overflow-y: auto;
		padding: 0.75rem 1rem 1rem;
		flex: 1;
		min-height: 0;
	}
</style>
