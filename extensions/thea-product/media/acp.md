# Configure ACP agents

Thea's Agent Host harness supports subprocess agents over the Agent Client Protocol (ACP). ACP agents share the same IDE tools (edit file, terminal, etc.) as BYOK chat sessions.

## Setup

1. Open **Settings** and edit **chat.agentHost.acpAgents**.
2. Add agent definitions for Claude, Codex, Copilot CLI, or other ACP-compatible agents.
3. Select an ACP agent from the Agent Host session picker in sidebar chat or the Agents window.

Built-in agents may require their own credentials (for example Anthropic API key for Claude). GitHub sign-in is optional when the agent supports local authentication.
