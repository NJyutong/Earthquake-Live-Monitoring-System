const fs = require('fs');
const path = require('path');
const vm = require('vm');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const spoken = [];
  let cancelled = false;
  class SpeechSynthesisUtterance {
    constructor(text) {
      this.text = text;
    }
  }
  const storage = {
    ready: Promise.resolve(),
    getItem: async () => 'true',
    setItem: async () => {}
  };
  const sharedValues = new Map();
  const localStorage = {
    getItem: key => sharedValues.has(key) ? sharedValues.get(key) : null,
    setItem: (key, value) => sharedValues.set(key, String(value))
  };
  const window = {
    SecureStorage: storage,
    localStorage,
    QuakeI18n: { t: value => `EN ${value}` },
    SpeechSynthesisUtterance,
    speechSynthesis: {
      getVoices: () => [],
      speak: utterance => spoken.push(utterance),
      cancel: () => { cancelled = true; }
    }
  };
  const document = { documentElement: { lang: 'zh-CN' } };
  const context = vm.createContext({ window, document, SpeechSynthesisUtterance, console });
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'voice-alert.js'), 'utf8');
  vm.runInContext(source, context, { filename: 'voice-alert.js' });

  await window.QuakeVoice.init();
  const liveEvent = {
    eventKey: 'live-1',
    source: 'cenc_eew',
    location: '四川省康定市',
    magnitude: 4.2,
    depth: 0,
    isLive: true,
    isHistory: false
  };
  assert(window.QuakeVoice.announce(liveEvent), 'A new live event was not announced');
  assert(spoken.length === 1 && spoken[0].text.includes('4.2'), 'Live announcement content is incomplete');
  assert(!window.QuakeVoice.announce(liveEvent) && spoken.length === 1, 'Duplicate event was announced twice');
  assert(!window.QuakeVoice.announce({ ...liveEvent, eventKey: 'history-1', isHistory: true }), 'History event was announced');
  assert(!window.QuakeVoice.announce({ ...liveEvent, eventKey: 'debug-1', source: 'debug' }), 'Debug event was announced');

  document.documentElement.lang = 'en';
  assert(window.QuakeVoice.announce({ ...liveEvent, eventKey: 'live-2' }), 'English live event was not announced');
  assert(spoken.at(-1).lang === 'en-US' && spoken.at(-1).text.startsWith('Earthquake alert.'), 'English announcement was not localized');

  const secondWindow = {
    SecureStorage: storage,
    localStorage,
    QuakeI18n: window.QuakeI18n,
    SpeechSynthesisUtterance,
    speechSynthesis: window.speechSynthesis
  };
  const secondContext = vm.createContext({ window: secondWindow, document, SpeechSynthesisUtterance, console });
  vm.runInContext(source, secondContext, { filename: 'voice-alert-second-tab.js' });
  await secondWindow.QuakeVoice.init();
  assert(!secondWindow.QuakeVoice.announce({ ...liveEvent, eventKey: 'live-2' }), 'The same event was announced in a second tab');
  window.QuakeVoice.setEnabled(false);
  assert(cancelled, 'Disabling voice alerts did not cancel queued speech');
  console.log(JSON.stringify({ ok: true, announcements: spoken.length }));
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
