import '../../src/ui/base.css';
import './style.css';
import {
  type Activation,
  errorMessage,
  type PublicSettings,
  type Strength,
  settingsSchema,
} from '../../src/shared/contracts';
import { inExtension, loadSettings, openChamber, send } from '../../src/ui/bridge';
import { query, showStatus } from '../../src/ui/dom';

const notes: Record<Strength, string> = {
  light: 'A small edit. The original voice stays.',
  balanced: 'Clearer sentences. All the meaning.',
  thorough: 'Cut the padding. Keep every useful detail.',
};
let settings: PublicSettings;
const pick = query<HTMLButtonElement>('#pick');
const selection = query<HTMLButtonElement>('#selection');
const key = query<HTMLInputElement>('#api-key');
const save = query<HTMLButtonElement>('#save-key');
const accordion = query<HTMLDetailsElement>('#key-accordion');
const forget = query<HTMLButtonElement>('#forget-key');
const model = query<HTMLSelectElement>('#model');

function render(): void {
  query<HTMLInputElement>(`input[value="${settings.strength}"]`).checked = true;
  query('#strength-note').textContent = notes[settings.strength];
  query('#key-label').textContent = settings.hasKey ? 'API key saved' : 'Set API key';
  model.value = settings.model;
  key.placeholder = settings.hasKey ? 'Paste a replacement Gemini key' : 'Paste your Gemini key';
  forget.hidden = !settings.hasKey;
  pick.disabled = false;
  selection.disabled = false;
  save.disabled = !inExtension;
}

async function activate(mode: Activation): Promise<void> {
  if (!settings) return;
  try {
    if (!settings.hasKey && mode !== 'undo') {
      accordion.open = true;
      key.focus();
      return;
    }
    pick.disabled = true;
    selection.disabled = true;
    await send({ type: 'activate', mode });
    window.close();
  } catch (error) {
    showStatus(errorMessage(error), true);
  } finally {
    pick.disabled = false;
    selection.disabled = false;
  }
}

async function updatePreferences(): Promise<void> {
  if (!settings) return;
  const values = settingsSchema.parse({
    ...settings,
    model: model.value,
    strength: query<HTMLInputElement>('input[name="strength"]:checked').value,
  });
  try {
    settings = inExtension
      ? await send<PublicSettings>({
          type: 'save-settings',
          settings: values,
          rememberKey: settings.rememberKey,
        })
      : { ...settings, ...values };
  } catch (error) {
    showStatus(errorMessage(error), true);
  }
  render();
}

pick.addEventListener('click', () => void activate('pick'));
selection.addEventListener('click', () => void activate('selection'));
query('#undo').addEventListener('click', () => void activate('undo'));
query('#chamber').addEventListener(
  'click',
  () => void openChamber().catch((error: unknown) => showStatus(errorMessage(error), true)),
);
for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="strength"]'))
  radio.addEventListener('change', () => void updatePreferences());
model.addEventListener('change', () => void updatePreferences());
accordion.addEventListener('toggle', () => {
  if (accordion.open) key.focus();
});

query('#key-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  save.disabled = true;
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
    render();
    showStatus('Gemini key saved. Ready when you are.');
  } catch (error) {
    showStatus(errorMessage(error), true);
  } finally {
    save.disabled = !inExtension;
  }
});
forget.addEventListener('click', async () => {
  forget.disabled = true;
  try {
    settings = await send<PublicSettings>({ type: 'forget-key' });
    key.value = '';
    render();
    showStatus('Key removed.');
  } catch (error) {
    showStatus(errorMessage(error), true);
  } finally {
    forget.disabled = false;
  }
});
key.disabled = !inExtension;
save.disabled = true;
if (!inExtension)
  query('#key-help').textContent = 'Preview only. Open NG in the browser toolbar to save your key.';
void loadSettings()
  .then((value) => {
    settings = value;
    render();
  })
  .catch((error: unknown) => showStatus(errorMessage(error), true));
