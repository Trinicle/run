/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import "./media/chatViewPane.css";
import {
	$,
	addDisposableListener,
	append,
	EventHelper,
	EventType,
	getWindow,
	hide,
	show,
} from "../../../../../../base/browser/dom.js";
import { StandardMouseEvent } from "../../../../../../base/browser/mouseEvent.js";
import { DomScrollableElement } from "../../../../../../base/browser/ui/scrollbar/scrollableElement.js";
import {
	CancellationToken,
	CancellationTokenSource,
} from "../../../../../../base/common/cancellation.js";
import { isCancellationError } from "../../../../../../base/common/errors.js";
import { Event } from "../../../../../../base/common/event.js";
import {
	MutableDisposable,
	toDisposable,
	DisposableStore,
	DisposableMap,
	IDisposable,
} from "../../../../../../base/common/lifecycle.js";
import { LRUCache } from "../../../../../../base/common/map.js";
import { MarshalledId } from "../../../../../../base/common/marshallingIds.js";
import {
	autorun,
	IObservable,
	IReader,
	observableFromEvent,
	observableValue,
} from "../../../../../../base/common/observable.js";
import {
	getComparisonKey,
	isEqual,
} from "../../../../../../base/common/resources.js";
import { ScrollbarVisibility } from "../../../../../../base/common/scrollable.js";
import { URI } from "../../../../../../base/common/uri.js";
import { localize } from "../../../../../../nls.js";
import { MenuId } from "../../../../../../platform/actions/common/actions.js";
import { CommandsRegistry } from "../../../../../../platform/commands/common/commands.js";
import { IConfigurationService } from "../../../../../../platform/configuration/common/configuration.js";
import {
	IContextKey,
	IContextKeyService,
} from "../../../../../../platform/contextkey/common/contextkey.js";
import { IContextMenuService } from "../../../../../../platform/contextview/browser/contextView.js";
import { IHoverService } from "../../../../../../platform/hover/browser/hover.js";
import { IInstantiationService } from "../../../../../../platform/instantiation/common/instantiation.js";
import { ServiceCollection } from "../../../../../../platform/instantiation/common/serviceCollection.js";
import { IKeybindingService } from "../../../../../../platform/keybinding/common/keybinding.js";
import { ILogService } from "../../../../../../platform/log/common/log.js";
import { INotificationService } from "../../../../../../platform/notification/common/notification.js";
import { IOpenerService } from "../../../../../../platform/opener/common/opener.js";
import {
	IStorageService,
	StorageScope,
	StorageTarget,
} from "../../../../../../platform/storage/common/storage.js";
import { ITelemetryService } from "../../../../../../platform/telemetry/common/telemetry.js";
import { IWorkspaceContextService } from "../../../../../../platform/workspace/common/workspace.js";
import { editorBackground } from "../../../../../../platform/theme/common/colorRegistry.js";
import { ChatViewTitleControl } from "./chatViewTitleControl.js";
import {
	ChatSessionTabsControl,
	getChatSessionTabTitle,
} from "./chatSessionTabsControl.js";
import { IThemeService } from "../../../../../../platform/theme/common/themeService.js";
import { isDark } from "../../../../../../platform/theme/common/theme.js";
import { IAccessibilityService } from "../../../../../../platform/accessibility/common/accessibility.js";
import {
	IViewPaneOptions,
	ViewPane,
} from "../../../../../browser/parts/views/viewPane.js";
import { Memento } from "../../../../../common/memento.js";
import { SIDE_BAR_FOREGROUND } from "../../../../../common/theme.js";
import {
	IViewDescriptorService,
	ViewContainerLocation,
} from "../../../../../common/views.js";
import {
	ILifecycleService,
	StartupKind,
} from "../../../../../services/lifecycle/common/lifecycle.js";
import { IChatViewTitleActionContext } from "../../../common/actions/chatActions.js";
import { IChatAgentService } from "../../../common/participants/chatAgents.js";
import { ChatContextKeys } from "../../../common/actions/chatContextKeys.js";
import {
	IChatModel,
	IChatModelInputState,
} from "../../../common/model/chatModel.js";
import { CHAT_PROVIDER_ID } from "../../../common/participants/chatParticipantContribTypes.js";
import {
	IChatModelReference,
	IChatService,
} from "../../../common/chatService/chatService.js";
import {
	IChatSessionsService,
	localChatSessionType,
} from "../../../common/chatSessionsService.js";
import {
	LocalChatSessionUri,
	getChatSessionType,
	getNewChatSessionResource,
	isUntitledChatSession,
} from "../../../common/model/chatUri.js";
import {
	ChatAgentLocation,
	ChatConfiguration,
	ChatModeKind,
	getDefaultNewChatSessionType,
	getDefaultNewChatSessionTypeAndReasonFromServices,
	getLocalFallbackSessionTypeSelectionReason,
	SessionTypeSelectionReason,
} from "../../../common/constants.js";
import { ChatWidget } from "../../widget/chatWidget.js";
import {
	ChatViewWelcomeController,
	IViewWelcomeDelegate,
} from "../../viewsWelcome/chatViewWelcomeController.js";
import { IChatViewsWelcomeDescriptor } from "../../viewsWelcome/chatViewsWelcome.js";
import {
	IWorkbenchLayoutService,
	LayoutSettings,
	Position,
} from "../../../../../services/layout/browser/layoutService.js";
import { IProgressService } from "../../../../../../platform/progress/common/progress.js";
import {
	CHAT_WIDGET_VIEW_STATE_CACHE_LIMIT,
	ChatViewId,
	IChatWidgetService,
	IChatWidgetViewState,
	setModelPreservingInputTypedWhileLoading,
} from "../../chat.js";
import {
	IActivityService,
	ProgressBadge,
} from "../../../../../services/activity/common/activity.js";
import { disposableTimeout } from "../../../../../../base/common/async.js";
import { IAgentSessionsService } from "../../agentSessions/agentSessionsService.js";
import { IAgentHostEnablementService } from "../../../../../../platform/agentHost/common/agentHostEnablementService.js";
import { toErrorMessage } from "../../../../../../base/common/errorMessage.js";
import { IMicCaptureService } from "../../voiceClient/micCaptureService.js";
import { ITtsPlaybackService } from "../../voiceClient/ttsPlaybackService.js";
import { IVoiceSessionController } from "../../voiceClient/voiceSessionController.js";
import {
	IVoiceInputModeService,
	SimulatedVoiceState,
} from "../../voiceInputMode/voiceInputMode.js";
import {
	isGlowingVoiceState,
	readVoiceGlowIntensity,
	resolveVoiceGlowColors,
	VoiceGlowState,
} from "../../voiceClient/voiceGlow.js";
import { createVoiceGlowController } from "../../voiceClient/voiceGlowController.js";
import { combineVoiceInput } from "../../voiceClient/voiceInputUtils.js";
import {
	IVoiceModelSelectionResult,
	resolveVoiceModel,
} from "../../voiceClient/voiceToolDispatchService.js";
import { IVoicePlaybackService } from "../../../common/voicePlaybackService.js";
import { VOICE_AGENT_PROGRESS_SETTING } from "../../../common/voiceClient/voiceClientService.js";
import { IWorkbenchEnvironmentService } from "../../../../../services/environment/common/environmentService.js";

interface IChatViewPaneState extends Partial<IChatModelInputState> {
	/**
	 * @deprecated This is kept around to support old view states. However it should not be set on new states and `sessionResource` should be used instead.
	 */
	sessionId?: string;
	sessionResource?: URI;
}

interface IChatSessionAcquisitionResult {
	modelRef: IChatModelReference | undefined;
	localFallbackSelectionReason?: SessionTypeSelectionReason;
}

type ChatViewPaneOpenedClassification = {
	owner: "sbatten";
	comment: "Event fired when the chat view pane is opened";
};

export class ChatViewPane extends ViewPane implements IViewWelcomeDelegate {
	private readonly memento: Memento<IChatViewPaneState>;
	private readonly viewState: IChatViewPaneState;

	private viewPaneContainer: HTMLElement | undefined;
	private readonly chatViewLocationContext: IContextKey<ViewContainerLocation>;

	private lastDimensions: { height: number; width: number } | undefined;

	private welcomeController: ChatViewWelcomeController | undefined;

	private restoringSession: Promise<void> | undefined;
	private readonly loadSessionCts = this._register(
		new MutableDisposable<CancellationTokenSource>(),
	);
	private readonly _applyModelCts = this._register(
		new MutableDisposable<CancellationTokenSource>(),
	);
	private readonly modelRef = this._register(
		new MutableDisposable<IChatModelReference>(),
	);
	private readonly widgetViewStates = new LRUCache<
		string,
		IChatWidgetViewState
	>(CHAT_WIDGET_VIEW_STATE_CACHE_LIMIT);
	private openTabResources: URI[] = [];
	private readonly closingTabKeys = new Set<string>();
	private readonly tabKeepAlive = this._register(
		new DisposableMap<string, IChatModelReference>(),
	);
	private readonly tabListeners = this._register(
		new DisposableMap<string, IDisposable>(),
	);
	private sessionTabsControl: ChatSessionTabsControl | undefined;
	private sessionTabsHost: HTMLElement | undefined;
	private sessionTabsTitle: HTMLElement | undefined;
	private sessionTabsHiddenHeading: HTMLElement | undefined;
	private newSessionQueue: Promise<unknown> = Promise.resolve();

	private readonly activityBadge = this._register(new MutableDisposable());
	private readonly _currentSessionResource = observableValue<URI | undefined>(
		this,
		undefined,
	);
	/**
	 * Session resource of the last-focused chat widget, or this pane's own
	 * session when no chat widget is focused. Used to bind the voice glow /
	 * transcript to the single input voice targets, so with several chat inputs
	 * open (e.g. this pane plus a chat editor) only the focused one lights up.
	 */
	private _focusedSessionResource!: IObservable<URI | undefined>;

	constructor(
		options: IViewPaneOptions,
		@IKeybindingService keybindingService2: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
		@IStorageService private readonly storageService: IStorageService,
		@IChatService private readonly chatService: IChatService,
		@IChatAgentService private readonly chatAgentService: IChatAgentService,
		@ILogService private readonly logService: ILogService,
		@INotificationService
		private readonly notificationService: INotificationService,
		@IWorkbenchLayoutService
		private readonly layoutService: IWorkbenchLayoutService,
		@IChatSessionsService
		private readonly chatSessionsService: IChatSessionsService,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@ILifecycleService lifecycleService: ILifecycleService,
		@IProgressService private readonly progressService: IProgressService,
		@IAgentSessionsService
		private readonly agentSessionsService: IAgentSessionsService,
		@IActivityService private readonly activityService: IActivityService,
		@IMicCaptureService private readonly micCaptureService: IMicCaptureService,
		@ITtsPlaybackService
		private readonly ttsPlaybackService: ITtsPlaybackService,
		@IVoiceSessionController
		private readonly voiceSessionController: IVoiceSessionController,
		@IVoiceInputModeService
		private readonly voiceInputModeService: IVoiceInputModeService,
		@IChatWidgetService private readonly chatWidgetService: IChatWidgetService,
		@IVoicePlaybackService _voicePlaybackService: IVoicePlaybackService,
		@IWorkbenchEnvironmentService
		_workbenchEnvironmentService: IWorkbenchEnvironmentService,
		@IWorkspaceContextService
		private readonly workspaceContextService: IWorkspaceContextService,
		@IAgentHostEnablementService
		private readonly agentHostEnablementService: IAgentHostEnablementService,
		@IAccessibilityService
		private readonly accessibilityService: IAccessibilityService,
	) {
		super(
			options,
			keybindingService2,
			contextMenuService,
			configurationService,
			contextKeyService,
			viewDescriptorService,
			instantiationService,
			openerService,
			themeService,
			hoverService,
		);
		this.element.classList.add("chat-viewpane-container");

		// View state for the ViewPane is currently global per-provider basically,
		// but some other strictly per-model state will require a separate memento.
		this.memento = new Memento(
			`interactive-session-view-${CHAT_PROVIDER_ID}`,
			this.storageService,
		);
		this.viewState = this.memento.getMemento(
			StorageScope.WORKSPACE,
			StorageTarget.MACHINE,
		);
		if (
			lifecycleService.startupKind !== StartupKind.ReloadedWindow &&
			this.configurationService.getValue<boolean>(
				ChatConfiguration.RestoreLastPanelSession,
			) === false
		) {
			// clear persisted session on fresh start
			this.viewState.sessionId = undefined;
			this.viewState.sessionResource = undefined;
		}

		// Contextkeys
		this.chatViewLocationContext =
			ChatContextKeys.panelLocation.bindTo(contextKeyService);

		this.updateContextKeys();

		// Tracks the session of the last-focused chat widget so the voice UI can
		// bind to exactly one input even when several are open.
		this._focusedSessionResource = observableFromEvent(
			this,
			this.chatWidgetService.onDidChangeFocusedSession,
			() =>
				this.chatWidgetService.lastFocusedWidget?.viewModel?.sessionResource,
		);

		this.registerListeners();
	}

	private updateContextKeys(): void {
		const { location } = this.getViewPositionAndLocation();

		this.chatViewLocationContext.set(
			location ?? ViewContainerLocation.AuxiliaryBar,
		);
	}

	private getViewPositionAndLocation(): {
		position: Position;
		location: ViewContainerLocation;
	} {
		const viewLocation = this.viewDescriptorService.getViewLocationById(
			this.id,
		);
		const sideBarPosition = this.layoutService.getSideBarPosition();
		const panelPosition = this.layoutService.getPanelPosition();

		let sideSessionsOnRightPosition: boolean;
		switch (viewLocation) {
			case ViewContainerLocation.Sidebar:
				sideSessionsOnRightPosition = sideBarPosition === Position.RIGHT;
				break;
			case ViewContainerLocation.Panel:
				sideSessionsOnRightPosition = panelPosition !== Position.LEFT;
				break;
			default:
				sideSessionsOnRightPosition = sideBarPosition === Position.LEFT;
				break;
		}

		return {
			position: sideSessionsOnRightPosition ? Position.RIGHT : Position.LEFT,
			location: viewLocation ?? ViewContainerLocation.AuxiliaryBar,
		};
	}

	private updateViewPaneClasses(fromEvent: boolean): void {
		const activityBarLocationDefault =
			this.configurationService.getValue<string>(
				LayoutSettings.ACTIVITY_BAR_LOCATION,
			) === "default";
		this.viewPaneContainer?.classList.toggle(
			"activity-bar-location-default",
			activityBarLocationDefault,
		);
		this.viewPaneContainer?.classList.toggle(
			"activity-bar-location-other",
			!activityBarLocationDefault,
		);

		const { position, location } = this.getViewPositionAndLocation();

		this.viewPaneContainer?.classList.toggle(
			"chat-view-location-auxiliarybar",
			location === ViewContainerLocation.AuxiliaryBar,
		);
		this.viewPaneContainer?.classList.toggle(
			"chat-view-location-sidebar",
			location === ViewContainerLocation.Sidebar,
		);
		this.viewPaneContainer?.classList.toggle(
			"chat-view-location-panel",
			location === ViewContainerLocation.Panel,
		);

		this.viewPaneContainer?.classList.toggle(
			"chat-view-position-left",
			position === Position.LEFT,
		);
		this.viewPaneContainer?.classList.toggle(
			"chat-view-position-right",
			position === Position.RIGHT,
		);

		if (fromEvent) {
			this.relayout();
		}
	}

	private registerListeners(): void {
		// Agent changes
		this._register(
			this.chatAgentService.onDidChangeAgents(() => this.onDidChangeAgents()),
		);

		// Session changes
		this._register(
			this.chatSessionsService.onDidCommitSession(async (e) => {
				if (!this.modelRef.value) {
					return;
				}

				if (!isEqual(e.original, this.modelRef.value.object.sessionResource)) {
					return;
				}

				this.replaceSessionTab(e.original, e.committed);
				const modelRef = await this.chatService.acquireOrLoadSession(
					e.committed,
					ChatAgentLocation.Chat,
					CancellationToken.None,
					"ChatViewPane#onDidCommitSession",
				);
				await this.showModel(CancellationToken.None, modelRef);
			}),
		);

		// Layout changes
		this._register(
			Event.any(
				Event.filter(this.configurationService.onDidChangeConfiguration, (e) =>
					e.affectsConfiguration("workbench.sideBar.location"),
				),
				this.layoutService.onDidChangePanelPosition,
				this.layoutService.onDidChangePartVisibility,
				Event.filter(
					this.viewDescriptorService.onDidChangeContainerLocation,
					(e) =>
						e.viewContainer ===
						this.viewDescriptorService.getViewContainerByViewId(this.id),
				),
			)(() => {
				this.updateContextKeys();
				this.updateViewPaneClasses(true /* layout here */);
				this.attachSessionTabs();
			}),
		);

		// Settings changes
		this._register(
			Event.filter(this.configurationService.onDidChangeConfiguration, (e) => {
				return e.affectsConfiguration(LayoutSettings.ACTIVITY_BAR_LOCATION);
			})(() => this.updateViewPaneClasses(true)),
		);
	}

	private onDidChangeAgents(): void {
		if (this.chatAgentService.getDefaultAgent(ChatAgentLocation.Chat)) {
			if (!this._widget?.viewModel && !this.restoringSession) {
				this.restoringSession = this.acquireTransferredOrPersistedSession(
					CancellationToken.None,
					"ChatViewPane#onDidChangeAgents",
				).then(async (session) => {
					if (!this._widget) {
						return; // renderBody has not been called yet
					}

					// The widget may be hidden at this point, because welcome views were allowed. Use setVisible to
					// avoid doing a render while the widget is hidden. This is changing the condition in `shouldShowWelcome`
					// so it should fire onDidChangeViewWelcomeState.
					const wasVisible = this._widget.visible;
					try {
						this._widget.setVisible(false);

						await this.showModel(
							CancellationToken.None,
							session.modelRef,
							true,
							!session.modelRef,
							undefined,
							session.localFallbackSelectionReason,
						);
					} finally {
						this._widget.setVisible(wasVisible);
					}
				});

				this.restoringSession.finally(
					() => (this.restoringSession = undefined),
				);
			}
		}

		this._onDidChangeViewWelcomeState.fire();
	}

	private getTransferredOrPersistedSessionInfo(): URI | undefined {
		if (this.chatService.transferredSessionResource) {
			return this.chatService.transferredSessionResource;
		}

		if (this.viewState.sessionResource) {
			return this.viewState.sessionResource;
		}

		return this.viewState.sessionId
			? LocalChatSessionUri.forSession(this.viewState.sessionId)
			: undefined;
	}

	protected override renderBody(parent: HTMLElement): void {
		super.renderBody(parent);

		this.telemetryService.publicLog2<{}, ChatViewPaneOpenedClassification>(
			"chatViewPaneOpened",
		);

		this.viewPaneContainer = parent;
		this.viewPaneContainer.classList.add("chat-viewpane");
		this.updateViewPaneClasses(false);

		// Controls wrapper — welcome + chat live inside here
		const controlsWrapper = append(parent, $(".voice-agent-controls-wrapper"));
		this.createControls(controlsWrapper);

		// Voice bar — hidden by default, voice is activated via mic button in toolbar.
		// The widget is still created for PTT keybinding support and session binding.
		this._voiceBarContainer = $(".voice-agent-bar-host");
		this._voiceBarContainer.style.display = "none";
		this._updateVoiceBar(this._voiceBarContainer);

		// Transcript overlay — shown inside the input container when voice is active
		const inputContainerEl = this._widget.inputPart.inputContainerElement;
		if (inputContainerEl) {
			this._setupVoiceTranscriptOverlay(inputContainerEl);
		}

		this._register(
			this.configurationService.onDidChangeConfiguration((e) => {
				if (e.affectsConfiguration("agents.voice.enabled")) {
					this._updateVoiceBar(this._voiceBarContainer!);
				}
			}),
		);

		this.setupContextMenu(parent);

		this._register(
			this.onDidChangeBodyVisibility((visible) => {
				if (visible) {
					this.attachSessionTabs();
				} else {
					this.detachSessionTabs();
				}
			}),
		);
		this._register(toDisposable(() => this.detachSessionTabs()));
		this.attachSessionTabs();

		this.applyModel();
	}

	private createControls(parent: HTMLElement): void {
		// Welcome Control (used to show chat specific extension provided welcome views via `chatViewsWelcome` contribution point)
		this.welcomeController = this._register(
			this.instantiationService.createInstance(
				ChatViewWelcomeController,
				parent,
				this,
				ChatAgentLocation.Chat,
			),
		);

		// Chat Control
		const chatWidget = this.createChatControl(parent);

		// Controls Listeners
		this.registerControlsListeners(chatWidget);
	}

	//#region Voice Agent Bar

	private _voiceBarContainer: HTMLElement | undefined;
	private readonly _voiceBarDisposables = this._register(new DisposableStore());

	private _updateVoiceBar(container: HTMLElement): void {
		this._voiceBarDisposables.clear();
		container.replaceChildren();

		// Always keep the container hidden — voice UI is now the mic toolbar
		// button + transcript overlay. We still register the command bridges
		// needed by VoiceSessionController.
		container.style.display = "none";

		if (this.configurationService.getValue<boolean>("agents.voice.enabled")) {
			// Voice command bridge — lets the VoiceSessionController reach into the chat widget
			this._voiceBarDisposables.add(
				CommandsRegistry.registerCommand(
					"_chat.voice.acceptInput",
					(accessor, text: string) => {
						const chatWidgetService = accessor.get(IChatWidgetService);
						// Ignore lastFocusedWidget when its input no longer has focus because blur does not clear it.
						const focusedWidget = chatWidgetService.lastFocusedWidget;
						const widget = focusedWidget?.hasInputFocus()
							? focusedWidget
							: this._widget;
						if (text && widget?.viewModel) {
							if (widget.viewModel.editing) {
								// When editing an old message, populate the active input
								// editor so the user can review before submitting.
								widget.input.setValue(text, false);
							} else {
								// Preserve any text the user already typed in the input.
								return widget.acceptInput(
									combineVoiceInput(widget.getInput(), text),
									{
										preserveFocus: true,
										isVoiceModeInput:
											this.configurationService.getValue<boolean>(
												VOICE_AGENT_PROGRESS_SETTING,
											) === true,
									},
								);
							}
						}
						return undefined;
					},
				),
			);
			this._voiceBarDisposables.add(
				CommandsRegistry.registerCommand(
					"_chat.voice.switchToSession",
					async (_accessor, resourceStr: string): Promise<boolean> => {
						if (!resourceStr) {
							return false;
						}
						try {
							const resource = URI.parse(resourceStr);
							this.viewState.sessionResource = resource;
							this.applyModel();
							await this.restoringSession;
							const restoredResource = this._widget?.viewModel?.sessionResource;
							return !!restoredResource && isEqual(restoredResource, resource);
						} catch {
							return false;
						}
					},
				),
			);
			this._voiceBarDisposables.add(
				CommandsRegistry.registerCommand(
					"_chat.voice.getCurrentSession",
					(_accessor): string | undefined => {
						return this._widget?.viewModel?.sessionResource?.toString();
					},
				),
			);
			this._voiceBarDisposables.add(
				CommandsRegistry.registerCommand(
					"_chat.voice.selectModel",
					(_accessor, requestedModel: string): IVoiceModelSelectionResult => {
						const widget = this._getVoiceActionWidget();
						if (!widget) {
							return { ok: false, reason: "no_input" };
						}
						const resolved = resolveVoiceModel(
							widget.inputPart.availableLanguageModels,
							requestedModel,
						);
						if (!resolved.ok || !resolved.identifier) {
							return resolved;
						}
						return widget.inputPart.switchModelByIdentifier(
							resolved.identifier,
							true,
							true,
						)
							? resolved
							: {
									ok: false,
									reason: "selection_failed",
									available_models: resolved.available_models,
								};
					},
				),
			);
		}
	}

	private _getVoiceActionWidget() {
		const target = this._currentVoiceInputResource();
		return target
			? this.chatWidgetService.getWidgetBySessionResource(target)
			: this._widget;
	}

	/**
	 * The single chat input voice mode is currently bound to. An explicit target
	 * session wins, otherwise the last-focused chat widget's session falls back to
	 * this pane's own session. The glow / transcript render only on
	 * the pane whose session matches this, so with several chat inputs open (e.g.
	 * this pane plus a chat editor) exactly one lights up.
	 */
	private _currentVoiceInputResource(reader?: IReader): URI | undefined {
		const target = reader
			? this.voiceSessionController.targetSession.read(reader)
			: this.voiceSessionController.targetSession.get();
		if (target) {
			return target;
		}
		const focused = reader
			? this._focusedSessionResource.read(reader)
			: this._focusedSessionResource.get();
		return focused ?? this._widget?.viewModel?.sessionResource;
	}

	private _setupVoiceTranscriptOverlay(inputContainerEl: HTMLElement): void {
		inputContainerEl.style.position = "relative";
		const showTranscriptSetting = observableFromEvent(
			this,
			Event.filter(this.configurationService.onDidChangeConfiguration, (e) =>
				e.affectsConfiguration("agents.voice.showTranscript"),
			),
			() =>
				this.configurationService.getValue<boolean>(
					"agents.voice.showTranscript",
				) !== false,
		);
		const showLiveTranscriptSetting = observableFromEvent(
			this,
			Event.filter(this.configurationService.onDidChangeConfiguration, (e) =>
				e.affectsConfiguration("agents.voice.liveTranscript"),
			),
			() =>
				this.configurationService.getValue<boolean>(
					"agents.voice.liveTranscript",
				) !== false,
		);
		const inputValue = observableFromEvent(
			this,
			this._widget.inputEditor.onDidChangeModelContent,
			() => this._widget.getInput(),
		);
		const transcriptOverlay = $(".voice-transcript-overlay");
		const transcriptScrollable = this._register(
			new DomScrollableElement(transcriptOverlay, {
				horizontal: ScrollbarVisibility.Hidden,
				vertical: ScrollbarVisibility.Auto,
			}),
		);
		const transcriptOverlayNode = transcriptScrollable.getDomNode();
		transcriptOverlayNode.classList.add("voice-transcript-overlay-scrollable");
		transcriptOverlayNode.style.display = "none";
		inputContainerEl.append(transcriptOverlayNode);

		// Dynamic audio-reactive glow animation (matches aux window behavior)
		let animFrameId: number | undefined;
		const glowDataArrayRef: { value: Uint8Array | undefined } = {
			value: undefined,
		};
		const win = getWindow(inputContainerEl);
		const glowController = this._register(
			createVoiceGlowController(
				inputContainerEl,
				() =>
					isDark(this.themeService.getColorTheme().type) ? "dark" : "light",
				() => resolveVoiceGlowColors(this.themeService.getColorTheme()),
			),
		);
		this._register(
			this.themeService.onDidColorThemeChange(() =>
				glowController.refreshTheme(),
			),
		);
		// Merge the real voice session with any dev/preview simulation so the walkthrough
		// commands drive the input-box glow exactly as a live session would.
		const getEffectiveVoice = (): {
			connected: boolean;
			voiceState: VoiceGlowState;
			simulating: boolean;
		} => {
			const sim: SimulatedVoiceState | undefined =
				this.voiceInputModeService.simulatedVoiceState.get();
			if (sim === "idle" || sim === "listening" || sim === "speaking") {
				return { connected: true, voiceState: sim, simulating: true };
			}
			if (sim === "off" || sim === "connecting" || sim === "dictating") {
				return { connected: false, voiceState: "idle", simulating: true };
			}
			const voiceState =
				this.voiceSessionController.voiceState.get() as VoiceGlowState;
			return {
				connected: this.voiceSessionController.isConnected.get(),
				// While muted the mic isn't heard; treat muted-listening as idle (no
				// glow). Only check mute in the listening state so other states don't
				// depend on it.
				voiceState:
					voiceState === "listening" &&
					this.voiceSessionController.isMuted.get()
						? "idle"
						: voiceState,
				simulating: false,
			};
		};
		const startGlowAnimation = () => {
			if (animFrameId !== undefined) {
				return;
			}
			const animate = () => {
				animFrameId = win.requestAnimationFrame(animate);
				const { connected, voiceState, simulating } = getEffectiveVoice();
				// Only glow the input of the session voice is bound to. Mirrors the
				// transcript overlay's ownership test (see below) so the glow and
				// the "Listening..."/transcript overlay always render on the same
				// pane and never on a different split/window (#8514) or a chat
				// editor open alongside this pane. A dev/preview simulation bypasses
				// ownership so the walkthrough can light up here.
				const currentSession = this._currentSessionResource.get();
				const boundResource = this._currentVoiceInputResource();
				const isOwner =
					!!currentSession &&
					!!boundResource &&
					isEqual(currentSession, boundResource);
				const glowActive =
					connected &&
					isGlowingVoiceState(voiceState) &&
					(simulating || isOwner);

				if (!glowActive) {
					glowController.clear();
					return;
				}

				// Get audio intensity from analyser
				const analyser =
					this.ttsPlaybackService.analyserNode ??
					(voiceState === "listening"
						? this.micCaptureService.analyserNode
						: null) ??
					null;
				let intensity: number;
				if (!analyser && simulating) {
					// No live audio (a simulation): synthesize a lively pulsing intensity
					// so the walkthrough glow behaves like real speech instead of sitting flat.
					const t = Date.now() / 1000;
					intensity = Math.min(
						1,
						0.28 +
							0.34 * Math.abs(Math.sin(t * 6.1)) +
							0.22 * Math.abs(Math.sin(t * 11.3 + 1)),
					);
				} else {
					intensity = readVoiceGlowIntensity(analyser, glowDataArrayRef);
				}

				glowController.render(
					voiceState,
					intensity,
					this.accessibilityService.isMotionReduced(),
				);
			};
			animFrameId = win.requestAnimationFrame(animate);
		};
		const stopGlowAnimation = () => {
			if (animFrameId !== undefined) {
				win.cancelAnimationFrame(animFrameId);
				animFrameId = undefined;
			}
			glowController.clear();
		};
		this._register(
			autorun((reader) => {
				const connected = this.voiceSessionController.isConnected.read(reader);
				const voiceState = this.voiceSessionController.voiceState.read(reader);
				// Only run the per-frame glow loop for states that actually render a
				// glow. Idle renders none, so keeping the loop alive then would burn a
				// requestAnimationFrame callback every frame for nothing. React to
				// simulated states too, so the walkthrough commands light up the glow.
				// A muted mic isn't heard, so the listening rim would misleadingly react
				// to the user's voice; treat muted-listening as idle (no glow). The mute
				// observable is only read in the listening state.
				const sim = this.voiceInputModeService.simulatedVoiceState.read(reader);
				const simGlow = sim === "listening" || sim === "speaking";
				const liveGlow =
					connected &&
					isGlowingVoiceState(voiceState) &&
					!(
						voiceState === "listening" &&
						this.voiceSessionController.isMuted.read(reader)
					);
				if (simGlow || liveGlow) {
					startGlowAnimation();
				} else {
					stopGlowAnimation();
				}
			}),
		);
		this._register({ dispose: () => stopGlowAnimation() });

		// Voice transcript is per-session. The transcript is "owned" by the
		// session the user is dictating into (the explicit target session, or the
		// focused session when dictation began) and is only shown in that
		// session's view. Switching focus to a different session hides the
		// transcript here; switching to another existing session stops
		// transcription so it isn't misrouted there. Anything already dictated is
		// submitted to the original session; an idle hands-free turn may instead
		// follow an untitled "New Chat" session before any dictation starts.
		let listeningSession: URI | undefined;
		let ownerSession: URI | undefined;
		this._register(
			autorun((reader) => {
				// Dev/preview: when a walkthrough is simulating, drive the overlay hint from the
				// simulated state + version so each design shows its own instruction.
				const simState =
					this.voiceInputModeService.simulatedVoiceState.read(reader);
				const simVersion =
					this.voiceInputModeService.simulatedVersion.read(reader);
				if (simState !== undefined) {
					if (simState === "idle" && simVersion) {
						transcriptOverlayNode.style.display = "";
						transcriptOverlayNode.classList.remove("has-transcript");
						transcriptOverlay.replaceChildren();
						const hint = $("span.partial");
						switch (simVersion) {
							case "handsFree":
								hint.textContent = localize(
									"voiceMode.simHint.handsFree",
									"Hands-free \u2014 just start talking",
								);
								break;
							case "keyboardHold": {
								const kbLabel = this.keybindingService
									.lookupKeybinding(
										"workbench.action.chat.voiceInputMode.holdToTalk",
									)
									?.getLabel();
								hint.textContent = kbLabel
									? localize("voiceMode.pttHint", "Hold {0} to talk", kbLabel)
									: localize(
											"voiceMode.simHint.keyboardHold",
											"Hold Space to talk",
										);
								break;
							}
							case "buttonHold":
								hint.textContent = localize(
									"voiceMode.simHint.buttonHold",
									"Hold the button to talk, tap to turn off",
								);
								break;
							case "clickToggle":
								hint.textContent = localize(
									"voiceMode.simHint.clickToggle",
									"Tap the button to start listening",
								);
								break;
						}
						transcriptOverlay.append(hint);
						transcriptScrollable.scanDomNode();
					} else {
						transcriptOverlayNode.style.display = "none";
						transcriptOverlayNode.classList.remove("has-transcript");
					}
					return;
				}

				const turns = this.voiceSessionController.transcriptTurns.read(reader);
				const connected = this.voiceSessionController.isConnected.read(reader);
				const voiceState = this.voiceSessionController.voiceState.read(reader);
				const targetSession =
					this.voiceSessionController.targetSession.read(reader);
				const currentSession = this._currentSessionResource.read(reader);
				const showTranscript = showTranscriptSetting.read(reader);
				const showLiveTranscript = showLiveTranscriptSetting.read(reader);
				const hasInput = inputValue.read(reader).length > 0;
				const visible = turns.filter(
					(t) => t.text.length > 0 || (t.speaker === "user" && t.isPartial),
				);
				const showListeningPlaceholder =
					voiceState === "listening" &&
					(!showTranscript || !showLiveTranscript);

				if (!connected) {
					listeningSession = undefined;
					ownerSession = undefined;
					transcriptOverlayNode.style.display = "none";
					transcriptOverlayNode.classList.remove("has-transcript");
					return;
				}

				// Capture / maintain the session the current transcript belongs to.
				if (voiceState === "listening") {
					if (!listeningSession) {
						listeningSession = targetSession ?? currentSession;
						ownerSession = listeningSession;
					} else if (
						!targetSession &&
						currentSession &&
						!isEqual(currentSession, listeningSession)
					) {
						const dictationSession = listeningSession;
						const activelyDictating = turns.some(
							(t) =>
								t.speaker === "user" && t.isPartial && t.text.trim().length > 0,
						);
						if (activelyDictating) {
							// The user has already spoken — submit their words to the
							// session they were dictating into rather than losing them
							// or misrouting to the newly focused session.
							this.voiceSessionController.finishListeningAndSubmitTo(
								dictationSession,
							);
							listeningSession = undefined;
						} else if (isUntitledChatSession(currentSession)) {
							// Idle hands-free listen following into a fresh New Chat.
							listeningSession = currentSession;
							ownerSession = currentSession;
						} else {
							// Idle listen and the user switched to another existing
							// session before saying anything — nothing to submit.
							this.voiceSessionController.discardListening();
							listeningSession = undefined;
						}
					}
				} else {
					// Allow the next dictation to re-capture the owning session.
					listeningSession = undefined;
				}

				// Don't show a transcript that belongs to a different session here, or
				// on a pane that isn't the single input voice is bound to (focus-aware,
				// so a chat editor open alongside this pane doesn't also show it).
				const boundResource = this._currentVoiceInputResource(reader);
				if (
					boundResource &&
					currentSession &&
					!isEqual(boundResource, currentSession)
				) {
					transcriptOverlayNode.style.display = "none";
					transcriptOverlayNode.classList.remove("has-transcript");
					return;
				}
				const effectiveOwner = targetSession ?? ownerSession;
				if (
					effectiveOwner &&
					currentSession &&
					!isEqual(effectiveOwner, currentSession)
				) {
					transcriptOverlayNode.style.display = "none";
					transcriptOverlayNode.classList.remove("has-transcript");
					return;
				}

				// Show hint when connected but no transcript yet
				if (
					visible.length === 0 ||
					!showTranscript ||
					showListeningPlaceholder
				) {
					if (hasInput) {
						transcriptOverlayNode.style.display = "none";
						transcriptOverlayNode.classList.remove("has-transcript");
						return;
					}
					const handsFree =
						this.configurationService.getValue<boolean>(
							"agents.voice.handsFree",
						) === true;
					if (showListeningPlaceholder) {
						transcriptOverlayNode.style.display = "";
						transcriptOverlayNode.classList.remove("has-transcript");
						transcriptOverlay.replaceChildren();
						const listening = $("span.listening");
						listening.textContent = this.voiceSessionController.isMuted.read(
							reader,
						)
							? localize("voiceMode.mutedUnmuteToSpeak", "Unmute to speak...")
							: localize("voiceMode.listening", "Listening...");
						transcriptOverlay.append(listening);
						transcriptScrollable.scanDomNode();
					} else if (!showTranscript && voiceState === "speaking") {
						// Transcript is disabled: hint that the user can interrupt playback.
						transcriptOverlayNode.style.display = "";
						transcriptOverlayNode.classList.remove("has-transcript");
						transcriptOverlay.replaceChildren();
						const hint = $("span.partial");
						const kb =
							this.keybindingService.lookupKeybinding(
								"workbench.action.chat.voiceInputMode.holdToTalk",
							) ??
							this.keybindingService.lookupKeybinding("agentsVoice.pushToTalk");
						const kbLabel = kb?.getLabel();
						hint.textContent = kbLabel
							? localize("voiceMode.bargeInHint", "Speak or use {0}", kbLabel)
							: localize("voiceMode.bargeInHintNoKb", "Speak to barge in");
						transcriptOverlay.append(hint);
						transcriptScrollable.scanDomNode();
					} else if (
						voiceState === "idle" &&
						visible.length === 0 &&
						showTranscript &&
						!handsFree
					) {
						transcriptOverlayNode.style.display = "";
						transcriptOverlayNode.classList.remove("has-transcript");
						transcriptOverlay.replaceChildren();
						const hint = $("span.partial");
						const kb = this.keybindingService.lookupKeybinding(
							"agentsVoice.pushToTalk",
						);
						const kbLabel = kb?.getLabel();
						hint.textContent = kbLabel
							? localize(
									"voiceMode.pttOrBargeInHint",
									"Press {0} to talk or barge in",
									kbLabel,
								)
							: localize(
									"voiceMode.clickMicOrBargeInHint",
									"Click voice mode to talk or barge in",
								);
						transcriptOverlay.append(hint);
						transcriptScrollable.scanDomNode();
					} else {
						transcriptOverlayNode.style.display = "none";
						transcriptOverlayNode.classList.remove("has-transcript");
					}
					return;
				}

				transcriptOverlayNode.style.display = "";
				transcriptOverlayNode.classList.add("has-transcript");
				// Show only the latest visible turn
				const lastTurn = visible[visible.length - 1];
				const contentElements: HTMLElement[] = [];
				if (lastTurn.speaker === "user") {
					const span = $("span");
					if (lastTurn.isPartial) {
						const committedPart = lastTurn.committed || "";
						const unsurePart = lastTurn.text.slice(committedPart.length);
						if (committedPart) {
							const c = $("span.committed");
							c.textContent = committedPart;
							span.append(c);
						}
						const u = $("span.partial");
						u.textContent = unsurePart + "\u2589";
						span.append(u);
					} else {
						span.className = "committed";
						span.textContent = lastTurn.text;
					}
					contentElements.push(span);
				} else {
					const div = $("div.assistant-text");
					div.textContent = lastTurn.text;
					contentElements.push(div);
				}
				transcriptOverlay.replaceChildren(...contentElements);
				transcriptScrollable.scanDomNode();
				transcriptScrollable.setScrollPosition({ scrollTop: 0 });
			}),
		);
	}

	//#endregion

	//#region Chat Control

	private _widget!: ChatWidget;
	get widget(): ChatWidget {
		return this._widget;
	}

	private titleControl: ChatViewTitleControl | undefined;

	private createChatControl(parent: HTMLElement): ChatWidget {
		const chatControlsContainer = append(parent, $(".chat-controls-container"));

		const locationBasedColors = this.getLocationBasedColors();

		const editorOverflowWidgetsDomNode = this.layoutService
			.getContainer(getWindow(chatControlsContainer))
			.appendChild($(".chat-editor-overflow.monaco-editor"));
		this._register(toDisposable(() => editorOverflowWidgetsDomNode.remove()));

		// Chat Title
		this.createChatTitleControl(chatControlsContainer);

		// Chat Widget
		const scopedInstantiationService = this._register(
			this.instantiationService.createChild(
				new ServiceCollection([
					IContextKeyService,
					this.scopedContextKeyService,
				]),
			),
		);
		this._widget = this._register(
			scopedInstantiationService.createInstance(
				ChatWidget,
				ChatAgentLocation.Chat,
				{ viewId: this.id },
				{
					autoScroll: (mode) => mode !== ChatModeKind.Ask,
					renderFollowups: true,
					supportsFileReferences: true,
					clear: () => this.clear(),
					enableFind: true,
					rendererOptions: {
						renderTextEditsAsSummary: (uri) => {
							return true;
						},
						referencesExpandedWhenEmptyResponse: false,
						progressMessageAtBottomOfResponse: (mode) =>
							mode !== ChatModeKind.Ask,
					},
					editorOverflowWidgetsDomNode,
					enableImplicitContext: true,
					enableWorkingSet: "explicit",
					supportsChangingModes: true,
					dndContainer: parent,
				},
				{
					listForeground: SIDE_BAR_FOREGROUND,
					listBackground: editorBackground,
					listShadow:
						locationBasedColors.listOverrideStyles.treeStickyScrollShadow,
					overlayBackground: locationBasedColors.overlayBackground,
					inputEditorBackground: editorBackground,
					resultEditorBackground: editorBackground,
				},
			),
		);
		this._widget.render(chatControlsContainer, parent);

		const updateWidgetVisibility = (reader?: IReader) =>
			this._widget.setVisible(
				this.isBodyVisible() &&
					!this.welcomeController?.isShowingWelcome.read(reader),
			);
		this._register(
			this.onDidChangeBodyVisibility(() => updateWidgetVisibility()),
		);
		this._register(autorun((reader) => updateWidgetVisibility(reader)));

		return this._widget;
	}

	private createChatTitleControl(parent: HTMLElement): void {
		this.titleControl = this._register(
			this.instantiationService.createInstance(
				ChatViewTitleControl,
				parent,
				{
					focusChat: () => this._widget.focusInput(),
				},
				undefined,
			),
		);

		this._register(
			this.titleControl.onDidChangeHeight(() => {
				this.relayout();
			}),
		);
	}

	//#endregion

	private registerControlsListeners(chatWidget: ChatWidget): void {
		// Track the active chat model
		this._register(
			chatWidget.onDidChangeViewModel(() => {
				const model = chatWidget.viewModel?.model;
				this.titleControl?.update(model);
				this._currentSessionResource.set(
					chatWidget.viewModel?.sessionResource,
					undefined,
				);
			}),
		);

		// When the currently displayed session is archived, start a new session
		this._register(
			this.agentSessionsService.model.onDidChangeSessionArchivedState((e) => {
				if (e.isArchived()) {
					const currentSessionResource = chatWidget.viewModel?.sessionResource;
					if (
						currentSessionResource &&
						isEqual(currentSessionResource, e.resource)
					) {
						this.clear();
					}
				}
			}),
		);

		// Show progress badge when the current session is in progress
		const progressBadgeDisposables = this._register(
			new MutableDisposable<DisposableStore>(),
		);
		const updateProgressBadge = () => {
			progressBadgeDisposables.value = new DisposableStore();

			if (
				!this.configurationService.getValue<boolean>(
					ChatConfiguration.ChatViewProgressBadgeEnabled,
				)
			) {
				this.activityBadge.clear();
				return;
			}

			const model = chatWidget.viewModel?.model;
			if (model) {
				progressBadgeDisposables.value.add(
					autorun((reader) => {
						if (model.requestInProgress.read(reader)) {
							this.activityBadge.value = this.activityService.showViewActivity(
								this.id,
								{
									badge: new ProgressBadge(() =>
										localize("sessionInProgress", "Agent Session in Progress"),
									),
								},
							);
						} else {
							this.activityBadge.clear();
						}
					}),
				);
			} else {
				this.activityBadge.clear();
			}
		};
		this._register(
			chatWidget.onDidChangeViewModel(() => updateProgressBadge()),
		);
		this._register(
			Event.filter(this.configurationService.onDidChangeConfiguration, (e) =>
				e.affectsConfiguration(ChatConfiguration.ChatViewProgressBadgeEnabled),
			)(() => updateProgressBadge()),
		);
		updateProgressBadge();
	}

	private setupContextMenu(parent: HTMLElement): void {
		this._register(
			addDisposableListener(parent, EventType.CONTEXT_MENU, (e) => {
				EventHelper.stop(e, true);

				this.contextMenuService.showContextMenu({
					menuId: MenuId.ChatWelcomeContext,
					contextKeyService: this.contextKeyService,
					getAnchor: () => new StandardMouseEvent(getWindow(parent), e),
				});
			}),
		);
	}

	//#region Model Management

	private applyModel(): void {
		// Make the initial session resolution cancelable so an explicit request
		// (e.g. New Local Chat via `startNewLocalSession`) can preempt a slow /
		// blocking default-provider resolution instead of waiting for it.
		// Cancel any previous in-flight resolution first: assigning to the
		// MutableDisposable only disposes the old source, and disposing a
		// CancellationTokenSource does not cancel it.
		this._applyModelCts.value?.cancel();
		const cts = (this._applyModelCts.value = new CancellationTokenSource());
		this.restoringSession = this._applyModel(cts.token).catch((err) => {
			if (!isCancellationError(err)) {
				this.logService.error("ChatViewPane#applyModel failed", err);
			}
		});
		this.restoringSession.finally(() => (this.restoringSession = undefined));
	}

	private async _applyModel(token: CancellationToken): Promise<void> {
		const session = await this.acquireTransferredOrPersistedSession(
			token,
			"ChatViewPane#applyModel",
		);
		await this.showModel(
			token,
			session.modelRef,
			true,
			!session.modelRef,
			undefined,
			session.localFallbackSelectionReason,
		);
	}

	/**
	 * Force-start a new local chat session in the view, bypassing the
	 * default-provider override applied by `showModel()`. Used by the
	 * picker when the user explicitly selects "Local", and by New Local Chat.
	 */
	async startNewLocalSession(
		sessionTypeSelectionReason: SessionTypeSelectionReason = "explicitOverride",
	): Promise<IChatModel | undefined> {
		const result = this.newSessionQueue.then(() =>
			this.doStartNewLocalSession(sessionTypeSelectionReason),
		);
		this.newSessionQueue = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	}

	/**
	 * Opens another chat session as a tab, even when an untitled session is
	 * already open. Used by the Chat header `+` action.
	 */
	async openNewChatTab(
		sessionTypeSelectionReason: SessionTypeSelectionReason = "explicitOverride",
	): Promise<IChatModel | undefined> {
		return this.startNewLocalSession(sessionTypeSelectionReason);
	}

	private async doStartNewLocalSession(
		sessionTypeSelectionReason: SessionTypeSelectionReason,
	): Promise<IChatModel | undefined> {
		// Preempt any in-flight initial session resolution (e.g. the computed
		// default provider). Without this, opening the view kicks off a default
		// resolution that, when the default is a non-local harness, blocks on
		// agent host activation; canceling it lets this explicit local request
		// win immediately.
		this._applyModelCts.value?.cancel();
		this.loadSessionCts.value?.cancel();
		const ref = this.chatService.startNewLocalSession(ChatAgentLocation.Chat, {
			debugOwner: "ChatViewPane#startNewLocalSession",
			sessionTypeSelectionReason,
		});
		return this.showModel(CancellationToken.None, ref);
	}

	/**
	 * When the remembered or computed default session type is a non-local
	 * provider (for example when the agent host is enabled), return a new session
	 * reference for it instead of the built-in local provider.
	 */
	private async acquireDefaultNewSession(
		token: CancellationToken,
		localFallbackSelectionReason?: SessionTypeSelectionReason,
	): Promise<IChatSessionAcquisitionResult> {
		const workspace = this.workspaceContextService.getWorkspace();
		const defaultTypeAndReason =
			getDefaultNewChatSessionTypeAndReasonFromServices(
				this.configurationService,
				this.chatSessionsService,
				this.storageService,
				workspace,
				this.agentHostEnablementService.enabled.get(),
				undefined,
				this.agentHostEnablementService.managedSandboxEnforced.get(),
			);
		if (defaultTypeAndReason.sessionType === localChatSessionType) {
			return {
				modelRef: this.chatService.startNewLocalSession(
					ChatAgentLocation.Chat,
					{
						debugOwner: "ChatViewPane#acquireDefaultNewSession",
						sessionTypeSelectionReason:
							localFallbackSelectionReason ??
							defaultTypeAndReason.selectionReason,
					},
				),
			};
		}
		const resource = getNewChatSessionResource(
			defaultTypeAndReason.sessionType,
		);
		try {
			const modelRef = await this.chatService.acquireOrLoadSession(
				resource,
				ChatAgentLocation.Chat,
				token,
				"ChatViewPane#acquireDefaultNewSession",
				defaultTypeAndReason.selectionReason,
			);
			return {
				modelRef,
				localFallbackSelectionReason:
					getLocalFallbackSessionTypeSelectionReason(
						defaultTypeAndReason.sessionType,
						!!modelRef,
						localFallbackSelectionReason,
					),
			};
		} catch (error) {
			// A cancellation means the caller (e.g. `startNewLocalSession`)
			// deliberately preempted this resolution; propagate it so the
			// initial `applyModel` bails instead of creating a fallback session.
			if (isCancellationError(error)) {
				throw error;
			}
			this.logService.warn(
				`[ChatViewPane] Failed to acquire default agent-host session, falling back to local`,
				error,
			);
			return {
				modelRef: undefined,
				localFallbackSelectionReason:
					getLocalFallbackSessionTypeSelectionReason(
						defaultTypeAndReason.sessionType,
						false,
						localFallbackSelectionReason,
					),
			};
		}
	}

	private async acquireTransferredOrPersistedSession(
		token: CancellationToken,
		debugOwner: string,
	): Promise<IChatSessionAcquisitionResult> {
		const sessionResource = this.getTransferredOrPersistedSessionInfo();
		if (!sessionResource) {
			return { modelRef: undefined };
		}

		const modelRef = await this.chatService.acquireOrLoadSession(
			sessionResource,
			ChatAgentLocation.Chat,
			token,
			debugOwner,
		);
		if (!modelRef) {
			return {
				modelRef: undefined,
				localFallbackSelectionReason:
					getLocalFallbackSessionTypeSelectionReason(
						getChatSessionType(sessionResource),
						false,
					),
			};
		}

		if (this.shouldSkipRestoredLocalSession(sessionResource, modelRef.object)) {
			modelRef.dispose();
			return { modelRef: undefined };
		}

		return { modelRef };
	}

	private shouldSkipRestoredLocalSession(
		sessionResource: URI,
		model: IChatModel,
	): boolean {
		const workspace = this.workspaceContextService.getWorkspace();
		const defaultType = getDefaultNewChatSessionType(
			this.configurationService,
			this.chatSessionsService,
			this.storageService,
			workspace,
			this.agentHostEnablementService.enabled.get(),
			undefined,
			this.agentHostEnablementService.managedSandboxEnforced.get(),
		);
		return (
			defaultType !== localChatSessionType &&
			getChatSessionType(sessionResource) === localChatSessionType &&
			!model.hasRequests
		);
	}

	private async showModel(
		token: CancellationToken,
		modelRef?: IChatModelReference | undefined,
		startNewSession = true,
		ignoreTransferredSession = false,
		inputBeforeLoad?: string,
		localFallbackSelectionReason?: SessionTypeSelectionReason,
	): Promise<IChatModel | undefined> {
		const oldModelResource = this._widget.viewModel?.sessionResource;
		if (oldModelResource) {
			this.widgetViewStates.set(
				getComparisonKey(oldModelResource),
				this._widget.getViewState(),
			);
			if (!this.closingTabKeys.has(oldModelResource.toString())) {
				this.ensureSessionTab(oldModelResource);
			}
		}
		this.modelRef.value = undefined;

		// Baseline draft for preserving text typed during loading. `loadSession`
		// opens its load window before calling us, so it passes its own baseline;
		// otherwise this call's own await is the load window. See #325323.
		const baselineInput = inputBeforeLoad ?? this._widget?.getInput() ?? "";

		let ref: IChatModelReference | undefined;
		if (startNewSession) {
			if (modelRef) {
				ref = modelRef;
			} else if (
				!ignoreTransferredSession &&
				this.chatService.transferredSessionResource
			) {
				ref = await this.chatService.acquireOrLoadSession(
					this.chatService.transferredSessionResource,
					ChatAgentLocation.Chat,
					token,
					"ChatViewPane#showModel",
				);
			} else {
				const defaultSession = await this.acquireDefaultNewSession(
					token,
					localFallbackSelectionReason,
				);
				ref =
					defaultSession.modelRef ??
					this.chatService.startNewLocalSession(ChatAgentLocation.Chat, {
						debugOwner: "ChatViewPane#showModel",
						sessionTypeSelectionReason:
							defaultSession.localFallbackSelectionReason,
					});
			}
			if (!ref) {
				throw new Error("Could not start chat session");
			}
		}

		if (token.isCancellationRequested) {
			ref?.dispose();
			return undefined;
		}

		this.modelRef.value = ref;
		const model = ref?.object;

		if (model) {
			await this.updateWidgetLockState(
				getChatSessionType(model.sessionResource),
			); // Update widget lock state based on session type

			if (token.isCancellationRequested) {
				this.modelRef.value = undefined;
				return undefined;
			}

			// remember as model to restore in view state
			this.viewState.sessionResource = model.sessionResource;
		}

		if (model) {
			setModelPreservingInputTypedWhileLoading(
				this._widget,
				baselineInput,
				() => this._widget.setModel(model),
			);
			const widgetViewState = this.widgetViewStates.get(
				getComparisonKey(model.sessionResource),
			);
			if (widgetViewState) {
				this._widget.restoreViewState(widgetViewState);
			}
		} else {
			this._widget.setModel(model);
		}

		// Update title control
		this.titleControl?.update(model);
		if (model) {
			this.ensureSessionTab(model.sessionResource);
		} else {
			this.renderSessionTabs();
		}

		// Update the toolbar context with new sessionId
		this.updateActions();

		// Mark the old model as read when closing unless explicitly marked unread.
		// Deferred because setRead fires _onDidChangeSessions which synchronously
		// re-renders the sessions list (~250ms), and that doesn't need to block
		// the new chat from displaying.
		if (oldModelResource) {
			const capturedOldResource = oldModelResource;
			this._register(
				disposableTimeout(() => {
					const oldSession =
						this.agentSessionsService.model.getSession(capturedOldResource);
					if (oldSession && !oldSession.isMarkedUnread()) {
						oldSession.setRead(true);
					}
				}, 0),
			);
		}

		return model;
	}

	private ensureSessionTab(resource: URI): void {
		if (
			!this.openTabResources.some((existing) => isEqual(existing, resource))
		) {
			this.openTabResources.push(resource);
		}

		const key = resource.toString();
		if (!this.tabKeepAlive.has(key)) {
			const extra = this.chatService.acquireExistingSession(
				resource,
				"ChatViewPane#tab",
			);
			if (extra) {
				this.tabKeepAlive.set(key, extra);
				this.tabListeners.set(
					key,
					extra.object.onDidChange(() => this.renderSessionTabs()),
				);
			}
		}

		this.renderSessionTabs();
	}

	private replaceSessionTab(from: URI, to: URI): void {
		const index = this.openTabResources.findIndex((resource) =>
			isEqual(resource, from),
		);
		if (index >= 0) {
			this.openTabResources[index] = to;
		}
		this.tabKeepAlive.deleteAndDispose(from.toString());
		this.tabListeners.deleteAndDispose(from.toString());
		this.ensureSessionTab(to);
	}

	private async closeSessionTab(resource: URI): Promise<void> {
		const key = resource.toString();
		const wasActive = isEqual(
			this._widget?.viewModel?.sessionResource,
			resource,
		);
		const remaining = this.openTabResources.filter(
			(existing) => !isEqual(existing, resource),
		);
		this.openTabResources = remaining;
		this.closingTabKeys.add(key);
		this.tabKeepAlive.deleteAndDispose(key);
		this.tabListeners.deleteAndDispose(key);

		try {
			if (wasActive) {
				const next = remaining.at(-1);
				if (next) {
					await this.loadSession(next);
				} else {
					await this.startNewLocalSession();
				}
			} else {
				this.renderSessionTabs();
			}
		} finally {
			this.closingTabKeys.delete(key);
		}
	}

	private attachSessionTabs(): void {
		if (!this.element?.isConnected) {
			return;
		}

		const part = this.element.closest(".pane-composite-part");
		const title = part?.querySelector(
			":scope > .composite.title, :scope > .title",
		);
		const titleLabel = title?.querySelector(":scope > .title-label");
		if (
			!(title instanceof HTMLElement) ||
			!(titleLabel instanceof HTMLElement)
		) {
			return;
		}

		if (this.sessionTabsTitle && this.sessionTabsTitle !== title) {
			this.detachSessionTabs();
		}

		title.classList.add("thea-chat-session-tabs");
		this.sessionTabsTitle = title;

		const heading = titleLabel.querySelector("h2");
		if (heading instanceof HTMLElement) {
			hide(heading);
			this.sessionTabsHiddenHeading = heading;
		}

		if (!this.sessionTabsHost) {
			this.sessionTabsHost = $(".thea-chat-tabs-host");
			this.sessionTabsControl = this._register(
				new ChatSessionTabsControl(this.sessionTabsHost, {
					onSelect: (resource) => {
						if (!isEqual(resource, this._widget?.viewModel?.sessionResource)) {
							void this.loadSession(resource);
						}
					},
					onClose: (resource) => void this.closeSessionTab(resource),
				}),
			);
		}

		if (this.sessionTabsHost.parentElement !== titleLabel) {
			titleLabel.appendChild(this.sessionTabsHost);
		}

		this.renderSessionTabs();
	}

	private detachSessionTabs(): void {
		this.sessionTabsTitle?.classList.remove("thea-chat-session-tabs");
		if (this.sessionTabsHiddenHeading) {
			show(this.sessionTabsHiddenHeading);
			this.sessionTabsHiddenHeading = undefined;
		}
		this.sessionTabsHost?.remove();
		this.sessionTabsTitle = undefined;
	}

	private renderSessionTabs(): void {
		if (!this.sessionTabsControl) {
			return;
		}

		const active = this._widget?.viewModel?.sessionResource;
		this.sessionTabsControl.setTabs(
			this.openTabResources.map((resource) => {
				const model =
					this.tabKeepAlive.get(resource.toString())?.object ??
					(active && isEqual(resource, active)
						? this.modelRef.value?.object
						: undefined);
				return {
					resource,
					title: getChatSessionTabTitle(model?.title),
					active: !!active && isEqual(resource, active),
				};
			}),
		);
	}

	private async updateWidgetLockState(sessionType: string): Promise<void> {
		if (sessionType === localChatSessionType) {
			this._widget.unlockFromCodingAgent();
			return;
		}

		let canResolve = false;
		try {
			canResolve =
				await this.chatSessionsService.canResolveChatSession(sessionType);
		} catch (error) {
			this.logService.warn(
				`Failed to resolve chat session type '${sessionType}' for locking`,
				error,
			);
		}

		if (!canResolve) {
			this._widget.unlockFromCodingAgent();
			return;
		}

		const contribution =
			this.chatSessionsService.getChatSessionContribution(sessionType);
		if (contribution) {
			this._widget.lockToCodingAgent(
				contribution.name,
				contribution.displayName,
				sessionType,
				contribution.agentHostProviderId,
			);
		} else {
			this._widget.unlockFromCodingAgent();
		}
	}

	private async clear(): Promise<void> {
		// Cancel any in-flight loadSession call to prevent it from
		// overwriting the fresh session we are about to create.
		this.loadSessionCts.value?.cancel();

		// Grab the widget's latest view state because it will be loaded back into the widget
		this.updateViewState();
		await this.showModel(CancellationToken.None);

		// Update the toolbar context with new sessionId
		this.updateActions();
	}

	async loadSession(
		sessionResource: URI,
		sessionTypeSelectionReason?: SessionTypeSelectionReason,
	): Promise<IChatModel | undefined> {
		const t0 = Date.now();
		this.logService.trace(
			`[ChatViewPane] loadSession start uri=${sessionResource.toString()}`,
		);

		// Capture the input draft up front: the load window (clear + acquire below)
		// opens before `showModel` binds, so text typed during loading must be
		// baselined here to be preserved rather than erased. See #325323.
		const inputBeforeLoad = this._widget?.getInput() ?? "";

		// Cancel any in-flight loadSession call so the last one always wins
		this.loadSessionCts.value?.cancel();
		const cts = (this.loadSessionCts.value = new CancellationTokenSource());
		const token = cts.token;

		// Wait for any in-progress session restore (e.g. from onDidChangeAgents)
		// to finish first, so our showModel call is guaranteed to be the last one.
		if (this.restoringSession) {
			await this.restoringSession;
		}

		if (token.isCancellationRequested) {
			this.logService.trace(
				`[ChatViewPane] loadSession done total=${Date.now() - t0}ms uri=${sessionResource.toString()} cancelled=true phase=preAcquire`,
			);
			return undefined;
		}

		return this.progressService.withProgress(
			{ location: ChatViewId, delay: 200 },
			async () => {
				let queue: Promise<void> = Promise.resolve();
				let didAcquireSession = false;

				// A delay here to avoid blinking because only Cloud sessions are slow, most others are fast
				const clearWidget = disposableTimeout(() => {
					// Only clear the current model if this loadSession call is still the active one
					// and has not been cancelled. This preserves the "last call wins" behavior.
					if (
						token.isCancellationRequested ||
						this.loadSessionCts.value !== cts
					) {
						return;
					}
					// clear current model without starting a new one
					queue = this.showModel(token, undefined, false).then(() => {});
				}, 100);
				const clearWidgetCancellationListener = token.onCancellationRequested(
					() => clearWidget.dispose(),
				);

				try {
					const newModelRef = await this.chatService.acquireOrLoadSession(
						sessionResource,
						ChatAgentLocation.Chat,
						token,
						"ChatViewPane#loadSession",
						sessionTypeSelectionReason,
					);
					didAcquireSession = !!newModelRef;
					clearWidget.dispose();
					await queue;

					if (token.isCancellationRequested) {
						newModelRef?.dispose();
						this.logService.trace(
							`[ChatViewPane] loadSession done total=${Date.now() - t0}ms uri=${sessionResource.toString()} cancelled=true phase=postAcquire`,
						);
						return undefined;
					}

					const localFallbackSelectionReason =
						getLocalFallbackSessionTypeSelectionReason(
							getChatSessionType(sessionResource),
							!!newModelRef,
						);
					const result = await this.showModel(
						token,
						newModelRef,
						true,
						false,
						inputBeforeLoad,
						localFallbackSelectionReason,
					);
					this.logService.trace(
						`[ChatViewPane] loadSession done total=${Date.now() - t0}ms uri=${sessionResource.toString()}`,
					);
					return result;
				} catch (err) {
					clearWidget.dispose();
					await queue;

					if (token.isCancellationRequested) {
						this.logService.trace(
							`[ChatViewPane] loadSession done total=${Date.now() - t0}ms uri=${sessionResource.toString()} cancelled=true phase=error`,
						);
						return undefined;
					}

					// Recover by starting a fresh empty session so the widget
					// is not left in a broken state without title or back button.
					this.logService.error(
						`Failed to load chat session '${sessionResource.toString()}'`,
						err,
					);
					this.notificationService.error(
						localize(
							"chat.loadSessionFailed",
							"Failed to open chat session: {0}",
							toErrorMessage(err),
						),
					);
					const localFallbackSelectionReason =
						getLocalFallbackSessionTypeSelectionReason(
							getChatSessionType(sessionResource),
							didAcquireSession,
						);
					const result = await this.showModel(
						token,
						undefined,
						true,
						false,
						inputBeforeLoad,
						localFallbackSelectionReason,
					);
					this.logService.trace(
						`[ChatViewPane] loadSession done total=${Date.now() - t0}ms uri=${sessionResource.toString()} error=true`,
					);
					return result;
				} finally {
					clearWidgetCancellationListener.dispose();
				}
			},
		);
	}

	//#endregion

	override focus(): void {
		super.focus();

		this.focusInput();
	}

	focusInput(): void {
		this._widget.focusInput();
	}

	//#region Layout

	private layoutingBody = false;

	private relayout(): void {
		if (!this._widget?.visible) {
			return;
		}

		if (this.lastDimensions) {
			this.layoutBody(this.lastDimensions.height, this.lastDimensions.width);
		}
	}

	protected override layoutBody(height: number, width: number): void {
		if (this.layoutingBody) {
			return; // prevent re-entrancy
		}

		this.layoutingBody = true;
		try {
			this.doLayoutBody(height, width);
		} finally {
			this.layoutingBody = false;
		}
	}

	private doLayoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		this.attachSessionTabs();

		this.lastDimensions = { height, width };
		this.layoutChatAndSessions(height, width);
	}

	private layoutChatAndSessions(height: number, width: number): void {
		let remainingHeight = height;

		const titleHeight = this.titleControl?.getHeight() ?? 0;
		remainingHeight -= titleHeight;

		this._widget.layout(remainingHeight, width);
	}

	//#endregion

	override saveState(): void {
		// Don't do saveState when no widget, or no viewModel in which case
		// the state has not yet been restored - in that case the default
		// state would overwrite the real state
		if (this._widget?.viewModel) {
			this._widget.saveState();

			this.updateViewState();
			this.memento.saveMemento();
		}

		super.saveState();
	}

	private updateViewState(viewState?: IChatModelInputState): void {
		const newViewState = viewState ?? this._widget.getInputState();
		if (newViewState) {
			for (const [key, value] of Object.entries(newViewState)) {
				(this.viewState as Record<string, unknown>)[key] = value; // Assign all props to the memento so they get saved
			}
		}
	}

	override shouldShowWelcome(): boolean {
		const noPersistedSessions = !this.chatService.hasSessions();
		const hasCoreAgent = this.chatAgentService
			.getAgents()
			.some(
				(agent) =>
					agent.isCore && agent.locations.includes(ChatAgentLocation.Chat),
			);
		const hasDefaultAgent =
			this.chatAgentService.getDefaultAgent(ChatAgentLocation.Chat) !==
			undefined; // only false when Hide AI Features has run and unregistered the setup agents
		const shouldShow =
			!hasCoreAgent &&
			(!hasDefaultAgent || (!this._widget?.viewModel && noPersistedSessions));

		this.logService.trace(
			`ChatViewPane#shouldShowWelcome() = ${shouldShow}: hasCoreAgent=${hasCoreAgent} hasDefaultAgent=${hasDefaultAgent} || noViewModel=${!this._widget?.viewModel} && noPersistedSessions=${noPersistedSessions}`,
		);

		return !!shouldShow;
	}

	getMatchingWelcomeView(): IChatViewsWelcomeDescriptor | undefined {
		return this.welcomeController?.getMatchingWelcomeView();
	}

	override getActionsContext(): IChatViewTitleActionContext | undefined {
		return this._widget?.viewModel
			? {
					sessionResource: this._widget.viewModel.sessionResource,
					$mid: MarshalledId.ChatViewContext,
				}
			: undefined;
	}
}
