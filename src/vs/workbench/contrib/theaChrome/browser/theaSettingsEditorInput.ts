/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { markAsSingleton } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { EditorInputCapabilities, IUntypedEditorInput } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';

const theaSettingsEditorIcon = registerIcon('thea-settings-editor-label-icon', Codicon.settingsGear, localize('theaSettingsEditorLabelIcon', 'Icon of the Thea Settings editor.'));

export class TheaSettingsEditorInput extends EditorInput {

	static readonly ID = 'workbench.editor.theaSettings';

	static readonly RESOURCE = URI.from({
		scheme: 'thea-settings',
		path: 'default'
	});

	private static _instance: TheaSettingsEditorInput;
	static get instance() {
		if (!TheaSettingsEditorInput._instance || TheaSettingsEditorInput._instance.isDisposed()) {
			TheaSettingsEditorInput._instance = markAsSingleton(new TheaSettingsEditorInput());
		}
		return TheaSettingsEditorInput._instance;
	}

	override get typeId(): string { return TheaSettingsEditorInput.ID; }

	override get editorId(): string | undefined { return TheaSettingsEditorInput.ID; }

	override get capabilities(): EditorInputCapabilities { return EditorInputCapabilities.Readonly | EditorInputCapabilities.Singleton | EditorInputCapabilities.NeverModal; }

	readonly resource = TheaSettingsEditorInput.RESOURCE;

	override getName(): string {
		return localize('theaSettingsInputName', "Thea Settings");
	}

	override getIcon(): ThemeIcon {
		return theaSettingsEditorIcon;
	}

	override matches(other: EditorInput | IUntypedEditorInput): boolean {
		if (super.matches(other)) {
			return true;
		}
		return other instanceof TheaSettingsEditorInput;
	}
}
