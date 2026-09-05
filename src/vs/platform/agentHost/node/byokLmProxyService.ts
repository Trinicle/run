/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../instantiation/common/instantiation.js';

export interface IByokLmProxyHandle {
	readonly endpoint: string | undefined;
	dispose(): void;
}

export const IByokLmProxyService = createDecorator<IByokLmProxyService>('byokLmProxyService');

export interface IByokLmProxyService {
	readonly _serviceBrand: undefined;
	start(): Promise<IByokLmProxyHandle>;
	dispose(): void;
}

/**
 * No-op BYOK proxy. In-process Copilot SDK adapters that consumed this
 * loopback server have been replaced by spawned ACP agents.
 */
export class NullByokLmProxyService implements IByokLmProxyService {
	declare readonly _serviceBrand: undefined;

	start(): Promise<IByokLmProxyHandle> {
		return Promise.reject(new Error('BYOK is not supported in this agent host'));
	}

	dispose(): void { }
}
