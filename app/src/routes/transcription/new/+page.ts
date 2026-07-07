import type { PageLoad } from './$types';

export const ssr = false;

export const load: PageLoad = ({ url }) => ({
	projectId: url.searchParams.get('projectId') ?? undefined,
});
