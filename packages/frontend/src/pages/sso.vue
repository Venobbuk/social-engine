<!--
SPDX-FileCopyrightText: silkvo social-engine contributors
SPDX-License-Identifier: AGPL-3.0-only
-->

<!-- /sso?jwt=…&redirect=/channels — host single sign-on landing (spec §2b item 1). A host (hkpl) sends the member
here with a short-lived JWT; we exchange it for an account token and log in, then continue to `redirect`. -->
<template>
<PageWithAnimBg>
	<div :class="$style.formContainer">
		<div :class="$style.form">
			<div v-if="state === 'working'" class="_gaps_s">
				<MkLoading/>
				<div>{{ i18n.ts.loading }}</div>
			</div>
			<div v-else-if="state === 'error'" class="_gaps_s">
				<div><i class="ti ti-alert-triangle"></i> {{ message }}</div>
				<MkButton @click="retry">{{ i18n.ts.retry }}</MkButton>
			</div>
		</div>
	</div>
</PageWithAnimBg>
</template>

<script lang="ts" setup>
import { ref, onMounted } from 'vue';
import MkButton from '@/components/MkButton.vue';
import { i18n } from '@/i18n.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { login } from '@/accounts.js';
import { definePage } from '@/page.js';

const props = defineProps<{
	jwt?: string;
	redirect?: string;
}>();

const state = ref<'working' | 'error'>('working');
const message = ref('');

function safeRedirect(p?: string): string {
	const s = p ?? '/channels';
	return (s.startsWith('/') && !s.startsWith('//')) ? s : '/channels';
}

async function run() {
	state.value = 'working';
	try {
		if (!props.jwt) throw new Error('missing token');
		const res = await misskeyApi('adapter/sso', { jwt: props.jwt }) as { token: string };
		await login(res.token, safeRedirect(props.redirect));
	} catch (e: any) {
		state.value = 'error';
		message.value = e?.message ?? String(e);
	}
}

function retry() {
	// go back to the host so it mints a fresh token
	window.location.href = 'https://hkpl.silkvo.com/api/v1/auth/sso/social/redirect?redirect=' + encodeURIComponent(safeRedirect(props.redirect));
}

onMounted(run);

definePage(() => ({
	title: 'SSO',
	icon: 'ti ti-login',
}));
</script>

<style lang="scss" module>
.formContainer {
	min-height: 100svh;
	padding: 32px 32px 64px 32px;
	box-sizing: border-box;
	display: grid;
	place-content: center;
}

.form {
	position: relative;
	z-index: 10;
	border-radius: var(--MI-radius);
	background: var(--MI_THEME-panel);
	overflow: clip;
	max-width: 500px;
	width: calc(100vw - 64px);
	height: min(100svh, 300px);
	display: grid;
	place-content: center;
	text-align: center;
}
</style>
