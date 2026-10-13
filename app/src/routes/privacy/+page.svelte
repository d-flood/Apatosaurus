<svelte:head>
	<title>Privacy Policy · Apatosaurus</title>
</svelte:head>

<main class="mx-auto max-w-3xl px-4 py-8">
	<p class="text-sm font-semibold uppercase tracking-wide text-primary">Privacy</p>
	<h1 class="font-serif text-4xl font-bold">Privacy Policy</h1>
	<p class="mt-2 text-sm text-base-content/55">Effective October 11, 2026</p>

	<div class="mt-6 space-y-8 leading-relaxed text-base-content/80">
		<section>
			<h2 class="font-serif text-2xl font-bold">Summary</h2>
			<p class="mt-3">
				Apatosaurus has no user accounts, no analytics, no advertising, and no database of
				its own. Your projects live in your browser and, if you choose, in your own Dropbox
				or Google Drive. We do not sell, rent, or share your data.
			</p>
		</section>

		<section>
			<h2 class="font-serif text-2xl font-bold">Data on your device</h2>
			<p class="mt-3">
				Transcriptions, collations, versions, and settings are stored in your browser's
				private storage on your device. They are not sent to us. Clearing your browser's
				site data for Apatosaurus deletes them unless you have synced or exported them.
			</p>
		</section>

		<section>
			<h2 class="font-serif text-2xl font-bold">Dropbox and Google Drive</h2>
			<p class="mt-3">
				Connecting a storage account is optional. When you connect one, the app in your
				browser talks directly to Dropbox or Google to list folders so you can pick a
				location, and to read and write the project files you sync there. File contents
				never pass through our servers.
			</p>
			<ul class="mt-3 list-inside list-disc space-y-1">
				<li>
					<strong>Google:</strong> we request your basic profile (name and email) and
					access only to Drive files that Apatosaurus creates or that you open with it (<code
						>drive.file</code
					>). We cannot see the rest of your Drive.
				</li>
				<li>
					<strong>Dropbox:</strong> we request your account name and email and permission to
					read and write files. Dropbox grants this for your whole Dropbox; Apatosaurus only
					uses it to browse folders and to sync the project folders you choose.
				</li>
			</ul>
			<p class="mt-3">
				Your name and email are shown in the app to identify the connected account. Your
				name is recorded as the author of versions you save and, while you edit, in a small
				presence file (with a device name) inside the shared project folder so collaborators
				can see who is editing. These files stay in your storage account.
			</p>
		</section>

		<section>
			<h2 class="font-serif text-2xl font-bold">Sign-in tokens</h2>
			<p class="mt-3">
				A small service at <code>/auth</code>, hosted on Cloudflare, completes the Dropbox
				or Google sign-in. It encrypts the resulting refresh token into a secure, HttpOnly
				cookie in your browser and hands short-lived access tokens to the app. It keeps no
				copy of your tokens, profile, or files. The cookie lasts up to 400 days or until you
				sign out.
			</p>
		</section>

		<section>
			<h2 class="font-serif text-2xl font-bold">Google user data</h2>
			<p class="mt-3">
				Apatosaurus's use and transfer to any other app of information received from Google
				APIs will adhere to the
				<a
					class="link link-primary"
					href="https://developers.google.com/terms/api-services-user-data-policy"
					rel="external">Google API Services User Data Policy</a
				>, including the Limited Use requirements. Google data is used only to provide
				Apatosaurus's storage features, is never used for advertising or to train AI models,
				and is never read by people except with your permission or where required by law.
			</p>
		</section>

		<section>
			<h2 class="font-serif text-2xl font-bold">Hosting and third parties</h2>
			<p class="mt-3">
				The site is served by GitHub Pages through Cloudflare, which may log standard
				request data such as IP addresses under their own privacy policies. IIIF images you
				view are loaded directly from the institutions that host them.
			</p>
		</section>

		<section>
			<h2 class="font-serif text-2xl font-bold">Your choices</h2>
			<p class="mt-3">
				Sign out of a storage account on the Data page to delete its cookie and ask the
				provider to revoke access. You can also remove Apatosaurus in your
				<a
					class="link link-primary"
					href="https://myaccount.google.com/connections"
					rel="external">Google account connections</a
				>
				or
				<a
					class="link link-primary"
					href="https://www.dropbox.com/account/connected_apps"
					rel="external">Dropbox connected apps</a
				>. Files already synced remain in your storage account until you delete them.
			</p>
		</section>

		<section>
			<h2 class="font-serif text-2xl font-bold">Changes and contact</h2>
			<p class="mt-3">
				We will update this page and its effective date if these practices change. Questions
				are welcome on
				<a
					class="link link-primary"
					href="https://github.com/d-flood/Apatosaurus/issues"
					rel="external">GitHub</a
				>.
			</p>
		</section>
	</div>
</main>
