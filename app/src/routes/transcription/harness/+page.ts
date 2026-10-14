import { dev } from '$app/environment';
import { error } from '@sveltejs/kit';

export const ssr = false;

export function load() {
	if (!dev && import.meta.env.VITE_E2E_SHARED_FOLDER !== '1') error(404);
}
