/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from "assert";
import { ensureNoDisposablesAreLeakedInTestSuite } from "../../../../../../../base/test/common/utils.js";
import { URI } from "../../../../../../../base/common/uri.js";
import {
	ChatSessionTabsControl,
	getChatSessionTabTitle,
	NEW_THEA_SESSION_TITLE,
} from "../../../../browser/widgetHosts/viewPane/chatSessionTabsControl.js";

suite("ChatSessionTabsControl", () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	test("empty titles use New Thea Session", () => {
		assert.strictEqual(
			getChatSessionTabTitle(undefined),
			NEW_THEA_SESSION_TITLE,
		);
		assert.strictEqual(getChatSessionTabTitle(""), NEW_THEA_SESSION_TITLE);
		assert.strictEqual(getChatSessionTabTitle("   "), NEW_THEA_SESSION_TITLE);
		assert.strictEqual(
			getChatSessionTabTitle("Fix the build"),
			"Fix the build",
		);
	});

	test("renders editor-style tabs with icon, label, and close", () => {
		const container = document.createElement("div");
		const selected: URI[] = [];
		const closed: URI[] = [];
		const first = URI.parse("vscode-local-chat-session://local/one");
		const second = URI.parse("vscode-local-chat-session://local/two");
		const control = disposables.add(
			new ChatSessionTabsControl(container, {
				onSelect: (resource) => selected.push(resource),
				onClose: (resource) => closed.push(resource),
			}),
		);

		control.setTabs([
			{ resource: first, title: NEW_THEA_SESSION_TITLE, active: true },
			{ resource: second, title: NEW_THEA_SESSION_TITLE, active: false },
		]);

		const tabs = container.querySelectorAll(".thea-chat-tab");
		assert.strictEqual(tabs.length, 2);
		assert.ok(tabs[0].querySelector(".thea-chat-tab-icon"));
		assert.strictEqual(
			tabs[0].querySelector(".thea-chat-tab-label")?.textContent,
			NEW_THEA_SESSION_TITLE,
		);
		assert.ok(tabs[0].querySelector(".thea-chat-tab-close"));
		assert.ok(tabs[0].classList.contains("active"));
		assert.strictEqual(tabs[0].getAttribute("aria-selected"), "true");
		assert.strictEqual(tabs[1].getAttribute("aria-selected"), "false");

		(tabs[1] as HTMLElement).click();
		assert.deepStrictEqual(
			selected.map((uri) => uri.toString()),
			[second.toString()],
		);

		(
			tabs[0].querySelector(".thea-chat-tab-close") as HTMLButtonElement
		).click();
		assert.deepStrictEqual(
			closed.map((uri) => uri.toString()),
			[first.toString()],
		);
	});
});
