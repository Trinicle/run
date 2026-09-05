/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import * as acp from '@agentclientprotocol/sdk';
import { PassThrough, Readable, Writable } from 'stream';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { AgentSession } from '../../../common/agent.js';
import { createLinkedAcpTransports } from '../../../node/acp/acpTransport.js';
import { AcpSessionManager } from '../../../node/acp/acpSessionManager.js';

suite('ACP transport', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('SDK streams exchange initialize, session, prompt, and update', async () => {
		const clientToAgent = new PassThrough();
		const agentToClient = new PassThrough();
		const updates: string[] = [];

		acp.agent({ name: 'test-agent' })
			.onRequest(acp.methods.agent.initialize, context => ({
				protocolVersion: context.params.protocolVersion,
				agentCapabilities: { loadSession: false },
				authMethods: [],
			}))
			.onRequest(acp.methods.agent.session.new, () => ({ sessionId: 'acp-session-1' }))
			.onRequest(acp.methods.agent.session.prompt, async context => {
				await context.client.notify(acp.methods.client.session.update, {
					sessionId: context.params.sessionId,
					update: {
						sessionUpdate: 'agent_message_chunk',
						content: { type: 'text', text: 'Hello from ACP' },
					},
				});
				return { stopReason: 'end_turn' };
			})
			.connect(acp.ndJsonStream(
				Writable.toWeb(agentToClient),
				Readable.toWeb(clientToAgent) as ReadableStream<Uint8Array>,
			));

		const result = await acp.client({ name: 'test-client' })
			.onNotification(acp.methods.client.session.update, context => {
				if (context.params.update.sessionUpdate === 'agent_message_chunk' && context.params.update.content.type === 'text') {
					updates.push(context.params.update.content.text);
				}
			})
			.connectWith(
				acp.ndJsonStream(
					Writable.toWeb(clientToAgent),
					Readable.toWeb(agentToClient) as ReadableStream<Uint8Array>,
				),
				async agent => {
					const initialized = await agent.request(acp.methods.agent.initialize, {
						protocolVersion: acp.PROTOCOL_VERSION,
						clientCapabilities: {},
					});
					const session = await agent.request(acp.methods.agent.session.new, {
						cwd: '/tmp',
						mcpServers: [],
					});
					const prompted = await agent.request(acp.methods.agent.session.prompt, {
						sessionId: session.sessionId,
						prompt: [{ type: 'text', text: 'Hello' }],
					});
					return { initialized, session, prompted };
				},
			);

		assert.deepStrictEqual({
			protocolVersion: result.initialized.protocolVersion,
			sessionId: result.session.sessionId,
			stopReason: result.prompted.stopReason,
			updates,
		}, {
			protocolVersion: acp.PROTOCOL_VERSION,
			sessionId: 'acp-session-1',
			stopReason: 'end_turn',
			updates: ['Hello from ACP'],
		});
	});

	test('session manager maps chat URIs onto ACP session ids and serializes turns', async () => {
		const { client } = createLinkedAcpTransports(() => ({
			initialize: params => ({
				protocolVersion: params.protocolVersion,
				agentCapabilities: { loadSession: false },
				authMethods: [],
			}),
			newSession: () => ({ sessionId: 'acp-session-1' }),
			authenticate: () => { },
			prompt: () => ({ stopReason: 'end_turn' }),
			cancel: () => { },
		}));
		store.add(client);

		const session = AgentSession.uri('acp-test', 'session-1');
		const chat = URI.parse(`${session.scheme}:${session.path}/chat`);
		const manager = new AcpSessionManager(client);
		const record = await manager.createAcpSession(chat, session, '/tmp', []);
		assert.strictEqual(record.acpSessionId, 'acp-session-1');
		assert.strictEqual(manager.getByAcpSessionId('acp-session-1'), record);

		await manager.beginTurn(record, 'turn-1');
		let secondBegan = false;
		const second = manager.beginTurn(record, 'turn-2').then(() => {
			secondBegan = true;
		});
		await Promise.resolve();
		assert.strictEqual(secondBegan, false);
		assert.strictEqual(record.turnId, 'turn-1');
		manager.endTurn(record);
		await second;
		assert.strictEqual(record.turnId, 'turn-2');
		manager.endTurn(record);
		assert.strictEqual(record.promptInFlight, false);
	});
});
