/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { PassThrough } from 'stream';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, toDisposable, type IDisposable } from '../../../../base/common/lifecycle.js';
import { AcpJsonRpcPeer, type IAcpIncomingRequest } from './acpJsonRpc.js';
import type { IAcpAgentDefinition } from './acpAgentConfig.js';

export interface IAcpTransportExit {
	readonly code: number | null;
	readonly signal: NodeJS.Signals | null;
}

export interface IAcpTransport extends IDisposable {
	readonly onNotification: Event<{ readonly method: string; readonly params?: unknown }>;
	readonly onRequest: Event<IAcpIncomingRequest>;
	readonly onDidExit: Event<IAcpTransportExit>;
	sendRequest<T>(method: string, params?: unknown): Promise<T>;
	sendNotification(method: string, params?: unknown): void;
	sendResult(id: string | number, result: unknown): void;
	sendError(id: string | number, code: number, message: string, data?: unknown): void;
}

export type IAcpTransportFactory = (definition: IAcpAgentDefinition, cwd?: string) => IAcpTransport;

class StreamAcpTransport extends Disposable implements IAcpTransport {
	private readonly _peer: AcpJsonRpcPeer;
	readonly onNotification: IAcpTransport['onNotification'];
	readonly onRequest: IAcpTransport['onRequest'];
	private readonly _onDidExit = this._register(new Emitter<IAcpTransportExit>());
	readonly onDidExit = this._onDidExit.event;

	constructor(peer: AcpJsonRpcPeer, extra?: IDisposable) {
		super();
		this._peer = this._register(peer);
		this.onNotification = this._peer.onNotification;
		this.onRequest = this._peer.onRequest;
		this._register(this._peer.onDidClose(() => this._onDidExit.fire({ code: null, signal: null })));
		if (extra) {
			this._register(extra);
		}
	}

	fireExit(exit: IAcpTransportExit): void {
		this._onDidExit.fire(exit);
	}

	sendRequest<T>(method: string, params?: unknown): Promise<T> {
		return this._peer.sendRequest<T>(method, params);
	}

	sendNotification(method: string, params?: unknown): void {
		this._peer.sendNotification(method, params);
	}

	sendResult(id: string | number, result: unknown): void {
		this._peer.sendResult(id, result);
	}

	sendError(id: string | number, code: number, message: string, data?: unknown): void {
		this._peer.sendError(id, code, message, data);
	}
}

export function spawnAcpTransport(definition: IAcpAgentDefinition, cwd?: string): IAcpTransport {
	const child: ChildProcessWithoutNullStreams = spawn(definition.command, definition.args ? [...definition.args] : [], {
		cwd,
		env: { ...process.env, ...definition.env },
		stdio: ['pipe', 'pipe', 'pipe'],
		windowsHide: true,
	});
	const peer = new AcpJsonRpcPeer(child.stdout, child.stdin);
	const transport = new StreamAcpTransport(peer, toDisposable(() => {
		if (!child.killed) {
			child.kill();
		}
	}));
	child.once('exit', (code, signal) => transport.fireExit({ code, signal }));
	return transport;
}

/**
 * Linked in-memory ACP transports for tests. Writes to `client` are read by
 * `agent`, and vice versa.
 */
export function createLinkedAcpTransports(): { client: IAcpTransport; agent: IAcpTransport } {
	const clientToAgent = new PassThrough();
	const agentToClient = new PassThrough();
	return {
		client: new StreamAcpTransport(new AcpJsonRpcPeer(agentToClient, clientToAgent)),
		agent: new StreamAcpTransport(new AcpJsonRpcPeer(clientToAgent, agentToClient)),
	};
}

export type { IAcpIncomingRequest };
