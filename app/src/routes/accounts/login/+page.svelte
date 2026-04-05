<script lang="ts">
	import { resolve } from '$app/paths';

	function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
	}
</script>

<svelte:head>
	<title>Log In to Apatosaurus</title>
</svelte:head>

<div class="flex justify-center">
	<div class="card card-xl max-w-md bg-base-300 shadow-md mt-8">
		<div class="card-body px-2 sm:px-10">
			<h1 class="text-2xl font-bold text-center">Log In</h1>
			<p class="text-center text-sm text-base-content/70">
				Work in progress for open-source contributors: authentication is not wired up yet, so
				this form is a non-functional placeholder.
			</p>

			<form onsubmit={handleSubmit} class="space-y-2">
							<fieldset class="fieldset">
					<legend class="sr-only">Authentication Credentials</legend>
					<label class="text-base" for="email">Email</label>
					<input
						class="input input-lg w-full validator"
						id="email"
						name="email"
						type="email"
						placeholder="Your Email"
						required
					/>

					<label for="password" class="text-base">Password</label>
					<input
						id="password"
						class="input input-lg w-full validator"
						name="password"
						type="password"
						minlength="16"
						required
						placeholder="Your Password"
					/>
				</fieldset>

				<button type="submit" class="btn btn-success btn-block"> Log In </button>

				<p>
					Don't have an account? <a href={resolve('/accounts/register')} class="link link-primary"
						>Register</a
					>
				</p>
			</form>
		</div>
	</div>
</div>
