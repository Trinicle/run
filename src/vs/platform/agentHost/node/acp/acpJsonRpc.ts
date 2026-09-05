/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Readable, Writable } from 'stream';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import {
	ACP_JSONRPC_VERSION,
	isAcpJsonRpcError,
	isAcpJsonRpcNotification,
	isAcpJsonRpcRequest,
	isAcpJsonRpcSuccess,
	type IAcpJsonRpcError,
	type IAcpJsonRpcMessage,
	type IAcpJsonRpcNotification,
	type IAcpJsonRpcRequest,
} from './acpTypes.js';

export const enum AcpJsonRpcErrorCode {
	ParseError = -32700,
	InvalidRequest = -32600,
	MethodNotFound = -32601,
	InvalidParams = -32602,
	InternalError = -32603,
}

export class AcpJsonRpcError extends Error {
	constructor(
		readonly code: number,
		message: string,
		readonly data?: unknown,
	) {
		super(message);
		this.name = 'AcpJsonRpcError';
	}
}

export interface IAcpIncomingRequest {
	readonly id: string | number;
	readonly method: string;
	readonly params: unknown;
}

/**
 * NDJSON JSON-RPC 2.0 peer used by ACP stdio transports.
 */
export class AcpJsonRpcPeer extends Disposable {
	private _nextId = 1;
	private readonly _pending = new Map<string | number, { resolve: (value: unknown) => void; reject: (error: unknown) => void }>();
	private _buffer = '';
	private readonly _onNotification = this._register(new Emitter<IAcpJsonRpcNotification>());
	readonly onNotification = this._onNotification.event;
	private readonly _onRequest = this._register(new Emitter<IAcpIncomingRequest>());
	readonly onRequest = this._onRequest.event;
	private readonly _onDidClose = this._register(new Emitter<void>());
	readonly onDidClose = this._onDidClose.event;

	constructor(
		private readonly _readable: Readable,
		private readonly _writable: Writable,
	) {
		super();
		const onData = (chunk: Buffer | string) => this._onData(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
		const onEnd = () => {
			this._rejectAll(new AcpJsonRpcError(AcpJsonRpcErrorCode.InternalError, 'ACP transport closed'));
			this._onDidClose.fire();
		};
		this._readable.on('data', onData);
		this._readable.on('end', onEnd);
		this._readable.on('error', onEnd);
		this._register({
			dispose: () => {
				this._readable.off('data', onData);
				this._readable.off('end', onEnd);
				this._readable.off('error', onEnd);
				this._rejectAll(new AcpJsonRpcError(AcpJsonRpcErrorCode.InternalError, 'ACP transport disposed'));
			},
		});
	}

	sendRequest<T>(method: string, params?: unknown): Promise<T> {
		const id = this._nextId++;
		const message: IAcpJsonRpcRequest = params === undefined
			? { jsonrpc: ACP_JSONRPC_VERSION, id, method }
			: { jsonrpc: ACP_JSONRPC_VERSION, id, method, params };
		return new Promise<T>((resolve, reject) => {
			this._pending.set(id, { resolve: value => resolve(value as T), reject });
			this._write(message);
		});
	}

	sendNotification(method: string, params?: unknown): void {
		const message: IAcpJsonRpcNotification = params === undefined
			? { jsonrpc: ACP_JSONRPC_VERSION, method }
			: { jsonrpc: ACP_JSONRPC_VERSION, method, params };
		this._write(message);
	}

	sendResult(id: string | number, result: unknown): void {
		this._write({ jsonrpc: ACP_JSONRPC_VERSION, id, result });
	}

	sendError(id: string | number, code: number, message: string, data?: unknown): void {
		const error: IAcpJsonRpcError['error'] = data === undefined ? { code, message } : { code, message, data };
		this._write({ jsonrpc: ACP_JSONRPC_VERSION, id, error });
	}

	private _write(message: IAcpJsonRpcMessage): void {
		this._writable.write(`${JSON.stringify(message)}\n`);
	}

	private _onData(chunk: string): void {
		this._buffer += chunk;
		let newline = this._buffer.indexOf('\n');
		while (newline >= 0) {
			const line = this._buffer.slice(0, newline).replace(/\r$/, '');
			this._buffer = this._buffer.slice(newline + 1);
			if (line.trim().length > 0) {
				this._dispatchLine(line);
			}
			newline = this._buffer.indexOf('\n');
		}
	}

	private _dispatchLine(line: string): void {
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch {
			return;
		}
		if (!parsed || typeof parsed !== 'object') {
			return;
		}
		const message = parsed as IAcpJsonRpcMessage;
		if (isAcpJsonRpcRequest(message)) {
			this._onRequest.fire({ id: message.id, method: message.method, params: message.params });
			return;
		}
		if (isAcpJsonRpcNotification(message)) {
			this._onNotification.fire(message);
			return;
		}
		if (isAcpJsonRpcSuccess(message)) {
			const pending = this._pending.get(message.id);
			if (pending) {
				this._pending.delete(message.id);
				pending.resolve(message.result);
			}
			return;
		}
		if (isAcpJsonRpcError(message)) {
			const pending = this._pending.get(message.id);
			if (pending) {
				this._pending.delete(message.id);
				pending.reject(new AcpJsonRpcError(message.error.code, message.error.message, message.error.data));
			}
		}
	}

	private _rejectAll(error: Error): void {
		for (const pending of this._pending.values()) {
			pending.reject(error);
		}
		this._pending.clear();
	}
}

export type { Event };
