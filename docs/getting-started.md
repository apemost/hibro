# Getting started

Hibro is available from the Chrome Web Store.

## Requirements

You need:

- Chrome or Edge.
- An API key for an AI service and a model that supports tools, also called function calling.

Tool support is needed for both page questions and page actions.

## Install from the Chrome Web Store

1. Open [Hibro in the Chrome Web Store](https://chromewebstore.google.com/detail/hibro/adjgimddlhgjegcbbcmccalenolmeije).
2. Choose the install action and approve the browser prompt.
3. Pin Hibro to the browser toolbar if you want quick access.

Click the Hibro toolbar button to open its menu. From there you can translate the current page or open the side panel.

## Add a provider

1. Select the Settings gear at the lower left of the panel.
2. Open LLM providers.
3. Review and accept the provider data-use notice.
4. Choose Add provider.
5. Enter a name, provider type, API key, and model. OpenAI-compatible profiles also need a base URL.
6. Save the profile and make sure it is active.

See [Provider setup](providers.md) for the supported profile types.

## Try the first chat

Open a regular web page and ask a simple question:

> Summarize this page in five sentences.

Then try a visible page action:

> Scroll to the next section.

Page reads and actions appear in expandable cards. Use Stop to interrupt the request.

Browser settings pages and extension stores do not allow this kind of page access. See [Troubleshooting](troubleshooting.md) if the panel cannot connect to a normal page.
