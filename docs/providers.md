# Provider setup

A provider is the AI service Hibro sends your requests to. Save a profile for each service or model you want to use, then choose which one is active.

## Add a provider

Open Settings and select LLM providers. Review and accept the data-use notice, then choose Add provider. Enter:

- A name you will recognize in the provider picker.
- The provider type from the table below.
- Your API key and the model name supplied by the service.
- A base URL if required by the service or a proxy you use.

| Provider type     | Use it for                                        | Base URL |
| ----------------- | ------------------------------------------------- | -------- |
| OpenAI-compatible | Services using the OpenAI Chat Completions format | Required |
| OpenAI            | OpenAI or a compatible proxy                      | Optional |
| Anthropic         | Anthropic or a compatible proxy                   | Optional |

OpenAI and Anthropic use their usual server addresses when Base URL is empty. Other remote addresses must use HTTPS. HTTP is allowed for a local service at `localhost`, `127.0.0.1`, or `[::1]`.

Choose a model that supports tools, also called function calling. Hibro needs this for both page questions and page actions. Check the service's documentation for model names and tool support.

Save the profile and make it active. Chat, page translation, and Explain can send messages or page content to the selected service; see the [Privacy policy](privacy.md).

## Switch or edit a provider

Choose Use beside a profile in Settings, or select it from the picker beside the chat input. The next request uses that provider.

When you edit a profile, the API Key field is empty. Leave it empty to keep the saved key, or enter a new one to replace it.

Provider settings are encrypted before they are saved in your browser. Keep API keys out of screenshots, bug reports, and shared logs. For storage details and deletion options, see the [Privacy policy](privacy.md#data-kept-in-your-browser).
