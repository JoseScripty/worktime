'use strict';

// Lógica del horario sin dependencias de Electron, para poder probarla con `npm test`.

const { REPORT_ID } = require('./config');

const MINUTE = 60 * 1000;

function dayKey(date) {
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${m}-${d}`;
}

function minutesOf(time) {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function atTime(day, time) {
  const [h, m] = time.split(':').map(Number);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m).getTime();
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function describeAgo(minutes) {
  if (minutes < 60) return `hace ${minutes} min`;
  const rest = minutes % 60;
  return `hace ${Math.floor(minutes / 60)} h${rest ? ` ${rest} min` : ''}`;
}

// El estado solo guarda el día en curso; al cambiar de fecha se empieza de cero.
function freshState(now) {
  return { date: dayKey(now), marked: {}, snoozedUntil: {}, paused: false };
}

function normalizeState(raw, now) {
  if (!raw || typeof raw !== 'object' || raw.date !== dayKey(now)) return freshState(now);
  const timestamps = (obj) =>
    Object.fromEntries(Object.entries(obj && typeof obj === 'object' ? obj : {}).filter(([, v]) => Number.isFinite(v)));
  return {
    date: raw.date,
    marked: timestamps(raw.marked),
    snoozedUntil: timestamps(raw.snoozedUntil),
    paused: raw.paused === true,
  };
}

function isWorkday(config, date) {
  return config.days.includes(date.getDay());
}

function activeReminders(config) {
  return config.reminders.filter((r) => r.enabled).sort((a, b) => minutesOf(a.time) - minutesOf(b.time));
}

//   upcoming → aún no es la hora · due → toca avisar · missed → pasó la ventana · done → confirmado
function withStatus(item, state, t) {
  const markedAt = state.marked[item.id] || null;
  let status;
  if (markedAt) status = 'done';
  else if (t < item.start) status = 'upcoming';
  else if (t < item.end) status = 'due';
  else status = 'missed';
  return { ...item, markedAt, status };
}

// Marcajes: la ventana de aviso dura giveUpMinutes, pero termina antes si llega la hora del siguiente.
function clockItems(config, now) {
  const list = activeReminders(config);
  return list.map((r, i) => {
    const start = atTime(now, r.time);
    let end = start + config.giveUpMinutes * MINUTE;
    const next = list[i + 1];
    if (next) {
      const nextStart = atTime(now, next.time);
      if (nextStart > start && nextStart < end) end = nextStart;
    }
    return { id: r.id, kind: 'clock', label: r.label, time: r.time, start, end, alerts: [start] };
  });
}

// Reporte diario: avisa firstMinutes antes de la salida y, si no se confirmó, otra vez secondMinutes antes.
function reportItem(config, now) {
  const { report } = config;
  const salida = config.reminders.find((r) => r.id === 'salida');
  if (!report.enabled || !salida) return null;
  const end = atTime(now, salida.time);
  const start = end - report.firstMinutes * MINUTE;
  const alerts = [start];
  if (report.secondMinutes > 0) alerts.push(end - report.secondMinutes * MINUTE);
  return {
    id: REPORT_ID,
    kind: 'task',
    label: 'Reporte diario',
    message: report.message,
    time: formatTime(start),
    until: salida.time,
    start,
    end,
    alerts,
  };
}

// Agenda del día ordenada por hora, con el estado de cada aviso.
function buildAgenda(config, state, now) {
  const t = now.getTime();
  const items = clockItems(config, now);
  const report = reportItem(config, now);
  if (report) items.push(report);
  return items.sort((a, b) => a.start - b.start).map((item) => withStatus(item, state, t));
}

// El aviso que hay que mostrar ahora mismo, o null. alertAt es el último aviso programado ya
// alcanzado: cuando cambia (p. ej. el segundo aviso del reporte), la ventana emergente se vuelve a abrir.
function pickDue(config, state, agenda, now) {
  if (state.paused || !isWorkday(config, now)) return null;
  const t = now.getTime();
  const item = agenda.find((i) => i.status === 'due' && !(state.snoozedUntil[i.id] > t));
  if (!item) return null;
  return { ...item, alertAt: Math.max(...item.alerts.filter((a) => a <= t)) };
}

// Hasta cuándo se silencia un aviso al pulsar "más tarde": los marcajes, snoozeMinutes;
// el reporte, hasta su siguiente aviso (o hasta la salida si ya no quedan).
function snoozeUntil(config, item, now) {
  const t = now.getTime();
  if (item.kind === 'task') return item.alerts.find((a) => a > t) ?? item.end;
  return t + config.snoozeMinutes * MINUTE;
}

// Próximo aviso pendiente, buscando hasta una semana hacia delante.
function nextReminder(config, state, now) {
  if (isWorkday(config, now) && !state.paused) {
    const item = buildAgenda(config, state, now).find((i) => i.status === 'upcoming');
    if (item) return { label: item.label, time: item.time, when: 'hoy' };
  }
  const first = activeReminders(config)[0];
  if (!first) return null;
  for (let offset = 1; offset <= 7; offset++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    if (isWorkday(config, day)) {
      const when = offset === 1 ? 'mañana' : day.toLocaleDateString('es-ES', { weekday: 'long' });
      return { label: first.label, time: first.time, when };
    }
  }
  return null;
}

function describeNext(config, state, now) {
  const next = nextReminder(config, state, now);
  return next ? `${next.label} · ${next.when} ${next.time}` : 'Sin recordatorios programados';
}

// ---------- Historial ----------

const HISTORY_DAYS = 60;
const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

function endOfDay(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d, 23, 59, 59);
}

// Resumen de un día terminado: qué avisos tocaban y a qué hora se confirmó cada uno.
// Devuelve null para los días no laborables en los que no se marcó nada.
function archiveDay(config, rawState) {
  if (!rawState || !DAY_KEY_RE.test(rawState.date)) return null;
  const day = endOfDay(rawState.date);
  const state = normalizeState(rawState, day);
  const items = buildAgenda(config, state, day).map(({ id, kind, label, time, markedAt }) => ({
    id,
    kind,
    label,
    time,
    markedAt,
  }));
  const workday = isWorkday(config, day);
  if (!workday && !items.some((i) => i.markedAt)) return null;
  return { workday, paused: state.paused, items };
}

// Conserva solo los últimos HISTORY_DAYS días anteriores a hoy.
function pruneHistory(history, now) {
  if (!history || typeof history !== 'object') return {};
  const today = dayKey(now);
  const oldest = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - HISTORY_DAYS));
  return Object.fromEntries(
    Object.entries(history)
      .filter(([date, entry]) => DAY_KEY_RE.test(date) && date >= oldest && date < today && entry)
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}

module.exports = {
  MINUTE,
  dayKey,
  formatTime,
  describeAgo,
  freshState,
  normalizeState,
  isWorkday,
  buildAgenda,
  pickDue,
  snoozeUntil,
  nextReminder,
  describeNext,
  HISTORY_DAYS,
  endOfDay,
  archiveDay,
  pruneHistory,
};
