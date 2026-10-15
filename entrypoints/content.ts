import { defineContentScript } from 'wxt/utils/define-content-script';
import { boot } from '../src/content/boot';

export default defineContentScript({
  matches: ['<all_urls>'],
  main: boot,
});
