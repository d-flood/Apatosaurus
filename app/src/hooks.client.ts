import type { ClientInit } from '@sveltejs/kit';
import { ensureLocalDbRuntime } from '$lib/db/runtime';

export const init: ClientInit = () => {
	// The runtime reports its own start-up failure.
	ensureLocalDbRuntime().catch(() => {});
};
