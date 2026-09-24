# Troubleshooting

## The panel asks for an AI provider

Open Settings from the gear in the lower left, add a provider profile, and make it active. OpenAI-compatible profiles require a base URL.

If Hibro asks you to accept the provider data-use notice, select **Open provider settings** in the error message. Settings opens on the LLM Providers tab, where you can review and accept the notice.

## Settings cannot unlock saved providers

Hibro leaves the saved data unchanged when it cannot decrypt provider settings. Reload the extension once in case the browser storage was temporarily unavailable.

If extension data was cleared or damaged, the encryption key may be gone. The providers then need to be set up again after clearing Hibro's local extension data. This also removes local conversations, skills, and settings, so use it only when you no longer need that data.

## The model answers without reading or acting on the page

Use a model that supports function calling. Hibro uses tools for page questions and page actions, so a chat-only model is not enough.

Also check that the model name, API key, and base URL match the provider's requirements.

## Hibro cannot connect to the page

Hibro normally restores its page connection automatically, including for tabs that were already open when the extension was installed or reloaded. If a regular web page still does not connect, refresh that tab and try again.

Very large pages can take too long to read. If a read times out, retry with a request that names a smaller section of the page.

Hibro cannot inspect browser settings pages, the browser's extension store, or other protected pages. Open a regular `http://` or `https://` page instead.

## Only part of a long page is translated

Hibro translates up to a fixed amount of text in one run. On a page longer than that, the first part is translated and the rest is left in its original language.

## A page action reports a debugger error

Close browser DevTools and pause other extensions that may be debugging the same tab, then retry. Chrome allows only one debugger attachment to a target at a time.

## A long task stops before it is finished

Hibro limits the number of tool steps in one request. If the answer says the task may be incomplete, send a follow-up that asks it to continue from the current page.

## The page changed but the answer uses old context

Hibro detects URL changes. Some sites replace their content without changing the URL. Ask Hibro to read the page again, or start a new chat.

## An action is not what you expected

Use Stop to interrupt the current request. Web pages can contain instructions that influence a model, so review important changes before relying on them.
