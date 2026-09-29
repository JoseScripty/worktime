'use strict';

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const REPORT_ID = 'reporte';

const DEFAULT_CONFIG = {
  reminders: [
    { id: 'entrada', label: 'Entrada', time: '09:00', enabled: true },
    { id: 'almuerzo', label: 'Salida a almorzar', time: '13:00', enabled: true },
    { id: 'regreso', label: 'Regreso del almuerzo', time: '14:00', enabled: true },
    { id: 'salida', label: 'Salida', time: '18:00', enabled: true },
  ],
  // Aviso antes de la hora de salida para enviar el reporte diario.
  report: {
    enabled: true,
    message: 'RECUERDE ENVIAR EL REPORTE DIARIO',
    firstMinutes: 30, // primer aviso: minutos antes de la salida
    secondMinutes: 15, // segundo aviso si aún no lo envió; 0 = sin segundo aviso
  },
  // 0 = domingo … 6 = sábado (igual que Date#getDay)
  days: [1, 2, 3, 4, 5],
  // Al pulsar "Recordar más tarde", el aviso vuelve tras estos minutos.
  snoozeMinutes: 5,
  // Si no marcas, el aviso se retira pasado este tiempo (o al llegar el siguiente marcaje).
  giveUpMinutes: 90,
  sound: true,
  // 'small': ventana pequeña en la esquina · 'large': aviso grande que ocupa toda la pantalla.
  alertStyle: 'small',
  openAtLogin: false,
  theme: 'system', // 'system' | 'light' | 'dark'
};

const THEMES = ['system', 'light', 'dark'];
const ALERT_STYLES = ['small', 'large'];

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

// Devuelve siempre una configuración válida: rellena lo que falte con los valores
// por defecto y descarta lo que no tenga el formato esperado.
function sanitizeConfig(raw) {
  const config = structuredClone(DEFAULT_CONFIG);
  if (!raw || typeof raw !== 'object') return config;

  const saved = new Map(
    (Array.isArray(raw.reminders) ? raw.reminders : [])
      .filter((r) => r && typeof r === 'object')
      .map((r) => [r.id, r]),
  );
  config.reminders = config.reminders.map((def) => {
    const r = saved.get(def.id) || {};
    const label = typeof r.label === 'string' ? r.label.trim().slice(0, 40) : '';
    return {
      id: def.id,
      label: label || def.label,
      time: TIME_RE.test(r.time) ? r.time : def.time,
      enabled: typeof r.enabled === 'boolean' ? r.enabled : def.enabled,
    };
  });

  const report = raw.report && typeof raw.report === 'object' ? raw.report : {};
  const message = typeof report.message === 'string' ? report.message.trim().slice(0, 60) : '';
  if (message) config.report.message = message;
  if (typeof report.enabled === 'boolean') config.report.enabled = report.enabled;
  config.report.firstMinutes = clampInt(report.firstMinutes, 5, 180, config.report.firstMinutes);
  // El segundo aviso siempre va después del primero.
  const maxSecond = config.report.firstMinutes - 1;
  config.report.secondMinutes = clampInt(
    report.secondMinutes,
    0,
    maxSecond,
    Math.min(config.report.secondMinutes, maxSecond),
  );

  if (Array.isArray(raw.days)) {
    config.days = [...new Set(raw.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort(
      (a, b) => a - b,
    );
  }
  config.snoozeMinutes = clampInt(raw.snoozeMinutes, 1, 60, config.snoozeMinutes);
  config.giveUpMinutes = clampInt(raw.giveUpMinutes, 5, 240, config.giveUpMinutes);
  if (typeof raw.sound === 'boolean') config.sound = raw.sound;
  if (typeof raw.openAtLogin === 'boolean') config.openAtLogin = raw.openAtLogin;
  if (THEMES.includes(raw.theme)) config.theme = raw.theme;
  if (ALERT_STYLES.includes(raw.alertStyle)) config.alertStyle = raw.alertStyle;
  return config;
}

module.exports = { DEFAULT_CONFIG, REPORT_ID, TIME_RE, sanitizeConfig };
