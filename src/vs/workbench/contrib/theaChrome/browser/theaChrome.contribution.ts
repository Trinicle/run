/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/theaChrome.css';
import { Codicon } from '../../../../base/common/codicons.js';
import { localize, localize2 } from '../../../../nls.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IInstantiationService, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { Action2, MenuId, MenuRegistry, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { TitleBarLeadingActionsGroup } from '../../../browser/parts/titlebar/titlebarActions.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../browser/editor.js';
import { EditorExtensions, IEditorFactoryRegistry, IEditorSerializer } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { ITheaWorkbenchModeService, TheaWorkbenchModeService } from './theaWorkbenchModeService.js';
import { TheaAgentsEditor } from './theaAgentsEditor.js';
import { TheaAgentsEditorInput } from './theaAgentsEditorInput.js';
import { TheaSettingsEditor } from './theaSettingsEditor.js';
import { TheaSettingsEditorInput } from './theaSettingsEditorInput.js';
import { OpenTheaSettings } from './theaSettingsActions.js';

registerSingleton(ITheaWorkbenchModeService, TheaWorkbenchModeService, InstantiationType.Delayed);

Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(TheaAgentsEditor, TheaAgentsEditor.ID, localize('theaAgents', "Agents")),
	[new SyncDescriptor(TheaAgentsEditorInput)]
);

Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(TheaSettingsEditor, TheaSettingsEditor.ID, localize('theaSettings', "Thea Settings")),
	[new SyncDescriptor(TheaSettingsEditorInput)]
);

class TheaAgentsEditorInputSerializer implements IEditorSerializer {
	canSerialize(_editorInput: EditorInput): boolean {
		return true;
	}

	serialize(_editorInput: EditorInput): string {
		return '';
	}

	deserialize(_instantiationService: IInstantiationService): EditorInput {
		return TheaAgentsEditorInput.instance;
	}
}

class TheaSettingsEditorInputSerializer implements IEditorSerializer {
	canSerialize(_editorInput: EditorInput): boolean {
		return true;
	}

	serialize(_editorInput: EditorInput): string {
		return '';
	}

	deserialize(_instantiationService: IInstantiationService): EditorInput {
		return TheaSettingsEditorInput.instance;
	}
}

Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).registerEditorSerializer(TheaAgentsEditorInput.ID, TheaAgentsEditorInputSerializer);
Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).registerEditorSerializer(TheaSettingsEditorInput.ID, TheaSettingsEditorInputSerializer);

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'thea.workbench.mode.editor',
			title: localize2('theaEditorMode', 'Thea Editor Mode'),
			f1: true,
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		await accessor.get(ITheaWorkbenchModeService).setMode('editor');
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'thea.workbench.mode.agents',
			title: localize2('theaAgentsMode', 'Thea Agents Mode'),
			f1: true,
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		await accessor.get(ITheaWorkbenchModeService).setMode('agents');
	}
});

registerAction2(OpenTheaSettings);

MenuRegistry.appendMenuItem(MenuId.TitleBar, {
	command: {
		id: 'workbench.action.chat.toggle',
		title: localize('theaChat', "Chat"),
		icon: Codicon.commentDiscussion,
	},
	group: TitleBarLeadingActionsGroup,
	order: 1,
});
