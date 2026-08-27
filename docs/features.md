# Features

Hibro reads and operates the current page from a browser side panel. This page describes the behavior users can see. Maintainer notes stay with the source.

## Chat about a page

Open Hibro from the browser toolbar and ask a question in the side panel. Hibro sends the page title, URL, and a small page overview with each request. It reads more of the page only when the task needs it.

Answers stream into the conversation as they arrive. Hibro follows the language used by you and the page. While the model is working, the panel shows a short status or the latest reasoning lines above the input. Reasoning appears only in the temporary readout, not in the answer bubble.

Hibro notices when a conversation moves to a different URL and asks the model to read the new page again. A page that changes without changing its URL may need a clear follow-up such as "read this page again."

## Automate a page

You can ask Hibro to:

- Click links, buttons, and other controls.
- Type into fields and press common keys.
- Scroll the page or bring an element into view.
- Open another URL.
- Read visible text or the main page content.

Each action appears in a collapsible tool card, including failures. The model can use several tools in one request and then report what it did.

Use Stop to interrupt a running request. Starting another chat or switching conversations also stops the current request so its output cannot appear in the wrong thread.

Hibro limits the number of tool steps in one request. If a longer task reaches the limit, the answer says that the task may be incomplete. Send a follow-up to continue.

Page questions and page actions both require a model that supports function calling.

## Conversations and input

Hibro keeps the 10 most recent conversations in extension storage and restores the active one when the panel reopens.

- Use the plus button in the top right to start a new chat.
- Open History from the top left to switch, rename, or delete a conversation.
- An empty new chat is not added to History until you send its first message.
- Deleting the active conversation opens the most recent remaining one.

The input remembers sent messages across saved conversations. Press ArrowUp from an empty input, or from the start of the current text, to recall older messages. ArrowDown moves forward and restores the draft after the newest entry.

Drag the handle above the input to make it taller, up to 400 pixels. The handle also supports ArrowUp, ArrowDown, Home, and End from the keyboard.

User messages taller than 400 pixels start collapsed. Use Show more and Show less to expand or collapse them. Wide code and tool output scroll inside their own blocks instead of widening the whole panel.

## Answers and message actions

Assistant answers support regular Markdown, CJK text, and math. Fenced blocks can also render:

- Mermaid diagrams.
- JSON-based charts using bar, line, pie, or scatter series.
- HTML with a Code and Preview switch.

HTML previews are static. Scripts, forms, popups, and network requests are blocked inside the preview. Code is always available as the default view.

Images in model-generated Markdown are not loaded. Chart blocks also reject remote image addresses. This prevents an answer from making an unexpected request to another website.

Long code blocks show up to 25 lines before scrolling. Invalid chart or HTML content falls back to readable code instead of breaking the conversation.

Click a finished message to copy the whole message. Select text inside a message to copy only the selection or ask Hibro to explain it. Explain sends the selected text to the active AI provider as a separate request.

## Providers and Settings

Open Settings from the gear at the lower left of the panel. You can save more than one named provider profile and choose which one Hibro uses.

Provider profiles are encrypted before Hibro saves them in the browser. When you upgrade from an older release, Hibro encrypts existing plaintext profiles automatically. A previously saved single provider also becomes an active profile, so you do not need to enter its credentials again.

Supported provider types are:

- OpenAI-compatible, for services that use the Chat Completions format.
- OpenAI.
- Anthropic.

OpenAI and Anthropic can use their standard endpoints without a custom base URL. OpenAI-compatible profiles require a base URL.

Switching the active provider in Settings updates the side panel. You can also switch providers from the picker beside the chat input. The next request uses the new provider.

Settings and the side panel support English and Simplified Chinese. Choose the language under the General tab in Settings. Open extension pages update at once and remember the choice.

Conversation titles, messages, provider names, skill content, and tool output keep their original text.

## Site skills

A skill gives the assistant instructions for a website. Hibro includes read-only skills for supported sites, and you can enable or disable them in Settings. You can also create your own skills.

Enabled skills activate when their URL pattern matches the current page. Their instructions are included with the request to your selected provider. A skill does not run code by itself.

See the [skill format guide](../skills/README.md) to write a built-in skill.

## Restricted pages

If a regular page does not have Hibro's current page reader, Hibro loads it and retries without refreshing the page. This can happen when the tab was open before Hibro was installed or reloaded.

If a page reader is present but a large read takes too long, Hibro reports the timeout without loading a second reader or repeating the read.

Browsers do not allow extensions to inspect or automate some pages, including browser settings pages and the extension store. Hibro shows an error card instead of trying to restore access to those pages.

## Data and permissions

Hibro needs access to the current tab and page so it can read content and perform the actions you request. Provider settings are encrypted, and conversation history stays in the browser. Chat context and page content are sent directly to the provider when needed. The Hibro developer does not receive this data.

Read the [Privacy policy](privacy.md) for more detail about stored and transmitted data.
