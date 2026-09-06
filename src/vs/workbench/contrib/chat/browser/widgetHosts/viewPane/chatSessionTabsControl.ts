/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	$,
	addDisposableListener,
	append,
	EventHelper,
	EventType,
} from "../../../../../../base/browser/dom.js";
import {
	Disposable,
	DisposableStore,
} from "../../../../../../base/common/lifecycle.js";
import { ThemeIcon } from "../../../../../../base/common/themables.js";
import { URI } from "../../../../../../base/common/uri.js";
import { localize } from "../../../../../../nls.js";
import { Codicon } from "../../../../../../base/common/codicons.js";

export const NEW_THEA_SESSION_TITLE = localize(
	"newTheaSession",
	"New Thea Session",
);

export function getChatSessionTabTitle(title: string | undefined): string {
	return title?.trim() ? title : NEW_THEA_SESSION_TITLE;
}

export interface IChatSessionTabItem {
	readonly resource: URI;
	readonly title: string;
	readonly active: boolean;
}

export interface IChatSessionTabsControlOptions {
	readonly onSelect: (resource: URI) => void;
	readonly onClose: (resource: URI) => void;
}

export class ChatSessionTabsControl extends Disposable {
	private readonly tabDisposables = this._register(new DisposableStore());

	constructor(
		private readonly container: HTMLElement,
		private readonly options: IChatSessionTabsControlOptions,
	) {
		super();
		this.container.classList.add("thea-chat-tabs");
		this.container.setAttribute("role", "tablist");
		this.container.setAttribute(
			"aria-label",
			localize("chatSessionTabs", "Chat sessions"),
		);
	}

	setTabs(tabs: readonly IChatSessionTabItem[]): void {
		this.tabDisposables.clear();
		this.container.replaceChildren();
		for (const tab of tabs) {
			append(this.container, this.createTab(tab));
		}
	}

	private createTab(tab: IChatSessionTabItem): HTMLElement {
		const el = $(".thea-chat-tab");
		el.setAttribute("role", "tab");
		el.setAttribute("aria-selected", String(tab.active));
		el.tabIndex = tab.active ? 0 : -1;
		el.title = tab.title;
		el.classList.toggle("active", tab.active);
		el.dataset["resource"] = tab.resource.toString();

		const icon = append(el, $(".thea-chat-tab-icon"));
		icon.classList.add(...ThemeIcon.asClassNameArray(Codicon.chatSparkle));
		icon.setAttribute("aria-hidden", "true");

		const label = append(el, $(".thea-chat-tab-label"));
		label.textContent = tab.title;

		const close = append(
			el,
			$("button.thea-chat-tab-close"),
		) as HTMLButtonElement;
		close.type = "button";
		close.title = localize("closeChatSession", "Close");
		close.setAttribute(
			"aria-label",
			localize("closeChatSessionNamed", "Close {0}", tab.title),
		);
		close.classList.add(...ThemeIcon.asClassNameArray(Codicon.closeSmall));

		this.tabDisposables.add(
			addDisposableListener(el, EventType.CLICK, (e) => {
				if ((e.target as HTMLElement).closest(".thea-chat-tab-close")) {
					return;
				}
				this.options.onSelect(tab.resource);
			}),
		);
		this.tabDisposables.add(
			addDisposableListener(close, EventType.CLICK, (e) => {
				EventHelper.stop(e, true);
				this.options.onClose(tab.resource);
			}),
		);
		this.tabDisposables.add(
			addDisposableListener(el, EventType.AUXCLICK, (e) => {
				if (e.button === 1) {
					EventHelper.stop(e, true);
					this.options.onClose(tab.resource);
				}
			}),
		);

		return el;
	}
}
