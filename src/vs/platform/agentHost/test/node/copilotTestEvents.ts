/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// =============================================================================
// Minimal session-event shapes for tests
// =============================================================================
// Used by mock-agent history fixtures. These are host-owned test shapes, not
// vendor SDK events.

export interface ISessionEventToolStart {
	type: 'tool.execution_start';
	/** Envelope-level sub-agent instance id; resolved to the parent tool call id via `subagent.started`. */
	agentId?: string;
	/** ISO 8601 envelope timestamp; the mapper uses it to restore turn timing. */
	timestamp?: string;
	data: {
		toolCallId: string;
		toolName: string;
		arguments?: unknown;
		mcpServerName?: string;
		mcpToolName?: string;
		toolDescription?: unknown;
		/** @deprecated Use the envelope-level {@link ISessionEventToolStart.agentId} instead. */
		parentToolCallId?: string;
	};
}

export interface ISessionEventToolComplete {
	type: 'tool.execution_complete';
	/** Envelope-level sub-agent instance id. See {@link ISessionEventToolStart.agentId}. */
	agentId?: string;
	/** ISO 8601 envelope timestamp; the mapper uses it to restore turn timing. */
	timestamp?: string;
	data: {
		toolCallId: string;
		success: boolean;
		result?: {
			content?: string;
			contents?: unknown[];
		};
		error?: { message: string; code?: string };
		isUserRequested?: boolean;
		toolTelemetry?: unknown;
		mcpServerName?: string;
		mcpToolName?: string;
		toolDescription?: unknown;
		/** @deprecated Use the envelope-level {@link ISessionEventToolComplete.agentId} instead. */
		parentToolCallId?: string;
	};
}

export interface ISessionEventMessage {
	type: 'assistant.message' | 'user.message';
	/** SDK envelope-level event id, used as the protocol turn id. */
	id?: string;
	/** Envelope-level sub-agent instance id. See {@link ISessionEventToolStart.agentId}. */
	agentId?: string;
	/** ISO 8601 envelope timestamp; the mapper uses it to restore turn timing. */
	timestamp?: string;
	data: {
		messageId?: string;
		interactionId?: string;
		content?: string;
		toolRequests?: readonly { toolCallId: string; name: string; arguments?: unknown; type?: 'function' | 'custom'; mcpServerName?: string; mcpToolName?: string; toolDescription?: unknown }[];
		reasoningOpaque?: string;
		reasoningText?: string;
		encryptedContent?: string;
		/** @deprecated Use the envelope-level {@link ISessionEventMessage.agentId} instead. */
		parentToolCallId?: string;
		/** Origin of the message; a non-`'user'` value marks an injected message that should be hidden. */
		source?: string;
		attachments?: readonly unknown[];
	};
}

export interface ISessionEventSkillInvoked {
	type: 'skill.invoked';
	id?: string;
	/** Envelope-level sub-agent instance id. */
	agentId?: string;
	data: { name?: string; skillName?: string };
}

export interface ISessionEventSubagentStarted {
	type: 'subagent.started';
	/** Envelope-level sub-agent instance id resolved back to {@link ISessionEventSubagentStarted.data.toolCallId}. */
	agentId?: string;
	data: {
		toolCallId: string;
		agentName: string;
		agentDisplayName: string;
		agentDescription: string;
	};
}

export interface ISessionEventAbort {
	type: 'abort';
	/** Envelope-level sub-agent instance id. */
	agentId?: string;
	data: {
		reason: string;
	};
}

export interface ISessionEventAssistantTurn {
	type: 'assistant.turn_start' | 'assistant.turn_end';
	agentId?: string;
	/** ISO 8601 envelope timestamp; the mapper uses it to restore turn timing. */
	timestamp?: string;
	data: {
		turnId: string;
		interactionId?: string;
	};
}

export interface ISessionEventSystemNotification {
	type: 'system.notification';
	id?: string;
	/** ISO 8601 envelope timestamp; the mapper uses it to restore turn timing. */
	timestamp?: string;
	data?: unknown;
}

export interface ISessionEventError {
	type: 'session.error';
	id?: string;
	agentId?: string;
	/** ISO 8601 envelope timestamp; the mapper uses it to restore turn timing. */
	timestamp?: string;
	data?: unknown;
}

/** Minimal event shape for session history mapping. */
export type ISessionEvent =
	| ISessionEventToolStart
	| ISessionEventToolComplete
	| ISessionEventMessage
	| ISessionEventSubagentStarted
	| ISessionEventSkillInvoked
	| ISessionEventAbort
	| ISessionEventAssistantTurn
	| ISessionEventSystemNotification
	| ISessionEventError
	| { type: string; agentId?: string; timestamp?: string; data?: unknown };
