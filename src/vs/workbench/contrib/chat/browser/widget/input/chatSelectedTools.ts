/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { derived, IObservable } from '../../../../../../base/common/observable.js';
import { IChatMode } from '../../../common/chatModes.js';
import { ILanguageModelChatMetadataAndIdentifier } from '../../../common/languageModels.js';
import { UserSelectedTools } from '../../../common/participants/chatAgents.js';
import { ILanguageModelToolsService, IToolData, isToolSet, ToolAndToolSetEnablementMap, IToolSet } from '../../../common/tools/languageModelToolsService.js';

export class ChatSelectedTools extends Disposable {

	private readonly _currentTools: IObservable<readonly IToolData[]>;

	constructor(
		_mode: IObservable<IChatMode>,
		private readonly languageModel: IObservable<ILanguageModelChatMetadataAndIdentifier | undefined>,
		@ILanguageModelToolsService private readonly _toolsService: ILanguageModelToolsService,
	) {
		super();

		this._currentTools = languageModel.map(lm =>
			_toolsService.observeTools(lm?.metadata)).map((o, r) => o.read(r));
	}

	/**
	 * All tools and tool sets, always enabled so the agent can use them.
	 */
	public readonly entriesMap: IObservable<ToolAndToolSetEnablementMap> = derived(r => {
		const map = new Map<IToolData | IToolSet, boolean>();
		const lm = this.languageModel.read(r)?.metadata;

		for (const tool of this._currentTools.read(r)) {
			if (tool.canBeReferencedInPrompt) {
				map.set(tool, true);
			}
		}
		for (const toolSet of this._toolsService.getToolSetsForModel(lm, r)) {
			if (toolSet.hiddenInToolsPicker) {
				continue;
			}
			map.set(toolSet, true);
			for (const tool of toolSet.getTools(r)) {
				map.set(tool, true);
			}
		}
		return ToolAndToolSetEnablementMap.fromMap(map);
	});

	public readonly userSelectedTools: IObservable<UserSelectedTools> = derived(r => {
		const result: UserSelectedTools = {};
		const map = this.entriesMap.read(r);
		for (const [item, enabled] of map) {
			if (!isToolSet(item)) {
				result[item.id] = enabled;
			}
		}
		return result;
	});
}
