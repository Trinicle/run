/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { DeferredPromise } from '../../../../base/common/async.js';
import { URI } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import type { IFileService } from '../../../files/common/files.js';
import type { AgentSignal } from '../../common/agent.js';
import { ActionType } from '../../common/state/sessionActions.js';
import { ToolCallConfirmationReason, ToolCallContributorKind, ToolResultContentType, type StringOrMarkdown, type ToolCallResult, type ToolDefinition } from '../../common/state/sessionState.js';
import { ActiveClientToolSet } from '../activeClientState.js';
import { AcpJsonRpcErrorCode } from './acpJsonRpc.js';
import type { IAcpIncomingRequest, IAcpTransport } from './acpTransport.js';
import { AcpEventMapper } from './acpEventMapper.js';
import type { AcpSessionManager } from './acpSessionManager.js';
import {
	ACP_CLIENT_TOOLS_MCP_NAME,
	type IAcpFsReadTextFileParams,
	type IAcpFsWriteTextFileParams,
	type IAcpMcpConnectParams,
	type IAcpMcpMessageParams,
	type IAcpPermissionOption,
	type IAcpRequestPermissionParams,
} from './acpTypes.js';

export interface IAcpPermissionOutcome {
	readonly outcome: 'selected' | 'cancelled';
	readonly optionId?: string;
}

interface IPendingPermission {
	readonly requestId: string | number;
	readonly toolCallId: string;
	readonly options: IAcpRequestPermissionParams['options'];
	readonly deferred: DeferredPromise<IAcpPermissionOutcome>;
}

/**
 * Handles ACP reverse requests: permissions (first AHP client wins),
 * filesystem methods, and MCP-over-ACP client-tool callbacks.
 */
export class AcpClientBridge {
	private readonly _pendingPermissions = new Map<string, IPendingPermission>();
	private readonly _mcpConnections = new Map<string, string>();
	private readonly _pendingClientTools = new Map<string, DeferredPromise<unknown>>();
	private _clientToolsServerId: string | undefined;

	constructor(
		private readonly _transport: IAcpTransport,
		private readonly _sessions: AcpSessionManager,
		private readonly _mapper: AcpEventMapper,
		private readonly _toolSet: ActiveClientToolSet,
		private readonly _emit: (signal: AgentSignal) => void,
		private readonly _fileService: IFileService | undefined,
		private readonly _activeTurn: () => { chat: URI; turnId: string } | undefined,
	) { }

	get clientToolsServerId(): string {
		this._clientToolsServerId ??= generateUuid();
		return this._clientToolsServerId;
	}

	async handleRequest(request: IAcpIncomingRequest): Promise<void> {
		try {
			const result = await this._dispatch(request);
			this._transport.sendResult(request.id, result);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this._transport.sendError(request.id, AcpJsonRpcErrorCode.InternalError, message);
		}
	}

	/**
	 * First confirmation for a given tool-call id wins; later AHP clients are ignored.
	 */
	respondToPermissionRequest(requestId: string, approved: boolean): boolean {
		const pending = this._pendingPermissions.get(requestId);
		if (!pending || pending.deferred.isSettled) {
			return false;
		}
		this._pendingPermissions.delete(requestId);
		pending.deferred.complete({
			outcome: 'selected',
			optionId: selectPermissionOptionId(pending.options, approved),
		});
		return true;
	}

	onClientToolCallComplete(toolCallId: string, result: ToolCallResult): boolean {
		const pending = this._pendingClientTools.get(toolCallId);
		if (!pending || pending.isSettled) {
			return false;
		}
		this._pendingClientTools.delete(toolCallId);
		pending.complete(toMcpToolResult(result));
		return true;
	}

	private async _dispatch(request: IAcpIncomingRequest): Promise<unknown> {
		switch (request.method) {
			case 'session/request_permission':
				return this._handlePermission(request);
			case 'fs/read_text_file':
				return this._handleReadTextFile(request.params as IAcpFsReadTextFileParams);
			case 'fs/write_text_file':
				return this._handleWriteTextFile(request.params as IAcpFsWriteTextFileParams);
			case 'mcp/connect':
				return this._handleMcpConnect(request.params as IAcpMcpConnectParams);
			case 'mcp/disconnect':
				this._mcpConnections.delete((request.params as { connectionId?: string })?.connectionId ?? '');
				return {};
			case 'mcp/message':
				return this._handleMcpMessage(request.params as IAcpMcpMessageParams);
			default:
				throw new Error(`Unhandled ACP reverse request: ${request.method}`);
		}
	}

	private async _handlePermission(request: IAcpIncomingRequest): Promise<{ outcome: { outcome: string; optionId?: string } }> {
		const params = (request.params ?? {}) as IAcpRequestPermissionParams;
		const session = this._sessions.getByAcpSessionId(params.sessionId);
		if (!session?.turnId) {
			return { outcome: { outcome: 'cancelled' } };
		}
		const { signals, toolCallId } = this._mapper.mapPermissionRequest({ chat: session.chat, turnId: session.turnId }, params);
		const pending: IPendingPermission = {
			requestId: request.id,
			toolCallId,
			options: params.options,
			deferred: new DeferredPromise<IAcpPermissionOutcome>(),
		};
		this._pendingPermissions.set(toolCallId, pending);
		for (const signal of signals) {
			this._emit(signal);
		}
		const outcome = await pending.deferred.p;
		if (outcome.outcome === 'cancelled') {
			return { outcome: { outcome: 'cancelled' } };
		}
		return { outcome: { outcome: 'selected', optionId: outcome.optionId } };
	}

	private async _handleReadTextFile(params: IAcpFsReadTextFileParams): Promise<{ content: string }> {
		if (!this._fileService) {
			throw new Error('Filesystem access is not available');
		}
		const file = await this._fileService.readFile(URI.file(params.path));
		let text = file.value.toString();
		if (params.line !== undefined || params.limit !== undefined) {
			const lines = text.split(/\r?\n/);
			const start = Math.max(0, (params.line ?? 1) - 1);
			const end = params.limit !== undefined ? start + params.limit : lines.length;
			text = lines.slice(start, end).join('\n');
		}
		return { content: text };
	}

	private async _handleWriteTextFile(params: IAcpFsWriteTextFileParams): Promise<null> {
		if (!this._fileService) {
			throw new Error('Filesystem access is not available');
		}
		await this._fileService.writeFile(URI.file(params.path), VSBuffer.fromString(params.content));
		return null;
	}

	private _handleMcpConnect(params: IAcpMcpConnectParams): { connectionId: string } {
		const connectionId = generateUuid();
		this._mcpConnections.set(connectionId, params.acpId);
		return { connectionId };
	}

	private async _handleMcpMessage(params: IAcpMcpMessageParams): Promise<unknown> {
		const acpId = this._mcpConnections.get(params.connectionId);
		if (acpId !== this.clientToolsServerId && acpId !== ACP_CLIENT_TOOLS_MCP_NAME) {
			throw new Error(`Unknown MCP-over-ACP connection: ${params.connectionId}`);
		}
		switch (params.method) {
			case 'tools/list':
				return { tools: this._toolSet.merged().map(toMcpTool) };
			case 'tools/call':
				return this._callClientTool(params);
			default:
				throw new Error(`Unsupported MCP method: ${params.method}`);
		}
	}

	private async _callClientTool(params: IAcpMcpMessageParams): Promise<unknown> {
		const call = (params.params ?? {}) as { name?: string; arguments?: unknown };
		const toolName = call.name ?? '';
		const owner = this._toolSet.ownerOf(toolName);
		const toolCallId = generateUuid();
		const current = this._activeTurn();
		if (!current) {
			throw new Error(`No in-flight ACP turn for client tool ${toolName}`);
		}
		this._emit({
			kind: 'action',
			resource: current.chat,
			action: {
				type: ActionType.ChatToolCallStart,
				turnId: current.turnId,
				toolCallId,
				toolName,
				displayName: toolName,
				contributor: owner ? { kind: ToolCallContributorKind.Client, clientId: owner } : undefined,
			},
		});
		this._emit({
			kind: 'action',
			resource: current.chat,
			action: {
				type: ActionType.ChatToolCallReady,
				turnId: current.turnId,
				toolCallId,
				invocationMessage: toolName,
				confirmed: ToolCallConfirmationReason.NotNeeded,
				contributor: owner ? { kind: ToolCallContributorKind.Client, clientId: owner } : undefined,
			},
		});
		const deferred = new DeferredPromise<unknown>();
		this._pendingClientTools.set(toolCallId, deferred);
		return deferred.p;
	}
}

function toMcpTool(tool: ToolDefinition): Record<string, unknown> {
	return {
		name: tool.name,
		description: tool.description ?? tool.title ?? tool.name,
		inputSchema: tool.inputSchema ?? { type: 'object', properties: {} },
	};
}

function stringifyMarkdown(value: StringOrMarkdown): string {
	return typeof value === 'string' ? value : value.markdown;
}

function toMcpToolResult(result: ToolCallResult): Record<string, unknown> {
	const content = result.content?.map(block => {
		if (block.type === ToolResultContentType.Text) {
			return { type: 'text', text: block.text };
		}
		return { type: 'text', text: stringifyMarkdown(result.pastTenseMessage) };
	}) ?? [{ type: 'text', text: stringifyMarkdown(result.pastTenseMessage) }];
	return {
		content,
		isError: !result.success,
		structuredContent: result.structuredContent,
	};
}

function selectPermissionOptionId(options: IAcpRequestPermissionParams['options'], approved: boolean): string {
	if (!options || options.length === 0) {
		return approved ? 'allow_once' : 'reject_once';
	}
	const match = options.find(option => approved ? isAllowOption(option) : isRejectOption(option));
	if (match) {
		return match.optionId;
	}
	return approved ? options[0].optionId : options[options.length - 1].optionId;
}

function isAllowOption(option: IAcpPermissionOption): boolean {
	const kind = option.kind ?? '';
	return kind.includes('allow') || kind.includes('approve');
}

function isRejectOption(option: IAcpPermissionOption): boolean {
	const kind = option.kind ?? '';
	return kind.includes('reject') || kind.includes('deny');
}
