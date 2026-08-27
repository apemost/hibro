# Privacy policy

Last updated: August 27, 2026

Hibro is a browser extension for AI-assisted reading and user-requested page actions. Hibro has no developer-operated account service, analytics, or advertising. The Hibro developer does not receive or store your messages, browsing data, page content, provider credentials, or saved settings.

Hibro still handles data on your device and sends some data directly to the LLM provider you choose. This policy explains those flows.

## Data kept in your browser

Hibro stores the following data in your browser's local extension storage:

- Provider profiles, including API keys, model names, and optional base URLs. The profiles are encrypted before storage.
- Up to 10 recent conversations, including message text, reasoning, tool inputs and results, titles, timestamps, and the last page address used by each conversation.
- Built-in skill preferences, user-created skill content, and interface language.
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
- Selected text when you choose Explain.
- Instructions from enabled skills that match the current page.
- The configured model name and API credential needed to authenticate the request.

The API key is sent as an authentication header, not as part of the chat prompt. Remote provider URLs must use HTTPS. Plain HTTP is allowed only for a provider running on the same device through localhost or a loopback address.

The provider's privacy, security, and retention terms apply to these requests. A self-hosted OpenAI-compatible endpoint receives the same request data at the address you configure. Hibro does not send a second copy to the developer.

## How Hibro uses data

Hibro uses data only to provide the reading, chat, settings, history, skill, and page-action features the user requests. It does not sell data, use it for advertising or credit decisions, share it with data brokers, or allow developer staff to inspect it.

Hibro's use of information complies with the [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq), including the Limited Use requirements.

Model responses cannot automatically load remote Markdown or chart images. HTML previews are static and block scripts, forms, popups, same-origin access, and network requests. A preview can use inline styles and embedded data images or fonts.

## Browser permissions

Hibro requests:

- `sidePanel` to show chat beside the current page.
- `storage` and `unlimitedStorage` to keep settings and recent conversations.
- `scripting` to restore Hibro's bundled page reader on a supported page when it is missing.
- `debugger` to send browser-level click, typing, keyboard, scroll, and navigation commands for page automation.
- Access to all URLs so the bundled content script can read supported pages and the service worker can contact the provider address you configure.

The browser blocks extension access on protected pages such as `chrome://` pages and the browser's extension store. Hibro does not read page content at load time. It reads data after you make a request and only as the request needs it.

## Changes and questions

Material changes to this policy will be published with an updated date. Questions or privacy concerns can be reported through the [Hibro issue tracker](https://github.com/apemost/hibro/issues).
