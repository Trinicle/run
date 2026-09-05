/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Declarative ACP agent process configuration, sourced from
 * `chat.agentHost.acpAgents` or `VSCODE_AGENT_HOST_ACP_AGENTS`.
 */
export interface IAcpAgentDefinition {
	readonly id: string;
	readonly name?: string;
	readonly description?: string;
	readonly command: string;
	readonly args?: readonly string[];
	readonly env?: Readonly<Record<string, string>>;
}

export function parseAcpAgentDefinitions(value: unknown): IAcpAgentDefinition[] {
	if (typeof value === 'string') {
		try {
			value = JSON.parse(value);
		} catch {
			return [];
		}
	}
	if (!Array.isArray(value)) {
		return [];
	}
	const result: IAcpAgentDefinition[] = [];
	const seen = new Set<string>();
	for (const entry of value) {
		if (!entry || typeof entry !== 'object') {
			continue;
		}
		const record = entry as Record<string, unknown>;
		if (typeof record.id !== 'string' || record.id.trim() === '') {
			continue;
		}
		if (typeof record.command !== 'string' || record.command.trim() === '') {
			continue;
		}
		const id = record.id.trim();
		if (seen.has(id)) {
			continue;
		}
		seen.add(id);
		result.push({
			id,
			name: typeof record.name === 'string' ? record.name : undefined,
			description: typeof record.description === 'string' ? record.description : undefined,
			command: record.command,
			args: Array.isArray(record.args) ? record.args.filter((arg): arg is string => typeof arg === 'string') : undefined,
			env: isStringRecord(record.env) ? record.env : undefined,
		});
	}
	return result;
}

function isStringRecord(value: unknown): value is Record<string, string> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return false;
	}
	return Object.values(value).every(entry => typeof entry === 'string');
}
