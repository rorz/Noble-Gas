# Noble Gas

Less noise. Same substance. A Chrome extension that rewrites selected prose in place with Gemini, preserving the page’s formatting, links, and inline code.

## Development

Install [Bun](https://bun.sh), then:

```sh
bun install
bun dev
```

`bun dev` opens Chrome for Testing with the extension loaded and the test chamber ready. It reuses a local Chrome for Testing installation, or downloads the stable version once. The development browser keeps its profile in `.wxt/chrome-data`; your normal Chrome profile is separate. WXT reloads the extension as you edit.

Open **NG** in the browser toolbar, expand **Set API key**, paste a [Google Gemini API key](https://aistudio.google.com/apikey), and save. No AI Gateway account or key is needed. Choose Gemini 4 Argon or Gemini 3.5 Flash-Lite in the popup.

The chamber contains recorded rewrites so you can try page editing, animation, and undo without an API call. Use the extension’s toolbar controls on a page to make a live Gemini request.

## Use

- Click **Pick a passage**, then click a paragraph. You can also drag to select text and press Enter while picking.
- For an existing selection, choose **Rewrite highlighted text**, use the **De-slop with Noble Gas** context menu, or press **Alt + Shift + N** (**Option + Shift + N** on Mac).
- Use **Undo** in the page overlay or **Undo last rewrite** in the popup. Escape cancels a pending rewrite. Reloading the page also restores its original content.

Noble Gas runs on normal webpages without per-visit permission prompts. Chrome blocks extensions on its own settings pages and other protected pages, including the Chrome Web Store. File URLs require Chrome’s “Allow access to file URLs” setting. Code blocks, form fields, editors, hidden content, and text inside shadow roots are skipped. Selection currently operates in the main frame.

Rewrites change only your local view; they do not submit edits to GitHub or publish anything. Changes are applied only after the response passes validation and the original text is confirmed unchanged. Undo likewise avoids overwriting subsequent website changes.

## Install from a checkout

```sh
bun install
bun run build
```

Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select `.output/chrome-mv3`. For an archive to distribute through GitHub, run `bun run zip`; unzip it before loading the extension.

## Data and limits

Only the selected text segments are sent to Google, with segment IDs and formatting boundaries. Requests use the AI SDK Google provider directly. API keys stay in extension-local storage restricted to trusted extension contexts; they are never placed in webpage DOM or content-script messages. Browser-local storage is not an encrypted vault.

The extension bounds each selection to 18,000 characters and 160 text segments, cancels requests after 90 seconds, and keeps up to ten undo operations per page. Model output is inserted as text, never HTML. The model is instructed to preserve meaning, but you should review rewrites where exact wording matters.

## Checks

```sh
bun run check
```

Runs TypeScript, Biome, Bun tests, Knip, Pokayoke, and a production build. Tests cover partial selections, formatting and link preservation, stale-page protection, undo, output validation, and the real Google SDK with mocked network responses. The repository policy keeps model SDKs in the background worker and prohibits HTML injection in page-editing code.
