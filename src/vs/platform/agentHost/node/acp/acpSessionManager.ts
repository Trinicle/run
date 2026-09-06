/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as acp from '@agentclientprotocol/sdk';
import { URI } from '../../../../base/common/uri.js';
import type { IAcpTransport } from './acpTransport.js';

export interface IAcpChatSession {
	readonly chat: URI;
	readonly session: URI;
	readonly acpSessionId: string;
	readonly cwd: string | undefined;
	turnId: string | undefined;
	promptInFlight: boolean;
	queued: Array<() => void>;
}

export interface IAcpSessionLookup {
	readonly byChat: IAcpChatSession;
	readonly byAcpSessionId: IAcpChatSession;
}

/**
 * Maps AHP chat URIs onto ACP `sessionId`s for one agent process.
 */
export class AcpSessionManager {
	private readonly _byChat = new Map<string, IAcpChatSession>();
	private readonly _byAcpSessionId = new Map<string, IAcpChatSession>();

	constructor(private readonly _transport: IAcpTransport) { }

	getByChat(chat: URI): IAcpChatSession | undefined {
		return this._byChat.get(chat.toString());
	}

	getByAcpSessionId(sessionId: string): IAcpChatSession | undefined {
		return this._byAcpSessionId.get(sessionId);
	}

	async createAcpSession(chat: URI, session: URI, cwd: string | undefined, mcpServers: acp.NewSessionRequest['mcpServers']): Promise<IAcpChatSession> {
		const existing = this._byChat.get(chat.toString());
		if (existing) {
			return existing;
		}
		const result = await this._transport.connection.newSession({
			cwd: cwd ?? '',
			mcpServers,
		});
		const record: IAcpChatSession = {
			chat,
			session,
			acpSessionId: result.sessionId,
			cwd,
			turnId: undefined,
			promptInFlight: false,
			queued: [],
		};
		this._byChat.set(chat.toString(), record);
		this._byAcpSessionId.set(result.sessionId, record);
		return record;
	}

	bindRestored(chat: URI, session: URI, acpSessionId: string, cwd: string | undefined): IAcpChatSession {
		const record: IAcpChatSession = {
			chat,
			session,
			acpSessionId,
			cwd,
			turnId: undefined,
			promptInFlight: false,
			queued: [],
		};
		this._byChat.set(chat.toString(), record);
		this._byAcpSessionId.set(acpSessionId, record);
		return record;
	}

	remove(chat: URI): void {
		const record = this._byChat.get(chat.toString());
		if (!record) {
			return;
		}
		this._byChat.delete(chat.toString());
		this._byAcpSessionId.delete(record.acpSessionId);
		for (const queued of record.queued.splice(0)) {
			queued();
		}
	}

	/**
	 * Serializes ACP `session/prompt` so a second client cannot overlap the
	 * in-flight turn. Callers must invoke {@link endTurn} when the prompt settles.
	 */
	async beginTurn(record: IAcpChatSession, turnId: string): Promise<void> {
		if (record.promptInFlight) {
			await new Promise<void>(resolve => {
				record.queued.push(() => {
					record.turnId = turnId;
					resolve();
				});
			});
			return;
		}
		record.promptInFlight = true;
		record.turnId = turnId;
	}

	endTurn(record: IAcpChatSession): void {
		const next = record.queued.shift();
		if (next) {
			next();
			return;
		}
		record.promptInFlight = false;
		record.turnId = undefined;
	}
}
