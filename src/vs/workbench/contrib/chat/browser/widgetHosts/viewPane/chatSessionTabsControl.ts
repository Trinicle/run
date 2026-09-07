/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	$,
	addDisposableListener,
	append,
	DisposableResizeObserver,
	EventHelper,
	EventType,
} from '../../../../../../base/browser/dom.js';
import { ScrollableElement } from '../../../../../../base/browser/ui/scrollbar/scrollableElement.js';
import {
	Disposable,
	DisposableStore,
} from '../../../../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../../../../base/common/themables.js';
import { URI } from '../../../../../../base/common/uri.js';
import { localize } from '../../../../../../nls.js';
import { Codicon } from '../../../../../../base/common/codicons.js';
import { ActionBar } from '../../../../../../base/browser/ui/actionbar/actionbar.js';
import { Action } from '../../../../../../base/common/actions.js';
import { IKeybindingService } from '../../../../../../platform/keybinding/common/keybinding.js';
import { ScrollbarVisibility } from '../../../../../../base/common/scrollable.js';
import { CLOSE_EDITOR_COMMAND_ID } from '../../../../../browser/parts/editor/editorCommands.js';

export const NEW_THEA_SESSION_TITLE = localize(
	'newTheaSession',
	'New Thea Session',
);

export function getChatSessionTabTitle(title: string | undefined): string {
	return title?.trim() ? title : NEW_THEA_SESSION_TITLE;
}

export function getChatSessionTabCloseKeybinding(keybindingService: IKeybindingService): string | undefined {
	return keybindingService.lookupKeybinding(CLOSE_EDITOR_COMMAND_ID)?.getLabel() ?? undefined;
}

export function getChatSessionTabCloseTooltip(keybindingService: IKeybindingService): string {
	const label = localize('closeOneEditor', "Close");
	const keybinding = getChatSessionTabCloseKeybinding(keybindingService);
	if (keybinding) {
		return localize({ key: 'titleLabel', comment: ['action title', 'action keybinding'] }, "{0} ({1})", label, keybinding);
	}
	return label;
}

export interface IChatSessionTabItem {
	readonly resource: URI;
	readonly title: string;
	readonly active: boolean;
}

export interface IChatSessionTabsControlOptions {
	readonly onSelect: (resource: URI) => void;
	readonly onClose: (resource: URI) => void;
	readonly getCloseKeybinding?: () => string | undefined;
}

export class ChatSessionTabsControl extends Disposable {
	private static readonly TAB_SCROLLBAR_SIZE = 3;

	private readonly tabDisposables = this._register(new DisposableStore());
	private readonly tabsContainer: HTMLElement;
	private readonly tabsScrollbar: ScrollableElement;

	constructor(
		host: HTMLElement,
		private readonly options: IChatSessionTabsControlOptions,
	) {
		super();

		this.tabsContainer = $('.thea-chat-tabs');
		this.tabsContainer.classList.add(
			'modern-ui-editor-tab-group',
			'modern-ui-editor-tab-group-active',
		);
		this.tabsContainer.setAttribute('role', 'tablist');
		this.tabsContainer.setAttribute(
			'aria-label',
			localize('chatSessionTabs', "Chat sessions"),
		);

		this.tabsScrollbar = this._register(new ScrollableElement(this.tabsContainer, {
			horizontal: ScrollbarVisibility.Auto,
			horizontalScrollbarSize: ChatSessionTabsControl.TAB_SCROLLBAR_SIZE,
			vertical: ScrollbarVisibility.Hidden,
			scrollYToX: true,
			useShadows: false,
		}));
		host.appendChild(this.tabsScrollbar.getDomNode());

		this._register(addDisposableListener(this.tabsContainer, EventType.SCROLL, () => {
			this.tabsScrollbar.setScrollPosition({ scrollLeft: this.tabsContainer.scrollLeft });
		}));

		this._register(this.tabsScrollbar.onScroll(e => {
			if (e.scrollLeftChanged) {
				this.tabsContainer.scrollLeft = e.scrollLeft;
			}
		}));

		const resizeObserver = this._register(new DisposableResizeObserver('ChatSessionTabsControl.scroll', () => {
			this.updateScrollDimensions();
			this.revealActiveTab();
		}));
		this._register(resizeObserver.observe(this.tabsContainer));
	}

	setTabs(tabs: readonly IChatSessionTabItem[]): void {
		this.tabDisposables.clear();
		this.tabsContainer.replaceChildren();
		for (const tab of tabs) {
			append(this.tabsContainer, this.createTab(tab));
		}
		this.updateScrollDimensions();
		this.revealActiveTab();
	}

	private updateScrollDimensions(): void {
		this.tabsScrollbar.setScrollDimensions({
			width: this.tabsContainer.clientWidth,
			scrollWidth: this.tabsContainer.scrollWidth,
		});
	}

	private revealActiveTab(): void {
		const activeTab = this.tabsContainer.querySelector('.thea-chat-tab.active');
		activeTab?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
	}

	private createTab(tab: IChatSessionTabItem): HTMLElement {
		const el = $('.thea-chat-tab.modern-ui-editor-tab');
		el.setAttribute('role', 'tab');
		el.setAttribute('aria-selected', String(tab.active));
		el.tabIndex = tab.active ? 0 : -1;
		el.classList.toggle('active', tab.active);
		el.dataset['resource'] = tab.resource.toString();

		append(
			el,
			$(
				'.thea-chat-tab-fill.modern-ui-editor-tab-fill',
				{ 'aria-hidden': 'true' },
			),
		);

		const icon = append(el, $('.thea-chat-tab-icon'));
		icon.classList.add(...ThemeIcon.asClassNameArray(Codicon.chatSparkle));
		icon.setAttribute('aria-hidden', 'true');

		const label = append(
			el,
			$('.thea-chat-tab-label.modern-ui-editor-tab-label'),
		);
		label.textContent = tab.title;

		const closeLabel = localize('closeOneEditor', "Close");
		const actionsContainer = append(el, $('.thea-chat-tab-actions'));
		const actionBar = this.tabDisposables.add(new ActionBar(actionsContainer, {
			ariaLabel: closeLabel,
		}));
		const closeAction = this.tabDisposables.add(new Action(
			'thea.closeChatSession',
			closeLabel,
			ThemeIcon.asClassName(Codicon.closeSmall),
			true,
			() => {
				this.options.onClose(tab.resource);
				return Promise.resolve();
			},
		));
		actionBar.push(closeAction, {
			icon: true,
			label: false,
			keybinding: this.options.getCloseKeybinding?.(),
		});

		this.tabDisposables.add(
			addDisposableListener(el, EventType.CLICK, (e) => {
				if ((e.target as HTMLElement).closest('.thea-chat-tab-actions')) {
					return;
				}
				this.options.onSelect(tab.resource);
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
