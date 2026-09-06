/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IAuthenticationService } from '../../../../platform/authentication/common/authentication';
import { FetchOptions, IAbortController, IHeaders, PaginationOptions, Response, WebSocketConnection, WebSocketConnectOptions } from '../../../../platform/networking/common/fetcherService';
import { IFetcher } from '../../../../platform/networking/common/networking';
import { Emitter } from '../../../../util/vs/base/common/event';
import { CancellationToken } from '../../../../util/vs/base/common/cancellation';
import { IBYOKStorageService } from '../../../byok/vscode-node/byokStorageService';
import {
	fetchHarnessByokCompletions,
	HarnessModelCompletionsService,
	NullHarnessModelCompletionsService,
} from '../harnessModelCompletionsService';

const selectChatModelsMock = vi.hoisted(() => vi.fn());

vi.mock('vscode', () => ({
	lm: {
		onDidChangeChatModels: new Emitter<void>().event,
		selectChatModels: (...args: unknown[]) => selectChatModelsMock(...args),
	},
}));

class TestFetcher implements IFetcher {
	readonly requests: { url: string; options: FetchOptions }[] = [];

	constructor(private readonly responseBody: string) { }

	getUserAgentLibrary(): string { return 'test-fetcher'; }

	async fetch(url: string, options: FetchOptions): Promise<Response> {
		this.requests.push({ url, options });
		const headers = new class implements IHeaders {
			get(): string | null { return null; }
			*[Symbol.iterator](): Iterator<[string, string]> { }
		};
		return Response.fromText(200, 'OK', headers, this.responseBody, 'test');
	}

	fetchWithPagination<T>(_baseUrl: string, _options: PaginationOptions<T>): Promise<T[]> {
		throw new Error('not implemented');
	}
	async disconnectAll(): Promise<unknown> { return undefined; }
	makeAbortController(): IAbortController { return new AbortController(); }
	isAbortError(): boolean { return false; }
	isInternetDisconnectedError(): boolean { return false; }
	isFetcherError(): boolean { return false; }
	isNetworkProcessCrashedError(): boolean { return false; }
	getUserMessageForFetcherError(err: unknown): string { return String(err); }
}

function createAuthService(opts?: { anyGitHubSession?: unknown; copilotToken?: unknown }) {
	const emitter = new Emitter<void>();
	return {
		authService: {
			_serviceBrand: undefined,
			anyGitHubSession: opts?.anyGitHubSession,
			copilotToken: opts?.copilotToken,
			onDidAuthenticationChange: emitter.event,
			onDidCopilotTokenChange: new Emitter<void>().event,
		} as unknown as IAuthenticationService,
		emitter,
	};
}

function createByokStorageService(apiKey = 'test-key'): IBYOKStorageService {
	return {
		_serviceBrand: undefined,
		getAPIKey: vi.fn(async () => apiKey),
		getStoredModelConfigs: vi.fn(async () => ({})),
	} as unknown as IBYOKStorageService;
}

describe('HarnessModelCompletionsService', () => {
	let service: HarnessModelCompletionsService | undefined;

	afterEach(() => {
		service?.dispose();
		service = undefined;
		vi.clearAllMocks();
	});

	it('hasUsableModel is false when signed out without BYOK models', async () => {
		selectChatModelsMock.mockResolvedValue([]);
		const { authService } = createAuthService({ anyGitHubSession: undefined });
		service = new HarnessModelCompletionsService(authService, createByokStorageService());
		await Promise.resolve();
		await Promise.resolve();
		expect(service.hasUsableModel()).toBe(false);
	});

	it('hasUsableModel is true when signed out with configured BYOK model', async () => {
		selectChatModelsMock.mockResolvedValue([{ vendor: 'openai', id: 'gpt-4.1' }]);
		const { authService } = createAuthService({ anyGitHubSession: undefined });
		service = new HarnessModelCompletionsService(authService, createByokStorageService());
		await vi.waitFor(() => {
			expect(service!.hasUsableModel()).toBe(true);
		});
		expect(service.getActiveByokEndpoint()?.url).toBe('https://api.openai.com/v1/chat/completions');
	});

	it('NullHarnessModelCompletionsService reports no usable model', () => {
		const nullService = new NullHarnessModelCompletionsService();
		expect(nullService.hasUsableModel()).toBe(false);
		expect(nullService.getActiveByokEndpoint()).toBeUndefined();
	});
});

describe('fetchHarnessByokCompletions', () => {
	it('posts to harness BYOK chat/completions endpoint', async () => {
		const streamBody = [
			'data: {"choices":[{"index":0,"delta":{"content":"hello"}}]}',
			'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
			'data: [DONE]',
		].join('\n');
		const fetcher = new TestFetcher(streamBody);
		const result = await fetchHarnessByokCompletions(fetcher, {
			vendor: 'openai',
			modelId: 'gpt-4.1',
			url: 'https://api.openai.com/v1/chat/completions',
			apiKey: 'secret',
		}, {
			prefix: 'const x = ',
			suffix: ';',
			isFimEnabled: true,
			maxTokens: 32,
			temperature: 0,
			topP: 1,
			n: 1,
			stop: undefined,
			requestId: 'req-1',
		}, CancellationToken.None);

		expect(result.isOk()).toBe(true);
		expect(fetcher.requests).toHaveLength(1);
		expect(fetcher.requests[0].url).toBe('https://api.openai.com/v1/chat/completions');
		const body = JSON.parse(String(fetcher.requests[0].options.body));
		expect(body.model).toBe('gpt-4.1');
		expect(body.messages.some((m: { content: string }) => m.content.includes('<FILL_HERE>'))).toBe(true);
	});
});
