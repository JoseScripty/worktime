'use strict';

const api = window.worktime;
const $ = (id) => document.getElementById(id);

// El proceso principal indica el tamaño en la URL para aplicarlo antes de que se pinte la ventana.
const large = new URLSearchParams(location.search).get('size') === 'large';
if (large) document.body.classList.add('popup--large');

let current = null;
// El aviso grande aparece de golpe y con el foco: sus botones se activan tras un instante para
// que una tecla o un clic que ya estaba en curso no lo responda sin querer.
let armed = !large;
if (large) setTimeout(() => (armed = true), 700);

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
  if (!current || !armed) return;
  $('done').disabled = true;
  $('snooze').disabled = true;
  action(current.id);
}

const done = () => act((id) => api.setMarked(id, true));
const later = () => act((id) => api.snooze(id));

$('done').addEventListener('click', done);
$('snooze').addEventListener('click', later);
// Esc equivale al botón secundario ("Recordar…" o "Cerrar").
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') later();
});

refresh(true);
api.onChange(() => refresh(false));
