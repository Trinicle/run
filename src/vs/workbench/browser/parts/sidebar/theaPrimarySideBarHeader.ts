/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/theaPrimarySideBarHeader.css';
import { $, append, reset } from '../../../../base/browser/dom.js';
import { StandardKeyboardEvent } from '../../../../base/browser/keyboardEvent.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { KeyCode } from '../../../../base/common/keyCodes.js';
import { Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { localize } from '../../../../nls.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IWorkbenchLayoutService, Parts, SINGLE_WINDOW_PARTS } from '../../../services/layout/browser/layoutService.js';
import { ToggleSidebarVisibilityAction } from '../../actions/layoutActions.js';
import { SideBarCompactContext, TheaWorkbenchModeContext } from '../../../common/contextkeys.js';
import { sidebarHeaderWidth } from './theaSidebarChrome.js';

const QUICK_OPEN_WITH_MODES_ID = 'workbench.action.quickOpenWithModes';

export class TheaPrimarySideBarHeader extends Disposable {

	readonly element: HTMLElement;

	private readonly agentTab: HTMLButtonElement;
	private readonly editorTab: HTMLButtonElement;
	private readonly collapseButton: HTMLButtonElement;
	private sizeObserver: ResizeObserver | undefined;
	private sidebarContainer: HTMLElement | undefined;
	private activityBarContainer: HTMLElement | undefined;

	constructor(
		@ICommandService private readonly commandService: ICommandService,
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
	) {
		super();

		this.element = $('.thea-primary-sidebar-header');
		this.element.setAttribute('role', 'toolbar');
		this.element.setAttribute('aria-label', localize('theaSidebarHeader', "Thea sidebar header"));

		const tabs = append(this.element, $('.thea-primary-sidebar-header-tabs'));
		this.agentTab = this.createTab(tabs, localize('theaAgentTab', "Agent"), 'thea.workbench.mode.agents');
		this.editorTab = this.createTab(tabs, localize('theaEditorTab', "Editor"), 'thea.workbench.mode.editor');

		const actions = append(this.element, $('.thea-primary-sidebar-header-actions'));
		this.createIconButton(actions, Codicon.search, localize('theaSearch', "Search"), QUICK_OPEN_WITH_MODES_ID);
		this.collapseButton = this.createIconButton(actions, Codicon.layoutSidebarLeft, localize('theaCollapseSidebar', "Toggle Primary Side Bar"), ToggleSidebarVisibilityAction.ID);

		this._register(this.layoutService.onDidLayoutMainContainer(() => {
			this.ensureSizeObserver();
			this.updateWidth();
		}));
		this._register(this.layoutService.onDidChangeSideBarCompact(() => {
			this.updateWidth();
			this.updateCollapseIcon();
		}));
		this._register(this.contextKeyService.onDidChangeContext(e => {
			if (e.affectsSome(new Set([TheaWorkbenchModeContext.key, SideBarCompactContext.key]))) {
				this.updateTabs();
				this.updateCollapseIcon();
			}
		}));

		this.updateTabs();
		this.updateCollapseIcon();
		this.ensureSizeObserver();
		this.updateWidth();
	}

	private createTab(parent: HTMLElement, label: string, commandId: string): HTMLButtonElement {
		const button = append(parent, $('button.thea-primary-sidebar-header-tab')) as HTMLButtonElement;
		button.type = 'button';
		button.textContent = label;
		this._register(this.bindClick(button, commandId));
		return button;
	}

	private createIconButton(parent: HTMLElement, icon: ThemeIcon, label: string, commandId: string): HTMLButtonElement {
		const button = append(parent, $('button.thea-primary-sidebar-header-action')) as HTMLButtonElement;
		button.type = 'button';
		button.title = label;
		button.setAttribute('aria-label', label);
		append(button, $(`span${ThemeIcon.asCSSSelector(icon)}`));
		this._register(this.bindClick(button, commandId));
		return button;
	}

	private bindClick(button: HTMLButtonElement, commandId: string) {
		const onActivate = () => this.commandService.executeCommand(commandId);
		const onKeyDown = (e: KeyboardEvent) => {
			const event = new StandardKeyboardEvent(e);
			if (event.equals(KeyCode.Enter) || event.equals(KeyCode.Space)) {
				event.preventDefault();
				onActivate();
			}
		};
		button.addEventListener('click', onActivate);
		button.addEventListener('keydown', onKeyDown);
		return toDisposable(() => {
			button.removeEventListener('click', onActivate);
			button.removeEventListener('keydown', onKeyDown);
		});
	}

	private updateTabs(): void {
		const mode = this.contextKeyService.getContextKeyValue<string>(TheaWorkbenchModeContext.key) ?? 'editor';
		this.agentTab.classList.toggle('active', mode === 'agents');
		this.editorTab.classList.toggle('active', mode === 'editor');
		this.agentTab.setAttribute('aria-pressed', String(mode === 'agents'));
		this.editorTab.setAttribute('aria-pressed', String(mode === 'editor'));
	}

	private updateCollapseIcon(): void {
		const compact = this.layoutService.isSideBarCompact();
		reset(this.collapseButton, $(`span${ThemeIcon.asCSSSelector(compact ? Codicon.layoutSidebarLeftOff : Codicon.layoutSidebarLeft)}`));
	}

	private ensureSizeObserver(): void {
		if (this.sizeObserver) {
			return;
		}

		this.sidebarContainer = this.layoutService.getContainer(mainWindow, Parts.SIDEBAR_PART);
		if (!this.sidebarContainer) {
			return;
		}

		this.activityBarContainer = this.layoutService.getContainer(mainWindow, Parts.ACTIVITYBAR_PART);
		this.sizeObserver = new ResizeObserver(entries => {
			let sidebarWidth: number | undefined;
			let activityBarWidth: number | undefined;
			for (const entry of entries) {
				if (entry.target === this.sidebarContainer) {
					sidebarWidth = entry.contentRect.width;
				} else if (entry.target === this.activityBarContainer) {
					activityBarWidth = entry.contentRect.width;
				}
			}
			this.updateWidth(sidebarWidth, activityBarWidth);
		});
		this.sizeObserver.observe(this.sidebarContainer);
		if (this.activityBarContainer) {
			this.sizeObserver.observe(this.activityBarContainer);
		}
		this._register(toDisposable(() => this.sizeObserver?.disconnect()));
	}

	private partWidth(part: SINGLE_WINDOW_PARTS): number {
		try {
			if (this.layoutService.isVisible(part)) {
				return this.layoutService.getSize(part).width;
			}
		} catch {
			// Grid may not be ready during early startup.
		}
		return 0;
	}

	private updateWidth(sidebarWidthOverride?: number, activityBarWidthOverride?: number): void {
		const compact = this.layoutService.isSideBarCompact();
		const activityBarWidth = activityBarWidthOverride ?? this.partWidth(Parts.ACTIVITYBAR_PART);
		if (compact) {
			this.element.style.width = 'auto';
			return;
		}

		const sidebarWidth = sidebarWidthOverride ?? this.partWidth(Parts.SIDEBAR_PART);
		this.element.style.width = `${sidebarHeaderWidth({ compact: false, sidebarWidth, activityBarWidth })}px`;
	}
}
