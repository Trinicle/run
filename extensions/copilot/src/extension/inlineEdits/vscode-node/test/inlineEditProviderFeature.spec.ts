/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { Emitter } from '../../../../util/vs/base/common/event';
import { constObservable } from '../../../../util/vs/base/common/observable';
import { InlineEditProviderFeature } from '../inlineEditProviderFeature';
import { IAuthenticationService } from '../../../../platform/authentication/common/authentication';
import { IHarnessModelCompletionsService } from '../../../completions/vscode-node/harnessModelCompletionsService';
import { IConfigurationService } from '../../../../platform/configuration/common/configurationService';
import { IInlineEditsModelService } from '../inlineEditsModelService';

describe('InlineEditProviderFeature', () => {
	it('reacts to harness BYOK model availability when copilotToken is absent', () => {
		const tokenEmitter = new Emitter<void>();
		let currentToken: any = undefined;
		const authService = {
			onDidCopilotTokenChange: tokenEmitter.event,
			get copilotToken() { return currentToken; },
		} as unknown as IAuthenticationService;

		const modelEmitter = new Emitter<void>();
		let usableModel = false;
		const harnessModelService = {
			onDidChangeModel: modelEmitter.event,
			hasUsableModel: () => usableModel,
		} as unknown as IHarnessModelCompletionsService;

		const configService = {
			getExperimentBasedConfigObservable: () => constObservable(undefined),
			getConfigObservable: () => constObservable(undefined),
		} as unknown as IConfigurationService;

		const modelService = {
			onModelListUpdated: new Emitter<void>().event,
			selectedModelConfiguration: () => ({}),
		} as unknown as IInlineEditsModelService;

		const feature = new InlineEditProviderFeature(
			{} as any,
			configService,
			authService,
			{} as any,
			{} as any,
			{} as any,
			modelService,
			harnessModelService,
		);

		// Initially signed out and no harness model -> disabled
		expect(feature.inlineEditsEnabled.get()).toBe(false);

		// Harness model becomes available -> enabled
		usableModel = true;
		modelEmitter.fire();
		expect(feature.inlineEditsEnabled.get()).toBe(true);

		// When token is present with quota exceeded -> disabled
		currentToken = { isCompletionsQuotaExceeded: true };
		tokenEmitter.fire();
		expect(feature.inlineEditsEnabled.get()).toBe(false);

		// When token quota is valid -> enabled
		currentToken = { isCompletionsQuotaExceeded: false };
		tokenEmitter.fire();
		expect(feature.inlineEditsEnabled.get()).toBe(true);
	});
});
