/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { Emitter } from '../../../../util/vs/base/common/event';
import { constObservable } from '../../../../util/vs/base/common/observable';
import { CompletionsCoreContribution } from '../completionsCoreContribution';
import { IAuthenticationService } from '../../../../platform/authentication/common/authentication';
import { IHarnessModelCompletionsService } from '../harnessModelCompletionsService';
import { IConfigurationService } from '../../../../platform/configuration/common/configurationService';
import { ICopilotInlineCompletionItemProviderService } from '../copilotInlineCompletionItemProviderService';

describe('CompletionsCoreContribution', () => {
	it('activates and registers provider when harness has BYOK model and copilot token is absent', () => {
		const executedCommands: Array<{ command: string; args: unknown[] }> = [];
		(vscode as any).commands = {
			executeCommand: vi.fn((command: string, ...args: unknown[]) => {
				executedCommands.push({ command, args });
			}),
		};
		let providerRegistered = false;
		(vscode as any).languages = {
			registerInlineCompletionItemProvider: vi.fn(() => {
				providerRegistered = true;
				return { dispose() {} };
			}),
		};

		const tokenEmitter = new Emitter<void>();
		let currentToken: any = undefined;
		const authService = {
			onDidCopilotTokenChange: tokenEmitter.event,
			get copilotToken() { return currentToken; },
		} as unknown as IAuthenticationService;

		const modelEmitter = new Emitter<void>();
		let usableModel = true;
		const harnessModelService = {
			onDidChangeModel: modelEmitter.event,
			hasUsableModel: () => usableModel,
		} as unknown as IHarnessModelCompletionsService;

		const configService = {
			getExperimentBasedConfigObservable: () => constObservable(false),
			getConfigObservable: () => constObservable(false),
		} as unknown as IConfigurationService;

		const providerService = {
			getOrCreateProvider: () => ({ provideInlineCompletionItems: vi.fn() }),
			getOrCreateInstantiationService: () => ({ invokeFunction: vi.fn() }),
		} as unknown as ICopilotInlineCompletionItemProviderService;

		const contribution = new CompletionsCoreContribution(
			providerService,
			configService,
			{} as any,
			authService,
			harnessModelService,
		);

		expect(providerRegistered).toBe(true);
		expect(executedCommands).toContainEqual({
			command: 'setContext',
			args: ['github.copilot.activated', true],
		});

		contribution.dispose();
	});
});
