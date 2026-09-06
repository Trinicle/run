import * as vscode from 'vscode';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	context.subscriptions.push(
		vscode.commands.registerCommand('thea.welcome.open', () =>
			vscode.commands.executeCommand(
				'workbench.action.openWalkthrough',
				'thea.thea-product#thea.welcome',
			),
		),
	);
}

export function deactivate(): void { }
