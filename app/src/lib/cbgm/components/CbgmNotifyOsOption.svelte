<script lang="ts">
	let { checked = $bindable(false) }: { checked?: boolean } = $props();

	let blocked = $state(false);

	const supported = typeof Notification !== 'undefined';

	async function toggle(next: boolean) {
		checked = next;
		blocked = false;
		if (!next || Notification.permission === 'granted') return;
		const permission = await Notification.requestPermission();
		if (permission !== 'granted') {
			checked = false;
			blocked = permission === 'denied';
		}
	}
</script>

{#if supported}
	<div class="space-y-1">
		<label class="flex items-center gap-2 text-sm">
			<input
				type="checkbox"
				class="checkbox checkbox-sm"
				{checked}
				onchange={event => toggle(event.currentTarget.checked)}
			/>
			Notify me on this device when it finishes
		</label>
		{#if blocked}
			<p class="text-xs text-base-content/60">
				Notifications are blocked for this site. Allow them in your browser's site settings
				to use this.
			</p>
		{/if}
	</div>
{/if}
