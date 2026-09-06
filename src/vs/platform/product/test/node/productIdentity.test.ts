/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';

suite('Thea product identity', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	function loadProductJson(): Record<string, unknown> {
		return JSON.parse(readFileSync(join(process.cwd(), 'product.json'), 'utf8')) as Record<string, unknown>;
	}

	test('display and machine identity is Thea', () => {
		const product = loadProductJson();
		assert.strictEqual(product.nameShort, 'Thea');
		assert.strictEqual(product.nameLong, 'Thea');
		assert.strictEqual(product.applicationName, 'thea');
		assert.strictEqual(product.dataFolderName, '.thea');
		assert.strictEqual(product.sharedDataFolderName, '.thea-shared');
		assert.strictEqual(product.serverApplicationName, 'thea-server');
		assert.strictEqual(product.serverDataFolderName, '.thea-server');
		assert.strictEqual(product.tunnelApplicationName, 'thea-tunnel');
		assert.strictEqual(product.urlProtocol, 'thea');
		assert.strictEqual(product.linuxIconName, 'thea');
		assert.strictEqual(product.win32MutexName, 'theaeditor');
		assert.strictEqual(product.win32DirName, 'Thea');
		assert.strictEqual(product.win32NameVersion, 'Thea');
		assert.strictEqual(product.win32RegValueName, 'Thea');
		assert.strictEqual(product.win32AppUserModelId, 'Thea.Editor');
		assert.strictEqual(product.win32ShellNameShort, '&Thea');
		assert.strictEqual(product.win32TunnelServiceMutex, 'thea-tunnelservice');
		assert.strictEqual(product.win32TunnelMutex, 'thea-tunnel');
		assert.strictEqual(product.darwinBundleIdentifier, 'com.thea.editor');
		assert.strictEqual(product.agentsTelemetryAppName, 'thea-agents');
	});

	test('default chat provider is Thea', () => {
		const product = loadProductJson();
		const agent = product.defaultChatAgent as { provider: { default: { id: string; name: string } } };
		assert.strictEqual(agent.provider.default.id, 'thea');
		assert.strictEqual(agent.provider.default.name, 'Thea');
	});

	test('branding extension is thea.thea-product', () => {
		const manifest = JSON.parse(readFileSync(join(process.cwd(), 'extensions/thea-product/package.json'), 'utf8')) as {
			name: string;
			publisher: string;
			contributes: { commands: { command: string }[]; walkthroughs: { id: string }[] };
		};
		assert.strictEqual(manifest.publisher, 'thea');
		assert.strictEqual(manifest.name, 'thea-product');
		assert.strictEqual(manifest.contributes.commands[0].command, 'thea.welcome.open');
		assert.strictEqual(manifest.contributes.walkthroughs[0].id, 'thea.welcome');
	});
});
