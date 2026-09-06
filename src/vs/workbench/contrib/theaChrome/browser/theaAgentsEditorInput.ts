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

const theaAgentsEditorIcon = registerIcon('thea-agents-editor-label-icon', Codicon.commentDiscussion, localize('theaAgentsEditorLabelIcon', 'Icon of the Thea Agents editor.'));

export class TheaAgentsEditorInput extends EditorInput {

	static readonly ID = 'workbench.editor.theaAgents';

	static readonly RESOURCE = URI.from({
		scheme: 'thea-agents',
		path: 'default'
	});

	private static _instance: TheaAgentsEditorInput;
	static get instance() {
		if (!TheaAgentsEditorInput._instance || TheaAgentsEditorInput._instance.isDisposed()) {
			TheaAgentsEditorInput._instance = markAsSingleton(new TheaAgentsEditorInput());
		}
		return TheaAgentsEditorInput._instance;
	}

	override get typeId(): string { return TheaAgentsEditorInput.ID; }

	override get editorId(): string | undefined { return TheaAgentsEditorInput.ID; }

	override get capabilities(): EditorInputCapabilities { return EditorInputCapabilities.Readonly | EditorInputCapabilities.Singleton | EditorInputCapabilities.NeverModal; }

	readonly resource = TheaAgentsEditorInput.RESOURCE;

	override getName(): string {
		return localize('theaAgentsInputName', "Agents");
	}

	override getIcon(): ThemeIcon {
		return theaAgentsEditorIcon;
	}

	override matches(other: EditorInput | IUntypedEditorInput): boolean {
		if (super.matches(other)) {
			return true;
		}
		return other instanceof TheaAgentsEditorInput;
	}
}
