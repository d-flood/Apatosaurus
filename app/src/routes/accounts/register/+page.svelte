<script lang="ts">
	import { resolve } from '$app/paths';

	function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
	}

	let password1: string = $state('');
	let password2: string = $state('');
	let passwordsMatch: boolean = $derived.by(() => password1 === password2);
	const minCharacters = 16;
</script>

<svelte:head>
	<title>Register for Apatosaurus</title>
</svelte:head>

<div class="flex justify-center">
	<div class="card card-xl max-w-md bg-base-300 shadow-md mt-8">
		<div class="card-body px-2 sm:px-10">
			<h1 class="text-2xl font-bold text-center">Register</h1>
			<p class="text-center text-sm text-base-content/70">
				Work in progress for open-source contributors: registration is not wired up yet, and
				this form is a non-functional placeholder.
			</p>

			<form onsubmit={handleSubmit} class="space-y-2 my-4">
							<fieldset class="fieldset">
					<label class="text-base" for="email">Email</label>
					<input
						class="input input-lg w-full validator"
						id="email"
						name="email"
						type="email"
						placeholder="Your Email"
						required
					/>
				</fieldset>

				<fieldset class="fieldset">
					<label for="password" class="text-base">Password</label>
					<input
						id="password"
						class="input input-lg w-full validator"
						bind:value={password1}
						name="password"
						type="password"
						required
						minlength={minCharacters}
						placeholder="New Password"
					/>
					<progress
						class={[
							'progress w-full',
							password1.length === 0 && 'invisible',
							password1.length < minCharacters && 'progress-error',
							password1.length >= minCharacters && 'progress-success',
						]}
						value={password1.length}
						max={minCharacters}
					></progress>
					<p class="-mt-2">
						No special characters required, but must have at least {minCharacters} characters.
						<a
							href="https://www.nist.gov/cybersecurity/how-do-i-create-good-password"
							class="link link-primary">NIST password guidelines</a
						>
					</p>
				</fieldset>

				<fieldset class="fieldset">
					<label for="confirm-password" class="text-base">Confirm Password</label>
					<input
						id="confirm-password"
						name="confirmPassword"
						bind:value={password2}
						class={[
							'input input-lg w-full',
							!passwordsMatch && 'input-error ring-error',
							passwordsMatch &&
								password2.length >= minCharacters &&
								'input-success ring-success',
						]}
						type="password"
						required
						minlength={minCharacters}
						placeholder="New Password (again)"
					/>
				</fieldset>

				<button type="submit" class="btn btn-success btn-block"> Register </button>

				<p>
					Already have an account? <a href={resolve('/accounts/login')} class="link link-primary"
						>Log In</a
					>
				</p>
			</form>
		</div>
	</div>
</div>
