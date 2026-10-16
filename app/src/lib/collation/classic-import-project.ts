import {
	createCollation,
	deleteCollation,
	deleteTranscription,
	getProject,
	saveCollationArtifact,
	updateCollationMetadata,
	updateProjectMetadata,
} from '$lib/db/client';
import {
	createTranscriptionRecord,
	listMissingRequiredTranscriptionFields,
} from '$lib/transcription/create-transcription';
import type { LocalTeiImportDefaults } from '$lib/transcription/local-tei-import';
import { COLLATION_DOCUMENT_ARTIFACT_TYPE, serializeCollationDocument } from './collation-document';
import { gatherWitnessesForSegment, prepareWitnessesFromDocument } from './collation-runner';
import { parseProjectCollationSettings } from './project-settings';
import {
	buildClassicBaseTranscription,
	buildClassicCollationDocument,
	classicBaseSiglumCandidates,
	classicManualWitnesses,
	type ClassicCollationExport,
} from './classic-import';

export async function importClassicCollationProject(input: {
	projectId: string;
	source: ClassicCollationExport;
	baseSiglum: string;
	title: string;
	defaults: LocalTeiImportDefaults;
}): Promise<void> {
	const baseSiglum = input.baseSiglum.trim();
	const metadata = { ...input.defaults, title: input.title.trim(), siglum: baseSiglum };
	const missing = listMissingRequiredTranscriptionFields(metadata);
	if (missing.length) throw new Error(`Missing required metadata: ${missing.join(', ')}.`);
	if (
		input.source.witnesses.includes(baseSiglum) &&
		!classicBaseSiglumCandidates(input.source).includes(baseSiglum)
	)
		throw new Error(
			'Choose a witness that agrees with the base text at every unit, or name a new siglum.'
		);
	const project = await getProject(input.projectId);
	if (!project) throw new Error('Project not found.');
	const settings = parseProjectCollationSettings(project.collationSettings);
	const manualWitnesses = classicManualWitnesses(
		input.source,
		baseSiglum,
		settings.manualWitnesses ?? []
	);
	const document = buildClassicBaseTranscription(input.source);
	const collationIds = input.source.verses.map(() => crypto.randomUUID());
	for (const [index, verse] of input.source.verses.entries()) {
		const witness = prepareWitnessesFromDocument({
			document,
			verseIdentifier: verse.id,
			transcriptionId: 'preview',
			siglum: baseSiglum,
			source: {
				kind: 'current',
				transcriptionId: 'preview',
				capturedAt: '',
				contentHash: '',
			},
		})[0];
		if (!witness) throw new Error(`Verse ${verse.id} has no base text.`);
		buildClassicCollationDocument({
			verse,
			witness,
			manualWitnesses,
			collationId: collationIds[index],
			projectId: project.id,
			projectName: project.name,
		});
	}
	let transcriptionId: string | null = null;
	const created: string[] = [];
	let settingsSaved = false;
	try {
		transcriptionId = await createTranscriptionRecord({
			projectId: project.id,
			...metadata,
			document,
		});
		const documents = [];
		for (const [index, verse] of input.source.verses.entries()) {
			const gathered = await gatherWitnessesForSegment({ members: [verse.id] }, [
				transcriptionId,
			]);
			const witness = gathered.witnesses[0];
			if (gathered.error || !witness)
				throw new Error(
					gathered.error?.message ?? `Cannot gather the base text for ${verse.id}.`
				);
			documents.push(
				buildClassicCollationDocument({
					verse,
					witness,
					manualWitnesses,
					collationId: collationIds[index],
					projectId: project.id,
					projectName: project.name,
				})
			);
		}
		await updateProjectMetadata({
			projectId: project.id,
			collationSettings: { ...settings, manualWitnesses },
		});
		settingsSaved = true;
		for (const document of documents) {
			const id = document.meta.collationId!;
			created.push(id);
			await createCollation({
				id,
				projectId: project.id,
				title: document.setup.segment.name,
				verseIdentifier: document.setup.segment.name,
				segment: document.setup.segment,
			});
			await saveCollationArtifact({
				collationId: id,
				artifactType: COLLATION_DOCUMENT_ARTIFACT_TYPE,
				payload: serializeCollationDocument(document),
			});
			await updateCollationMetadata({ id, status: 'complete' });
		}
	} catch (error) {
		for (const id of created.reverse()) await deleteCollation(id);
		if (transcriptionId) await deleteTranscription(transcriptionId);
		if (settingsSaved)
			await updateProjectMetadata({
				projectId: project.id,
				collationSettings: project.collationSettings,
			});
		throw error;
	}
}
