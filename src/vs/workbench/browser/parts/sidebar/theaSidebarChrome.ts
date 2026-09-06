/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const SIDEBAR_EXPANDED_MIN_WIDTH = 170;
export const SIDEBAR_COMPACT_CONTENT_WIDTH = 0;
export const ACTIVITY_BAR_DEFAULT_WIDTH = 48;
export const SIDEBAR_LAST_EXPANDED_SIZE_DEFAULT = 300;

export function sidebarHeaderWidth(options: { compact: boolean; sidebarWidth?: number; activityBarWidth?: number }): number {
	const activityBarWidth = options.activityBarWidth ?? ACTIVITY_BAR_DEFAULT_WIDTH;
	if (options.compact) {
		return activityBarWidth;
	}
	return activityBarWidth + (options.sidebarWidth ?? 0);
}
