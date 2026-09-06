/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../../base/common/uri.js';
import { IChatViewTitleActionContext, isChatViewTitleActionContext } from '../../common/actions/chatActions.js';
import { AICustomizationManagementSection } from '../../common/aiCustomizationWorkspaceService.js';

// Re-export for convenience — consumers import from this file
export { AICustomizationManagementCommands, AICustomizationManagementSection } from '../../common/aiCustomizationWorkspaceService.js';
export type { AICustomizationSource } from '../../common/aiCustomizationWorkspaceService.js';
export { BUILTIN_STORAGE } from '../../common/aiCustomizationWorkspaceService.js';

export type AICustomizationManagementOpenEditorTarget =
	| AICustomizationManagementSection
	| {
		readonly section?: AICustomizationManagementSection;
		readonly sessionType?: string;
		readonly revealUri?: URI;
	}
	| IChatViewTitleActionContext;

export function resolveAICustomizationManagementOpenEditorTarget(
	target: AICustomizationManagementOpenEditorTarget | undefined,
	pendingSessionType: string | undefined,
	chatSessionResource: URI | undefined,
	getSessionResourceForHarness: (sessionType: string) => URI,
): { readonly section?: AICustomizationManagementSection; readonly revealUri?: URI; readonly sessionResource?: URI } {
	if (isChatViewTitleActionContext(target)) {
		return { sessionResource: target.sessionResource };
	}

	const options = typeof target === 'string' ? { section: target } : target;
	const sessionType = options?.sessionType ?? pendingSessionType;
	return {
		section: options?.section,
		revealUri: options?.revealUri,
		sessionResource: sessionType ? getSessionResourceForHarness(sessionType) : chatSessionResource,
	};
}
