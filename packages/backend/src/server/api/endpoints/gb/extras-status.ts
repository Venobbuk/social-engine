/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { gifMode, translateMode, translateProviders, translateChain } from '@/core/GbChatExtras.js';

// CHAT-EXTRAS-V1 — which chat extras this engine can serve right now (a key is configured, or UAT's mock is on). The app
// reads it once per chat: no GIF button without `gif`, "Not available yet" on Translate without `translate`. Names no key.
export const meta = {
	tags: ['chat'],
	requireCredential: true,
	kind: 'read:account',
	res: { type: 'object', optional: false, nullable: false, properties: {
		gif: { type: 'boolean', optional: false, nullable: false },
		translate: { type: 'boolean', optional: false, nullable: false },
		gifMode: { type: 'string', optional: false, nullable: false },
		translateMode: { type: 'string', optional: false, nullable: false },
		// GEMINI-TRANSLATE-V1: the provider tried FIRST (gemini | openrouter | deepseek | none) — a name, never a key
		translateProvider: { type: 'string', optional: false, nullable: false },
		// the hop chain by NAME, e.g. gemini:proxy>gemini:sg>openrouter — no key, no URL
		translateChain: { type: 'string', optional: false, nullable: false },
	} },
} as const;

export const paramDef = { type: 'object', properties: {}, required: [] } as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor() {
		super(meta, paramDef, async () => {
			const g = gifMode(); const t = translateMode();
			return { gif: g !== 'off', translate: t !== 'off', gifMode: g, translateMode: t, translateProvider: translateProviders()[0] ?? 'none', translateChain: translateChain() };
		});
	}
}
