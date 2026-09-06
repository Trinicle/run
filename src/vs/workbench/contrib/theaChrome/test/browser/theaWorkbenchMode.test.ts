/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { IEditorOptions } from '../../../../../platform/editor/common/editor.js';
import { PreferredGroup } from '../../../../services/editor/common/editorService.js';
import { IUntypedEditorInput } from '../../../../common/editor.js';
import { workbenchInstantiationService, TestEditorService } from '../../../../test/browser/workbenchTestServices.js';
import { TheaWorkbenchModeService } from '../../browser/theaWorkbenchModeService.js';
import { TheaAgentsEditorInput } from '../../browser/theaAgentsEditorInput.js';
import { TheaSettingsEditorInput } from '../../browser/theaSettingsEditorInput.js';
import { OpenTheaSettings } from '../../browser/theaSettingsActions.js';

class TrackingEditorService extends TestEditorService {
	override async openEditor(editor: EditorInput | IUntypedEditorInput, _optionsOrGroup?: IEditorOptions | PreferredGroup, _group?: PreferredGroup): Promise<undefined> {
		if (editor instanceof EditorInput) {
			this.activeEditor = editor;
		}
		return undefined;
	}

	override async closeEditor(): Promise<void> {
		this.activeEditor = undefined;
	}
}

suite('Thea chrome', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('setMode agents opens thea agents input', async () => {
		const disposables = store.add(new DisposableStore());
		const editorService = disposables.add(new TrackingEditorService());
		const instantiationService = workbenchInstantiationService({
			editorService: () => editorService,
		}, disposables);

		const mode = instantiationService.createInstance(TheaWorkbenchModeService);
		disposables.add(mode);
		await mode.setMode('agents');
		assert.strictEqual(mode.getMode(), 'agents');
		assert.ok(editorService.activeEditor instanceof TheaAgentsEditorInput);
	});

	test('open Thea settings opens singleton settings input', async () => {
		const disposables = store.add(new DisposableStore());
		const editorService = disposables.add(new TrackingEditorService());
		const instantiationService = workbenchInstantiationService({
			editorService: () => editorService,
		}, disposables);

		await instantiationService.invokeFunction(accessor => new OpenTheaSettings().run(accessor));
		assert.ok(editorService.activeEditor instanceof TheaSettingsEditorInput);
	});
});
