/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { KeyCode, KeyMod } from '../../../../../base/common/keyCodes.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { ServicesAccessor } from '../../../../../editor/browser/editorExtensions.js';
import { localize2 } from '../../../../../nls.js';
import { Action2, registerAction2 } from '../../../../../platform/actions/common/actions.js';
import { ContextKeyExpr } from '../../../../../platform/contextkey/common/contextkey.js';
import { KeybindingWeight } from '../../../../../platform/keybinding/common/keybindingsRegistry.js';
import { ChatContextKeys } from '../../common/actions/chatContextKeys.js';
import { ConfirmedReason, IChatToolInvocation, ToolConfirmKind } from '../../common/chatService/chatService.js';
import { isResponseVM } from '../../common/model/chatViewModel.js';
import { IChatWidgetService } from '../chat.js';
import { CHAT_CATEGORY } from './chatActions.js';

export const AcceptToolConfirmationActionId = 'workbench.action.chat.acceptTool';
export const SkipToolConfirmationActionId = 'workbench.action.chat.skipTool';
export const AcceptToolPostConfirmationActionId = 'workbench.action.chat.acceptToolPostExecution';
export const SkipToolPostConfirmationActionId = 'workbench.action.chat.skipToolPostExecution';

export interface IToolConfirmationActionContext {
	readonly sessionResource?: URI;
}

abstract class ToolConfirmationAction extends Action2 {
	protected abstract getReason(): ConfirmedReason;

	run(accessor: ServicesAccessor, context?: IToolConfirmationActionContext) {
		const chatWidgetService = accessor.get(IChatWidgetService);
		const widget = context?.sessionResource
			? chatWidgetService.getWidgetBySessionResource(context.sessionResource)
			: chatWidgetService.lastFocusedWidget;
		const lastItem = widget?.viewModel?.getItems().at(-1);
		if (!isResponseVM(lastItem)) {
			return;
		}

		for (const item of lastItem.model.response.value) {
			const state = item.kind === 'toolInvocation' ? item.state.get() : undefined;
			if (state?.type === IChatToolInvocation.StateKind.WaitingForConfirmation || state?.type === IChatToolInvocation.StateKind.WaitingForPostApproval) {
				state.confirm(this.getReason());
				break;
			}
		}

		// Return focus to the chat input, in case it was in the tool confirmation editor
		widget?.focusInput();
	}
}

class AcceptToolConfirmation extends ToolConfirmationAction {
	constructor() {
		super({
			id: AcceptToolConfirmationActionId,
			title: localize2('chat.accept', "Accept"),
			f1: false,
			category: CHAT_CATEGORY,
			keybinding: {
				when: ContextKeyExpr.and(ChatContextKeys.inChatSession, ChatContextKeys.Editing.hasToolConfirmation),
				primary: KeyMod.CtrlCmd | KeyCode.Enter,
				// Override chatEditor.action.accept
				weight: KeybindingWeight.WorkbenchContrib + 1,
			},
		});
	}

	protected override getReason(): ConfirmedReason {
		return { type: ToolConfirmKind.UserAction };
	}
}

class SkipToolConfirmation extends ToolConfirmationAction {
	constructor() {
		super({
			id: SkipToolConfirmationActionId,
			title: localize2('chat.skip', "Skip"),
			f1: false,
			category: CHAT_CATEGORY,
			keybinding: {
				when: ContextKeyExpr.and(ChatContextKeys.inChatSession, ChatContextKeys.Editing.hasToolConfirmation),
				primary: KeyMod.CtrlCmd | KeyCode.Enter | KeyMod.Alt,
				// Override chatEditor.action.accept
				weight: KeybindingWeight.WorkbenchContrib + 1,
			},
		});
	}

	protected override getReason(): ConfirmedReason {
		return { type: ToolConfirmKind.Skipped };
	}
}

export function registerChatToolActions(): DisposableStore {
	const store = new DisposableStore();
	store.add(registerAction2(AcceptToolConfirmation));
	store.add(registerAction2(SkipToolConfirmation));
	return store;
}
