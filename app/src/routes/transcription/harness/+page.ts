import { dev } from '$app/environment';
import { error } from '@sveltejs/kit';

const harnessEnabled = dev || import.meta.env.VITE_E2E_SHARED_FOLDER === '1';

export const ssr = !harnessEnabled;

export function load() {
	if (!harnessEnabled) error(404);
}
