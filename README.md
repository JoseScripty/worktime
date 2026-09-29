<p align="center">
  <img src="assets/icon.png" alt="Icono de WorkTime" width="112">
</p>

<h1 align="center">WorkTime</h1>

<p align="center">
  Recordatorios para marcar en el detector facial de la oficina.
</p>

<p align="center">
  <a href="https://github.com/JoseScripty/worktime/releases/latest"><strong>Descargar para Windows</strong></a>
  ·
  <a href="WorkTime-funcionalidades.pdf">Guía de funcionalidades (PDF)</a>
</p>

---

WorkTime es una aplicación de escritorio para Windows y macOS. Vive en la bandeja del sistema, te avisa a la hora
de cada marcaje y sigue insistiendo hasta que confirmas que ya pasaste por el detector.

## Funciones

- **Cuatro marcajes al día:** entrada (09:00), salida a almorzar (13:00), regreso (14:00) y salida (18:00), de lunes a viernes. Los nombres, las horas y los días se pueden cambiar.
- **Aviso emergente:** aparece encima de todo con un sonido corto y no te quita el foco. Tiene dos botones: *Ya marqué* y *Recordar en 5 min*.
- **Insiste hasta que marcas:** el aviso sigue activo hasta 90 minutos o hasta el siguiente marcaje. También salta al desbloquear la sesión o despertar el equipo.
- **Reporte diario:** *«RECUERDE ENVIAR EL REPORTE DIARIO»* 30 minutos antes de la salida y, si no lo confirmas, otra vez 15 minutos antes.
- **Historial:** la hora de cada marcaje de los últimos 60 días.
- **Menú en la bandeja:** muestra el próximo aviso y permite marcar o pausar el día sin abrir la ventana.
- **Personalización:** tema claro, oscuro o del sistema, e inicio automático con Windows (en macOS, al iniciar sesión).

## Instalación

1. Descarga el instalador desde [Releases](https://github.com/JoseScripty/worktime/releases/latest) y ábrelo.
2. El instalador no está firmado, así que Windows puede mostrar *«Windows protegió su PC»*. Pulsa **Más información → Ejecutar de todas formas**.
3. En **Ajustes**, activa **Iniciar con Windows** para que la app se abra sola cada vez que inicies sesión.

Cerrar la ventana no cierra la app: sigue en la bandeja. Para salir del todo, usa **Salir** en el menú de la bandeja.

## Desarrollo

Necesitas [Node.js](https://nodejs.org/). Se ha probado con la versión 24.

```bash
npm install        # dependencias
npm start          # abre la app
npm test           # pruebas de la lógica del horario, el reporte y el historial
npm run dist:win   # instalador de Windows en dist/
npm run dist:mac   # .dmg para macOS (hay que ejecutarlo en un Mac)
npm run icons      # regenera los iconos de assets/ y build/
```

Si `npm start` dice que Electron no se instaló bien, descarga de nuevo su binario con:

```bash
node node_modules/electron/install.js
```

### Estructura

| Ruta                      | Contenido                                                     |
| ------------------------- | ------------------------------------------------------------- |
| `main.js`                 | Proceso principal: bandeja, horario, ventanas e historial     |
| `preload.js`              | Funciones que la interfaz puede usar                          |
| `src/config.js`           | Configuración por defecto y validación                        |
| `src/schedule.js`         | Cálculo de avisos, reporte diario e historial (sin Electron)  |
| `src/store.js`            | Guardado en archivos JSON                                     |
| `renderer/`               | Ventana principal (Hoy, Historial, Ajustes) y aviso emergente |
| `test/`                   | Pruebas con `node --test`                                     |
| `scripts/make-icons.js`   | Genera los iconos sin dependencias                            |

Los datos del usuario se guardan en `%APPDATA%\WorkTime` en Windows y en `~/Library/Application Support/WorkTime` en macOS. Son tres archivos: `config.json`, `state.json` y `history.json`. La app no envía nada a internet.
