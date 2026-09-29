'use strict';

const path = require('path');
const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  ipcMain,
  nativeImage,
  nativeTheme,
  powerMonitor,
  screen,
  shell,
} = require('electron');
const { REPORT_ID, sanitizeConfig } = require('./src/config');
const { createStore } = require('./src/store');
const schedule = require('./src/schedule');

const TICK_MS = 15 * 1000;
const isMac = process.platform === 'darwin';
const supportsLoginItem = process.platform === 'win32' || isMac;
const loginItemLabel = isMac ? 'Abrir al iniciar sesión' : 'Iniciar con Windows';

let store;
let config;
let state;
let tray = null;
let trayMenuKey = '';
let mainWindow = null;
let reminderWindow = null;
let reminderId = null;
let reminderAlertAt = null;
let quitting = false;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showMain);
  app.whenReady().then(start);
}

function start() {
  if (process.platform === 'win32') app.setAppUserModelId('com.worktime.marcaje');

  store = createStore(app.getPath('userData'));
  config = sanitizeConfig(store.read('config.json', null));
  const saved = store.read('state.json', null);
  state = schedule.normalizeState(saved, new Date());
  // Si la app estuvo cerrada al cambiar de día, el último día usado pasa al historial ahora.
  if (saved && saved.date !== state.date) {
    archiveDay(saved);
    saveState();
  }
  if (config.openAtLogin) applyLoginItem();
  nativeTheme.themeSource = config.theme;
  nativeTheme.on('updated', () => {
    for (const win of BrowserWindow.getAllWindows()) win.setBackgroundColor(backgroundColor());
  });

  createTray();
  registerIpc();

  powerMonitor.on('resume', tick);
  powerMonitor.on('unlock-screen', tick);
  setInterval(tick, TICK_MS);
  tick();

  const openedAtLogin =
    process.argv.includes('--hidden') || (isMac && app.getLoginItemSettings().wasOpenedAtLogin);
  if (!openedAtLogin) showMain();
}

app.on('before-quit', () => {
  quitting = true;
});

// La app vive en la bandeja: cerrar las ventanas no la termina.
app.on('window-all-closed', () => {});

app.on('activate', showMain);

// ---------- Estado ----------

function saveState() {
  store.write('state.json', state);
}

function readHistory() {
  return schedule.pruneHistory(store.read('history.json', {}), new Date());
}

function archiveDay(dayState) {
  const history = readHistory();
  const entry = schedule.archiveDay(config, dayState);
  if (entry) history[dayState.date] = entry;
  store.write('history.json', schedule.pruneHistory(history, new Date()));
}

function historyView() {
  return Object.entries(readHistory())
    .reverse()
    .map(([date, entry]) => ({
      date,
      dateLabel: schedule
        .endOfDay(date)
        .toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }),
      workday: entry.workday,
      paused: entry.paused,
      items: schedule.sortForDisplay(entry.items || []).map((item) => ({
        ...item,
        markedText: item.markedAt ? schedule.formatTime(item.markedAt) : null,
      })),
    }));
}

function updateConfig(patch) {
  const before = config;
  config = sanitizeConfig({ ...config, ...patch });
  store.write('config.json', config);
  if (config.openAtLogin !== before.openAtLogin) applyLoginItem();
  if (config.theme !== before.theme) nativeTheme.themeSource = config.theme;
  tick();
  return config;
}

function isKnownId(id) {
  return id === REPORT_ID || config.reminders.some((r) => r.id === id);
}

function setMarked(id, done) {
  if (!isKnownId(id)) return;
  if (done) state.marked[id] = Date.now();
  else delete state.marked[id];
  delete state.snoozedUntil[id];
  saveState();
  tick();
}

function snooze(id) {
  const now = new Date();
  const item = schedule.buildAgenda(config, state, now).find((i) => i.id === id);
  if (!item) return;
  state.snoozedUntil[id] = schedule.snoozeUntil(config, item, now);
  saveState();
  tick();
}

function setPaused(paused) {
  state.paused = Boolean(paused);
  saveState();
  tick();
}

function applyLoginItem() {
  if (!supportsLoginItem) return;
  // En desarrollo (`npm start`) hay que pasarle a electron.exe la carpeta de la app.
  const args = app.isPackaged ? ['--hidden'] : [app.getAppPath(), '--hidden'];
  app.setLoginItemSettings({ openAtLogin: config.openAtLogin, path: process.execPath, args });
}

// En macOS 13+ el sistema puede dejar el inicio automático pendiente de que el usuario lo apruebe
// en Ajustes del Sistema → General → Ítems de inicio.
function loginItemNeedsApproval() {
  return isMac && config.openAtLogin && app.getLoginItemSettings().status === 'requires-approval';
}

function openLoginItemsSettings() {
  if (isMac) shell.openExternal('x-apple.systempreferences:com.apple.LoginItems-Settings.extension');
}

function todayView(now = new Date()) {
  return {
    dateLabel: now.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }),
    workday: schedule.isWorkday(config, now),
    paused: state.paused,
    next: schedule.describeNext(config, state, now),
    items: schedule.buildAgenda(config, state, now).map((item) => ({
      ...item,
      markedText: item.markedAt ? schedule.formatTime(item.markedAt) : null,
    })),
  };
}

// Se ejecuta cada 15 s, al despertar el equipo y al desbloquear la sesión.
function tick() {
  const now = new Date();
  if (state.date !== schedule.dayKey(now)) {
    archiveDay(state);
    state = schedule.freshState(now);
    saveState();
  }

  const agenda = schedule.buildAgenda(config, state, now);
  const due = schedule.pickDue(config, state, agenda, now);
  if (!due) closeReminder();
  else if (due.id !== reminderId || due.alertAt !== reminderAlertAt) openReminder(due);

  refreshTray(agenda, due, now);
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('state:changed');
}

// ---------- Ventanas ----------

const webPreferences = {
  preload: path.join(__dirname, 'preload.js'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
};

function backgroundColor() {
  return nativeTheme.shouldUseDarkColors ? '#17161d' : '#f6f6fb';
}

function showMain() {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    return;
  }
  mainWindow = new BrowserWindow({
    width: 460,
    height: 700,
    minWidth: 400,
    minHeight: 560,
    show: false,
    title: 'WorkTime',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    backgroundColor: backgroundColor(),
    webPreferences,
  });
  if (!isMac) mainWindow.removeMenu();
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    mainWindow.hide();
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function openReminder(item) {
  closeReminder();
  const width = 380;
  const height = item.kind === 'task' ? 200 : 176;
  const { workArea } = screen.getPrimaryDisplay();
  const win = new BrowserWindow({
    width,
    height,
    x: workArea.x + workArea.width - width - 16,
    y: workArea.y + workArea.height - height - 16,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    title: 'WorkTime',
    backgroundColor: backgroundColor(),
    webPreferences: { ...webPreferences, autoplayPolicy: 'no-user-gesture-required' },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  if (isMac) win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadFile(path.join(__dirname, 'renderer', 'reminder.html'));
  // showInactive: el aviso aparece encima de todo sin quitarte el foco de lo que estés escribiendo.
  win.once('ready-to-show', () => win.showInactive());
  win.on('closed', () => {
    if (reminderWindow !== win) return;
    reminderWindow = null;
    reminderId = null;
    reminderAlertAt = null;
  });
  reminderWindow = win;
  reminderId = item.id;
  reminderAlertAt = item.alertAt;
}

function closeReminder() {
  if (!reminderWindow) return;
  const win = reminderWindow;
  reminderWindow = null;
  reminderId = null;
  reminderAlertAt = null;
  win.destroy();
}

// Textos del aviso emergente según sea un marcaje o el reporte diario.
function reminderView() {
  const now = new Date();
  const t = now.getTime();
  const item = schedule.buildAgenda(config, state, now).find((i) => i.id === reminderId);
  if (!item) return null;

  if (item.kind === 'task') {
    const next = item.alerts.find((a) => a > t);
    const isSecond = item.alerts.length > 1 && t >= item.alerts[1];
    return {
      id: item.id,
      eyebrow: item.label,
      title: item.message,
      sub: isSecond ? `Segundo aviso · la salida es a las ${item.until}` : `Antes de la salida de las ${item.until}`,
      doneLabel: 'Ya lo envié',
      laterLabel: next ? `Recordar a las ${schedule.formatTime(next)}` : 'Cerrar',
      sound: config.sound,
    };
  }

  const late = Math.floor((t - item.start) / schedule.MINUTE);
  return {
    id: item.id,
    eyebrow: 'Hora de marcar',
    title: item.label,
    sub:
      late >= 2
        ? `Programado a las ${item.time} · ${schedule.describeAgo(late)}`
        : `${item.time} · Pasa por el detector facial`,
    doneLabel: 'Ya marqué',
    laterLabel: `Recordar en ${config.snoozeMinutes} min`,
    sound: config.sound,
  };
}

// ---------- Bandeja ----------

function createTray() {
  const icon = nativeImage.createFromPath(
    path.join(__dirname, 'assets', isMac ? 'trayTemplate.png' : 'tray.png'),
  );
  if (isMac) icon.setTemplateImage(true);
  tray = new Tray(icon);
  // En Windows el clic izquierdo abre la ventana y el derecho el menú; en macOS el clic abre el menú.
  tray.on('click', () => {
    if (!isMac) showMain();
  });
}

function refreshTray(agenda, due, now) {
  const workday = schedule.isWorkday(config, now);
  let headline = `Próximo: ${schedule.describeNext(config, state, now)}`;
  if (due?.kind === 'clock') headline = `Toca marcar: ${due.label} (${due.time})`;
  if (due?.kind === 'task') headline = `Pendiente: ${due.label} (antes de las ${due.until})`;

  const items = [{ label: headline, enabled: false }, { type: 'separator' }];
  if (!workday) items.push({ label: 'Hoy no es día laboral', enabled: false });
  for (const item of agenda) {
    const verb = item.kind === 'task' ? 'enviado' : 'marcado';
    const marked = item.markedAt ? ` · ${verb} ${schedule.formatTime(item.markedAt)}` : '';
    items.push({
      label: `${item.time}  ${item.label}${marked}`,
      type: 'checkbox',
      checked: Boolean(item.markedAt),
      click: () => setMarked(item.id, !item.markedAt),
    });
  }
  items.push(
    { type: 'separator' },
    { label: 'Abrir WorkTime', click: showMain },
    {
      label: 'Pausar recordatorios hoy',
      type: 'checkbox',
      checked: state.paused,
      click: (menuItem) => setPaused(menuItem.checked),
    },
  );
  if (supportsLoginItem) {
    items.push({
      label: loginItemLabel,
      type: 'checkbox',
      checked: config.openAtLogin,
      click: (menuItem) => updateConfig({ openAtLogin: menuItem.checked }),
    });
  }
  items.push({ type: 'separator' }, { label: 'Salir', click: () => app.quit() });

  tray.setToolTip(`WorkTime\n${headline}`);
  // Solo se reconstruye el menú si cambió algo, para no cerrarlo mientras está abierto.
  const key = JSON.stringify(items.map((i) => [i.label, i.checked]));
  if (key !== trayMenuKey) {
    trayMenuKey = key;
    tray.setContextMenu(Menu.buildFromTemplate(items));
  }
}

// ---------- IPC ----------

function registerIpc() {
  ipcMain.handle('app:info', () => ({ platform: process.platform, loginItemLabel, supportsLoginItem }));
  ipcMain.handle('login:status', () => ({ needsApproval: loginItemNeedsApproval() }));
  ipcMain.handle('login:open-settings', () => openLoginItemsSettings());
  ipcMain.handle('config:get', () => config);
  ipcMain.handle('config:save', (_event, patch) => updateConfig(patch));
  ipcMain.handle('today:get', () => todayView());
  ipcMain.handle('history:get', () => historyView());
  ipcMain.handle('mark:set', (_event, id, done) => setMarked(id, done));
  ipcMain.handle('pause:set', (_event, paused) => setPaused(paused));
  ipcMain.handle('reminder:get', () => reminderView());
  ipcMain.handle('reminder:snooze', (_event, id) => snooze(id));
}
