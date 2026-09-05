/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import type { AgentSignal, IAgentActionSignal, IAgentToolPendingConfirmationSignal } from '../../common/agent.js';
import { ActionType } from '../../common/state/sessionActions.js';
import { ConfirmationOptionKind, type ConfirmationOption } from '../../common/state/protocol/state.js';
import { ResponsePartKind, ToolCallConfirmationReason, ToolCallStatus, createErrorResponsePart } from '../../common/state/sessionState.js';
import type { IAcpRequestPermissionParams, IAcpSessionUpdate, IAcpSessionUpdateParams } from './acpTypes.js';

export interface IAcpMapperContext {
	readonly chat: URI;
	readonly turnId: string;
}

/**
 * Converts ACP `session/update` notifications and permission requests into
 * {@link AgentSignal}s that {@link AgentSideEffects} already understands.
 */
export class AcpEventMapper {
	private readonly _markdownPartIds = new Map<string, string>();
	private readonly _startedToolCalls = new Set<string>();
	private readonly _turnStartedAt = new Map<string, number>();

	beginTurn(turnId: string): void {
		this._turnStartedAt.set(turnId, Date.now());
		this._markdownPartIds.delete(turnId);
	}

	mapUpdate(context: IAcpMapperContext, update: IAcpSessionUpdate): readonly AgentSignal[] {
		const kind = update.sessionUpdate;
		switch (kind) {
			case 'agent_message_chunk':
			case 'agent_message':
			case 'message_chunk':
				return this._mapTextChunk(context, textFromContent(update.content));
			case 'agent_thought_chunk':
			case 'agent_thought':
				return this._mapReasoning(context, textFromContent(update.content));
			case 'tool_call':
			case 'tool_call_update':
				return this._mapToolCall(context, update);
			default:
				return [];
		}
	}

	mapPermissionRequest(context: IAcpMapperContext, params: IAcpRequestPermissionParams): { signals: readonly AgentSignal[]; toolCallId: string } {
		const toolCallId = resolvePermissionToolCallId(params);
		const title = params.title ?? params.toolCall?.title ?? params.subject?.command ?? 'Approve agent action';
		const signals: AgentSignal[] = [];
		if (!this._startedToolCalls.has(toolCallId)) {
			signals.push(...this._mapToolCall(context, {
				sessionUpdate: 'tool_call',
				toolCallId,
				title: typeof title === 'string' ? title : 'Tool',
				kind: params.toolCall?.kind,
				status: 'pending',
				rawInput: params.toolCall?.rawInput,
			}));
		}
		const options = toConfirmationOptions(params.options);
		const pending: IAgentToolPendingConfirmationSignal = {
			kind: 'pending_confirmation',
			chat: context.chat,
			state: {
				status: ToolCallStatus.PendingConfirmation,
				toolCallId,
				toolName: params.toolCall?.kind ?? 'acp',
				displayName: typeof title === 'string' ? title : 'Tool',
				invocationMessage: params.description ?? title,
				confirmationTitle: title,
				toolInput: params.toolCall?.rawInput !== undefined ? JSON.stringify(params.toolCall.rawInput) : undefined,
				options: options.length > 0 ? options : undefined,
			},
			permissionKind: permissionKindFromTool(params.toolCall?.kind ?? params.subject?.type),
		};
		signals.push(pending);
		return { signals, toolCallId };
	}

	mapTurnComplete(context: IAcpMapperContext): IAgentActionSignal {
		return {
			kind: 'action',
			resource: context.chat,
			action: {
				type: ActionType.ChatTurnComplete,
				turnId: context.turnId,
				duration: this._duration(context.turnId),
			},
		};
	}

	mapTurnCancelled(context: IAcpMapperContext): IAgentActionSignal {
		return {
			kind: 'action',
			resource: context.chat,
			action: {
				type: ActionType.ChatTurnCancelled,
				turnId: context.turnId,
				duration: this._duration(context.turnId),
			},
		};
	}

	mapTurnError(context: IAcpMapperContext, message: string): IAgentActionSignal {
		return {
			kind: 'action',
			resource: context.chat,
			action: {
				type: ActionType.ChatError,
				turnId: context.turnId,
				duration: this._duration(context.turnId),
				part: createErrorResponsePart({ errorType: 'acp', message }),
			},
		};
	}

	isSessionUpdate(params: unknown): params is IAcpSessionUpdateParams {
		if (!params || typeof params !== 'object') {
			return false;
		}
		const record = params as Record<string, unknown>;
		return typeof record.sessionId === 'string' && !!record.update && typeof record.update === 'object';
	}

	private _mapTextChunk(context: IAcpMapperContext, text: string): AgentSignal[] {
		if (text.length === 0) {
			return [];
		}
		const existingPartId = this._markdownPartIds.get(context.turnId);
		if (!existingPartId) {
			const partId = generateUuid();
			this._markdownPartIds.set(context.turnId, partId);
			return [{
				kind: 'action',
				resource: context.chat,
				action: {
					type: ActionType.ChatResponsePart,
					turnId: context.turnId,
					part: { kind: ResponsePartKind.Markdown, id: partId, content: text },
				},
			}];
		}
		return [{
			kind: 'action',
			resource: context.chat,
			action: {
				type: ActionType.ChatDelta,
				turnId: context.turnId,
				partId: existingPartId,
				content: text,
			},
		}];
	}

	private _mapReasoning(context: IAcpMapperContext, text: string): AgentSignal[] {
		if (text.length === 0) {
			return [];
		}
		const partId = `reasoning-${context.turnId}`;
		return [{
			kind: 'action',
			resource: context.chat,
			action: {
				type: ActionType.ChatResponsePart,
				turnId: context.turnId,
				part: { kind: ResponsePartKind.Reasoning, id: partId, content: text },
			},
		}];
	}

	private _mapToolCall(context: IAcpMapperContext, update: IAcpSessionUpdate): AgentSignal[] {
		const toolCallId = String(update.toolCallId ?? update.toolCall?.toolCallId ?? generateUuid());
		const title = String(update.title ?? update.toolCall?.title ?? toolCallId);
		const status = String(update.status ?? update.toolCall?.status ?? 'pending');
		const signals: AgentSignal[] = [];
		if (!this._startedToolCalls.has(toolCallId)) {
			this._startedToolCalls.add(toolCallId);
			signals.push({
				kind: 'action',
				resource: context.chat,
				action: {
					type: ActionType.ChatToolCallStart,
					turnId: context.turnId,
					toolCallId,
					toolName: String(update.kind ?? update.toolCall?.kind ?? 'acp'),
					displayName: title,
				},
			});
		}
		if (status === 'completed' || status === 'failed' || status === 'cancelled') {
			signals.push({
				kind: 'action',
				resource: context.chat,
				action: {
					type: ActionType.ChatToolCallComplete,
					turnId: context.turnId,
					toolCallId,
					result: {
						success: status === 'completed',
						pastTenseMessage: title,
						error: status === 'completed' ? undefined : { message: title },
					},
				},
			});
			return signals;
		}
		if (status === 'in_progress' || status === 'running') {
			signals.push({
				kind: 'action',
				resource: context.chat,
				action: {
					type: ActionType.ChatToolCallReady,
					turnId: context.turnId,
					toolCallId,
					invocationMessage: title,
					confirmed: ToolCallConfirmationReason.NotNeeded,
				},
			});
		}
		return signals;
	}

	private _duration(turnId: string): number {
		const started = this._turnStartedAt.get(turnId);
		return started === undefined ? 0 : Math.max(0, Date.now() - started);
	}
}

function textFromContent(content: IAcpSessionUpdate['content']): string {
	if (!content) {
		return '';
	}
	if (typeof content === 'string') {
		return content;
	}
	if (typeof content.text === 'string') {
		return content.text;
	}
	return '';
}

function resolvePermissionToolCallId(params: IAcpRequestPermissionParams): string {
	return params.toolCall?.toolCallId
		?? params.subject?.toolCall?.toolCallId
		?? params.subject?.toolCallId
		?? generateUuid();
}

function toConfirmationOptions(options: IAcpRequestPermissionParams['options']): ConfirmationOption[] {
	if (!options) {
		return [];
	}
	return options.map((option, index) => ({
		id: option.optionId,
		label: option.name,
		kind: option.kind?.includes('reject') || option.kind?.includes('deny')
			? ConfirmationOptionKind.Deny
			: ConfirmationOptionKind.Approve,
		group: index,
	}));
}

function permissionKindFromTool(kind: string | undefined): IAgentToolPendingConfirmationSignal['permissionKind'] {
	switch (kind) {
		case 'execute':
		case 'command':
			return 'shell';
		case 'edit':
		case 'write':
			return 'write';
		case 'read':
			return 'read';
		case 'fetch':
			return 'url';
		default:
			return 'custom-tool';
	}
}
