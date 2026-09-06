/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ACTIVITY_BAR_DEFAULT_WIDTH, SIDEBAR_COMPACT_CONTENT_WIDTH, SIDEBAR_EXPANDED_MIN_WIDTH, sidebarHeaderWidth } from '../../../../browser/parts/sidebar/theaSidebarChrome.js';

suite('Thea sidebar chrome', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('sidebar width constants', () => {
		assert.strictEqual(SIDEBAR_EXPANDED_MIN_WIDTH, 170);
		assert.strictEqual(SIDEBAR_COMPACT_CONTENT_WIDTH, 0);
		assert.strictEqual(ACTIVITY_BAR_DEFAULT_WIDTH, 48);
	});

	test('sidebarHeaderWidth', () => {
		assert.strictEqual(sidebarHeaderWidth({ compact: true }), ACTIVITY_BAR_DEFAULT_WIDTH);
		assert.strictEqual(sidebarHeaderWidth({ compact: false, sidebarWidth: 280 }), ACTIVITY_BAR_DEFAULT_WIDTH + 280);
		assert.strictEqual(sidebarHeaderWidth({ compact: false, sidebarWidth: 200 }), ACTIVITY_BAR_DEFAULT_WIDTH + 200);
	});
});
