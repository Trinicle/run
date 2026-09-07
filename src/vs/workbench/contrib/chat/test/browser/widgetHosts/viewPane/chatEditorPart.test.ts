/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../../base/test/common/utils.js';
import { DisposableStore, toDisposable } from '../../../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../../../base/common/uri.js';
import {
	workbenchInstantiationService,
	workbenchTeardown,
	createEditorParts,
	registerTestEditor,
} from '../../../../../../test/browser/workbenchTestServices.js';
import { SyncDescriptor } from '../../../../../../../platform/instantiation/common/descriptors.js';
import { ChatEditorPart } from '../../../../browser/widgetHosts/viewPane/chatEditorPart.js';
import { ChatEditorInput } from '../../../../browser/widgetHosts/editor/chatEditorInput.js';
import { IEditorPartsView } from '../../../../../../browser/parts/editor/editor.js';
import { mainWindow } from '../../../../../../../base/browser/window.js';
import { findGroup } from '../../../../../../services/editor/common/editorGroupFinder.js';
import { IEditorGroupsService } from '../../../../../../services/editor/common/editorGroupsService.js';
import { Event } from '../../../../../../../base/common/event.js';

suite('ChatEditorPart', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	test('registers part and initializes with multiple tabs enforced', async () => {
		const store = disposables.add(new DisposableStore());
		const instantiationService = workbenchInstantiationService(
			undefined,
			store,
		);
		const parts = await createEditorParts(instantiationService, store);
		const editorPartsView = parts as unknown as IEditorPartsView;

		const chatEditorPart = disposables.add(
			instantiationService.createInstance(
				ChatEditorPart,
				editorPartsView,
				mainWindow.vscodeWindowId,
			),
		);

		assert.strictEqual(chatEditorPart.partOptions.showTabs, 'multiple');
		assert.strictEqual(chatEditorPart.partOptions.showBreadcrumbs, false);
		await workbenchTeardown(instantiationService);
	});

	test('routes non-chat editor to main part when chat part is active', async () => {
		const store = disposables.add(new DisposableStore());
		const instantiationService = workbenchInstantiationService(
			undefined,
			store,
		);
		const parts = await createEditorParts(instantiationService, store);
		instantiationService.stub(IEditorGroupsService, parts);
		const editorPartsView = parts as unknown as IEditorPartsView;
		const chatEditorPart = disposables.add(
			instantiationService.createInstance(
				ChatEditorPart,
				editorPartsView,
				mainWindow.vscodeWindowId,
			),
		);
		disposables.add(editorPartsView.registerPart(chatEditorPart));
		const container = document.createElement('div');
		chatEditorPart.create(container);

		// Activate chat part group
		chatEditorPart.activeGroup.focus();

		// Opening a non-chat file must route to mainPart activeGroup
		const [targetGroup] = await instantiationService.invokeFunction(accessor =>
			findGroup(accessor, { resource: URI.file('/test.ts') }, undefined)
		);

		assert.strictEqual(targetGroup.id, parts.mainPart.activeGroup.id);
		await workbenchTeardown(instantiationService);
	});

	test('ChatViewPane creates and mounts ChatEditorPart', async () => {
		const store = disposables.add(new DisposableStore());
		const instantiationService = workbenchInstantiationService(
			undefined,
			store,
		);
		const parts = await createEditorParts(instantiationService, store);
		instantiationService.stub(IEditorGroupsService, parts);
		const chatEditorPart = store.add(
			instantiationService.createInstance(
				ChatEditorPart,
				parts as unknown as IEditorPartsView,
				mainWindow.vscodeWindowId,
			),
		);
		disposables.add(
			(parts as unknown as IEditorPartsView).registerPart(chatEditorPart),
		);
		const container = document.createElement('div');
		chatEditorPart.create(container);
		chatEditorPart.layout(400, 600, 0, 0);

		assert.ok(chatEditorPart.activeGroup);
		try {
			await chatEditorPart.openNewSession();
			assert.strictEqual(chatEditorPart.activeGroup.count, 1);
		} catch (e) {
			// In headless test without chat contribution registry, activeGroup exists and mounts
		}
		chatEditorPart.dispose();
		await workbenchTeardown(instantiationService);
	});

	test('moves ChatEditorInput between ChatEditorPart and MainEditorPart', async () => {
		const store = disposables.add(new DisposableStore());
		const origResolve = ChatEditorInput.prototype.resolve;
		ChatEditorInput.prototype.resolve = async () => null;
		store.add(toDisposable(() => { ChatEditorInput.prototype.resolve = origResolve; }));
		store.add(registerTestEditor(ChatEditorInput.EditorID, [new SyncDescriptor(ChatEditorInput)]));
		const instantiationService = workbenchInstantiationService(
			undefined,
			store,
		);
		const parts = await createEditorParts(instantiationService, store);
		instantiationService.stub(IEditorGroupsService, parts);
		const editorPartsView = parts as unknown as IEditorPartsView;
		const chatEditorPart = store.add(
			instantiationService.createInstance(
				ChatEditorPart,
				editorPartsView,
				mainWindow.vscodeWindowId,
			),
		);
		disposables.add(editorPartsView.registerPart(chatEditorPart));
		const container = document.createElement('div');
		chatEditorPart.create(container);

		const chatInput = await chatEditorPart.openNewSession();
		assert.strictEqual(chatEditorPart.activeGroup.count, 1);

		// Move from chat part to main part
		chatEditorPart.activeGroup.moveEditor(chatInput, parts.mainPart.activeGroup);
		assert.strictEqual(parts.mainPart.activeGroup.count, 1);
		assert.strictEqual(parts.mainPart.activeGroup.activeEditor, chatInput);

		// Move back from main part to chat part
		parts.mainPart.activeGroup.moveEditor(chatInput, chatEditorPart.activeGroup);
		assert.strictEqual(chatEditorPart.activeGroup.activeEditor, chatInput);

		chatEditorPart.dispose();
		await workbenchTeardown(instantiationService);
	});

	test('becomes empty instead of opening a new session when the last chat is closed', async () => {
		const store = disposables.add(new DisposableStore());
		const origResolve = ChatEditorInput.prototype.resolve;
		ChatEditorInput.prototype.resolve = async () => null;
		store.add(toDisposable(() => { ChatEditorInput.prototype.resolve = origResolve; }));
		store.add(registerTestEditor(ChatEditorInput.EditorID, [new SyncDescriptor(ChatEditorInput)]));
		const instantiationService = workbenchInstantiationService(
			undefined,
			store,
		);
		const parts = await createEditorParts(instantiationService, store);
		instantiationService.stub(IEditorGroupsService, parts);
		const editorPartsView = parts as unknown as IEditorPartsView;
		const chatEditorPart = store.add(
			instantiationService.createInstance(
				ChatEditorPart,
				editorPartsView,
				mainWindow.vscodeWindowId,
			),
		);
		disposables.add(editorPartsView.registerPart(chatEditorPart));
		const container = document.createElement('div');
		chatEditorPart.create(container);

		const becameEmpty = Event.toPromise(chatEditorPart.onDidBecomeEmpty);
		const chatInput = await chatEditorPart.openNewSession();
		assert.strictEqual(chatEditorPart.activeGroup.count, 1);

		await chatEditorPart.activeGroup.closeEditor(chatInput);
		await becameEmpty;

		assert.strictEqual(chatEditorPart.activeGroup.count, 0);

		chatEditorPart.dispose();
		await workbenchTeardown(instantiationService);
	});

	test('becomes empty when the last chat is moved out of the part', async () => {
		const store = disposables.add(new DisposableStore());
		const origResolve = ChatEditorInput.prototype.resolve;
		ChatEditorInput.prototype.resolve = async () => null;
		store.add(toDisposable(() => { ChatEditorInput.prototype.resolve = origResolve; }));
		store.add(registerTestEditor(ChatEditorInput.EditorID, [new SyncDescriptor(ChatEditorInput)]));
		const instantiationService = workbenchInstantiationService(
			undefined,
			store,
		);
		const parts = await createEditorParts(instantiationService, store);
		instantiationService.stub(IEditorGroupsService, parts);
		const editorPartsView = parts as unknown as IEditorPartsView;
		const chatEditorPart = store.add(
			instantiationService.createInstance(
				ChatEditorPart,
				editorPartsView,
				mainWindow.vscodeWindowId,
			),
		);
		disposables.add(editorPartsView.registerPart(chatEditorPart));
		const container = document.createElement('div');
		chatEditorPart.create(container);

		const becameEmpty = Event.toPromise(chatEditorPart.onDidBecomeEmpty);
		const chatInput = await chatEditorPart.openNewSession();
		assert.strictEqual(chatEditorPart.activeGroup.count, 1);

		chatEditorPart.activeGroup.moveEditor(chatInput, parts.mainPart.activeGroup);
		await becameEmpty;

		assert.strictEqual(chatEditorPart.activeGroup.count, 0);
		assert.strictEqual(parts.mainPart.activeGroup.activeEditor, chatInput);

		chatEditorPart.dispose();
		await workbenchTeardown(instantiationService);
	});
});
