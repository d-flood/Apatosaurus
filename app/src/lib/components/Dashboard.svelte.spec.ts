import { page } from '@vitest/browser/context';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';

import Dashboard from './Dashboard.svelte';

describe('Dashboard', () => {
	it('shows recent work and hides Continue when there are no documents', async () => {
		const projects = [
			{
				id: 'project-1',
				storageSlug: 'project-1',
				name: 'Romans',
				description: '',
				createdAt: '2026-07-01T00:00:00.000Z',
				updatedAt: '2026-07-18T00:00:00.000Z',
			},
		];

		const view = render(Dashboard, {
			projects,
			targetProject: projects[0],
			recentDocuments: [
				{
					id: 'collation-1',
					type: 'Collation',
					title: 'Romans 1:1',
					projectName: 'Romans',
					commitState: 'dirty',
					updatedAt: new Date().toISOString(),
					href: '/collation/collation-1',
				},
			],
			attentionItems: [],
		});

		await expect
			.element(page.getByRole('heading', { name: 'Continue where you left off' }))
			.toBeInTheDocument();
		await expect.element(page.getByText('Romans 1:1')).toBeInTheDocument();
		await expect.element(page.getByText('Collation', { exact: true })).toBeInTheDocument();
		await expect.element(page.getByText('Uncommitted changes')).toBeInTheDocument();

		view.unmount();
		render(Dashboard, {
			projects,
			targetProject: projects[0],
			recentDocuments: [],
			attentionItems: [],
		});

		await expect
			.element(page.getByRole('heading', { name: 'Continue where you left off' }))
			.not.toBeInTheDocument();
	});

	it('shows Needs attention only when an actionable warning exists', async () => {
		const projects = [
			{
				id: 'project-1',
				storageSlug: 'project-1',
				name: 'Romans',
				description: '',
				createdAt: '2026-07-01T00:00:00.000Z',
				updatedAt: '2026-07-18T00:00:00.000Z',
			},
		];
		const view = render(Dashboard, {
			projects,
			targetProject: projects[0],
			recentDocuments: [],
			attentionItems: [],
		});

		await expect
			.element(page.getByRole('heading', { name: 'Needs attention' }))
			.not.toBeInTheDocument();

		view.unmount();
		render(Dashboard, {
			projects,
			targetProject: projects[0],
			recentDocuments: [],
			attentionItems: [
				{
					id: 'quota',
					title: 'Browser storage is nearly full',
					description: 'Export a backup before adding more work.',
					href: '/data',
					linkLabel: 'Review storage',
				},
			],
		});

		await expect
			.element(page.getByRole('heading', { name: 'Needs attention' }))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('link', { name: 'Review storage' }))
			.toHaveAttribute('href', '/data');
	});

	it('shows only first-project guidance when there are no projects', async () => {
		render(Dashboard, {
			projects: [],
			targetProject: null,
			recentDocuments: [],
			attentionItems: [],
		});

		await expect
			.element(page.getByRole('link', { name: 'Create your first project' }))
			.toHaveAttribute('href', '/projects');
		await expect
			.element(page.getByRole('heading', { name: 'Start something' }))
			.not.toBeInTheDocument();
		await expect
			.element(page.getByRole('heading', { name: 'Needs attention' }))
			.not.toBeInTheDocument();
		await expect
			.element(page.getByRole('link', { name: 'About Apatosaurus' }))
			.not.toBeInTheDocument();
	});

	it('promotes project-scoped creation when projects have no documents', async () => {
		const projects = [
			{
				id: 'project-1',
				storageSlug: 'project-1',
				name: 'Romans',
				description: '',
				createdAt: '2026-07-01T00:00:00.000Z',
				updatedAt: '2026-07-18T00:00:00.000Z',
			},
		];
		render(Dashboard, {
			projects,
			targetProject: projects[0],
			recentDocuments: [],
			attentionItems: [],
		});

		await expect
			.element(page.getByRole('heading', { name: 'Start something' }))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('link', { name: 'New Transcription in Romans' }))
			.toHaveAttribute('href', '/transcription/new?projectId=project-1');
		await expect
			.element(page.getByRole('heading', { name: 'Continue where you left off' }))
			.not.toBeInTheDocument();
	});
});
