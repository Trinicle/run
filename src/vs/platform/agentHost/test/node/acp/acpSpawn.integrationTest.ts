/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { tmpdir } from 'os';
import * as acp from '@agentclientprotocol/sdk';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { isWindows } from '../../../../../base/common/platform.js';
import { BUILTIN_ACP_AGENTS, resolveAcpBinCommand } from '../../../node/acp/acpBuiltInAgents.js';
import { spawnAcpTransport } from '../../../node/acp/acpTransport.js';
import { ACP_PROTOCOL_VERSION } from '../../../node/acp/acpTypes.js';
import type { IAcpAgentDefinition } from '../../../node/acp/acpAgentConfig.js';

class RecordingAcpClient implements acp.Client {
	readonly updates: acp.SessionNotification[] = [];

	requestPermission(): acp.RequestPermissionResponse {
		return { outcome: { outcome: 'cancelled' } };
	}

	sessionUpdate(params: acp.SessionNotification): void {
		this.updates.push(params);
	}
}

function findAcpBinary(command: string): string | undefined {
	const resolved = resolveAcpBinCommand(command);
	if (resolved !== command && existsSync(resolved)) {
		return resolved;
	}
	const locator = isWindows ? 'where.exe' : 'which';
	const result = spawnSync(locator, [command], { encoding: 'utf8', windowsHide: true });
	if (result.status !== 0) {
		return undefined;
	}
	const first = result.stdout.split(/\r?\n/).map(line => line.trim()).find(Boolean);
	return first && existsSync(first) ? first : undefined;
}

function textFromUpdates(updates: readonly acp.SessionNotification[]): string {
	const chunks: string[] = [];
	for (const notification of updates) {
		const update = notification.update;
		if (update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text') {
			chunks.push(update.content.text);
		}
	}
	return chunks.join('');
}

suite('ACP spawn', function () {
	this.timeout(60_000);
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	for (const builtIn of BUILTIN_ACP_AGENTS) {
		test(`${builtIn.command} initialize, newSession, and prompt`, async function () {
			const command = findAcpBinary(builtIn.command);
			if (!command) {
				this.skip();
			}
			const definition: IAcpAgentDefinition = { ...builtIn, command };
			const transport = store.add(spawnAcpTransport(definition, tmpdir()));
			const client = new RecordingAcpClient();
			transport.setClient(client);
			const initialized = await transport.connection.initialize({
				protocolVersion: ACP_PROTOCOL_VERSION,
				clientCapabilities: {
					fs: { readTextFile: true, writeTextFile: true },
				},
				clientInfo: { name: 'vscode-agent-host-test', title: 'VS Code Agent Host Test', version: '1.0.0' },
			});
			assert.ok(initialized.protocolVersion, 'initialize should return a protocol version');
			const session = await transport.connection.newSession({
				cwd: tmpdir(),
				mcpServers: [],
			});
			assert.ok(session.sessionId, 'newSession should return a session id');
			const prompted = await transport.connection.prompt({
				sessionId: session.sessionId,
				prompt: [{ type: 'text', text: 'Reply with the word pong.' }],
			});
			const text = textFromUpdates(client.updates);
			assert.ok(text.length > 0 || prompted.stopReason, 'expected a text sessionUpdate or a stopReason');
		});
	}
});
