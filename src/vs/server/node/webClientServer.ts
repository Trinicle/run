/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createReadStream, promises } from 'fs';
import type * as http from 'http';
import { getMediaMime } from '../../base/common/mime.js';
import { extname } from '../../base/common/path.js';
import { ILogService } from '../../platform/log/common/log.js';

const textMimeType: { [ext: string]: string | undefined } = {
	'.html': 'text/html',
	'.js': 'text/javascript',
	'.json': 'application/json',
	'.css': 'text/css',
	'.svg': 'image/svg+xml',
};

/**
 * Return an error to the client.
 */
export async function serveError(req: http.IncomingMessage, res: http.ServerResponse, errorCode: number, errorMessage: string): Promise<void> {
	res.writeHead(errorCode, { 'Content-Type': 'text/plain' });
	res.end(errorMessage);
}

export const enum CacheControl {
	NO_CACHING, ETAG, NO_EXPIRY
}

/**
 * Serve a file at a given path or 404 if the file is missing.
 */
export async function serveFile(filePath: string, cacheControl: CacheControl, logService: ILogService, req: http.IncomingMessage, res: http.ServerResponse, responseHeaders: Record<string, string>): Promise<void> {
	try {
		const stat = await promises.stat(filePath); // throws an error if file doesn't exist
		if (cacheControl === CacheControl.ETAG) {

			// Check if file modified since
			const etag = `W/"${[stat.ino, stat.size, stat.mtime.getTime()].join('-')}"`; // weak validator (https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/ETag)
			responseHeaders['Etag'] = etag;
			if (req.headers['if-none-match'] === etag) {
				res.writeHead(304, responseHeaders);
				return void res.end();
			}
		} else if (cacheControl === CacheControl.NO_EXPIRY) {
			responseHeaders['Cache-Control'] = 'public, max-age=31536000';
		} else if (cacheControl === CacheControl.NO_CACHING) {
			responseHeaders['Cache-Control'] = 'no-store';
		}

		responseHeaders['Content-Type'] = textMimeType[extname(filePath)] || getMediaMime(filePath) || 'text/plain';

		// Create the stream first and wait for it to open before sending
		// headers so that errors (e.g. ENOENT race) can still produce a
		// proper 404 response instead of aborting a half-sent 200.
		const fileStream = createReadStream(filePath);
		await new Promise<void>((resolve, reject) => {
			fileStream.on('error', reject);
			fileStream.on('open', () => {
				// File opened successfully - send headers and pipe
				res.writeHead(200, responseHeaders);
				fileStream.pipe(res);
				// Destroy the read stream if the response is closed prematurely
				// (e.g. client disconnect) to avoid leaking the file descriptor.
				res.once('close', () => fileStream.destroy());
				fileStream.on('end', resolve);
				// Replace the initial error handler now that headers are sent
				fileStream.removeAllListeners('error');
				fileStream.on('error', error => {
					logService.error(error);
					console.error(error.toString());
					res.destroy();
				});
			});
		});
	} catch (error) {
		if (error.code !== 'ENOENT') {
			logService.error(error);
			console.error(error.toString());
		} else {
			logService.trace(`File not found: ${filePath}`);
		}

		res.writeHead(404, { 'Content-Type': 'text/plain' });
		return void res.end('Not found');
	}
}
