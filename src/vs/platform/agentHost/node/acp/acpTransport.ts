/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as acp from '@agentclientprotocol/sdk';
import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from 'child_process';
import { PassThrough, Readable, Writable } from 'stream';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, toDisposable, type IDisposable } from '../../../../base/common/lifecycle.js';
import { isWindows } from '../../../../base/common/platform.js';
import type { IAcpAgentDefinition } from './acpAgentConfig.js';
import { resolveAcpBinCommand } from './acpBuiltInAgents.js';

export interface IAcpTransportExit {
	readonly code: number | null;
	readonly signal: NodeJS.Signals | null;
}

export interface IAcpTransport extends IDisposable {
	readonly connection: acp.ClientSideConnection;
	readonly onDidExit: Event<IAcpTransportExit>;
	setClient(client: acp.Client): void;
}

export type IAcpTransportFactory = (definition: IAcpAgentDefinition, cwd?: string) => IAcpTransport;

class StreamAcpTransport extends Disposable implements IAcpTransport {
	private readonly _client = new DelegatingAcpClient();
	private readonly _onDidExit = this._register(new Emitter<IAcpTransportExit>());
	readonly onDidExit = this._onDidExit.event;
	readonly connection: acp.ClientSideConnection;
	private _didExit = false;

	constructor(readable: Readable, writable: Writable, extra?: IDisposable) {
		super();
		const stream = acp.ndJsonStream(
			Writable.toWeb(writable),
			Readable.toWeb(readable) as ReadableStream<Uint8Array>,
		);
		this.connection = new acp.ClientSideConnection(() => this._client, stream);
		void this.connection.closed.then(() => this.fireExit({ code: null, signal: null }));
		if (extra) {
			this._register(extra);
		}
	}

	fireExit(exit: IAcpTransportExit): void {
		if (this._didExit) {
			return;
		}
		this._didExit = true;
		this._onDidExit.fire(exit);
	}

	setClient(client: acp.Client): void {
		this._client.setDelegate(client);
	}
}

function quoteWindowsCmdToken(value: string): string {
	return `"${value.replace(/"/g, '""')}"`;
}

function spawnAcpProcess(command: string, args: readonly string[], options: SpawnOptionsWithoutStdio): ChildProcessWithoutNullStreams {
	if (isWindows && /\.(cmd|bat)$/i.test(command)) {
		return spawn(quoteWindowsCmdToken(command), args.map(quoteWindowsCmdToken), {
			...options,
			shell: true,
		});
	}
	return spawn(command, [...args], options);
}

export function spawnAcpTransport(definition: IAcpAgentDefinition, cwd?: string): IAcpTransport {
	const child: ChildProcessWithoutNullStreams = spawnAcpProcess(resolveAcpBinCommand(definition.command), definition.args ?? [], {
		cwd,
		env: { ...process.env, ...definition.env },
		stdio: ['pipe', 'pipe', 'pipe'],
		windowsHide: true,
	});
	const transport = new StreamAcpTransport(child.stdout, child.stdin, toDisposable(() => {
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
export function createLinkedAcpTransports(toAgent: (connection: acp.AgentSideConnection) => acp.Agent): { client: IAcpTransport; agent: acp.AgentSideConnection } {
	const clientToAgent = new PassThrough();
	const agentToClient = new PassThrough();
	const client = new StreamAcpTransport(agentToClient, clientToAgent, toDisposable(() => {
		clientToAgent.destroy();
		agentToClient.destroy();
	}));
	const agent = new acp.AgentSideConnection(toAgent, acp.ndJsonStream(
		Writable.toWeb(agentToClient),
		Readable.toWeb(clientToAgent) as ReadableStream<Uint8Array>,
	));
	return {
		client,
		agent,
	};
}

class DelegatingAcpClient implements acp.Client {
	private _delegate: acp.Client | undefined;

	setDelegate(delegate: acp.Client): void {
		this._delegate = delegate;
	}

	requestPermission(params: acp.RequestPermissionRequest): acp.MaybePromise<acp.RequestPermissionResponse> {
		return this._requireDelegate().requestPermission(params);
	}

	sessionUpdate(params: acp.SessionNotification): acp.MaybePromise<void> {
		return this._requireDelegate().sessionUpdate(params);
	}

	writeTextFile(params: acp.WriteTextFileRequest): acp.MaybePromise<acp.WriteTextFileResponse | void> {
		return this._requireDelegate().writeTextFile?.(params);
	}

	readTextFile(params: acp.ReadTextFileRequest): acp.MaybePromise<acp.ReadTextFileResponse> {
		const delegate = this._requireDelegate();
		if (!delegate.readTextFile) {
			throw new Error('ACP client does not support reading text files');
		}
		return delegate.readTextFile(params);
	}

	extMethod(method: string, params: Record<string, unknown>): acp.MaybePromise<Record<string, unknown>> {
		const delegate = this._requireDelegate();
		if (!delegate.extMethod) {
			throw new Error(`ACP client does not support extension method ${method}`);
		}
		return delegate.extMethod(method, params);
	}

	private _requireDelegate(): acp.Client {
		if (!this._delegate) {
			throw new Error('ACP client bridge is not connected');
		}
		return this._delegate;
	}
}
