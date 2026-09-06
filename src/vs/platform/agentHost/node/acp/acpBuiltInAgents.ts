/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { existsSync } from 'fs';
import { join } from '../../../../base/common/path.js';
import { isWindows } from '../../../../base/common/platform.js';
import type { IAcpAgentDefinition } from './acpAgentConfig.js';

/**
 * Built-in ACP agents registered as their own picker rows. User
 * `chat.agentHost.acpAgents` entries merge after these; the same `id`
 * overrides only that built-in's command/args/env.
 *
 * These agents do not require GitHub Copilot sign-in when their protected
 * resource set is empty (see `agentHostProviderRequiresCopilotSignIn`).
 */
export const BUILTIN_ACP_AGENTS: readonly IAcpAgentDefinition[] = [
	{
		id: 'copilotcli',
		name: 'Copilot',
		command: 'copilot',
		args: ['--acp', '--stdio'],
	},
	{ id: 'claude', name: 'Claude', command: 'claude-agent-acp', args: [] },
	{ id: 'codex', name: 'Codex', command: 'codex-acp', args: [] },
];

export function mergeAcpAgentDefinitions(
	builtIns: readonly IAcpAgentDefinition[],
	user: readonly IAcpAgentDefinition[],
): IAcpAgentDefinition[] {
	const overrides = new Map<string, IAcpAgentDefinition>();
	for (const entry of user) {
		overrides.set(entry.id, entry);
	}
	const result: IAcpAgentDefinition[] = [];
	const seen = new Set<string>();
	for (const builtIn of builtIns) {
		result.push(overrides.get(builtIn.id) ?? builtIn);
		seen.add(builtIn.id);
	}
	for (const entry of user) {
		if (!seen.has(entry.id)) {
			result.push(entry);
			seen.add(entry.id);
		}
	}
	return result;
}

/**
 * Resolves a command name to a local `node_modules/.bin` shim when present.
 * Absolute or already-qualified paths are returned unchanged.
 */
export function resolveAcpBinCommand(command: string, searchRoots: readonly string[] = [process.cwd()]): string {
	if (command.includes('/') || command.includes('\\')) {
		return command;
	}
	const names = isWindows ? [`${command}.cmd`, `${command}.exe`, command] : [command];
	for (const root of searchRoots) {
		const binDir = join(root, 'node_modules', '.bin');
		for (const name of names) {
			const candidate = join(binDir, name);
			if (existsSync(candidate)) {
				return candidate;
			}
		}
	}
	return command;
}
