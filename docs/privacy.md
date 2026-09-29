# Privacy policy

Last updated: September 29, 2026

Hibro keeps settings and recent conversations in your browser. It sends messages and page content directly to the AI provider you choose, with no copy sent to Hibro's developer. You do not need a Hibro account.

## Data kept in your browser

Hibro saves:

- Provider profiles, including API keys, model names, and server addresses.
- Your 10 most recent conversations, including messages, reasoning, page reads and actions, provider-returned images, titles, timestamps, and the last page address used in each chat.
- Your skills, enabled/disabled choices, interface language, and translation language.
- Your acceptance of the provider data-use notice.

This data is not synced by Hibro or uploaded to its developer. Provider profiles are encrypted before saving; the browser keeps the encryption key separately. Hibro can use that key to read profiles when contacting your provider.

Hibro does not separately encrypt conversations or skills. Their protection depends on your device and browser profile. Encryption of provider settings also cannot protect against someone controlling your device or the extension itself.

Delete conversations in History and remove providers or personal skills in Settings. Older conversations fall out of saved history when the limit of 10 is exceeded. Other settings remain until changed or cleared. Uninstalling Hibro removes its local extension data.

Deleting local data does not delete copies already held by your provider or websites you used.

## Data sent to your AI provider

Chat requests include your message, recent messages from the active conversation, and a brief page overview with its title and address. Depending on what you ask and which actions the model chooses, the provider may also receive:

- Page text, links, form values, details of page controls, and action results.
- The main page text for translation.
- Text you select when you choose Explain.
- Instructions from enabled skills that match the page.

Page text and form entries can include passwords or other sensitive information. Do not rely on Hibro to detect or remove it all.

Requests also include the model name and API key used to authenticate with the provider. Remote providers use HTTPS; HTTP is allowed only for a provider on your own device.

A remote provider can see your IP address and normal connection and request details. Hibro does not use these to determine your location. The provider's own privacy and retention terms apply, including when you use a service you host yourself.

## Your consent

Review and accept the data-use notice in Settings before using an AI provider. You can withdraw consent by clearing the checkbox under LLM providers. This does not cancel work already running; use Stop for an active chat. It also does not delete information already sent to a provider.

## Page translation

Translation sends the main page text to your selected provider, including any private information in that text.

Showing the original hides the translations but keeps a copy in the open tab. Hibro can reuse that copy for the same language. Reloading or closing the page clears it. The translation feature does not save its results in extension storage.

Translations are inserted into the page, where the website's scripts can read them. Websites can also read text Hibro enters into their forms.

Chat history records the translation action and its outcome. Later page reads can include translated text in provider requests and saved chat history.

## Remote image requests

An image link in an answer does not load automatically. The card shows the image address before you choose Load once. Loading contacts that website, which can see your IP address, the image address including its path and any query, and normal connection and request details. Check the address before loading it; it may contain personal information.

Downloaded images and your choice to load them are not saved in chat history. Reopening a conversation requires another click. Images returned directly by a supported provider are saved with the conversation.

## How Hibro uses data

Hibro uses data to provide reading, translation, chat, settings, history, skills, and page actions.

Hibro follows the Chrome Web Store User Data Policy's [Limited Use requirements](https://developer.chrome.com/docs/webstore/program-policies/limited-use) when using this information.

## Browser permissions

Hibro requests:

- Page access on all websites to read content, translate it, and carry out your actions. This access also lets it contact your provider and load an image when you choose Load once.
- Browser debugging access to click, type, scroll, and navigate pages.
- Permission to reconnect to pages opened before Hibro was installed or reloaded.
- Local storage and extra storage capacity for settings and conversations.
- Side panel access to display chat beside a page.

Hibro does not read page content just because a page opens. Page reads follow your requests. The browser blocks access to protected pages, such as browser settings and extension stores.

## Changes and questions

Changes to this policy will be published here with an updated date. For privacy questions, use the developer contact on the [Chrome Web Store listing](https://chromewebstore.google.com/detail/hibro/adjgimddlhgjegcbbcmccalenolmeije). General questions can also go in a [GitHub issue](https://github.com/apemost/hibro/issues). Issues are public; leave out credentials, private page content, and personal information.
