/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { EventEmitter } from 'events';
import { tmpdir } from 'os';
import { join } from '../../../base/common/path.js';
import { NullLogService } from '../../../platform/log/common/log.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../base/test/common/utils.js';
import { CacheControl, serveError, serveFile } from '../../node/webClientServer.js';

class MockResponse extends EventEmitter {
	statusCode: number | undefined;
	headers: Record<string, string> = {};
	body = '';
	ended = false;

	writeHead(statusCode: number, headers?: Record<string, string>): this {
		this.statusCode = statusCode;
		if (headers) {
			this.headers = { ...this.headers, ...headers };
		}
		return this;
	}

	end(chunk?: string): this {
		if (chunk) {
			this.body += chunk;
		}
		this.ended = true;
		this.emit('finish');
		return this;
	}
}

suite('WebClientServer HTTP helpers', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('serveError writes the status and message', async () => {
		const res = new MockResponse();
		await serveError({} as never, res as never, 403, 'Forbidden.');
		assert.deepStrictEqual({
			statusCode: res.statusCode,
			body: res.body,
			contentType: res.headers['Content-Type'],
			ended: res.ended
		}, {
			statusCode: 403,
			body: 'Forbidden.',
			contentType: 'text/plain',
			ended: true
		});
	});

	test('serveFile returns 404 for a missing path', async () => {
		const res = new MockResponse();
		await serveFile(join(tmpdir(), 'vscode-reh-missing-file'), CacheControl.NO_CACHING, new NullLogService(), { headers: {} } as never, res as never, {});
		assert.deepStrictEqual({
			statusCode: res.statusCode,
			body: res.body
		}, {
			statusCode: 404,
			body: 'Not found'
		});
	});
});
