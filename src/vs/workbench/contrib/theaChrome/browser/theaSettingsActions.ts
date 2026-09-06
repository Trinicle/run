/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize2 } from '../../../../nls.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { Action2, MenuId } from '../../../../platform/actions/common/actions.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { TheaSettingsEditorInput } from './theaSettingsEditorInput.js';

export class OpenTheaSettings extends Action2 {
	static readonly ID = 'thea.settings.open';

	constructor() {
		super({
			id: OpenTheaSettings.ID,
			title: localize2('openTheaSettings', 'Thea Settings'),
			icon: Codicon.settingsGear,
			f1: true,
			menu: {
				id: MenuId.TitleBar,
				group: 'navigation',
				order: 2,
			}
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		await accessor.get(IEditorService).openEditor(TheaSettingsEditorInput.instance, { pinned: true });
	}
}
