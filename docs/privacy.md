# Privacy policy

Last updated: September 25, 2026

Hibro is a browser extension for AI-assisted reading and user-requested page actions. Hibro has no developer-operated account service, analytics, or advertising. The Hibro developer does not receive or store your messages, browsing data, page content, provider credentials, or saved settings.

Hibro still handles data on your device and sends some data directly to the LLM provider you choose. This policy explains those flows.

## Data kept in your browser

Hibro stores the following data in your browser's local extension storage:

- Provider profiles, including API keys, model names, and optional base URLs. The profiles are encrypted before storage.
- Up to 10 recent conversations, including message text, reasoning, tool inputs and results, compatible provider-returned inline image assets, titles, timestamps, and the last page address used by each conversation.
- Built-in skill preferences, user-created skill content, the interface language, and the page translation language.
- Your acknowledgement of the provider data-use notice.

Conversation and skill data is stored as ordinary local extension data. It is not uploaded to the Hibro developer or synchronized through Hibro.

The provider encryption key is non-exportable and kept separately in the extension's browser storage. Hibro can decrypt a provider profile while it is running so it can contact that provider. The browser controls how this key and other local extension data are protected on disk.

Local storage is limited to trusted extension pages and the service worker. The page content script cannot read it directly.

You can delete individual conversations in History and remove providers or user-created skills in Settings. Uninstalling Hibro removes its local extension data through the browser. If an encrypted provider profile becomes unreadable, Hibro leaves it unchanged and reports the problem.

## Data sent to your LLM provider

Hibro contacts the active provider directly. The provider receives only the data needed for the request, which can include:

- Your message and recent text from the active conversation.
- The current page title, address, and a small structural overview.
- Page text, links, controls, form values, element details, and action results when the model asks Hibro to read or operate the page.
- The text blocks of the main content when you translate the page.
- Selected text when you choose Explain.
- Instructions from enabled skills that match the current page.
- The configured model name and API credential needed to authenticate the request.

Because requests go directly from your browser, a remote provider can receive your connection source IP address, TLS and network metadata, and ordinary request headers. Hibro does not separately read, derive, or store your location from this information.

The API key is sent as an authentication header, not as part of the chat prompt. Remote provider URLs must use HTTPS. Plain HTTP is allowed only for a provider running on the same device through localhost or a loopback address.

The provider's privacy, security, and retention terms apply to these requests. A self-hosted OpenAI-compatible endpoint receives the same request data at the address you configure. Hibro does not send a second copy to the developer.

## Page translation

Translating a page sends the text blocks of its main content to the active provider, in batches, and renders the replies back into the page. This includes any personal or confidential text those blocks contain, so treat a page behind a login the same way you would treat pasting it into a chat.

Translations exist only in the open tab. Hibro does not store them, does not add them to conversation history, and does not send them anywhere else. Closing the tab, reloading it, or pressing the translate button again removes them. Asking for a translation in chat records only the tool card, which holds the block count and the target language, not the translated text.

## Remote image requests

An image address written into a model response does not load automatically. Markdown shows an inactive card with the destination host. If you choose Load once, Hibro contacts that third-party host directly for that individual image. The host can receive your IP address, the requested address including its path or query parameters, TLS and network metadata, and ordinary browser request headers. Do not load an unfamiliar host or an address containing an identifier you do not want to disclose.

Hibro accepts only credential-free HTTPS addresses with public-looking hostnames. It blocks literal IP addresses, localhost and special-use names, and all redirects. The request omits browser cookies and other credentials, sends no referrer, and accepts only a matching PNG, JPEG, or WebP response up to 5 MiB. Hibro does not operate a proxy, so it cannot hide your network address. It also cannot reliably determine before connecting whether a public-looking hostname resolves or rebinds to a private network address.

After validation, the panel displays the downloaded bytes through a temporary local object address. Hibro removes that address when the image or conversation leaves the panel. The downloaded bytes and the one-time loading choice are not added to conversation history, so reopening the conversation requires another choice. This is separate from a compatible provider-returned inline image asset, which is part of the structured model response and is stored with that conversation.

## How Hibro uses data

Hibro uses data only to provide the reading, translation, chat, settings, history, skill, and page-action features the user requests. It does not sell data, use it for advertising or credit decisions, share it with data brokers, or allow developer staff to inspect it.

Hibro's use of information complies with the [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq), including the Limited Use requirements.

Model responses cannot automatically load Markdown image addresses. Each eligible remote Markdown image requires the one-time action described above. Mermaid and chart blocks reject remote image resources. HTML previews are static and block scripts, forms, popups, same-origin access, and network requests. A preview can use inline styles and embedded data images or fonts.

## Browser permissions

Hibro requests:

- `sidePanel` to show chat beside the current page.
- `storage` and `unlimitedStorage` to keep settings and recent conversations.
- `scripting` to restore Hibro's bundled page reader on a supported page when it is missing.
- `debugger` to send browser-level click, typing, keyboard, scroll, and navigation commands for page automation.
- Access to all URLs so the bundled content script can read supported pages and render translations into them, the service worker can contact the provider address you configure, and it can fetch an eligible third-party Markdown image after you choose Load once.

The browser blocks extension access on protected pages such as `chrome://` pages and the browser's extension store. Hibro does not read page content at load time. It reads data after you make a request and only as the request needs it.

## Changes and questions

Material changes to this policy will be published with an updated date. Questions or privacy concerns can be reported to the Hibro maintainer.
