/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { DeferredPromise, timeout } from '../../../../../base/common/async.js';
import { Event } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { FileService } from '../../../../../platform/files/common/fileService.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { AgentSession, type AgentSignal, type IAgentToolPendingConfirmationSignal } from '../../../common/agent.js';
import { AgentHostAcpAgentsEnvVar, buildAgentSdkEnv } from '../../../common/agentService.js';
import { AgentHostMcpServersConfigKey } from '../../../common/agentHostSchema.js';
import { ActionType } from '../../../common/state/sessionActions.js';
import { buildDefaultChatUri } from '../../../common/state/sessionState.js';
import { McpServerType } from '../../../../mcp/common/mcpPlatformTypes.js';
import { IAgentConfigurationService } from '../../../node/agentConfigurationService.js';
import { ActiveClientToolSet } from '../../../node/activeClientState.js';
import { parseAcpAgentDefinitions } from '../../../node/acp/acpAgentConfig.js';
import { AcpAgentProvider, resolveAcpAgentDefinitions, toAcpMcpServers } from '../../../node/acp/acpAgentProvider.js';
import { AcpClientBridge } from '../../../node/acp/acpClientBridge.js';
import { AcpEventMapper } from '../../../node/acp/acpEventMapper.js';
import { AcpSessionManager } from '../../../node/acp/acpSessionManager.js';
import { ACP_CLIENT_TOOLS_MCP_NAME, type IAcpMcpServer } from '../../../node/acp/acpTypes.js';
import { createLinkedAcpTransports, type IAcpIncomingRequest, type IAcpTransport } from '../../../node/acp/acpTransport.js';

class FakeAcpAgent extends Disposable {
	promptCount = 0;
	lastNewSessionParams: { cwd?: string; mcpServers?: readonly IAcpMcpServer[] } | undefined;
	private readonly _promptGates: DeferredPromise<void>[] = [];

	constructor(
		readonly transport: IAcpTransport,
		private readonly _options: {
			readonly autoCompletePrompt?: boolean;
			readonly onPrompt?: (params: unknown) => Promise<void> | void;
		} = {},
	) {
		super();
		this._register(transport.onRequest(request => {
			void this._handle(request);
		}));
	}

	completeNextPrompt(): void {
		this._promptGates.shift()?.complete();
	}

	private async _handle(request: IAcpIncomingRequest): Promise<void> {
		try {
			switch (request.method) {
				case 'initialize':
					this.transport.sendResult(request.id, {
						protocolVersion: 1,
						capabilities: { session: { mcp: { acp: {}, stdio: {} } } },
					});
					return;
				case 'session/new':
					this.lastNewSessionParams = request.params as { cwd?: string; mcpServers?: readonly IAcpMcpServer[] };
					this.transport.sendResult(request.id, { sessionId: 'acp-1' });
					return;
				case 'session/prompt': {
					this.promptCount++;
					await this._options.onPrompt?.(request.params);
					if (this._options.autoCompletePrompt === false) {
						const gate = new DeferredPromise<void>();
						this._promptGates.push(gate);
						await gate.p;
					}
					this.transport.sendResult(request.id, { stopReason: 'end_turn' });
					return;
				}
				default:
					this.transport.sendError(request.id, -32601, `Unknown method ${request.method}`);
			}
		} catch (error) {
			this.transport.sendError(request.id, -32603, error instanceof Error ? error.message : String(error));
		}
	}
}

function createConfigService(mcpServers: Record<string, unknown> = {}): IAgentConfigurationService {
	return {
		_serviceBrand: undefined,
		onDidRootConfigChange: Event.None,
		getRootValue: (_schema, key) => key === AgentHostMcpServersConfigKey ? mcpServers as never : undefined,
	} as IAgentConfigurationService;
}

suite('ACP agent provider', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const definition = { id: 'acp-test', command: 'fake-acp', name: 'ACP Test' };

	function createProvider(transport: IAcpTransport, mcpServers?: Record<string, unknown>): AcpAgentProvider {
		const fileService = store.add(new FileService(new NullLogService()));
		return store.add(new AcpAgentProvider(
			definition,
			() => transport,
			new NullLogService(),
			fileService as IFileService,
			createConfigService(mcpServers),
		));
	}

	test('parseAcpAgentDefinitions keeps unique id+command entries', () => {
		assert.deepStrictEqual(parseAcpAgentDefinitions([
			{ id: 'one', command: 'a' },
			{ id: 'one', command: 'b' },
			{ id: '', command: 'c' },
			{ command: 'd' },
			{ id: 'two', command: 'e', args: ['--acp'], name: 'Two' },
		]), [
			{ id: 'one', command: 'a', name: undefined, description: undefined, args: undefined, env: undefined },
			{ id: 'two', command: 'e', name: 'Two', description: undefined, args: ['--acp'], env: undefined },
		]);
	});

	test('resolveAcpAgentDefinitions prefers the env JSON over root config', () => {
		assert.deepStrictEqual(
			resolveAcpAgentDefinitions('[{"id":"env","command":"env-bin"}]', [{ id: 'root', command: 'root-bin' }]),
			[{ id: 'env', command: 'env-bin', name: undefined, description: undefined, args: undefined, env: undefined }],
		);
	});

	test('buildAgentSdkEnv forwards ACP agent definitions', () => {
		const env = buildAgentSdkEnv({
			acpAgents: [{ id: 'my-agent', command: 'my-agent-cli', args: ['--acp'] }],
		}, {});
		assert.strictEqual(env[AgentHostAcpAgentsEnvVar], JSON.stringify([{ id: 'my-agent', command: 'my-agent-cli', args: ['--acp'] }]));
	});

	test('createChat + sendMessage maps ACP text into AgentSignals then completes the turn', async () => {
		const { client, agent } = createLinkedAcpTransports();
		store.add(client);
		store.add(agent);
		store.add(new FakeAcpAgent(agent, {
			onPrompt: async () => {
				agent.sendNotification('session/update', {
					sessionId: 'acp-1',
					update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Hello' } },
				});
				agent.sendNotification('session/update', {
					sessionId: 'acp-1',
					update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: ' world' } },
				});
			},
		}));

		const provider = createProvider(client);
		const session = AgentSession.uri(definition.id, 'session-1');
		const chat = URI.parse(buildDefaultChatUri(session.toString()));
		const signals: AgentSignal[] = [];
		store.add(provider.onDidChatProgress(signal => signals.push(signal)));

		await provider.chats.createChat(chat, session);
		await provider.chats.sendMessage(chat, 'hi', undefined, undefined, 'turn-1', undefined, session);

		assert.ok(signals.some(signal => signal.kind === 'action' && signal.action.type === ActionType.ChatResponsePart));
		assert.ok(signals.some(signal => signal.kind === 'action' && signal.action.type === ActionType.ChatDelta));
		assert.ok(signals.some(signal => signal.kind === 'action' && signal.action.type === ActionType.ChatTurnComplete));
	});

	test('second sendMessage waits for the in-flight ACP prompt (N clients, one ACP turn)', async () => {
		const { client, agent } = createLinkedAcpTransports();
		store.add(client);
		store.add(agent);
		const fake = store.add(new FakeAcpAgent(agent, { autoCompletePrompt: false }));
		const provider = createProvider(client);
		const session = AgentSession.uri(definition.id, 'session-lock');
		const chat = URI.parse(buildDefaultChatUri(session.toString()));
		await provider.chats.createChat(chat, session);

		const first = provider.chats.sendMessage(chat, 'from A', undefined, undefined, 'turn-a', 'client-a', session);
		await timeout(20);
		assert.strictEqual(fake.promptCount, 1);

		let secondFinished = false;
		const second = provider.chats.sendMessage(chat, 'from B', undefined, undefined, 'turn-b', 'client-b', session).then(() => {
			secondFinished = true;
		});
		await timeout(20);
		assert.strictEqual(fake.promptCount, 1);
		assert.strictEqual(secondFinished, false);

		fake.completeNextPrompt();
		await first;
		await timeout(20);
		assert.strictEqual(fake.promptCount, 2);
		fake.completeNextPrompt();
		await second;
		assert.strictEqual(secondFinished, true);
	});

	test('session/new advertises MCP-over-ACP client tools plus configured stdio MCP servers', async () => {
		const { client, agent } = createLinkedAcpTransports();
		store.add(client);
		store.add(agent);
		const fake = store.add(new FakeAcpAgent(agent));
		const provider = createProvider(client, {
			docs: { type: McpServerType.LOCAL, command: 'npx', args: ['-y', 'docs-mcp'] },
		});
		const session = AgentSession.uri(definition.id, 'session-tools');
		const chat = URI.parse(buildDefaultChatUri(session.toString()));
		const active = provider.getOrCreateActiveClient(chat, session, { clientId: 'window-a' });
		active.tools = [{ name: 'editor_open', description: 'Open a file', inputSchema: { type: 'object', properties: {} } }];

		await provider.chats.createChat(chat, session);
		const servers = fake.lastNewSessionParams?.mcpServers ?? [];
		const acpTools = servers.find(server => server.type === 'acp');
		assert.ok(acpTools);
		assert.strictEqual(acpTools.type === 'acp' && acpTools.name, ACP_CLIENT_TOOLS_MCP_NAME);
		assert.ok(servers.some(server => server.type === 'stdio' && server.name === 'docs' && server.command === 'npx'));

		const connect = await agent.sendRequest<{ connectionId: string }>('mcp/connect', { acpId: acpTools.type === 'acp' ? acpTools.id : '' });
		const listed = await agent.sendRequest<{ tools: { name: string }[] }>('mcp/message', {
			connectionId: connect.connectionId,
			method: 'tools/list',
		});
		assert.deepStrictEqual(listed.tools.map(tool => tool.name), ['editor_open']);
	});
});

suite('ACP client bridge permissions', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('first AHP confirmation wins; later clients are ignored', async () => {
		const { client, agent } = createLinkedAcpTransports();
		store.add(client);
		store.add(agent);

		const session = AgentSession.uri('acp-test', 'session-perm');
		const chat = URI.parse(buildDefaultChatUri(session.toString()));
		const sessions = new AcpSessionManager(client);
		sessions.bindRestored(chat, session, 'acp-1', undefined);
		const live = sessions.getByChat(chat)!;
		live.turnId = 'turn-1';

		const mapper = new AcpEventMapper();
		mapper.beginTurn('turn-1');
		const pending = new DeferredPromise<IAgentToolPendingConfirmationSignal>();
		const bridge = new AcpClientBridge(
			client,
			sessions,
			mapper,
			new ActiveClientToolSet(),
			signal => {
				if (signal.kind === 'pending_confirmation' && !pending.isSettled) {
					pending.complete(signal);
				}
			},
			undefined,
			() => ({ chat, turnId: 'turn-1' }),
		);
		store.add(client.onRequest(request => {
			void bridge.handleRequest(request);
		}));

		const permission = agent.sendRequest<{ outcome: { outcome: string; optionId?: string } }>('session/request_permission', {
			sessionId: 'acp-1',
			toolCall: { toolCallId: 'tc-perm', title: 'Run', kind: 'execute' },
			options: [
				{ optionId: 'allow_once', name: 'Allow', kind: 'allow_once' },
				{ optionId: 'reject_once', name: 'Reject', kind: 'reject_once' },
			],
		});
		const confirmation = await pending.p;
		assert.strictEqual(bridge.respondToPermissionRequest(confirmation.state.toolCallId, true), true);
		assert.strictEqual(bridge.respondToPermissionRequest(confirmation.state.toolCallId, false), false);
		assert.deepStrictEqual(await permission, { outcome: { outcome: 'selected', optionId: 'allow_once' } });
	});
});

suite('ACP MCP conversion', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('toAcpMcpServers maps local and remote MCP configs', () => {
		assert.deepStrictEqual(toAcpMcpServers({
			local: { type: McpServerType.LOCAL, command: 'uvx', args: ['server'], env: { TOKEN: 'x' } },
			remote: { type: McpServerType.REMOTE, url: 'https://example.test/mcp' },
		}), [
			{ type: 'stdio', name: 'local', command: 'uvx', args: ['server'], env: [{ name: 'TOKEN', value: 'x' }] },
			{ type: 'http', name: 'remote', url: 'https://example.test/mcp', headers: undefined },
		]);
	});
});
