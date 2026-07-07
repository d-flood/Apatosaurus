import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

export const load: PageLoad = ({ url }) => {
	const projectId = url.searchParams.get('projectId');
	if (projectId) return { projectId };
	redirect(302, '/projects#transcriptions');
};
