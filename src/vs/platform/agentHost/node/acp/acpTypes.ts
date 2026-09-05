/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as acp from '@agentclientprotocol/sdk';

/**
 * Wire types for the Agent Client Protocol subset the agent host speaks.
 * Shapes follow ACP v1 with v2 fields accepted where they appear.
 */

export const ACP_JSONRPC_VERSION = '2.0';
export const ACP_PROTOCOL_VERSION = 1;
export const ACP_CLIENT_TOOLS_MCP_NAME = 'vscode-client-tools';

export interface IAcpJsonRpcRequest {
	readonly jsonrpc: typeof ACP_JSONRPC_VERSION;
	readonly id: string | number;
	readonly method: string;
	readonly params?: unknown;
}

export interface IAcpJsonRpcNotification {
	readonly jsonrpc: typeof ACP_JSONRPC_VERSION;
	readonly method: string;
	readonly params?: unknown;
}

export interface IAcpJsonRpcSuccess {
	readonly jsonrpc: typeof ACP_JSONRPC_VERSION;
	readonly id: string | number;
	readonly result: unknown;
}

export interface IAcpJsonRpcError {
	readonly jsonrpc: typeof ACP_JSONRPC_VERSION;
	readonly id: string | number;
	readonly error: { readonly code: number; readonly message: string; readonly data?: unknown };
}

export type IAcpJsonRpcMessage = IAcpJsonRpcRequest | IAcpJsonRpcNotification | IAcpJsonRpcSuccess | IAcpJsonRpcError;

export function isAcpJsonRpcRequest(message: IAcpJsonRpcMessage): message is IAcpJsonRpcRequest {
	return 'id' in message && 'method' in message && !('result' in message) && !('error' in message);
}

export function isAcpJsonRpcNotification(message: IAcpJsonRpcMessage): message is IAcpJsonRpcNotification {
	return !('id' in message) && 'method' in message;
}

export function isAcpJsonRpcSuccess(message: IAcpJsonRpcMessage): message is IAcpJsonRpcSuccess {
	return 'id' in message && 'result' in message && !('error' in message);
}

export function isAcpJsonRpcError(message: IAcpJsonRpcMessage): message is IAcpJsonRpcError {
	return 'id' in message && 'error' in message;
}

export interface IAcpImplementationInfo {
	readonly name: string;
	readonly title?: string;
	readonly version?: string;
}

export interface IAcpInitializeResult {
	readonly protocolVersion: number;
	readonly capabilities?: {
		readonly session?: {
			readonly mcp?: {
				readonly stdio?: object | null;
				readonly http?: object | null;
				readonly acp?: object | boolean | null;
			};
			readonly prompt?: object;
		};
		readonly mcpCapabilities?: {
			readonly stdio?: boolean;
			readonly http?: boolean;
			readonly acp?: boolean;
		};
	};
	readonly agentCapabilities?: Record<string, unknown>;
	readonly authMethods?: readonly unknown[];
	readonly info?: IAcpImplementationInfo;
}

export interface IAcpStdioMcpServer {
	readonly name: string;
	readonly command: string;
	readonly args: readonly string[];
	readonly env: readonly { readonly name: string; readonly value: string }[];
}

export interface IAcpHttpMcpServer {
	readonly type: 'http';
	readonly name: string;
	readonly url: string;
	readonly headers: readonly { readonly name: string; readonly value: string }[];
}

export interface IAcpChannelMcpServer {
	readonly type: 'acp';
	readonly name: string;
	readonly serverId: string;
}

export type IAcpMcpServer = IAcpStdioMcpServer | IAcpHttpMcpServer | IAcpChannelMcpServer;

export interface IAcpNewSessionResult {
	readonly sessionId: string;
}

export interface IAcpPromptContentText {
	readonly type: 'text';
	readonly text: string;
}

export type IAcpPromptContent = IAcpPromptContentText | { readonly type: string; [key: string]: unknown };

export interface IAcpSessionUpdateParams {
	readonly sessionId: string;
	readonly update: IAcpSessionUpdate;
}

export interface IAcpSessionUpdate {
	readonly sessionUpdate: string;
	readonly content?: { readonly type?: string; readonly text?: string;[key: string]: unknown };
	readonly toolCallId?: string;
	readonly title?: string;
	readonly kind?: string;
	readonly status?: string;
	readonly rawInput?: unknown;
	readonly locations?: readonly unknown[];
	readonly toolCall?: {
		readonly toolCallId?: string;
		readonly title?: string;
		readonly kind?: string;
		readonly status?: string;
		readonly rawInput?: unknown;
	};
	[key: string]: unknown;
}

export interface IAcpPermissionOption {
	readonly optionId: string;
	readonly name: string;
	readonly kind?: string;
}

export interface IAcpRequestPermissionParams {
	readonly sessionId: string;
	readonly title?: string;
	readonly description?: string;
	readonly toolCall?: {
		readonly toolCallId?: string;
		readonly title?: string;
		readonly kind?: string;
		readonly status?: string;
		readonly rawInput?: unknown;
	};
	readonly subject?: {
		readonly type?: string;
		readonly toolCall?: { readonly toolCallId?: string };
		readonly command?: string;
		readonly cwd?: string;
		readonly toolCallId?: string;
	};
	readonly options?: readonly IAcpPermissionOption[];
}

export interface IAcpFsReadTextFileParams {
	readonly sessionId: string;
	readonly path: string;
	readonly line?: number;
	readonly limit?: number;
}

export interface IAcpFsWriteTextFileParams {
	readonly sessionId: string;
	readonly path: string;
	readonly content: string;
}

export interface IAcpMcpConnectParams {
	readonly serverId?: string;
	readonly acpId?: string;
}

export interface IAcpMcpMessageParams {
	readonly connectionId: string;
	readonly method: string;
	readonly params?: unknown;
}

export function agentSupportsAcpMcp(result: acp.InitializeResponse): boolean {
	return result.agentCapabilities?.mcpCapabilities?.acp === true;
}

export function agentSupportsStdioMcp(result: acp.InitializeResponse): boolean {
	// Stdio MCP is the baseline ACP transport. The SDK capability bag only
	// flags http/sse/acp; treat stdio as available whenever initialize succeeded.
	return result.agentCapabilities !== undefined || result.protocolVersion !== undefined;
}
