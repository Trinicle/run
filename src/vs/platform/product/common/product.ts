/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { env } from '../../../base/common/process.js';
import { IProductConfiguration } from '../../../base/common/product.js';
import { ISandboxConfiguration } from '../../../base/parts/sandbox/common/sandboxTypes.js';

interface IPackageConfiguration {
	readonly version: string;
	readonly dependencies?: Readonly<Record<string, string>>;
}

function getDependencyVersion(packageConfiguration: IPackageConfiguration, packageName: string): string | undefined {
	return packageConfiguration.dependencies?.[packageName]?.replace(/^[~^]/, '');
}

/**
 * @deprecated It is preferred that you use `IProductService` if you can. This
 * allows web embedders to override our defaults. But for things like `product.quality`,
 * the use is fine because that property is not overridable.
 */
let product: IProductConfiguration;

// Native sandbox environment
const vscodeGlobal = (globalThis as { vscode?: { context?: { configuration(): ISandboxConfiguration | undefined } } }).vscode;
if (typeof vscodeGlobal !== 'undefined' && typeof vscodeGlobal.context !== 'undefined') {
	const configuration: ISandboxConfiguration | undefined = vscodeGlobal.context.configuration();
	if (configuration) {
		product = configuration.product;
	} else {
		throw new Error('Sandbox: unable to resolve product configuration from preload script.');
	}
}
// _VSCODE environment
else if (globalThis._VSCODE_PRODUCT_JSON && globalThis._VSCODE_PACKAGE_JSON) {
	// Obtain values from product.json and package.json-data
	product = globalThis._VSCODE_PRODUCT_JSON as unknown as IProductConfiguration;
	const packageConfiguration = globalThis._VSCODE_PACKAGE_JSON as unknown as IPackageConfiguration;

	// Running out of sources
	if (env['VSCODE_DEV']) {
		Object.assign(product, {
			nameShort: `${product.nameShort} Dev`,
			nameLong: `${product.nameLong} Dev`,
			dataFolderName: `${product.dataFolderName}-dev`,
			serverDataFolderName: product.serverDataFolderName ? `${product.serverDataFolderName}-dev` : undefined
		});
	}

	// Version is added during built time, but we still
	// want to have it running out of sources so we
	// read it from package.json only when we need it.
	if (!product.version) {
		Object.assign(product, {
			version: packageConfiguration.version
		});
	}

	if (!product.copilotVersions) {
		const runtime = getDependencyVersion(packageConfiguration, '@github/copilot');
		const sdk = getDependencyVersion(packageConfiguration, '@github/copilot-sdk');
		if (runtime && sdk) {
			Object.assign(product, { copilotVersions: { runtime, sdk } });
		}
	}
}

// Web environment or unknown
else {

	// Built time configuration (do NOT modify)
	// eslint-disable-next-line local/code-no-dangerous-type-assertions
	product = { /*BUILD->INSERT_PRODUCT_CONFIGURATION*/ } as unknown as IProductConfiguration;

	// Running out of sources
	if (Object.keys(product).length === 0) {
		Object.assign(product, {
			version: '1.104.0-dev',
			nameShort: 'Thea Dev',
			nameLong: 'Thea Dev',
			applicationName: 'thea',
			dataFolderName: '.thea',
			urlProtocol: 'thea',
			reportIssueUrl: '',
			licenseName: 'MIT',
			licenseUrl: 'https://opensource.org/licenses/MIT',
			serverLicenseUrl: 'https://opensource.org/licenses/MIT',
			defaultChatAgent: {
				extensionId: 'GitHub.copilot',
				chatExtensionId: 'GitHub.copilot-chat',
				chatExtensionOutputId: 'GitHub.copilot-chat.GitHub Copilot Chat.log',
				chatExtensionOutputExtensionStateCommand: 'github.copilot.chat.state',
				documentationUrl: '',
				termsStatementUrl: '',
				privacyStatementUrl: '',
				skusDocumentationUrl: '',
				optimizeUsageDocumentationUrl: '',
				publicCodeMatchesUrl: '',
				managePlanUrl: '',
				upgradePlanUrl: '',
				signUpUrl: '',
				provider: {
					default: { id: 'thea', name: 'Thea' },
					enterprise: { id: 'github-enterprise', name: 'GHE.com' },
					google: { id: 'google', name: 'Google' },
					apple: { id: 'apple', name: 'Apple' },
					microsoft: { id: 'microsoft', name: 'Microsoft' }
				},
				providerExtensionId: 'vscode.github-authentication',
				providerUriSetting: 'github-enterprise.uri',
				providerScopes: [['user:email'], ['read:user'], ['read:user', 'user:email', 'repo', 'workflow']],
				entitlementUrl: '',
				entitlementSignupLimitedUrl: '',
				tokenEntitlementUrl: '',
				mcpRegistryDataUrl: '',
				managedSettingsUrl: '',
				chatQuotaExceededContext: 'github.copilot.chat.quotaExceeded',
				completionsQuotaExceededContext: 'github.copilot.completions.quotaExceeded',
				walkthroughCommand: 'github.copilot.open.walkthrough',
				completionsMenuCommand: 'github.copilot.toggleStatusMenu',
				chatRefreshTokenCommand: 'github.copilot.refreshToken',
				generateCommitMessageCommand: 'github.copilot.git.generateCommitMessage',
				resolveMergeConflictsCommand: 'github.copilot.git.resolveMergeConflicts',
				completionsAdvancedSetting: 'github.copilot.advanced',
				completionsEnablementSetting: 'github.copilot.enable',
				nextEditSuggestionsSetting: 'github.copilot.nextEditSuggestions.enabled'
			}
		});
	}
}

export default product;
