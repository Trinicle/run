/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ActionType } from '../../../common/state/sessionActions.js';
import { ResponsePartKind, ToolCallStatus } from '../../../common/state/sessionState.js';
import { AcpEventMapper } from '../../../node/acp/acpEventMapper.js';

suite('ACP event mapper', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const chat = URI.parse('ahp-chat://default/session');
	const context = { chat, turnId: 'turn-1' };

	test('maps the first text chunk to ChatResponsePart and later chunks to ChatDelta', () => {
		const mapper = new AcpEventMapper();
		mapper.beginTurn(context.turnId);
		const first = mapper.mapUpdate(context, {
			sessionUpdate: 'agent_message_chunk',
			content: { type: 'text', text: 'Hel' },
		});
		const second = mapper.mapUpdate(context, {
			sessionUpdate: 'agent_message_chunk',
			content: { type: 'text', text: 'lo' },
		});

		assert.strictEqual(first.length, 1);
		assert.strictEqual(first[0].kind, 'action');
		assert.strictEqual(first[0].kind === 'action' && first[0].action.type, ActionType.ChatResponsePart);
		assert.strictEqual(first[0].kind === 'action' && first[0].action.type === ActionType.ChatResponsePart && first[0].action.part.kind, ResponsePartKind.Markdown);

		assert.strictEqual(second.length, 1);
		assert.strictEqual(second[0].kind, 'action');
		assert.strictEqual(second[0].kind === 'action' && second[0].action.type, ActionType.ChatDelta);
		assert.strictEqual(second[0].kind === 'action' && second[0].action.type === ActionType.ChatDelta && second[0].action.content, 'lo');
	});

	test('maps tool_call start and completion', () => {
		const mapper = new AcpEventMapper();
		mapper.beginTurn(context.turnId);
		const started = mapper.mapUpdate(context, {
			sessionUpdate: 'tool_call',
			toolCallId: 'tc-1',
			title: 'Read file',
			kind: 'read',
			status: 'in_progress',
		});
		const completed = mapper.mapUpdate(context, {
			sessionUpdate: 'tool_call_update',
			toolCallId: 'tc-1',
			title: 'Read file',
			status: 'completed',
		});

		assert.ok(started.some(signal => signal.kind === 'action' && signal.action.type === ActionType.ChatToolCallStart));
		assert.ok(started.some(signal => signal.kind === 'action' && signal.action.type === ActionType.ChatToolCallReady));
		assert.ok(completed.some(signal => signal.kind === 'action' && signal.action.type === ActionType.ChatToolCallComplete));
	});

	test('maps session/request_permission to pending_confirmation', () => {
		const mapper = new AcpEventMapper();
		mapper.beginTurn(context.turnId);
		const mapped = mapper.mapPermissionRequest(context, {
			sessionId: 'acp-1',
			title: 'Run command',
			toolCall: { toolCallId: 'tc-perm', title: 'Run command', kind: 'execute' },
			options: [
				{ optionId: 'allow_once', name: 'Allow', kind: 'allow_once' },
				{ optionId: 'reject_once', name: 'Reject', kind: 'reject_once' },
			],
		});

		assert.strictEqual(mapped.toolCallId, 'tc-perm');
		const pending = mapped.signals.find(signal => signal.kind === 'pending_confirmation');
		assert.ok(pending);
		assert.strictEqual(pending.kind === 'pending_confirmation' && pending.state.status, ToolCallStatus.PendingConfirmation);
		assert.strictEqual(pending.kind === 'pending_confirmation' && pending.permissionKind, 'shell');
		assert.ok(mapped.signals.some(signal => signal.kind === 'action' && signal.action.type === ActionType.ChatToolCallStart));
	});
});
