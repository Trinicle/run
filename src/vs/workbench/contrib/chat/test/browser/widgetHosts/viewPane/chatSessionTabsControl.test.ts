/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../../base/test/common/utils.js';
import { URI } from '../../../../../../../base/common/uri.js';
import {
	ChatSessionTabsControl,
	getChatSessionTabCloseTooltip,
	getChatSessionTabTitle,
	NEW_THEA_SESSION_TITLE,
} from '../../../../browser/widgetHosts/viewPane/chatSessionTabsControl.js';
import { IKeybindingService } from '../../../../../../../platform/keybinding/common/keybinding.js';

suite('ChatSessionTabsControl', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	test('empty titles use New Thea Session', () => {
		assert.strictEqual(
			getChatSessionTabTitle(undefined),
			NEW_THEA_SESSION_TITLE,
		);
		assert.strictEqual(getChatSessionTabTitle(''), NEW_THEA_SESSION_TITLE);
		assert.strictEqual(getChatSessionTabTitle('   '), NEW_THEA_SESSION_TITLE);
		assert.strictEqual(
			getChatSessionTabTitle('Fix the build'),
			'Fix the build',
		);
	});

	test('close tooltip includes keybinding like editor tabs', () => {
		const keybindingService = {
			lookupKeybinding: (commandId: string) =>
				commandId === 'workbench.action.closeActiveEditor'
					? { getLabel: () => 'Ctrl+F4' }
					: undefined,
		} as IKeybindingService;

		assert.strictEqual(
			getChatSessionTabCloseTooltip(keybindingService),
			'Close (Ctrl+F4)',
		);
	});

	test('renders editor-style tabs with icon, label, and close', () => {
		const host = document.createElement('div');
		const selected: URI[] = [];
		const closed: URI[] = [];
		const first = URI.parse('vscode-local-chat-session://local/one');
		const second = URI.parse('vscode-local-chat-session://local/two');
		const control = disposables.add(
			new ChatSessionTabsControl(host, {
				onSelect: (resource) => selected.push(resource),
				onClose: (resource) => closed.push(resource),
				getCloseKeybinding: () => 'Ctrl+F4',
			}),
		);

		const tabsContainer = host.querySelector('.thea-chat-tabs');
		assert.ok(tabsContainer);
		assert.ok(tabsContainer.classList.contains('modern-ui-editor-tab-group'));
		assert.ok(tabsContainer.classList.contains('modern-ui-editor-tab-group-active'));
		assert.ok(host.querySelector('.monaco-scrollable-element'));

		control.setTabs([
			{ resource: first, title: NEW_THEA_SESSION_TITLE, active: true },
			{ resource: second, title: NEW_THEA_SESSION_TITLE, active: false },
		]);

		const tabs = tabsContainer.querySelectorAll('.thea-chat-tab');
		assert.strictEqual(tabs.length, 2);
		assert.ok(tabs[0].classList.contains('modern-ui-editor-tab'));
		assert.ok(tabs[0].querySelector('.thea-chat-tab-fill.modern-ui-editor-tab-fill'));
		assert.ok(tabs[0].querySelector('.thea-chat-tab-icon'));
		assert.strictEqual(
			tabs[0].querySelector('.thea-chat-tab-label.modern-ui-editor-tab-label')?.textContent,
			NEW_THEA_SESSION_TITLE,
		);
		assert.ok(tabs[0].querySelector('.thea-chat-tab-actions .action-label.codicon'));
		assert.strictEqual(
			tabs[0].querySelector('.thea-chat-tab-actions .action-label')?.getAttribute('aria-label'),
			'Close (Ctrl+F4)',
		);
		assert.ok(tabs[0].classList.contains('active'));
		assert.strictEqual(tabs[0].getAttribute('aria-selected'), 'true');
		assert.strictEqual(tabs[1].getAttribute('aria-selected'), 'false');

		(tabs[1] as HTMLElement).click();
		assert.deepStrictEqual(
			selected.map((uri) => uri.toString()),
			[second.toString()],
		);

		(
			tabs[0].querySelector('.thea-chat-tab-actions .action-label') as HTMLElement
		).click();
		assert.deepStrictEqual(
			closed.map((uri) => uri.toString()),
			[first.toString()],
		);
	});
});
