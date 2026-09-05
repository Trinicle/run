import * as vscode from 'vscode';

const VENDOR = 'run';
const SECRET_API_KEY = 'run.chat.apiKey';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	const provider = new RunLanguageModelChatProvider(context);
	context.subscriptions.push(
		vscode.lm.registerLanguageModelChatProvider(VENDOR, provider),
		vscode.commands.registerCommand('run.chat.setApiKey', () => setApiKey(context, provider)),
		vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('run.chat')) {
				provider.fireDidChange();
			}
		})
	);
}

export function deactivate(): void { }

async function setApiKey(context: vscode.ExtensionContext, provider: RunLanguageModelChatProvider): Promise<void> {
	const value = await vscode.window.showInputBox({
		title: 'Run Chat API Key',
		prompt: 'API key for the OpenAI-compatible endpoint. Leave empty to clear the stored key.',
		password: true,
		ignoreFocusOut: true
	});
	if (value === undefined) {
		return;
	}
	if (value.length === 0) {
		await context.secrets.delete(SECRET_API_KEY);
	} else {
		await context.secrets.store(SECRET_API_KEY, value);
	}
	provider.fireDidChange();
}

class RunLanguageModelChatProvider implements vscode.LanguageModelChatProvider {
	private readonly _onDidChangeLanguageModelChatInformation = new vscode.EventEmitter<void>();
	readonly onDidChangeLanguageModelChatInformation = this._onDidChangeLanguageModelChatInformation.event;

	constructor(private readonly context: vscode.ExtensionContext) { }

	fireDidChange(): void {
		this._onDidChangeLanguageModelChatInformation.fire();
	}

	async provideLanguageModelChatInformation(options: vscode.PrepareLanguageModelChatModelOptions, token: vscode.CancellationToken): Promise<vscode.LanguageModelChatInformation[]> {
		if (token.isCancellationRequested) {
			return [];
		}
		void options;
		const config = vscode.workspace.getConfiguration('run.chat');
		const defaultModel = config.get<string>('model') || 'gpt-4o';
		const models = config.get<string[]>('models') ?? [defaultModel];
		const ids = [...new Set([defaultModel, ...models].filter(id => id.trim().length > 0))];
		const hasKey = !!(await this._resolveApiKey());

		return ids.map(id => ({
			id,
			name: id,
			family: id,
			version: '1',
			maxInputTokens: 128000,
			maxOutputTokens: 16384,
			capabilities: {
				toolCalling: true,
				imageInput: false
			},
			tooltip: hasKey ? `OpenAI-compatible model ${id}` : 'Set run.chat.apiKey or RUN_CHAT_API_KEY to enable this model'
		}));
	}

	async provideLanguageModelChatResponse(
		model: vscode.LanguageModelChatInformation,
		messages: readonly vscode.LanguageModelChatRequestMessage[],
		options: vscode.ProvideLanguageModelChatResponseOptions,
		progress: vscode.Progress<vscode.LanguageModelResponsePart>,
		token: vscode.CancellationToken
	): Promise<void> {
		void options;
		const apiKey = await this._resolveApiKey();
		if (!apiKey) {
			throw new Error('Run Chat has no API key. Run "Run Chat: Set API Key" or set RUN_CHAT_API_KEY.');
		}

		const config = vscode.workspace.getConfiguration('run.chat');
		const apiBase = (config.get<string>('apiBase') || 'https://api.openai.com/v1').replace(/\/$/, '');
		const body = {
			model: model.id,
			stream: true,
			messages: messages.map(message => this._toApiMessage(message))
		};

		const ac = new AbortController();
		const cancel = token.onCancellationRequested(() => ac.abort());
		try {
			const response = await fetch(`${apiBase}/chat/completions`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${apiKey}`
				},
				body: JSON.stringify(body),
				signal: ac.signal
			});

			if (!response.ok) {
				const errorText = await response.text().catch(() => '');
				throw new Error(`Run Chat request failed (${response.status}): ${errorText || response.statusText}`);
			}

			if (!response.body) {
				throw new Error('Run Chat received an empty response body.');
			}

			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';
			while (true) {
				const { done, value } = await reader.read();
				if (done) {
					break;
				}
				if (token.isCancellationRequested) {
					await reader.cancel();
					return;
				}
				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split('\n');
				buffer = lines.pop() ?? '';
				for (const line of lines) {
					const payload = line.trim();
					if (!payload.startsWith('data:')) {
						continue;
					}
					const data = payload.slice(5).trim();
					if (!data || data === '[DONE]') {
						continue;
					}
					try {
						const json = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> };
						const content = json.choices?.[0]?.delta?.content;
						if (content) {
							progress.report(new vscode.LanguageModelTextPart(content));
						}
					} catch {
						// ignore malformed SSE frames
					}
				}
			}
		} finally {
			cancel.dispose();
		}
	}

	async provideTokenCount(model: vscode.LanguageModelChatInformation, text: string | vscode.LanguageModelChatRequestMessage, token: vscode.CancellationToken): Promise<number> {
		if (token.isCancellationRequested) {
			return 0;
		}
		void model;
		const value = typeof text === 'string' ? text : this._messageText(text);
		return Math.max(1, Math.ceil(value.length / 4));
	}

	private async _resolveApiKey(): Promise<string | undefined> {
		const secret = await this.context.secrets.get(SECRET_API_KEY);
		if (secret) {
			return secret;
		}
		const setting = vscode.workspace.getConfiguration('run.chat').get<string>('apiKey');
		if (setting) {
			return setting;
		}
		return process.env['RUN_CHAT_API_KEY'] || undefined;
	}

	private _toApiMessage(message: vscode.LanguageModelChatRequestMessage): { role: 'user' | 'assistant' | 'system'; content: string } {
		const role = message.role === vscode.LanguageModelChatMessageRole.Assistant ? 'assistant' : 'user';
		return { role, content: this._messageText(message) };
	}

	private _messageText(message: vscode.LanguageModelChatRequestMessage): string {
		return message.content.map(part => {
			if (part instanceof vscode.LanguageModelTextPart) {
				return part.value;
			}
			if (typeof part === 'object' && part && 'value' in part && typeof (part as { value: unknown }).value === 'string') {
				return (part as { value: string }).value;
			}
			return '';
		}).join('');
	}
}
