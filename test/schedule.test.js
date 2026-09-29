'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeConfig } = require('../src/config');
const s = require('../src/schedule');

const config = sanitizeConfig(null);
// 28/09/2026 es lunes.
const monday = (h, m = 0) => new Date(2026, 8, 28, h, m);

function dueId(now, state = s.freshState(now), cfg = config) {
  const item = s.pickDue(cfg, state, s.buildAgenda(cfg, state, now), now);
  return item ? item.id : null;
}

function statuses(now, state = s.freshState(now)) {
  return Object.fromEntries(s.buildAgenda(config, state, now).map((i) => [i.id, i.status]));
}

test('antes de la hora no avisa y anuncia el próximo marcaje', () => {
  const now = monday(8, 30);
  assert.equal(dueId(now), null);
  assert.equal(statuses(now).entrada, 'upcoming');
  assert.equal(s.describeNext(config, s.freshState(now), now), 'Entrada · hoy 09:00');
});

test('avisa a la hora y sigue avisando hasta pasados giveUpMinutes', () => {
  assert.equal(dueId(monday(9, 0)), 'entrada');
  assert.equal(dueId(monday(10, 29)), 'entrada');
  assert.equal(dueId(monday(10, 30)), null);
  assert.equal(statuses(monday(10, 30)).entrada, 'missed');
});

test('la ventana termina cuando llega el siguiente marcaje', () => {
  assert.equal(dueId(monday(13, 59)), 'almuerzo');
  assert.equal(dueId(monday(14, 0)), 'regreso');
  assert.equal(statuses(monday(14, 0)).almuerzo, 'missed');
});

test('posponer silencia el aviso solo durante snoozeMinutes', () => {
  const now = monday(9, 5);
  const state = s.freshState(now);
  state.snoozedUntil.entrada = now.getTime() + config.snoozeMinutes * s.MINUTE;
  assert.equal(dueId(monday(9, 7), state), null);
  assert.equal(dueId(monday(9, 10), state), 'entrada');
});

test('marcar, incluso antes de la hora, evita el aviso', () => {
  const state = s.freshState(monday(8, 50));
  state.marked.entrada = monday(8, 50).getTime();
  assert.equal(dueId(monday(9, 0), state), null);
  assert.equal(statuses(monday(9, 0), state).entrada, 'done');
  assert.equal(s.describeNext(config, state, monday(9, 0)), 'Salida a almorzar · hoy 13:00');
});

test('no avisa en pausa ni en días no laborables', () => {
  const paused = { ...s.freshState(monday(9, 0)), paused: true };
  assert.equal(dueId(monday(9, 0), paused), null);
  assert.equal(s.describeNext(config, paused, monday(9, 0)), 'Entrada · mañana 09:00');

  const saturday = new Date(2026, 9, 3, 9, 0);
  assert.equal(dueId(saturday), null);
  assert.equal(s.describeNext(config, s.freshState(saturday), saturday), 'Entrada · lunes 09:00');
});

test('los marcajes desactivados no aparecen', () => {
  const cfg = sanitizeConfig({ reminders: [{ id: 'almuerzo', enabled: false }, { id: 'regreso', enabled: false }] });
  const now = monday(13, 30);
  assert.deepEqual(
    s.buildAgenda(cfg, s.freshState(now), now).map((i) => i.id),
    ['entrada', 'reporte', 'salida'],
  );
  assert.equal(dueId(now, s.freshState(now), cfg), null);
});

test('el orden en pantalla es fijo aunque cambien las horas', () => {
  // Salida a almorzar antes que la entrada y salida a media mañana: el orden no cambia.
  const cfg = sanitizeConfig({ reminders: [{ id: 'almuerzo', time: '08:00' }, { id: 'salida', time: '10:00' }] });
  const now = monday(8, 5);
  const state = s.freshState(now);
  assert.deepEqual(
    s.buildAgenda(cfg, state, now).map((i) => i.id),
    ['entrada', 'almuerzo', 'regreso', 'reporte', 'salida'],
  );
  // Los avisos siguen yendo por hora: toca el de las 08:00 y el próximo es la entrada de las 09:00.
  assert.equal(dueId(now, state, cfg), 'almuerzo');
  assert.equal(s.describeNext(cfg, state, now), 'Entrada · hoy 09:00');
  // A las 09:40 coinciden la entrada (09:00) y el reporte (09:30): primero la entrada.
  assert.equal(dueId(monday(9, 40), state, cfg), 'entrada');
});

test('sortForDisplay ordena también días guardados con otro orden', () => {
  const ids = ['salida', 'reporte', 'entrada', 'regreso', 'almuerzo'].map((id) => ({ id }));
  assert.deepEqual(s.sortForDisplay(ids).map((i) => i.id), ['entrada', 'almuerzo', 'regreso', 'reporte', 'salida']);
});

test('el estado guardado de otro día se descarta', () => {
  const now = monday(9, 0);
  const old = { date: '2026-09-27', marked: { entrada: 1 }, snoozedUntil: {}, paused: true };
  assert.deepEqual(s.normalizeState(old, now), s.freshState(now));

  const today = { date: '2026-09-28', marked: { entrada: 5, salida: 'x' }, paused: 'si' };
  assert.deepEqual(s.normalizeState(today, now), {
    date: '2026-09-28',
    marked: { entrada: 5 },
    snoozedUntil: {},
    paused: false,
  });
});

test('sanitizeConfig corrige valores inválidos', () => {
  const cfg = sanitizeConfig({
    reminders: [{ id: 'entrada', label: '  Llegada  ', time: '25:00' }, { id: 'desconocido', time: '10:00' }],
    days: [1, 1, 7, 3, 'x'],
    snoozeMinutes: 0,
    giveUpMinutes: 'mucho',
    sound: 'no',
  });
  assert.deepEqual(cfg.reminders[0], { id: 'entrada', label: 'Llegada', time: '09:00', enabled: true });
  assert.equal(cfg.reminders.length, 4);
  assert.deepEqual(cfg.days, [1, 3]);
  assert.equal(cfg.snoozeMinutes, 1);
  assert.equal(cfg.giveUpMinutes, 90);
  assert.equal(cfg.sound, true);
});

// ---------- Reporte diario ----------

function due(now, state = s.freshState(now), cfg = config) {
  return s.pickDue(cfg, state, s.buildAgenda(cfg, state, now), now);
}

test('el reporte avisa 30 min antes de la salida y otra vez 15 min antes', () => {
  assert.equal(dueId(monday(17, 29)), null);
  assert.equal(due(monday(17, 30)).id, 'reporte');
  assert.equal(due(monday(17, 30)).alertAt, monday(17, 30).getTime());
  // El segundo aviso cambia alertAt: la ventana emergente se vuelve a abrir.
  assert.equal(due(monday(17, 50)).alertAt, monday(17, 45).getTime());
  // A la hora de salida el reporte queda sin enviar y toca marcar la salida.
  assert.equal(dueId(monday(18, 0)), 'salida');
  assert.equal(statuses(monday(18, 0)).reporte, 'missed');
});

test('"más tarde" en el reporte espera al segundo aviso, y tras él ya no insiste', () => {
  const item = due(monday(17, 32));
  assert.equal(s.snoozeUntil(config, item, monday(17, 32)), monday(17, 45).getTime());
  assert.equal(s.snoozeUntil(config, due(monday(17, 46)), monday(17, 46)), monday(18, 0).getTime());

  const state = s.freshState(monday(17, 46));
  state.snoozedUntil.reporte = monday(18, 0).getTime();
  assert.equal(dueId(monday(17, 59), state), null);
});

test('si ya se envió el reporte no vuelve a avisar', () => {
  const state = s.freshState(monday(17, 0));
  state.marked.reporte = monday(17, 10).getTime();
  assert.equal(dueId(monday(17, 45), state), null);
  assert.equal(statuses(monday(17, 45), state).reporte, 'done');
});

test('el reporte sigue a la hora de salida y admite un solo aviso', () => {
  const cfg = sanitizeConfig({
    reminders: [{ id: 'salida', time: '17:00' }],
    report: { secondMinutes: 0 },
  });
  const item = s.buildAgenda(cfg, s.freshState(monday(8)), monday(8)).find((i) => i.id === 'reporte');
  assert.equal(item.time, '16:30');
  assert.deepEqual(item.alerts, [monday(16, 30).getTime()]);
  assert.equal(s.snoozeUntil(cfg, item, monday(16, 31)), monday(17, 0).getTime());
});

test('el reporte desactivado no aparece', () => {
  const cfg = sanitizeConfig({ report: { enabled: false } });
  assert.ok(!s.buildAgenda(cfg, s.freshState(monday(17, 40)), monday(17, 40)).some((i) => i.id === 'reporte'));
});

test('sanitizeConfig valida el reporte y el tema', () => {
  const cfg = sanitizeConfig({ report: { message: '   ', firstMinutes: 20, secondMinutes: 40 }, theme: 'rosa' });
  assert.equal(cfg.report.message, 'RECUERDE ENVIAR EL REPORTE DIARIO');
  assert.equal(cfg.report.firstMinutes, 20);
  assert.equal(cfg.report.secondMinutes, 19);
  assert.equal(cfg.theme, 'system');
  assert.equal(sanitizeConfig({ theme: 'dark' }).theme, 'dark');
  // Si el primer aviso baja por debajo del segundo por defecto, el segundo se ajusta.
  assert.equal(sanitizeConfig({ report: { firstMinutes: 10 } }).report.secondMinutes, 9);
});

// ---------- Historial ----------

test('archiveDay guarda qué tocaba cada día y a qué hora se confirmó', () => {
  const state = { date: '2026-09-28', marked: { entrada: monday(8, 57).getTime() }, snoozedUntil: {}, paused: false };
  const entry = s.archiveDay(config, state);
  assert.equal(entry.workday, true);
  assert.deepEqual(
    entry.items.map((i) => [i.id, i.time, i.markedAt]),
    [
      ['entrada', '09:00', monday(8, 57).getTime()],
      ['almuerzo', '13:00', null],
      ['regreso', '14:00', null],
      ['reporte', '17:30', null],
      ['salida', '18:00', null],
    ],
  );
  // Sábado sin marcas: no se guarda. Estado dañado: tampoco.
  assert.equal(s.archiveDay(config, { date: '2026-10-03', marked: {} }), null);
  assert.equal(s.archiveDay(config, { date: 'ayer' }), null);
});

test('pruneHistory conserva solo los 60 días anteriores a hoy', () => {
  const now = monday(10);
  const history = {
    '2026-07-29': { items: [] }, // hace 61 días
    '2026-07-30': { items: [] }, // hace 60 días
    '2026-09-27': { items: [] },
    '2026-09-28': { items: [] }, // hoy: todavía no es historial
    basura: { items: [] },
  };
  assert.deepEqual(Object.keys(s.pruneHistory(history, now)), ['2026-07-30', '2026-09-27']);
  assert.deepEqual(s.pruneHistory(null, now), {});
});
