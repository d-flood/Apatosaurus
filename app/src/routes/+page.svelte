<script lang="ts">
	import aptosaurusAnimated from '$lib/assets/apatosaurus_animated.gif';
</script>

<div class="flex flex-col items-center">
	<div class="flex flex-col items-center px-4 bg-base-300 rounded-b-box">
		<img src={aptosaurusAnimated} alt="Apatosaurus Logo" class="w-48 h-48 mt-4 -ml-20" />
		<h1 class="text-4xl font-semibold mt-8 mb-4 font-serif">Apatosaurus</h1>
		<div class="block font-serif mt-8 max-w-4xl">
			<p>
				Apatosaurus is a local-first progressive web application for New Testament textual
				criticism, offering tools for transcription, collation, and manuscript analysis.
			</p>
			<h2 class="my-4 text-2xl font-bold">Transcription Editor</h2>
			<ul class="list-disc list-inside mt-2 ml-8">
				<li>
					Import and export TEI, with over a hundred IGNTP transcriptions available for
					testing.
				</li>
				<li>Support for framed catena and commentary transcriptions.</li>
				<li>Rich-text editing with IIIF image integration.</li>
				<li>
					A flat transcription format that avoids TEI's deeply nested and unpredictable
					element structure while retaining round-trip TEI compatibility.
				</li>
			</ul>
			<h2 class="my-4 text-2xl font-bold">Collation</h2>
			<ul class="list-disc list-inside mt-2 ml-8">
				<li>Automated alignment with interactive fine-tuning.</li>
				<li>
					Multi-phase workflow: setup, alignment, regularization, readings, and stemma.
				</li>
				<li>Powered by a TypeScript port of the CollateX algorithm.</li>
			</ul>
			<h2 class="my-4 text-2xl font-bold">Local and Offline First</h2>
			<p>
				Your data is stored locally on your device. Work offline, close your browser, pick
				up right where you left off. Installable as a PWA from your browser's address bar.
			</p>
		</div>
	</div>
</div>
