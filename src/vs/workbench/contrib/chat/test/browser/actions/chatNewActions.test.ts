/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { KeyCode, KeyMod } from '../../../../../../base/common/keyCodes.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { MenuId } from '../../../../../../platform/actions/common/actions.js';
import { ContextKeyExpr, ContextKeyValue, IContext } from '../../../../../../platform/contextkey/common/contextkey.js';
import { NewChatAction } from '../../../browser/actions/chatNewActions.js';
import { ChatViewId } from '../../../browser/chat.js';
import { ChatContextKeys } from '../../../common/actions/chatContextKeys.js';
import { ChatAgentLocation } from '../../../common/constants.js';

function context(values: Record<string, ContextKeyValue>): IContext {
	return { getValue: <T extends ContextKeyValue>(key: string) => values[key] as T | undefined };
}

suite('Chat new actions', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('Ctrl+N opens a new editor from a chat editor without clearing the current chat', () => {
		const action = new NewChatAction();
		const keybinding = Array.isArray(action.desc.keybinding) ? action.desc.keybinding[0] : action.desc.keybinding;
		assert.ok(keybinding?.when);

		const chatContext = {
			[ChatContextKeys.enabled.key]: true,
			[ChatContextKeys.inChatSession.key]: true,
			[ChatContextKeys.location.key]: ChatAgentLocation.Chat,
		};
		const chatViewContext = context({
			...chatContext,
			[ChatContextKeys.inChatEditor.key]: false,
		});
		const chatEditorContext = context({
			...chatContext,
			[ChatContextKeys.inChatEditor.key]: true,
		});

		assert.deepStrictEqual({
			primary: keybinding.primary,
			newChatInView: keybinding.when.evaluate(chatViewContext),
			newChatInEditor: keybinding.when.evaluate(chatEditorContext),
		}, {
			primary: KeyMod.CtrlCmd | KeyCode.KeyN,
			newChatInView: true,
			newChatInEditor: false,
		});
	});

	test('chat view title plus creates a new chat without a dropdown', () => {
		const action = new NewChatAction();
		const menus = Array.isArray(action.desc.menu) ? action.desc.menu : [action.desc.menu];
		const viewTitle = menus.find(menu => menu && 'id' in menu && menu.id === MenuId.ViewTitle);

		assert.ok(viewTitle);
		assert.deepStrictEqual({
			group: viewTitle.group,
			order: viewTitle.order,
			isChatView: viewTitle.when?.equals(ContextKeyExpr.equals('view', ChatViewId)),
			precondition: viewTitle.precondition,
			splitButton: 'isSplitButton' in viewTitle ? viewTitle.isSplitButton : false,
		}, {
			group: 'navigation',
			order: -1,
			isChatView: true,
			precondition: null,
			splitButton: false,
		});
	});
});
