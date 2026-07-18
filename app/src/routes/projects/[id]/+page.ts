import { redirect } from '@sveltejs/kit';

export const load = ({ params }: { params: { id: string } }) => {
	redirect(302, `/projects/${params.id}/transcriptions`);
};
