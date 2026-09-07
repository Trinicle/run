/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IContextKeyService } from '../../../../../../platform/contextkey/common/contextkey.js';
import { IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';
import { IInstantiationService } from '../../../../../../platform/instantiation/common/instantiation.js';
import { IStorageService } from '../../../../../../platform/storage/common/storage.js';
import { IThemeService } from '../../../../../../platform/theme/common/themeService.js';
import { IHostService } from '../../../../../services/host/browser/host.js';
import { IWorkbenchLayoutService } from '../../../../../services/layout/browser/layoutService.js';
import { EditorPart } from '../../../../../browser/parts/editor/editorPart.js';
import { IEditorPartsView } from '../../../../../browser/parts/editor/editor.js';
import { IEditorDropTargetDelegate, IEditorGroup } from '../../../../../services/editor/common/editorGroupsService.js';
import { IDisposable } from '../../../../../../base/common/lifecycle.js';
import { Emitter } from '../../../../../../base/common/event.js';
import { URI } from '../../../../../../base/common/uri.js';
import { isEqual } from '../../../../../../base/common/resources.js';
import { localize } from '../../../../../../nls.js';
import { EditorCloseContext } from '../../../../../common/editor.js';
import { ChatEditorInput } from '../editor/chatEditorInput.js';
import type { IChatEditorOptions } from '../editor/chatEditor.js';

export class ChatEditorPart extends EditorPart {
	static readonly ID = 'workbench.parts.chatEditor';

	private readonly _onDidBecomeEmpty = this._register(new Emitter<void>());
	readonly onDidBecomeEmpty = this._onDidBecomeEmpty.event;

	constructor(
		editorPartsView: IEditorPartsView,
		windowId: number,
		@IInstantiationService instantiationService: IInstantiationService,
		@IThemeService themeService: IThemeService,
		@IConfigurationService configurationService: IConfigurationService,
		@IStorageService storageService: IStorageService,
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService,
		@IHostService hostService: IHostService,
		@IContextKeyService contextKeyService: IContextKeyService,
	) {
		super(
			editorPartsView,
			ChatEditorPart.ID,
			localize('chatEditorPartLabel', "Chat"),
			windowId,
			instantiationService,
			themeService,
			configurationService,
			storageService,
			layoutService,
			hostService,
			contextKeyService,
		);

		this._register(this.enforcePartOptions({
			showTabs: 'multiple',
			hasIcons: true,
			showBreadcrumbs: false,
		}));
	}

	private isDisposing = false;

	override dispose(): void {
		this.isDisposing = true;
		for (const group of this.groups) {
			for (const editor of group.editors) {
				editor.dispose();
			}
		}
		super.dispose();
	}

	override create(parent: HTMLElement): void {
		super.create(parent);

		const registerGroup = (group: IEditorGroup) => {
			this._register(group.onDidCloseEditor(e => this.handleEditorClosed(e.context)));
		};
		for (const group of this.groups) {
			registerGroup(group);
		}
		this._register(this.onDidAddGroup(group => registerGroup(group)));
	}

	private handleEditorClosed(context: EditorCloseContext): void {
		if (this.isDisposing || this._store.isDisposed) {
			return;
		}
		if (this.groups.some(group => group.count > 0)) {
			return;
		}
		if (context === EditorCloseContext.REPLACE) {
			return;
		}

		this._onDidBecomeEmpty.fire();
	}

	override createEditorDropTarget(container: unknown, delegate: IEditorDropTargetDelegate): IDisposable {
		return super.createEditorDropTarget(container, {
			...delegate,
			supportsSplitting: false,
		});
	}

	async openSession(sessionResource: URI, options?: IChatEditorOptions): Promise<void> {
		const existing = this.activeGroup.editors.find(
			e => e instanceof ChatEditorInput && isEqual(e.sessionResource, sessionResource)
		);
		if (existing) {
			await this.activeGroup.openEditor(existing, options);
			return;
		}

		const input = this.scopedInstantiationService.createInstance(ChatEditorInput, sessionResource, options ?? {});
		await this.activeGroup.openEditor(input, { pinned: true, ...options });
	}

	async openNewSession(): Promise<ChatEditorInput> {
		const uri = ChatEditorInput.getNewEditorUri();
		const input = this.scopedInstantiationService.createInstance(ChatEditorInput, uri, {});
		await this.activeGroup.openEditor(input, { pinned: true });
		return input;
	}
}
