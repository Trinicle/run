/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event, Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IContextKey, IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { TheaWorkbenchModeContext } from '../../../common/contextkeys.js';
import { TheaAgentsEditorInput } from './theaAgentsEditorInput.js';

export type TheaWorkbenchMode = 'editor' | 'agents';

export const ITheaWorkbenchModeService = createDecorator<ITheaWorkbenchModeService>('theaWorkbenchModeService');

export interface ITheaWorkbenchModeService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeMode: Event<TheaWorkbenchMode>;
	getMode(): TheaWorkbenchMode;
	setMode(mode: TheaWorkbenchMode): Promise<void>;
}

export class TheaWorkbenchModeService extends Disposable implements ITheaWorkbenchModeService {

	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeMode = this._register(new Emitter<TheaWorkbenchMode>());
	readonly onDidChangeMode = this._onDidChangeMode.event;

	private mode: TheaWorkbenchMode = 'editor';
	private previousEditor: EditorInput | undefined;
	private readonly modeContext: IContextKey<string>;

	constructor(
		@IEditorService private readonly editorService: IEditorService,
		@IEditorGroupsService private readonly editorGroupsService: IEditorGroupsService,
		@IContextKeyService contextKeyService: IContextKeyService,
	) {
		super();
		this.modeContext = TheaWorkbenchModeContext.bindTo(contextKeyService);
		this.modeContext.set(this.mode);
	}

	getMode(): TheaWorkbenchMode {
		return this.mode;
	}

	async setMode(mode: TheaWorkbenchMode): Promise<void> {
		if (this.mode === mode) {
			return;
		}

		if (mode === 'agents') {
			const active = this.editorService.activeEditor;
			if (active && !(active instanceof TheaAgentsEditorInput)) {
				this.previousEditor = active;
			}
			await this.editorService.openEditor(TheaAgentsEditorInput.instance, { pinned: true });
		} else {
			const agents = TheaAgentsEditorInput.instance;
			const group = this.editorGroupsService.activeGroup;
			if (this.editorService.activeEditor instanceof TheaAgentsEditorInput || group.activeEditor instanceof TheaAgentsEditorInput) {
				await this.editorService.closeEditor({ editor: agents, groupId: group.id });
			}
			if (this.previousEditor && !this.previousEditor.isDisposed()) {
				await this.editorService.openEditor(this.previousEditor, { pinned: true });
			}
			this.previousEditor = undefined;
		}

		this.mode = mode;
		this.modeContext.set(mode);
		this._onDidChangeMode.fire(mode);
	}
}
