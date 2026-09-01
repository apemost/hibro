# Provider setup

Hibro stores named provider profiles so you can switch models without re-entering their settings. The active profile is shared by Settings and the side panel.

Older Hibro releases stored provider settings without encryption, and some stored one provider without a profile name. After an upgrade, Hibro encrypts those settings automatically and keeps the old provider active.

## Profile fields

Every profile has:

- A name shown in the provider picker.
- A provider type.
- An API key.
- A model name understood by that provider.
- A base URL when the provider type requires one or you use a proxy.

Hibro encrypts the whole profile before saving it in your browser profile. The encryption key is kept separately by the browser and cannot be exported. Hibro can still unlock the profile while the extension is running so it can contact your provider.

When you edit a profile, the API Key field stays empty. Leave it empty to keep the saved key, or enter a new key to replace it.

This protects credentials from appearing as plain text in extension storage. It does not replace the security of your device or browser profile, and it does not protect against malicious code running as the extension. Hibro never bundles credentials in the extension build.

## Provider types

| Type              | Base URL | Use it for                                                |
| ----------------- | -------- | --------------------------------------------------------- |
| OpenAI-compatible | Required | Services that support the OpenAI Chat Completions format. |
| OpenAI            | Optional | OpenAI's Chat Completions API or a compatible proxy.      |
| Anthropic         | Optional | Anthropic's Messages API or a compatible proxy.           |

OpenAI and Anthropic use their standard endpoints when the base URL is empty.

Custom remote base URLs must use HTTPS. Plain HTTP is accepted only for a provider running on the same device through `localhost`, `127.0.0.1`, or `[::1]`.

## Model requirement

The selected model must support function calling. Hibro decides whether to read or operate a page through model tools on every request, including ordinary page questions.

Model names and tool support differ by provider and change over time. Check the provider's documentation when choosing a model.

## Switch profiles

Use the Use button in Settings or the picker beside the chat input. Open Settings and side panels update when the active profile changes. The next message uses the new profile.

## Keep credentials safe

Do not add API keys to source files, screenshots, bug reports, or shared logs. Read the [Privacy policy](privacy.md) before sharing reproductions.
