import * as vscode from 'vscode';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	context.subscriptions.push(
		vscode.commands.registerCommand('run.welcome.open', () =>
			vscode.commands.executeCommand(
				'workbench.action.openWalkthrough',
				'run.run-product#run.welcome',
			),
		),
	);
}

export function deactivate(): void { }
