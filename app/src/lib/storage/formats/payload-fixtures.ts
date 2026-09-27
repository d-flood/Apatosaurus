import type { ProjectManifestPayload } from './project-manifest';
import type { ProjectTranscriptionPayload } from './project-transcription';
import type { CollationPayload } from './collation';
import type { TranscriptionCheckpointPayload } from './checkpoint-transcription';
import type { CollationCheckpointPayload } from './checkpoint-collation';
import type { TombstonePayload } from './tombstone';
import type { WorkingTranscriptionPayload } from './working-transcription';
import type { WorkingCollationPayload } from './working-collation';

export const PROJECT_MANIFEST_FIXTURE: ProjectManifestPayload = {
	id: 'project-1',
	name: 'Default Project',
	description: 'Fixture project',
	charter: '',
	collation_settings: { regularize: false },
	forked_from: null,
	manifest_content_hash:
		'sha256:e08119724306ed74a77e9748563d84ef8ac69d6064c0ee9a83859a6ff2b78e67',
	transcriptions: [
		{
			project_transcription_id: 'pt-1',
			transcription_id: 'tx-1',
			current_revision: { id: 'tx-cp-1', content_hash: 'sha256:tx' },
			title: 'Witness A',
			siglum: 'A',
			primary_path: 'transcriptions/pt-1.json',
		},
	],
	collations: [
		{
			collation_id: 'col-1',
			current_revision: { id: 'col-cp-1', content_hash: 'sha256:col' },
			title: 'John 1:1',
			verse_identifier: 'John 1:1',
			primary_path: 'collations/col-1.json',
		},
	],
	tombstones: [],
	created_at: '2026-07-03T00:00:00.000Z',
	updated_at: '2026-07-03T00:00:00.000Z',
};

export const PROJECT_TRANSCRIPTION_FIXTURE: ProjectTranscriptionPayload = {
	project_transcription_id: 'pt-1',
	id: 'tx-1',
	canonical_transcription_id: null,
	current_revision: {
		id: 'tx-cp-1',
		content_hash: 'sha256:de6dbef56033da96f56e1514fb53181cfa4128829f94c214bc1ee29d75c42e4c',
		created_at: '2026-07-03T00:00:00.000Z',
		author_name: 'Editor',
	},
	origin: {
		source_type: 'created',
		source_project_id: null,
		source_transcription_id: null,
		source_revision_id: null,
		source_content_hash: null,
	},
	title: 'Witness A',
	siglum: 'A',
	description: 'Fixture transcription',
	content_json: { type: 'transcriptionDocument', pages: [] },
	content_format: 'normalized_ast_v3',
	created_at: '2026-07-03T00:00:00.000Z',
	updated_at: '2026-07-03T00:00:00.000Z',
	owner: null,
	is_public: false,
	tags: ['fixture'],
	transcriber: 'Editor',
	repository: 'Repository',
	settlement: 'City',
	language: 'grc',
	iiif_manifest_sources: [
		{
			id: 'manifest-1',
			manifest_url: 'https://example.org/manifest.json',
			label: 'Fixture manifest',
			source_kind: 'iiif',
			default_canvas_id: 'canvas-1',
			default_image_service_url: null,
			metadata_json: { label: 'Fixture manifest' },
		},
	],
	page_canvas_links: [
		{
			id: 'link-1',
			page_id: 'page-1',
			page_name_snapshot: 'Page 1',
			page_order: 1,
			manifest_source_id: 'manifest-1',
			manifest_url_snapshot: 'https://example.org/manifest.json',
			canvas_id: 'canvas-1',
			canvas_order: 1,
			canvas_label: 'Canvas 1',
			image_service_url: null,
			thumbnail_url: null,
			link_role: 'primary',
		},
	],
	canvas_annotations: [
		{
			id: 'annotation-row-1',
			manifest_source_id: 'manifest-1',
			canvas_id: 'canvas-1',
			page_id: 'page-1',
			annotation_id: 'annotation-1',
			annotation_kind: 'comment',
			body_json: { value: 'note' },
			target_json: { source: 'canvas-1' },
			anchor_json: { pageId: 'page-1' },
			motivation: 'commenting',
			created_by: 'editor@example.com',
		},
	],
};

export const PROJECT_TRANSCRIPTION_OLD_SHAPE_FIXTURE = {
	schema_version: 1,
	...PROJECT_TRANSCRIPTION_FIXTURE,
	format: PROJECT_TRANSCRIPTION_FIXTURE.content_format,
};

export const COLLATION_FIXTURE: CollationPayload = {
	id: 'col-1',
	project_id: 'project-1',
	title: 'John 1:1 Collation',
	verse_identifier: 'John 1:1',
	status: 'draft',
	current_revision: {
		id: 'col-cp-1',
		content_hash: 'sha256:625adfc84755d1554eb7ea249d4a839af0ed8dd43b938b30300c167b6d74b8dc',
		created_at: '2026-07-03T00:00:00.000Z',
		author_name: 'Editor',
	},
	group_path: '',
	notes: '',
	sort_key: 0,
	created_at: '2026-07-03T00:00:00.000Z',
	updated_at: '2026-07-03T00:00:00.000Z',
	document: {
		type: 'collationDocument',
		version: 1,
		meta: { collationId: 'col-1', projectId: 'project-1', projectName: 'Project' },
		flow: {
			phase: 'review',
			furthestPhase: 'review',
			alignmentDisplayMode: 'regularized',
			alignmentLayout: 'grid',
		},
		setup: {
			segment: { id: 'segment-1', name: 'John 1:1', members: ['John 1:1'] },
			witnesses: [],
		},
		settings: {
			regularizationRules: [],
			ignoreWordBreaks: false,
			lowercase: false,
			ignoreTokenWhitespace: true,
			ignorePunctuation: false,
			suppliedTextMode: 'clear',
			segmentation: true,
		},
		alignment: null,
		apparatus: null,
		stemma: null,
	},
};

export const TRANSCRIPTION_CHECKPOINT_FIXTURE: TranscriptionCheckpointPayload = {
	checkpoint_id: 'tx-cp-1',
	entity_type: 'project-transcription',
	entity_id: 'pt-1',
	payload_transcription_id: 'tx-1',
	parent_checkpoint_id: null,
	payload_content_hash: 'sha256:b88064113fd452747b0723b27847c5ecf9efada27c6a9d5eaeee8b2eae57f4bb',
	content_format: 'normalized_ast_v3',
	commit_message: 'Initial commit',
	author_name: 'Editor',
	created_at: '2026-07-03T00:00:00.000Z',
	payload: {
		project_transcription_id: 'pt-1',
		id: 'tx-1',
		format: 'normalized_ast_v3',
		title: 'Witness A',
		siglum: 'A',
		description: '',
		content_json: { type: 'transcriptionDocument', pages: [] },
		owner: null,
		is_public: false,
		tags: [],
		transcriber: 'Editor',
		repository: 'Repository',
		settlement: 'City',
		language: 'grc',
		iiif_manifest_sources: [],
		page_canvas_links: [],
		canvas_annotations: [],
	},
};

export const TRANSCRIPTION_CHECKPOINT_OLD_SHAPE_FIXTURE = {
	schema_version: 1,
	...TRANSCRIPTION_CHECKPOINT_FIXTURE,
	content_hash: TRANSCRIPTION_CHECKPOINT_FIXTURE.payload_content_hash,
	format: TRANSCRIPTION_CHECKPOINT_FIXTURE.content_format,
};

export const COLLATION_CHECKPOINT_FIXTURE: CollationCheckpointPayload = {
	checkpoint_id: 'col-cp-1',
	entity_type: 'collation',
	entity_id: 'col-1',
	parent_checkpoint_id: null,
	payload_content_hash: 'sha256:625adfc84755d1554eb7ea249d4a839af0ed8dd43b938b30300c167b6d74b8dc',
	commit_message: 'Initial commit',
	author_name: 'Editor',
	created_at: '2026-07-03T00:00:00.000Z',
	payload: (() => {
		const {
			current_revision: _,
			created_at: _createdAt,
			updated_at: _updatedAt,
			...content
		} = COLLATION_FIXTURE;
		return content;
	})(),
};

export const COLLATION_CHECKPOINT_OLD_SHAPE_FIXTURE = {
	schema_version: 1,
	...COLLATION_CHECKPOINT_FIXTURE,
	content_hash: COLLATION_CHECKPOINT_FIXTURE.payload_content_hash,
};

export const TOMBSTONE_FIXTURE: TombstonePayload = {
	id: 'tombstone-1',
	project_id: 'project-1',
	entity_type: 'project-transcription',
	entity_id: 'pt-deleted',
	cloud_path: 'transcriptions/pt-deleted.json',
	deletion_revision_id: 'tx-cp-deleted',
	deleted_by: 'editor@example.com',
	deleted_at: '2026-07-03T00:00:00.000Z',
};

const { current_revision: _currentRevision, ...workingTranscriptionBase } =
	PROJECT_TRANSCRIPTION_FIXTURE;

export const WORKING_TRANSCRIPTION_FIXTURE: WorkingTranscriptionPayload = {
	...workingTranscriptionBase,
	draft: {
		base_revision_id: 'tx-cp-1',
		base_content_hash: 'sha256:tx',
		saved_at: '2026-07-03T00:05:00.000Z',
		author_name: 'Editor',
	},
};

const { current_revision: _collationRevision, ...workingCollationBase } = COLLATION_FIXTURE;

export const WORKING_COLLATION_FIXTURE: WorkingCollationPayload = {
	...workingCollationBase,
	draft: {
		base_revision_id: 'col-cp-1',
		base_content_hash: 'sha256:col',
		saved_at: '2026-07-03T00:05:00.000Z',
		author_name: 'Editor',
	},
};
