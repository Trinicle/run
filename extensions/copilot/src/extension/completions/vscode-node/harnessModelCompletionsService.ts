/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { LanguageModelChat, lm } from 'vscode';
import { IAuthenticationService } from '../../../platform/authentication/common/authentication';
import { Completion } from '../../../platform/nesFetch/common/completionsAPI';
import { Completions } from '../../../platform/nesFetch/common/completionsFetchService';
import { ResponseStream } from '../../../platform/nesFetch/common/responseStream';
import { getRequestId } from '../../../platform/networking/common/fetch';
import { FetchOptions, IFetcherService } from '../../../platform/networking/common/fetcherService';
import { createServiceIdentifier } from '../../../util/common/services';
import { AsyncIterUtilsExt } from '../../../util/common/asyncIterableUtils';
import { ErrorUtils } from '../../../util/common/errors';
import { Result } from '../../../util/common/result';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { Emitter, Event } from '../../../util/vs/base/common/event';
import { CancellationToken } from '../../../util/vs/base/common/cancellation';
import { isClientBYOKAllowed } from '../../byok/common/byokProvider';
import { IBYOKStorageService } from '../../byok/vscode-node/byokStorageService';

export interface OpenAICompatibleEndpoint {
	readonly vendor: string;
	readonly modelId: string;
	readonly url: string;
	readonly apiKey: string;
}

export interface IHarnessModelCompletionsService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeModel: Event<void>;
	hasUsableModel(): boolean;
	getActiveByokEndpoint(): OpenAICompatibleEndpoint | undefined;
}

export const IHarnessModelCompletionsService = createServiceIdentifier<IHarnessModelCompletionsService>('IHarnessModelCompletionsService');

export interface HarnessByokCompletionRequest {
	readonly prefix: string;
	readonly suffix: string;
	readonly isFimEnabled: boolean;
	readonly maxTokens: number;
	readonly temperature: number;
	readonly topP: number;
	readonly n: number;
	readonly stop: string[] | undefined;
	readonly requestId: string;
}

export async function fetchHarnessByokCompletions(
	fetcherService: IFetcherService,
	endpoint: OpenAICompatibleEndpoint,
	request: HarnessByokCompletionRequest,
	ct: CancellationToken,
): Promise<Result<ResponseStream, Completions.CompletionsFetchFailure>> {
	if (ct.isCancellationRequested) {
		return Result.error(new Completions.RequestCancelled());
	}

	const fetchAbortCtl = fetcherService.makeAbortController();
	const onCancellationDisposable = ct.onCancellationRequested(() => fetchAbortCtl.abort());

	try {
		const fetchOptions: FetchOptions = {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${endpoint.apiKey}`,
				'X-Request-Id': request.requestId,
			},
			body: JSON.stringify(buildHarnessChatCompletionsBody(endpoint, request)),
			signal: fetchAbortCtl.signal,
			callSite: 'harness-byok-completions',
		};

		const response = await fetcherService.fetch(endpoint.url, fetchOptions);
		if (response.status !== 200) {
			return Result.error(new Completions.UnsuccessfulResponse(
				response.status,
				response.statusText,
				response.headers,
				() => response.text().catch(() => ''),
			));
		}

		const bodyStream = response.body.pipeThrough(new TextDecoderStream());
		const jsonlStream = AsyncIterUtilsExt.splitLines(bodyStream);
		const completionsStream = chatCompletionsStreamToCompletions(jsonlStream);
		const responseStream = new ResponseStream(response, completionsStream, getRequestId(response.headers), response.headers);
		return Result.ok(responseStream);
	} catch (reason: unknown) {
		if (reason instanceof Error && reason.message === 'This operation was aborted') {
			return Result.error(new Completions.RequestCancelled());
		}
		return Result.error(new Completions.Unexpected(ErrorUtils.fromUnknown(reason)));
	} finally {
		onCancellationDisposable.dispose();
	}
}

function buildHarnessChatCompletionsBody(endpoint: OpenAICompatibleEndpoint, request: HarnessByokCompletionRequest): Record<string, unknown> {
	return {
		model: endpoint.modelId,
		messages: buildHarnessChatMessages(request.prefix, request.suffix, request.isFimEnabled),
		stream: true,
		max_tokens: request.maxTokens,
		temperature: request.temperature,
		top_p: request.topP,
		n: request.n,
		...(request.stop?.length ? { stop: request.stop } : {}),
	};
}

function buildHarnessChatMessages(prefix: string, suffix: string, isFimEnabled: boolean): { role: 'system' | 'user'; content: string }[] {
	if (isFimEnabled && suffix.length > 0) {
		return [
			{
				role: 'system',
				content: 'You are an inline code completion engine. The user prompt contains existing code with <FILL_HERE> marking where the cursor is. Return ONLY the code that belongs directly inside <FILL_HERE>. Do NOT repeat the prefix or suffix. Do NOT include markdown code fences or conversational text.',
			},
			{
				role: 'user',
				content: `${prefix}<FILL_HERE>${suffix}`,
			},
		];
	}
	return [
		{
			role: 'system',
			content: 'You are an inline code completion engine. Continue the code directly after the prompt. Return ONLY the code completion. Do NOT include markdown code fences or conversational text.',
		},
		{
			role: 'user',
			content: prefix,
		},
	];
}

async function* chatCompletionsStreamToCompletions(jsonlStream: AsyncIterable<string>): AsyncGenerator<Completion> {
	for await (const line of jsonlStream) {
		if (line.trim() === 'data: [DONE]') {
			continue;
		}
		if (!line.startsWith('data: ')) {
			continue;
		}

		const message: {
			error?: { message: string };
			choices?: Array<{
				index?: number;
				delta?: { content?: string };
				text?: string;
				finish_reason?: Completion.Choice['finish_reason'];
			}>;
			system_fingerprint?: string;
			usage?: Completion.Usage;
		} = JSON.parse(line.substring('data: '.length));

		if (message.error) {
			throw new Error(message.error.message);
		}

		const choice = message.choices?.[0];
		if (!choice) {
			continue;
		}

		yield {
			choices: [{
				index: choice.index ?? 0,
				text: choice.delta?.content ?? choice.text ?? '',
				finish_reason: choice.finish_reason ?? null,
			}],
			system_fingerprint: message.system_fingerprint ?? '',
			object: 'text_completion',
			usage: message.usage,
		};
	}
}

const VENDOR_TO_PROVIDER_NAME: Readonly<Record<string, string>> = {
	openai: 'OpenAI',
	anthropic: 'Anthropic',
	google: 'Gemini Native',
	xai: 'xAI',
	openrouter: 'OpenRouter',
	azure: 'Azure',
	ollama: 'Ollama',
	customoai: 'Custom OpenAI Compatible',
	customendpoint: 'Custom Endpoint',
};

export class HarnessModelCompletionsService extends Disposable implements IHarnessModelCompletionsService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeModel = this._register(new Emitter<void>());
	readonly onDidChangeModel = this._onDidChangeModel.event;

	private _activeEndpoint: OpenAICompatibleEndpoint | undefined;
	private _refreshPromise: Promise<void> | undefined;

	constructor(
		@IAuthenticationService private readonly _authService: IAuthenticationService,
		@IBYOKStorageService private readonly _byokStorageService: IBYOKStorageService,
	) {
		super();
		this._register(lm.onDidChangeChatModels(() => void this._scheduleRefresh()));
		this._register(this._authService.onDidAuthenticationChange(() => void this._scheduleRefresh()));
		void this._scheduleRefresh();
	}

	hasUsableModel(): boolean {
		return isClientBYOKAllowed(!!this._authService.anyGitHubSession, this._authService.copilotToken)
			&& this._activeEndpoint !== undefined;
	}

	getActiveByokEndpoint(): OpenAICompatibleEndpoint | undefined {
		return this._activeEndpoint;
	}

	private _scheduleRefresh(): Promise<void> {
		if (!this._refreshPromise) {
			this._refreshPromise = this._refresh().finally(() => {
				this._refreshPromise = undefined;
			});
		}
		return this._refreshPromise;
	}

	private async _refresh(): Promise<void> {
		const previousKey = this._endpointKey(this._activeEndpoint);
		this._activeEndpoint = undefined;

		if (!isClientBYOKAllowed(!!this._authService.anyGitHubSession, this._authService.copilotToken)) {
			if (previousKey !== undefined) {
				this._onDidChangeModel.fire();
			}
			return;
		}

		try {
			const models = await lm.selectChatModels({});
			for (const model of models) {
				if (model.vendor === 'copilot') {
					continue;
				}
				const endpoint = await this._resolveEndpoint(model);
				if (endpoint) {
					this._activeEndpoint = endpoint;
					break;
				}
			}
		} catch {
			// Best-effort: keep completions disabled until models are queryable again.
		}

		const nextKey = this._endpointKey(this._activeEndpoint);
		if (previousKey !== nextKey) {
			this._onDidChangeModel.fire();
		}
	}

	private _endpointKey(endpoint: OpenAICompatibleEndpoint | undefined): string | undefined {
		return endpoint ? `${endpoint.vendor}/${endpoint.modelId}@${endpoint.url}` : undefined;
	}

	private async _resolveEndpoint(model: LanguageModelChat): Promise<OpenAICompatibleEndpoint | undefined> {
		const providerName = VENDOR_TO_PROVIDER_NAME[model.vendor] ?? model.vendor;
		const apiKey = await this._byokStorageService.getAPIKey(providerName, model.id)
			?? await this._byokStorageService.getAPIKey(providerName);
		if (!apiKey) {
			return undefined;
		}

		const storedConfigs = await this._byokStorageService.getStoredModelConfigs(providerName);
		const deploymentUrl = storedConfigs[model.id]?.deploymentUrl;
		const baseUrl = deploymentUrl ?? defaultBaseUrlForVendor(model.vendor);
		if (!baseUrl) {
			return undefined;
		}

		return {
			vendor: model.vendor,
			modelId: model.id,
			url: `${baseUrl.replace(/\/$/, '')}/chat/completions`,
			apiKey,
		};
	}
}

function defaultBaseUrlForVendor(vendor: string): string | undefined {
	switch (vendor) {
		case 'openai':
			return 'https://api.openai.com/v1';
		case 'openrouter':
			return 'https://openrouter.ai/api/v1';
		case 'xai':
			return 'https://api.x.ai/v1';
		case 'groq':
			return 'https://api.groq.com/openai/v1';
		case 'mistral':
			return 'https://api.mistral.ai/v1';
		case 'deepseek':
			return 'https://api.deepseek.com/v1';
		case 'ollama':
			return 'http://127.0.0.1:11434/v1';
		default:
			return undefined;
	}
}

export class NullHarnessModelCompletionsService implements IHarnessModelCompletionsService {
	declare readonly _serviceBrand: undefined;
	readonly onDidChangeModel = Event.None;
	hasUsableModel(): boolean {
		return false;
	}
	getActiveByokEndpoint(): OpenAICompatibleEndpoint | undefined {
		return undefined;
	}
}
