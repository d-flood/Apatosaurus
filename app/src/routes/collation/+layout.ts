import { isCollationEnabled } from '$lib/config/feature-flags';
import { redirect } from '@sveltejs/kit';
import type { LayoutLoad } from './$types';

export const load: LayoutLoad = () => {
	if (!isCollationEnabled) {
		throw redirect(307, '/');
	}
	return {};
};
