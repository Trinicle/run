/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { DeferredPromise } from '../../../../../base/common/async.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { AgentSession } from '../../../common/agent.js';
import { createLinkedAcpTransports } from '../../../node/acp/acpTransport.js';
import { AcpSessionManager } from '../../../node/acp/acpSessionManager.js';

suite('ACP transport', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('linked transports exchange requests, responses, and notifications', async () => {
		const { client, agent } = createLinkedAcpTransports();
		store.add(client);
		store.add(agent);

		const notified = new DeferredPromise<unknown>();
		store.add(agent.onNotification(message => {
			if (message.method === 'ping') {
				notified.complete(message.params);
			}
		}));
		store.add(agent.onRequest(request => {
			if (request.method === 'echo') {
				agent.sendResult(request.id, { echoed: request.params });
			}
		}));

		client.sendNotification('ping', { n: 1 });
		assert.deepStrictEqual(await notified.p, { n: 1 });

		const result = await client.sendRequest<{ echoed: string }>('echo', 'world');
		assert.deepStrictEqual(result, { echoed: 'world' });
	});

	test('session manager maps chat URIs onto ACP session ids and serializes turns', async () => {
		const { client, agent } = createLinkedAcpTransports();
		store.add(client);
		store.add(agent);
		store.add(agent.onRequest(request => {
			if (request.method === 'session/new') {
				agent.sendResult(request.id, { sessionId: 'acp-session-1' });
			}
		}));

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
