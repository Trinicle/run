/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { localize2 } from '../../../../../nls.js';
import { Action2, registerAction2 } from '../../../../../platform/actions/common/actions.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../../common/contributions.js';
import { ChatContextKeys } from '../../common/actions/chatContextKeys.js';
import { getCustomizationMigrationHintDismissedStorageKey } from '../../common/aiCustomizationWorkspaceService.js';
import { ICustomizationHarnessService } from '../../common/customizationHarnessService.js';
import { getChatSessionType } from '../../common/model/chatUri.js';
import { CHAT_CATEGORY } from '../actions/chatActions.js';
import { IChatWidgetService } from '../chat.js';
import {
	AICustomizationManagementOpenEditorTarget,
	AICustomizationManagementCommands,
	resolveAICustomizationManagementOpenEditorTarget,
} from './aiCustomizationManagement.js';

const OPEN_THEA_SETTINGS_COMMAND_ID = 'thea.settings.open';

async function openTheaSettings(accessor: ServicesAccessor): Promise<void> {
	await accessor.get(ICommandService).executeCommand(OPEN_THEA_SETTINGS_COMMAND_ID);
}

class AICustomizationManagementActionsContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.aiCustomizationManagementActions';

	constructor() {
		super();
		this.registerActions();
	}

	private registerActions(): void {
		this._register(registerAction2(class extends Action2 {
			constructor() {
				super({
					id: AICustomizationManagementCommands.DismissMigrationHint,
					title: localize2('dismissCustomizationMigrationHint', "Don't Show Customization Migration Hints Again"),
					f1: false,
				});
			}

			run(accessor: ServicesAccessor): void {
				const sessionResource = accessor.get(IChatWidgetService).lastFocusedWidget?.viewModel?.sessionResource;
				if (!sessionResource) {
					throw new Error('Expected an active chat session when dismissing customization migration hints');
				}
				const sessionType = getChatSessionType(sessionResource);
				accessor.get(IStorageService).store(
					getCustomizationMigrationHintDismissedStorageKey(sessionType),
					true,
					StorageScope.WORKSPACE,
					StorageTarget.USER
				);
			}
		}));

		// Open Customizations now lands on Thea Settings; keep the command id for slash/deep links.
		this._register(registerAction2(class extends Action2 {
			constructor() {
				super({
					id: AICustomizationManagementCommands.OpenEditor,
					title: localize2('openAICustomizations', "Open Customizations"),
					shortTitle: localize2('aiCustomizations', "Customizations"),
					category: CHAT_CATEGORY,
					precondition: ChatContextKeys.enabled,
					f1: false,
				});
			}

			async run(accessor: ServicesAccessor, target?: AICustomizationManagementOpenEditorTarget): Promise<void> {
				const chatWidgetService = accessor.get(IChatWidgetService);
				const harnessService = accessor.get(ICustomizationHarnessService);
				const widget = chatWidgetService.lastFocusedWidget;
				const { sessionResource } = resolveAICustomizationManagementOpenEditorTarget(
					target,
					widget?.input.pendingDelegationTarget,
					widget?.viewModel?.sessionResource,
					sessionType => harnessService.getSessionResourceForHarness(sessionType),
				);
				if (sessionResource) {
					harnessService.setActiveSession(sessionResource);
				}

				await openTheaSettings(accessor);
			}
		}));
	}
}

registerWorkbenchContribution2(
	AICustomizationManagementActionsContribution.ID,
	AICustomizationManagementActionsContribution,
	WorkbenchPhase.AfterRestored
);
