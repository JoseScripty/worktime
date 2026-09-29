'use strict';

const fs = require('fs');
const path = require('path');

// Archivos JSON en la carpeta de datos del usuario (%APPDATA%\WorkTime en Windows).
function createStore(dir) {
  const fileFor = (name) => path.join(dir, name);

  function read(name, fallback) {
    try {
      return JSON.parse(fs.readFileSync(fileFor(name), 'utf8'));
    } catch {
      return fallback;
    }
  }

  // Escribe en un archivo temporal y lo renombra, para no dejar un JSON a medias si la app se cierra.
  function write(name, data) {
    fs.mkdirSync(dir, { recursive: true });
    const file = fileFor(name);
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file);
  }

  return { read, write };
}

module.exports = { createStore };
