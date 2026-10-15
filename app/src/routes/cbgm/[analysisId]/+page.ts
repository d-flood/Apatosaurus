import { redirect } from '@sveltejs/kit';

import {
	buildLastOpenedProjectSectionTarget,
	readLastOpenedProjectId,
} from '$lib/shell/last-opened-project';
import { findCbgmAnalysis, listProjects } from '$lib/db/client';
import type { PageLoad } from './$types';

export const ssr = false;

export const load: PageLoad = async ({ params, depends }) => {
	depends('app:cbgm-analysis');
	const analysis = await findCbgmAnalysis(params.analysisId);
	if (!analysis) {
		redirect(
			302,
			buildLastOpenedProjectSectionTarget(
				readLastOpenedProjectId(),
				await listProjects(),
				'cbgm'
			)
		);
	}
	return { analysis };
};
