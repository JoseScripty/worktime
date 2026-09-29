'use strict';

const api = window.worktime;
const $ = (id) => document.getElementById(id);

const DAYS = [
  [1, 'L', 'lunes'],
  [2, 'M', 'martes'],
  [3, 'X', 'miércoles'],
  [4, 'J', 'jueves'],
  [5, 'V', 'viernes'],
  [6, 'S', 'sábado'],
  [0, 'D', 'domingo'],
];

let config = null;
let savedTimer = null;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// ---------- Pestañas ----------

function selectTab(name) {
  for (const tab of document.querySelectorAll('.tabs__tab')) {
    tab.setAttribute('aria-selected', String(tab.dataset.tab === name));
  }
  for (const panel of ['today', 'history', 'settings']) {
    $(`panel-${panel}`).hidden = name !== panel;
  }
  if (name === 'history') renderHistory();
}

for (const tab of document.querySelectorAll('.tabs__tab')) {
  tab.addEventListener('click', () => selectTab(tab.dataset.tab));
}

// ---------- Hoy ----------

function statusText(item) {
  const task = item.kind === 'task';
  switch (item.status) {
    case 'done':
      return `${task ? 'Enviado' : 'Marcado'} a las ${item.markedText}`;
    case 'due':
      return task ? `Envíalo antes de las ${item.until}` : 'Toca marcar ahora';
    case 'missed':
      return task ? 'Sin enviar' : 'Sin marcar';
    default:
      return 'Pendiente';
  }
}

function markItem(item) {
  const done = item.status === 'done';
  const li = el('li', `mark mark--${item.status}`);
  const body = el('div', 'mark__body');
  body.append(el('span', 'mark__label', item.label), el('span', 'mark__status', statusText(item)));

  const variant = done ? 'btn--ghost' : item.status === 'due' ? 'btn--primary' : 'btn--secondary';
  const confirm = item.kind === 'task' ? 'Ya lo envié' : 'Ya marqué';
  const button = el('button', `btn ${variant}`, done ? 'Deshacer' : confirm);
  button.type = 'button';
  button.addEventListener('click', () => api.setMarked(item.id, !done));

  li.append(el('span', 'mark__time', item.time), body, button);
  return li;
}

async function renderToday() {
  const today = await api.getToday();
  $('date').textContent = capitalize(today.dateLabel);
  $('next').textContent = today.next;
  $('paused').checked = today.paused;

  let notice = '';
  if (!today.workday) notice = 'Hoy no es día laboral: no habrá avisos.';
  else if (today.paused) notice = 'Recordatorios en pausa hasta mañana.';
  else if (today.items.length === 0) notice = 'No hay marcajes activos. Actívalos en Ajustes.';
  $('notice').textContent = notice;
  $('notice').hidden = !notice;

  $('marks').replaceChildren(...today.items.map(markItem));
}

$('paused').addEventListener('change', (event) => api.setPaused(event.target.checked));

// ---------- Historial ----------

function historyDay(day) {
  const card = el('article', 'day-card');
  const head = el('header', 'day-card__head');
  const clocks = day.items.filter((i) => i.kind === 'clock');
  const done = clocks.filter((i) => i.markedAt).length;

  let summary = el('span', 'pill pill--muted', 'Día no laboral');
  if (day.workday) {
    const complete = done === clocks.length;
    summary = el('span', `pill ${complete ? 'pill--ok' : 'pill--warn'}`, `${done}/${clocks.length} marcajes`);
  }
  head.append(el('span', 'day-card__date', capitalize(day.dateLabel)), summary);
  card.append(head);

  const rows = el('ul', 'day-card__rows');
  for (const item of day.items) {
    const missing = item.kind === 'task' ? 'Sin enviar' : 'Sin marcar';
    const row = el('li', `hrow ${item.markedAt ? 'hrow--done' : 'hrow--missed'}`);
    row.append(
      el('span', 'hrow__time', item.time),
      el('span', 'hrow__label', item.label),
      el('span', 'hrow__result', item.markedAt ? item.markedText : missing),
    );
    rows.append(row);
  }
  card.append(rows);
  if (day.paused) card.append(el('p', 'day-card__note', 'Los recordatorios estuvieron en pausa este día.'));
  return card;
}

async function renderHistory() {
  const days = await api.getHistory();
  $('historyEmpty').hidden = days.length > 0;
  $('history').replaceChildren(...days.map(historyDay));
}

// ---------- Ajustes ----------

function buildSettings() {
  $('reminders').replaceChildren(
    ...config.reminders.map((r) => {
      const row = el('div', 'reminder-row');
      row.dataset.id = r.id;

      const enabled = el('input', 'switch');
      enabled.type = 'checkbox';
      enabled.dataset.field = 'enabled';
      enabled.setAttribute('aria-label', 'Activar aviso');

      const label = el('input', 'input');
      label.type = 'text';
      label.maxLength = 40;
      label.dataset.field = 'label';
      label.setAttribute('aria-label', 'Nombre del marcaje');

      const time = el('input', 'input input--time');
      time.type = 'time';
      time.required = true;
      time.dataset.field = 'time';
      time.setAttribute('aria-label', 'Hora');

      row.append(enabled, label, time);
      return row;
    }),
  );

  $('days').replaceChildren(
    ...DAYS.map(([day, short, name]) => {
      const chip = el('button', 'day', short);
      chip.type = 'button';
      chip.dataset.day = String(day);
      chip.title = capitalize(name);
      chip.setAttribute('aria-label', name);
      chip.addEventListener('click', () => {
        chip.setAttribute('aria-pressed', String(chip.getAttribute('aria-pressed') !== 'true'));
        save();
      });
      return chip;
    }),
  );
}

function fillSettings() {
  for (const r of config.reminders) {
    const row = document.querySelector(`.reminder-row[data-id="${r.id}"]`);
    row.querySelector('[data-field="enabled"]').checked = r.enabled;
    row.querySelector('[data-field="label"]').value = r.label;
    row.querySelector('[data-field="time"]').value = r.time;
    row.classList.toggle('reminder-row--off', !r.enabled);
  }
  for (const chip of $('days').children) {
    chip.setAttribute('aria-pressed', String(config.days.includes(Number(chip.dataset.day))));
  }
  $('reportEnabled').checked = config.report.enabled;
  $('reportMessage').value = config.report.message;
  $('reportFirst').value = config.report.firstMinutes;
  $('reportSecond').value = config.report.secondMinutes;
  document.querySelector('.report-row').classList.toggle('reminder-row--off', !config.report.enabled);
  $('snooze').value = config.snoozeMinutes;
  $('giveUp').value = config.giveUpMinutes;
  $('sound').checked = config.sound;
  $('openAtLogin').checked = config.openAtLogin;
  document.querySelector(`input[name="theme"][value="${config.theme}"]`).checked = true;
  document.querySelector(`input[name="alertStyle"][value="${config.alertStyle}"]`).checked = true;
}

function readSettings() {
  const field = (row, name) => row.querySelector(`[data-field="${name}"]`);
  // Un campo numérico vacío se envía como undefined para que vuelva a su valor por defecto.
  const num = (id) => ($(id).value === '' ? undefined : Number($(id).value));
  return {
    reminders: [...document.querySelectorAll('.reminder-row')].map((row) => ({
      id: row.dataset.id,
      enabled: field(row, 'enabled').checked,
      label: field(row, 'label').value,
      time: field(row, 'time').value,
    })),
    days: [...$('days').children]
      .filter((chip) => chip.getAttribute('aria-pressed') === 'true')
      .map((chip) => Number(chip.dataset.day)),
    report: {
      enabled: $('reportEnabled').checked,
      message: $('reportMessage').value,
      firstMinutes: num('reportFirst'),
      secondMinutes: num('reportSecond'),
    },
    snoozeMinutes: num('snooze'),
    giveUpMinutes: num('giveUp'),
    sound: $('sound').checked,
    alertStyle: document.querySelector('input[name="alertStyle"]:checked').value,
    openAtLogin: $('openAtLogin').checked,
    theme: document.querySelector('input[name="theme"]:checked').value,
  };
}

// Solo en macOS: avisa si el inicio automático espera la aprobación del usuario.
async function refreshLoginStatus() {
  const { needsApproval } = await api.getLoginStatus();
  $('loginApproval').hidden = !needsApproval;
}

$('openLoginItems').addEventListener('click', () => api.openLoginItems());
$('previewAlert').addEventListener('click', () => api.previewReminder());

// Guarda al momento; lo que no sea válido vuelve a su valor anterior o por defecto.
async function save() {
  config = await api.saveConfig(readSettings());
  fillSettings();
  refreshLoginStatus();
  $('saved').textContent = 'Cambios guardados';
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => {
    $('saved').textContent = '';
  }, 2000);
}

$('panel-settings').addEventListener('change', save);

// La configuración también se puede cambiar desde la bandeja (p. ej. "Iniciar con Windows").
async function syncConfig() {
  const fresh = await api.getConfig();
  const editing = $('panel-settings').contains(document.activeElement);
  if (!editing && JSON.stringify(fresh) !== JSON.stringify(config)) {
    config = fresh;
    fillSettings();
  }
}

async function init() {
  const info = await api.getInfo();
  $('loginLabel').textContent = info.loginItemLabel;
  $('loginRow').hidden = !info.supportsLoginItem;

  config = await api.getConfig();
  buildSettings();
  fillSettings();
  await renderToday();
  refreshLoginStatus();

  // El historial solo cambia al pasar de día; se recarga entonces o al abrir su pestaña.
  let shownDate = $('date').textContent;
  api.onChange(async () => {
    await renderToday();
    syncConfig();
    // Detecta cuando el usuario ya aprobó la app en Ajustes del Sistema.
    refreshLoginStatus();
    if ($('date').textContent !== shownDate) {
      shownDate = $('date').textContent;
      if (!$('panel-history').hidden) renderHistory();
    }
  });
}

init();
