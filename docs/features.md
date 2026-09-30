# Features

Hibro helps you read and use the current web page from a browser side panel.

## Chat about a page

Open Hibro from the browser toolbar, choose the side panel, and ask a question. Each chat request sends your message, the page title, its address, and a brief overview to your selected AI provider. The model can ask to read more of the page.

Answers appear as they arrive. Hibro uses your language and the page's language to guide its replies. Some models also provide reasoning, shown temporarily above the input.

When you move to another page, Hibro tells the model that the address changed. If the page changes without a new address, ask Hibro to read it again.

## Ask Hibro to act

You can ask Hibro to click a button, fill in a field, scroll, follow a link, or open another page. Page reads and actions appear in expandable cards, including any errors.

Use Stop to interrupt a request. Starting a new chat or switching conversations also stops it. Stop does not undo actions already taken. Review important changes before relying on them.

Long tasks may reach a limit on the number of actions. If Hibro says the task may be incomplete, send a follow-up to continue. Both page questions and actions need a model that supports tools; see [Provider setup](providers.md).

## Translate a page

Open the toolbar menu, choose a language, and click the translate button. Translations appear below the original text. Click the button again to show only the original. Translation continues if you close the menu.

Hibro translates the main content, including paragraphs, headings, lists, and tables. It skips navigation, sidebars, footers, code blocks, and hidden text. Very long pages may be translated only in part.

The target language follows your interface language until you choose another. You can change it in the toolbar menu or Settings under General. You can also ask in chat, such as "translate this page into Japanese," including languages outside the Settings list.

Translation sends page text to your selected provider. The open tab remembers the result, so showing the same translation again needs no new request. Reloading or closing the page clears that copy. A different language or changed page content may require a new translation. See [translation privacy](privacy.md#page-translation) for details.

## Conversations

Hibro saves your 10 most recent conversations in the browser and restores the active one when you reopen the panel.

- Start a new chat with the plus button at the top right.
- Open History at the top left to switch, rename, or delete a conversation.
- An empty chat appears in History after you send its first message.
- Deleting the active conversation opens the most recent remaining one.

Deleting a conversation also clears it from other open Hibro panels and stops any request running in that conversation.

Press ArrowUp in an empty input, or at the start of its text, to recall sent messages. ArrowDown moves forward and eventually restores your draft.

Drag the handle above the input to resize it, or focus the handle and use ArrowUp, ArrowDown, Home, or End. Long messages can be expanded with Show more and collapsed with Show less. Wide code and action results scroll within their own areas.

## Answers, previews, and copying

Answers can include formatted text, math, diagrams, charts, and HTML previews. Charts support bar, line, pie, and scatter plots and follow your system's light or dark theme.

HTML starts in Code view. Choose Preview to see a static version. Preview links and forms do not work, and previews cannot run scripts, open popups, or load external content. The original HTML remains available in Code view. Invalid chart data is shown as code.

Click a finished message to open its copy action. Select text to copy just that part or choose Explain. Explain sends the selection to your active AI provider.

## Images

Hibro can display images returned directly by a provider when the provider and model support this response type. PNG, JPEG, and WebP images up to 5 MiB are supported and saved with the conversation.

Image links in answers stay unloaded until you choose Load once. Review the full address shown on the card first: loading sends that address to the website and reveals your IP address. Downloaded images are not saved in conversation history, so you must load them again when you reopen it.

Remote images must use HTTPS and meet the same file limits. Some addresses and redirects are blocked. Diagrams, charts, and HTML previews cannot load remote images. See [image privacy](privacy.md#remote-image-requests) for the restrictions and their limits.

## Providers and language

Open Settings from the gear in the panel or toolbar menu. You can save several provider profiles and switch between them in Settings or beside the chat input. The next request uses the selected provider. See [Provider setup](providers.md) for supported services and required fields.

Settings and the side panel support English and Simplified Chinese. Choose the interface language under General in Settings. Existing conversations, provider names, skill instructions, and action results keep their original text.

## Site skills

Skills give Hibro instructions for particular websites. In Settings, open Agent skills and use the checkbox beside a skill to enable or disable it. The ellipsis menu offers View for built-in skills and Edit or Delete for your own skills.

Creating or editing a skill requires a name, description, at least one URL pattern, and instructions. New skills start enabled, and editing keeps their current on/off setting. Enabled skills apply when the page address matches their rules. Their instructions are sent to your selected provider. See [Hibro skills](skills.md) to create or manage them.

## Page access and privacy

Browser settings pages, extension stores, and other protected pages cannot be read or controlled. If a regular page cannot connect, refresh it and retry. See [Troubleshooting](troubleshooting.md) for other connection and action errors.

Provider settings and recent conversations are saved locally. Messages and page content are sent directly to your chosen provider. The [Privacy policy](privacy.md) explains storage, sharing, deletion, and browser permissions.
