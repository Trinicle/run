/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as acp from '@agentclientprotocol/sdk';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { ResourceMap } from '../../../../base/common/map.js';
import { observableValue, type IObservable } from '../../../../base/common/observable.js';
import { hasKey } from '../../../../base/common/types.js';
import { URI } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { localize } from '../../../../nls.js';
import { IFileService } from '../../../files/common/files.js';
import { IInstantiationService } from '../../../instantiation/common/instantiation.js';
import { ILogService } from '../../../log/common/log.js';
import {
	AgentSession,
	resolveAgentChatContext,
	type AgentChatMigrationResult,
	type AgentChatOperationContext,
	type AgentProvider,
	type AgentSignal,
	type IActiveClient,
	type IAgent,
	type IAgentChatConfigCompletionsParams,
	type IAgentChatContext,
	type IAgentChatMetadata,
	type IAgentChats,
	type IAgentCreateChatOptions,
	type IAgentCreateChatResult,
	type IAgentDescriptor,
	type IAgentDiscoveredChat,
	type IAgentMaterializeChatEvent,
	type IAgentModelInfo,
	type IAgentResolveChatConfigParams,
	type IAgentSpawnChatEvent,
} from '../../common/agent.js';
import { AgentHostMcpServersConfigKey, platformRootSchema, type AgentHostMcpServers } from '../../common/agentHostSchema.js';
import { McpServerType, type IMcpServerConfiguration } from '../../../mcp/common/mcpPlatformTypes.js';
import { ChatInputResponseKind, type ClientPluginCustomization, type Customization, type MessageAttachment, type ToolCallResult, type ToolDefinition, type Turn } from '../../common/state/sessionState.js';
import type { ResolveSessionConfigResult, SessionConfigCompletionsResult } from '../../common/state/protocol/commands.js';
import { IAgentConfigurationService } from '../agentConfigurationService.js';
import { IAgentHostProviderService } from '../agentHostProviderService.js';
import { ActiveClientToolSet } from '../activeClientState.js';
import { AgentHostAcpAgentsEnvVar } from '../../common/agentService.js';
import { IAcpAgentDefinition, parseAcpAgentDefinitions } from './acpAgentConfig.js';
import { BUILTIN_ACP_AGENTS, mergeAcpAgentDefinitions } from './acpBuiltInAgents.js';
import { AcpClientBridge } from './acpClientBridge.js';
import { AcpEventMapper } from './acpEventMapper.js';
import { AcpSessionManager } from './acpSessionManager.js';
import { spawnAcpTransport, type IAcpTransport, type IAcpTransportFactory } from './acpTransport.js';
import {
	ACP_CLIENT_TOOLS_MCP_NAME,
	ACP_PROTOCOL_VERSION,
	agentSupportsAcpMcp,
	agentSupportsStdioMcp,
	type IAcpMcpServer,
} from './acpTypes.js';

export { AgentHostAcpAgentsEnvVar };

interface IAcpProviderData {
	readonly acpSessionId: string;
	readonly cwd?: string;
}

interface IAcpChatRecord {
	readonly chat: URI;
	readonly session: URI;
	readonly createdAt: number;
	cwd: string | undefined;
	turns: Turn[];
}

/**
 * Agent Host provider that speaks ACP to a spawned agent process and AHP to
 * connected clients. Multi-client coordination stays in the AHP host; this
 * class serializes N clients onto one ACP conversation per chat.
 */
export class AcpAgentProvider extends Disposable implements IAgent {
	private readonly _onDidChatProgress = this._register(new Emitter<AgentSignal>());
	readonly onDidChatProgress = this._onDidChatProgress.event;
	private readonly _onDidMaterializeChat = this._register(new Emitter<IAgentMaterializeChatEvent>());
	readonly onDidMaterializeChat = this._onDidMaterializeChat.event;
	readonly onDidChangeChatData = Event.None;
	readonly onDidSpawnChat: Event<IAgentSpawnChatEvent> = Event.None;
	private readonly _onDidDiscoverChats = this._register(new Emitter<readonly IAgentDiscoveredChat[]>());
	readonly onDidDiscoverChats = this._onDidDiscoverChats.event;
	private readonly _models = observableValue<readonly IAgentModelInfo[]>(this, []);
	readonly models: IObservable<readonly IAgentModelInfo[]> = this._models;

	private _transport: IAcpTransport | undefined;
	private _initialize: Promise<acp.InitializeResponse> | undefined;
	private _initializeResult: acp.InitializeResponse | undefined;
	private _starting: Promise<AcpSessionManager> | undefined;
	private _sessions: AcpSessionManager | undefined;
	private _mapper: AcpEventMapper | undefined;
	private _bridge: AcpClientBridge | undefined;
	private readonly _chats = new ResourceMap<IAcpChatRecord>();
	private readonly _toolSet = new ActiveClientToolSet();
	private readonly _activeClients = new ResourceMap<Map<string, IActiveClient>>();
	private _authToken: string | undefined;

	constructor(
		private readonly _definition: IAcpAgentDefinition,
		private readonly _transportFactory: IAcpTransportFactory | undefined,
		@ILogService private readonly _logService: ILogService,
		@IFileService private readonly _fileService: IFileService,
		@IAgentConfigurationService private readonly _configurationService: IAgentConfigurationService,
	) {
		super();
	}

	get id(): AgentProvider {
		return this._definition.id;
	}

	getDescriptor(): IAgentDescriptor {
		return {
			provider: this.id,
			displayName: this._definition.name ?? this.id,
			description: this._definition.description ?? localize('agentHost.acp.providerDescription', "ACP agent ({0})", this._definition.command),
		};
	}

	readonly chats: IAgentChats = {
		createChat: (chat, context, options) => this._createChat(chat, context, options),
		disposeChat: (chat, context) => this._disposeChat(chat, context),
		releaseChat: async () => { },
		sendMessage: (chat, prompt, workingDirectories, attachments, turnId, _senderClientId, clientTypeOrContext, context) =>
			this._sendMessage(chat, prompt, workingDirectories, attachments, turnId, context ?? (typeof clientTypeOrContext === 'string' ? undefined : clientTypeOrContext)),
		abort: (chat, context) => this._abort(chat, context),
		changeModel: async () => { },
		changeAgent: async () => { },
		getMessages: async (chat) => this._chats.get(chat)?.turns ?? [],
	};

	async materializeChat(chat: URI, context: AgentChatOperationContext, providerData: string | undefined): Promise<IAgentCreateChatResult | void> {
		const session = resolveAgentChatContext(context, chat).configurationResource;
		const data = decodeProviderData(providerData);
		this._chats.set(chat, {
			chat,
			session,
			createdAt: Date.now(),
			cwd: data?.cwd,
			turns: this._chats.get(chat)?.turns ?? [],
		});
		if (data?.acpSessionId) {
			const manager = await this._ensureSessions();
			if (this._initializeResult?.agentCapabilities?.loadSession) {
				await this._transport!.connection.loadSession({
					sessionId: data.acpSessionId,
					cwd: data.cwd ?? '',
					mcpServers: this._mcpServersForNewSession(chat),
				});
			}
			manager.bindRestored(chat, session, data.acpSessionId, data.cwd);
			return { providerData };
		}
		return { providerData };
	}

	getOrCreateActiveClient(chat: URI, _context: URI | IAgentChatContext, client: { readonly clientId: string; readonly displayName?: string }): IActiveClient {
		let byClient = this._activeClients.get(chat);
		if (!byClient) {
			byClient = new Map();
			this._activeClients.set(chat, byClient);
		}
		const existing = byClient.get(client.clientId);
		if (existing) {
			return existing;
		}
		const toolSet = this._toolSet;
		let tools: readonly ToolDefinition[] = [];
		let customizations: readonly ClientPluginCustomization[] = [];
		const handle: IActiveClient = {
			clientId: client.clientId,
			displayName: client.displayName,
			get tools() { return tools; },
			set tools(value: readonly ToolDefinition[]) {
				tools = value;
				toolSet.set(client.clientId, value);
			},
			get customizations() { return customizations; },
			set customizations(value: readonly ClientPluginCustomization[]) {
				customizations = value;
			},
		};
		byClient.set(client.clientId, handle);
		return handle;
	}

	removeActiveClient(chat: URI, _context: URI | IAgentChatContext, clientId: string): void {
		this._activeClients.get(chat)?.delete(clientId);
		this._toolSet.delete(clientId);
	}

	onClientToolCallComplete(_chat: URI, toolCallId: string, result: ToolCallResult): void {
		this._bridge?.onClientToolCallComplete(toolCallId, result);
	}

	respondToPermissionRequest(requestId: string, approved: boolean): void {
		this._bridge?.respondToPermissionRequest(requestId, approved);
	}

	respondToUserInputRequest(_requestId: string, _response: ChatInputResponseKind): void { }

	async resolveChatConfig(params: IAgentResolveChatConfigParams): Promise<ResolveSessionConfigResult> {
		return { schema: { type: 'object', properties: {} }, values: params.config ?? {} };
	}

	getInheritedChatConfig(): undefined {
		return undefined;
	}

	async chatConfigCompletions(_params: IAgentChatConfigCompletionsParams): Promise<SessionConfigCompletionsResult> {
		return { items: [] };
	}

	async getChatCustomizations(_chat: URI, _context: URI | IAgentChatContext, hostCustomizations?: readonly Customization[]): Promise<readonly Customization[]> {
		return hostCustomizations ?? [];
	}

	async listChatsToMigrate(): Promise<AgentChatMigrationResult> {
		return [];
	}

	async getChatMetadata(chat: URI, context: URI | IAgentChatContext): Promise<IAgentChatMetadata | undefined> {
		const record = this._chats.get(chat);
		if (!record) {
			return undefined;
		}
		return {
			chat,
			startTime: record.createdAt,
			modifiedTime: record.createdAt,
			project: { uri: record.session, displayName: this.getDescriptor().displayName },
			workingDirectories: record.cwd ? [URI.file(record.cwd)] : undefined,
		};
	}

	getProtectedResources() {
		return [];
	}

	async authenticate(_resource: string, token: string): Promise<boolean> {
		this._authToken = token || undefined;
		const manager = await this._ensureSessions();
		void manager;
		const methodId = pickAcpAuthMethodId(this._initializeResult?.authMethods ?? []);
		if (!methodId) {
			return true;
		}
		await this._transport!.connection.authenticate({ methodId });
		return true;
	}

	async shutdown(): Promise<void> {
		this._transport?.dispose();
		this._transport = undefined;
		this._initialize = undefined;
		this._initializeResult = undefined;
		this._starting = undefined;
		this._sessions = undefined;
		this._mapper = undefined;
		this._bridge = undefined;
	}

	private async _createChat(chat: URI, context: AgentChatOperationContext, options?: IAgentCreateChatOptions): Promise<IAgentCreateChatResult> {
		const session = resolveAgentChatContext(context, chat).configurationResource;
		const cwd = resolveWorkingDirectoryPath(options?.workingDirectories);
		this._chats.set(chat, { chat, session, createdAt: Date.now(), cwd, turns: [] });
		const manager = await this._ensureSessions();
		const acpSession = await manager.createAcpSession(chat, session, cwd, this._mcpServersForNewSession(chat));
		return { providerData: encodeProviderData({ acpSessionId: acpSession.acpSessionId, cwd }) };
	}

	private async _disposeChat(chat: URI, _context: AgentChatOperationContext): Promise<void> {
		this._bridge?.unregisterChatToolsServer(chat);
		this._sessions?.remove(chat);
		this._chats.delete(chat);
		this._activeClients.delete(chat);
	}

	private async _sendMessage(
		chat: URI,
		prompt: string,
		workingDirectories: readonly URI[] | URI | undefined,
		attachments: readonly MessageAttachment[] | undefined,
		turnId: string | undefined,
		context: URI | IAgentChatContext | undefined,
	): Promise<void> {
		const session = context ? resolveAgentChatContext(context, chat).configurationResource : AgentSession.uri(this.id, generateUuid());
		let record = this._chats.get(chat);
		if (!record) {
			const cwd = resolveWorkingDirectoryPath(workingDirectories);
			record = { chat, session, createdAt: Date.now(), cwd, turns: [] };
			this._chats.set(chat, record);
		}
		const manager = await this._ensureSessions();
		let acpSession = manager.getByChat(chat);
		if (!acpSession) {
			acpSession = await manager.createAcpSession(chat, record.session, record.cwd, this._mcpServersForNewSession(chat));
		}
		const resolvedTurnId = turnId ?? generateUuid();
		this._mapper!.beginTurn(resolvedTurnId);
		await manager.beginTurn(acpSession, resolvedTurnId);
		try {
			const contents: acp.PromptRequest['prompt'] = [{ type: 'text', text: prompt }];
			if (attachments) {
				for (const attachment of attachments) {
					contents.push({ type: 'text', text: `\n[attachment] ${JSON.stringify(attachment)}` });
				}
			}
			await this._transport!.connection.prompt({
				sessionId: acpSession.acpSessionId,
				prompt: contents,
			});
			this._onDidChatProgress.fire(this._mapper!.mapTurnComplete({ chat, turnId: resolvedTurnId }));
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (message.toLowerCase().includes('cancel')) {
				this._onDidChatProgress.fire(this._mapper!.mapTurnCancelled({ chat, turnId: resolvedTurnId }));
			} else {
				this._onDidChatProgress.fire(this._mapper!.mapTurnError({ chat, turnId: resolvedTurnId }, message));
			}
			throw error;
		} finally {
			manager.endTurn(acpSession);
		}
	}

	private async _abort(chat: URI, _context: AgentChatOperationContext): Promise<void> {
		const acpSession = this._sessions?.getByChat(chat);
		if (!acpSession) {
			return;
		}
		await this._transport?.connection.cancel({ sessionId: acpSession.acpSessionId });
	}

	private async _ensureSessions(): Promise<AcpSessionManager> {
		if (!this._starting) {
			this._starting = this._startSessions();
		}
		try {
			return await this._starting;
		} catch (error) {
			this._starting = undefined;
			throw error;
		}
	}

	private async _startSessions(): Promise<AcpSessionManager> {
		const factory = this._transportFactory ?? spawnAcpTransport;
		const transport = factory({
			...this._definition,
			env: {
				...this._definition.env,
				...(this._authToken ? { GITHUB_TOKEN: this._authToken, GH_TOKEN: this._authToken } : {}),
			},
		});
		this._register(transport);
		this._transport = transport;
		const mapper = new AcpEventMapper();
		this._mapper = mapper;
		const sessions = new AcpSessionManager(transport);
		this._sessions = sessions;
		const emit = (signal: AgentSignal) => this._onDidChatProgress.fire(signal);
		const bridge = new AcpClientBridge(sessions, mapper, this._toolSet, emit, this._fileService, () => {
			for (const record of this._chats.values()) {
				const live = sessions.getByChat(record.chat);
				if (live?.turnId) {
					return { chat: live.chat, turnId: live.turnId };
				}
			}
			return undefined;
		});
		this._bridge = bridge;
		transport.setClient(bridge);
		this._initialize = transport.connection.initialize({
			protocolVersion: ACP_PROTOCOL_VERSION,
			clientCapabilities: {
				fs: { readTextFile: true, writeTextFile: true },
			},
			clientInfo: { name: 'vscode-agent-host', title: 'VS Code Agent Host', version: '1.0.0' },
		}).catch(error => {
			this._logService.error('[AcpAgentProvider] initialize failed', error);
			throw error;
		});
		this._initializeResult = await this._initialize;
		return sessions;
	}

	private _mcpServersForNewSession(chat?: URI): acp.NewSessionRequest['mcpServers'] {
		const servers: IAcpMcpServer[] = [];
		const init = this._initializeResult;
		const includeAcpTools = !init || agentSupportsAcpMcp(init);
		if (includeAcpTools && this._bridge) {
			const serverId = chat ? this._bridge.registerChatToolsServer(chat) : this._bridge.clientToolsServerId;
			servers.push({ type: 'acp', name: ACP_CLIENT_TOOLS_MCP_NAME, serverId });
		}
		const configured = this._configurationService.getRootValue(platformRootSchema, AgentHostMcpServersConfigKey) ?? {};
		if (!init || agentSupportsStdioMcp(init) || agentSupportsAcpMcp(init)) {
			servers.push(...toAcpMcpServers(configured));
		}
		return servers as acp.NewSessionRequest['mcpServers'];
	}
}

function resolveWorkingDirectoryPath(workingDirectories: readonly URI[] | URI | undefined): string | undefined {
	if (!workingDirectories) {
		return undefined;
	}
	if (Array.isArray(workingDirectories)) {
		return workingDirectories[0]?.fsPath;
	}
	return (workingDirectories as URI).fsPath;
}

function pickAcpAuthMethodId(methods: readonly acp.AuthMethod[]): string | undefined {
	for (const method of methods) {
		if (!hasKey(method, { type: true }) || method.type !== 'terminal') {
			return method.id;
		}
	}
	return undefined;
}

function encodeProviderData(data: IAcpProviderData): string {
	return JSON.stringify(data);
}

function decodeProviderData(value: string | undefined): IAcpProviderData | undefined {
	if (!value) {
		return undefined;
	}
	try {
		const parsed = JSON.parse(value) as IAcpProviderData;
		return typeof parsed.acpSessionId === 'string' ? parsed : undefined;
	} catch {
		return undefined;
	}
}

export function toAcpMcpServers(configured: AgentHostMcpServers): IAcpMcpServer[] {
	const servers: IAcpMcpServer[] = [];
	for (const [name, config] of Object.entries(configured)) {
		const converted = toAcpMcpServer(name, config);
		if (converted) {
			servers.push(converted);
		}
	}
	return servers;
}

function toAcpMcpServer(name: string, config: IMcpServerConfiguration): IAcpMcpServer | undefined {
	switch (config.type) {
		case McpServerType.LOCAL: {
			const env = config.env
				? Object.entries(config.env)
					.filter((entry): entry is [string, string] => typeof entry[1] === 'string')
					.map(([envName, value]) => ({ name: envName, value }))
				: [];
			return {
				name,
				command: config.command,
				args: config.args ? [...config.args] : [],
				env,
			};
		}
		case McpServerType.REMOTE: {
			const headers = config.headers
				? Object.entries(config.headers).map(([headerName, value]) => ({ name: headerName, value }))
				: [];
			return { type: 'http', name, url: config.url, headers };
		}
		default: {
			const _exhaustive: never = config;
			void _exhaustive;
			return undefined;
		}
	}
}

export function resolveAcpAgentDefinitions(envValue: string | undefined, rootValue: unknown): IAcpAgentDefinition[] {
	const fromEnv = parseAcpAgentDefinitions(envValue);
	const user = fromEnv.length > 0 ? fromEnv : parseAcpAgentDefinitions(rootValue);
	return mergeAcpAgentDefinitions(BUILTIN_ACP_AGENTS, user);
}

export function registerAcpAgentProviders(
	instantiationService: IInstantiationService,
	providerService: IAgentHostProviderService,
	definitions: readonly IAcpAgentDefinition[],
	transportFactory?: IAcpTransportFactory,
): DisposableStore {
	const store = new DisposableStore();
	for (const definition of definitions) {
		if (providerService.getProvider(definition.id)) {
			continue;
		}
		const provider = instantiationService.createInstance(AcpAgentProvider, definition, transportFactory);
		providerService.registerProvider(provider);
	}
	return store;
}
