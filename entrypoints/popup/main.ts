import '../../src/ui/base.css';
import './style.css';
import { errorMessage, type PublicSettings, settingsSchema } from '../../src/shared/contracts';
import { inExtension, loadSettings, send } from '../../src/ui/bridge';
import { query, showStatus } from '../../src/ui/dom';

let settings: PublicSettings;
const rewrite = query<HTMLButtonElement>('#rewrite');
const key = query<HTMLInputElement>('#api-key');
const save = query<HTMLButtonElement>('#save-key');
const accordion = query<HTMLDetailsElement>('#key-accordion');
const forget = query<HTMLButtonElement>('#forget-key');
const options = query<HTMLFieldSetElement>('#rewrite-options');
const thinking = query<HTMLSelectElement>('#thinking-level');
const webSearch = query<HTMLInputElement>('#web-search');

function setBusy(busy: boolean): void {
  rewrite.disabled = busy;
  options.disabled = busy || !inExtension;
  key.disabled = busy || !inExtension;
  save.disabled = busy || !inExtension;
  forget.disabled = busy;
}

function render(): void {
  query('#key-label').textContent = settings.hasKey ? 'API key saved' : 'Set API key';
  key.placeholder = settings.hasKey ? 'Paste a replacement key' : 'Paste your key';
  forget.hidden = !settings.hasKey;
  thinking.value = settings.thinkingLevel;
  webSearch.checked = settings.webSearch;
  setBusy(false);
}

async function activate(): Promise<void> {
  if (!settings) return;
  try {
    if (!settings.hasKey) {
      accordion.open = true;
      key.focus();
      return;
    }
    setBusy(true);
    await send({ type: 'activate', mode: 'auto' });
    window.close();
  } catch (error) {
    showStatus(errorMessage(error), true);
  } finally {
    render();
  }
}

rewrite.addEventListener('click', () => void activate());
accordion.addEventListener('toggle', () => {
  if (accordion.open) key.focus();
});

async function savePreferences(): Promise<void> {
  if (!settings) return;
  setBusy(true);
  try {
    settings = await send<PublicSettings>({
      type: 'save-settings',
      settings: settingsSchema.parse({
        ...settings,
        thinkingLevel: thinking.value,
        webSearch: webSearch.checked,
      }),
      rememberKey: settings.rememberKey,
    });
    showStatus('');
  } catch (error) {
    showStatus(errorMessage(error), true);
  } finally {
    render();
  }
}

thinking.addEventListener('change', () => void savePreferences());
webSearch.addEventListener('change', () => void savePreferences());

query('#key-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!settings) return;
  setBusy(true);
  try {
    if (key.value.trim().length < 16) throw new Error('Paste the complete Gemini API key.');
    settings = await send<PublicSettings>({
      type: 'save-settings',
      settings,
      apiKey: key.value,
      rememberKey: true,
    });
    key.value = '';
    accordion.open = false;
    showStatus('');
  } catch (error) {
    showStatus(errorMessage(error), true);
  } finally {
    render();
  }
});
forget.addEventListener('click', async () => {
  if (!settings) return;
  setBusy(true);
  try {
    settings = await send<PublicSettings>({ type: 'forget-key' });
    key.value = '';
    showStatus('');
  } catch (error) {
    showStatus(errorMessage(error), true);
  } finally {
    render();
  }
});
setBusy(true);
void loadSettings()
  .then((value) => {
    settings = value;
    render();
  })
  .catch((error: unknown) => showStatus(errorMessage(error), true));
