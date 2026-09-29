# Troubleshooting

## Hibro asks for a provider

Open Settings, add a provider profile, and make it active. Check its model name, API key, and server address. OpenAI-compatible profiles require a base URL. See [Provider setup](providers.md).

If Hibro asks you to accept the data-use notice, choose Open provider settings in the error message. Review and accept the notice before retrying.

## Saved providers cannot be opened

Reload the extension and try again. Hibro leaves unreadable settings unchanged.

If browser data was cleared or damaged, the key needed to read saved providers may be missing. Resetting Hibro's local extension data lets you set up providers again, but also deletes local conversations, skills, and settings. Only reset it when you no longer need that data.

## The model does not read or act on the page

Choose a model that supports tools, also called function calling. Hibro needs this for both page questions and actions. Also check that the model name, API key, and base URL match your provider's instructions.

## Hibro cannot connect to a page

Refresh the page and retry. Hibro usually reconnects automatically, including to tabs opened before the extension was installed or reloaded.

If a large page takes too long to read, ask about a smaller section. Browser settings pages, extension stores, and other protected pages cannot be read or controlled.

## Only part of a page is translated

There is a limit on how much text Hibro translates in one run. On very long pages, the remaining text stays in its original language. Navigation, footers, code blocks, and hidden text are skipped.

## An action reports a debugger error

Close browser DevTools and pause other extensions that may be controlling the same tab, then retry. Another debugger connection can prevent Hibro from using the tab.

## A task stops before it finishes

Hibro limits the number of actions in one request. If it says the task may be incomplete, send a follow-up asking it to continue.

## The answer uses old page content

Ask Hibro to read the page again, or start a new chat. Some websites change content without changing the page address, so Hibro may still have earlier context.

## An action is not what you expected

Use Stop to interrupt the request. It does not undo completed actions. Page content can influence the model, so review important changes before relying on them.

## Report a problem

Include your Hibro and browser versions, steps to reproduce, and any error message in a [GitHub issue](https://github.com/apemost/hibro/issues). Remove API keys and private information from text, links, logs, and screenshots before posting.
