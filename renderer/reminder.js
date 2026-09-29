'use strict';

const api = window.worktime;
const $ = (id) => document.getElementById(id);

let current = null;

// Dos notas cortas generadas en el momento, sin archivos de audio.
function chime() {
  const ctx = new AudioContext();
  [880, 1318.5].forEach((frequency, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const t = ctx.currentTime + i * 0.18;
    osc.type = 'sine';
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.25, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.65);
  });
}

async function refresh(playSound) {
  current = await api.getReminder();
  if (!current) return;
  $('eyebrow').textContent = current.eyebrow;
  $('title').textContent = current.title;
  $('sub').textContent = current.sub;
  $('done').textContent = current.doneLabel;
  $('snooze').textContent = current.laterLabel;
  if (playSound && current.sound) chime();
}

function act(action) {
  if (!current) return;
  $('done').disabled = true;
  $('snooze').disabled = true;
  action(current.id);
}

$('done').addEventListener('click', () => act((id) => api.setMarked(id, true)));
$('snooze').addEventListener('click', () => act((id) => api.snooze(id)));

refresh(true);
api.onChange(() => refresh(false));
