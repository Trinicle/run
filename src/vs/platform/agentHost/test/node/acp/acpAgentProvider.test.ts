/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import * as acp from '@agentclientprotocol/sdk';
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
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IAgentHostProviderService } from '../../../node/agentHostProviderService.js';
import { AcpAgentProvider, registerAcpAgentProviders, resolveAcpAgentDefinitions, toAcpMcpServers } from '../../../node/acp/acpAgentProvider.js';
import { AcpClientBridge } from '../../../node/acp/acpClientBridge.js';
import { AcpEventMapper } from '../../../node/acp/acpEventMapper.js';
import { AcpSessionManager } from '../../../node/acp/acpSessionManager.js';
import { ACP_CLIENT_TOOLS_MCP_NAME } from '../../../node/acp/acpTypes.js';
import { createLinkedAcpTransports, type IAcpTransport } from '../../../node/acp/acpTransport.js';

class FakeAcpAgent extends Disposable implements acp.Agent {
	promptCount = 0;
	authenticateCount = 0;
	lastAuthMethodId: string | undefined;
	readonly loadedSessionIds: string[] = [];
	lastNewSessionParams: acp.NewSessionRequest | undefined;
	private readonly _promptGates: DeferredPromise<void>[] = [];

	constructor(
		readonly connection: acp.AgentSideConnection,
		private readonly _options: {
			readonly autoCompletePrompt?: boolean;
			readonly loadSession?: boolean;
			readonly authMethods?: readonly acp.AuthMethod[];
			readonly onPrompt?: (params: acp.PromptRequest) => Promise<void> | void;
		} = {},
	) {
		super();
	}

	completeNextPrompt(): void {
		this._promptGates.shift()?.complete();
	}

	initialize(params: acp.InitializeRequest): acp.InitializeResponse {
		return {
			protocolVersion: params.protocolVersion,
			agentCapabilities: { loadSession: this._options.loadSession === true, mcpCapabilities: { acp: true } },
			authMethods: this._options.authMethods ? [...this._options.authMethods] : [],
		};
	}

	newSession(params: acp.NewSessionRequest): acp.NewSessionResponse {
		this.lastNewSessionParams = params;
		return { sessionId: 'acp-1' };
	}

	authenticate(params: acp.AuthenticateRequest): void {
		this.authenticateCount++;
		this.lastAuthMethodId = params.methodId;
	}

	loadSession(params: acp.LoadSessionRequest): void {
		this.loadedSessionIds.push(params.sessionId);
	}

	async prompt(params: acp.PromptRequest): Promise<acp.PromptResponse> {
		this.promptCount++;
		await this._options.onPrompt?.(params);
		if (this._options.autoCompletePrompt === false) {
			const gate = new DeferredPromise<void>();
			this._promptGates.push(gate);
			await gate.p;
		}
		return { stopReason: 'end_turn' };
	}

	cancel(): void { }
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

	test('resolveAcpAgentDefinitions includes built-ins when env is empty', () => {
		const ids = resolveAcpAgentDefinitions(undefined, undefined).map(definition => definition.id);
		assert.deepStrictEqual(ids, ['copilotcli', 'claude', 'codex']);
	});

	test('user ACP id is an extra agent; same id overrides only that built-in', () => {
		const definitions = resolveAcpAgentDefinitions(undefined, [
			{ id: 'gemini', command: 'gemini', args: ['--acp'] },
			{ id: 'claude', command: 'my-claude' },
		]);
		assert.strictEqual(definitions.find(definition => definition.id === 'claude')?.command, 'my-claude');
		assert.strictEqual(definitions.find(definition => definition.id === 'gemini')?.command, 'gemini');
		assert.strictEqual(definitions.find(definition => definition.id === 'copilotcli')?.command, 'copilot');
		assert.ok(definitions.some(definition => definition.id === 'codex'));
	});

	test('resolveAcpAgentDefinitions prefers the env JSON over root config', () => {
		const definitions = resolveAcpAgentDefinitions('[{"id":"env","command":"env-bin"}]', [{ id: 'root', command: 'root-bin' }]);
		assert.ok(definitions.some(definition => definition.id === 'env' && definition.command === 'env-bin'));
		assert.ok(!definitions.some(definition => definition.id === 'root'));
		assert.ok(definitions.some(definition => definition.id === 'copilotcli'));
	});

	test('registerAcpAgentProviders registers one provider per definition', () => {
		const registered: string[] = [];
		const providers = new Map<string, { id: string }>();
		const instantiationService = {
			createInstance: (_ctor: unknown, definition: { id: string }) => ({ id: definition.id, dispose() { } }),
		};
		const providerService = {
			getProvider: (id: string) => providers.get(id),
			registerProvider: (provider: { id: string }) => {
				registered.push(provider.id);
				providers.set(provider.id, provider);
			},
		};
		const store = registerAcpAgentProviders(
			instantiationService as IInstantiationService,
			providerService as unknown as IAgentHostProviderService,
			resolveAcpAgentDefinitions(undefined, [{ id: 'gemini', command: 'gemini' }]),
		);
		store.dispose();
		assert.deepStrictEqual(registered, ['copilotcli', 'claude', 'codex', 'gemini']);
	});

	test('buildAgentSdkEnv forwards ACP agent definitions', () => {
		const env = buildAgentSdkEnv({
			acpAgents: [{ id: 'my-agent', command: 'my-agent-cli', args: ['--acp'] }],
		}, {});
		assert.strictEqual(env[AgentHostAcpAgentsEnvVar], JSON.stringify([{ id: 'my-agent', command: 'my-agent-cli', args: ['--acp'] }]));
	});

	test('createChat + sendMessage maps ACP text into AgentSignals then completes the turn', async () => {
		let fake!: FakeAcpAgent;
		const { client } = createLinkedAcpTransports(connection => fake = new FakeAcpAgent(connection, {
			onPrompt: async () => {
				await connection.sessionUpdate({
					sessionId: 'acp-1',
					update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Hello' } },
				});
				await connection.sessionUpdate({
					sessionId: 'acp-1',
					update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: ' world' } },
				});
			},
		}));
		store.add(client);
		store.add(fake!);

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
		let fake!: FakeAcpAgent;
		const { client } = createLinkedAcpTransports(connection => fake = new FakeAcpAgent(connection, { autoCompletePrompt: false }));
		store.add(client);
		store.add(fake!);
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
		let fake!: FakeAcpAgent;
		const { client, agent } = createLinkedAcpTransports(connection => fake = new FakeAcpAgent(connection));
		store.add(client);
		store.add(fake!);
		const provider = createProvider(client, {
			docs: { type: McpServerType.LOCAL, command: 'npx', args: ['-y', 'docs-mcp'] },
		});
		const session = AgentSession.uri(definition.id, 'session-tools');
		const chat = URI.parse(buildDefaultChatUri(session.toString()));
		const active = provider.getOrCreateActiveClient(chat, session, { clientId: 'window-a' });
		active.tools = [{ name: 'editor_open', description: 'Open a file', inputSchema: { type: 'object', properties: {} } }];

		await provider.chats.createChat(chat, session);
		const servers = fake.lastNewSessionParams?.mcpServers ?? [];
		const acpTools = servers.find(server => 'type' in server && server.type === 'acp') as (acp.McpServerAcp & { type: 'acp' }) | undefined;
		assert.ok(acpTools);
		assert.strictEqual(acpTools.name, ACP_CLIENT_TOOLS_MCP_NAME);
		assert.ok(servers.some(server => !('type' in server) && server.name === 'docs' && 'command' in server && server.command === 'npx'));

		const connect = await agent.request<{ connectionId: string }>('mcp/connect', { serverId: acpTools.serverId });
		const listed = await agent.request<{ tools: { name: string }[] }>('mcp/message', {
			connectionId: connect.connectionId,
			method: 'tools/list',
		});
		assert.deepStrictEqual(listed.tools.map(tool => tool.name), ['editor_open']);
	});
});

suite('ACP auth and session load', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const definition = { id: 'acp-test', command: 'fake-acp', name: 'ACP Test' };

	test('authenticate then loadSession on resume when the agent advertises both', async () => {
		let fake!: FakeAcpAgent;
		const { client } = createLinkedAcpTransports(connection => fake = new FakeAcpAgent(connection, {
			loadSession: true,
			authMethods: [{ id: 'github', name: 'GitHub' }],
		}));
		store.add(client);
		store.add(fake!);

		const fileService = store.add(new FileService(new NullLogService()));
		const provider = store.add(new AcpAgentProvider(
			definition,
			() => client,
			new NullLogService(),
			fileService as IFileService,
			createConfigService(),
		));
		const session = AgentSession.uri(definition.id, 'session-resume');
		const chat = URI.parse(buildDefaultChatUri(session.toString()));

		assert.strictEqual(await provider.authenticate('github', 'token-1'), true);
		assert.strictEqual(fake.authenticateCount, 1);
		assert.strictEqual(fake.lastAuthMethodId, 'github');

		await provider.materializeChat(chat, session, JSON.stringify({ acpSessionId: 'acp-resume-1', cwd: '/tmp' }));
		assert.deepStrictEqual(fake.loadedSessionIds, ['acp-resume-1']);
	});

	test('skips terminal auth methods when picking authenticate methodId', async () => {
		let fake!: FakeAcpAgent;
		const { client } = createLinkedAcpTransports(connection => fake = new FakeAcpAgent(connection, {
			authMethods: [
				{ type: 'terminal', id: 'tui', name: 'Terminal' },
				{ id: 'github', name: 'GitHub' },
			],
		}));
		store.add(client);
		store.add(fake!);

		const fileService = store.add(new FileService(new NullLogService()));
		const provider = store.add(new AcpAgentProvider(
			definition,
			() => client,
			new NullLogService(),
			fileService as IFileService,
			createConfigService(),
		));

		assert.strictEqual(await provider.authenticate('github', 'token-1'), true);
		assert.strictEqual(fake.authenticateCount, 1);
		assert.strictEqual(fake.lastAuthMethodId, 'github');
	});
});

suite('ACP client bridge permissions', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('first AHP confirmation wins; later clients are ignored', async () => {
		const { client, agent } = createLinkedAcpTransports(() => ({
			initialize: params => ({
				protocolVersion: params.protocolVersion,
				agentCapabilities: { loadSession: false },
				authMethods: [],
			}),
			newSession: () => ({ sessionId: 'acp-1' }),
			authenticate: () => { },
			prompt: () => ({ stopReason: 'end_turn' }),
			cancel: () => { },
		}));
		store.add(client);

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
		client.setClient(bridge);

		const permission = agent.requestPermission({
			sessionId: 'acp-1',
			toolCall: { toolCallId: 'tc-perm', title: 'Run', kind: 'execute', status: 'pending' },
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
			{ name: 'local', command: 'uvx', args: ['server'], env: [{ name: 'TOKEN', value: 'x' }] },
			{ type: 'http', name: 'remote', url: 'https://example.test/mcp', headers: [] },
		]);
	});
});
