// IsO — obra interactiva: la imagen pierde resolución al mover el cursor.
//
// Cómo funciona, en tres pasos:
//   1. Al cargar se generan varias versiones de la imagen (de nítida a muy comprimida).
//   2. Un "motor" muestra una o dos capas a la vez según un valor de 0 (nítida) a 1 (rota).
//   3. El puntero sube ese valor y no baja: la imagen queda rota hasta que recargues la página.
//   4. Pasado cierto desgaste se pueden arrancar pedazos; al arrancar el primero,
//      la degradación se congela y la imagen queda así hasta que recargues.
//   5. Cada pedazo deja un hueco, y por los huecos se ve lo que hay detrás de la
//      imagen: tres íconos con su nombre debajo.
//   6. Dos de esos íconos abren una ventana con un texto, y el tercero una con una imagen.

// ─────────────────────────────────────────────────────────────
// 1. Configuración: lo único que hace falta tocar
// ─────────────────────────────────────────────────────────────

const CONFIG = {
  imageSrc: 'imagenes/inicioMain.JPG',
  levels: 16,             // cantidad de versiones (16 = la original + 15 comprimidas)
  minScale: 0.035,        // tamaño de la última versión (3,5 % del ancho del escenario)
  maxRenderPx: 2400,      // techo de resolución al generarlas, en píxeles
  startQuality: 0.85,     // calidad JPEG de la primera versión comprimida
  endQuality: 0.03,       // calidad JPEG de la última
  degradePerPx: 1 / 3200, // cuánto suma cada píxel que recorre el puntero (1 = cruzar la pantalla)
  holdPerSecond: 0.035,   // cuánto suma por segundo si el puntero se queda quieto encima
  tearFrom: 0.6,          // desgaste (0 a 1) a partir del cual se pueden arrancar pedazos
};

// ─────────────────────────────────────────────────────────────
// 2. Elementos de la página
// ─────────────────────────────────────────────────────────────

const stage = document.querySelector('#stage');
const layersEl = document.querySelector('#layers');
const baseImg = layersEl ? layersEl.querySelector('.layer--base') : null;
const loading = document.querySelector('#loading');
const errorBox = document.querySelector('#error');
const hud = document.querySelector('#hud');
const revealEl = document.querySelector('#reveal');
const piecesEl = document.querySelector('#pieces');
const windowsEl = document.querySelector('#windows');
const debug = new URLSearchParams(location.search).has('debug');

// ─────────────────────────────────────────────────────────────
// 3. Utilidades
// ─────────────────────────────────────────────────────────────

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function lerp(from, to, amount) {
  return from + (to - from) * amount;
}

// ─────────────────────────────────────────────────────────────
// 4. Generación de las versiones de la imagen
// ─────────────────────────────────────────────────────────────

// Dibuja la imagen en un canvas, achicándola de a mitades para que no salga sucia.
function drawSource(context, source, width, height) {
  let current = source;
  let currentWidth = source.naturalWidth;
  let currentHeight = source.naturalHeight;

  while (currentWidth > width * 2 || currentHeight > height * 2) {
    const step = document.createElement('canvas');
    step.width = Math.max(width, Math.round(currentWidth / 2));
    step.height = Math.max(height, Math.round(currentHeight / 2));
    const stepContext = step.getContext('2d');
    stepContext.imageSmoothingQuality = 'high';
    stepContext.drawImage(current, 0, 0, step.width, step.height);
    current = step;
    currentWidth = step.width;
    currentHeight = step.height;
  }

  context.imageSmoothingQuality = 'high';
  context.drawImage(current, 0, 0, width, height);
}

// Convierte un canvas en una imagen JPEG y devuelve su dirección (blob URL).
function encodeCanvas(canvas, quality) {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(URL.createObjectURL(blob));
        } else {
          reject(new Error('No se pudo codificar la versión de la imagen.'));
        }
      }, 'image/jpeg', quality);
    } catch (error) {
      // Pasa cuando la página se abre como archivo (file://): el navegador no deja leer el canvas.
      reject(error);
    }
  });
}

// Crea las versiones comprimidas. La capa 0 es siempre la imagen original.
async function buildLevels(rect) {
  const displayWidth = Math.max(1, Math.round(rect.width));
  const displayHeight = Math.max(1, Math.round(rect.height));
  const cap = Math.min(1, CONFIG.maxRenderPx / Math.max(displayWidth, displayHeight));
  const renderWidth = Math.max(1, Math.round(displayWidth * cap));
  const renderHeight = Math.max(1, Math.round(displayHeight * cap));
  const count = Math.max(2, Math.floor(CONFIG.levels));

  const layers = [{ element: baseImg }];
  const urls = [];

  try {
    for (let index = 1; index < count; index += 1) {
      // De 0 a 1: cuánto avanza dentro de la serie (0 = casi nítida, 1 = la más rota).
      const progress = index / (count - 1);
      const scale = Math.exp(lerp(Math.log(0.92), Math.log(CONFIG.minScale), progress));
      const quality = clamp(lerp(CONFIG.startQuality, CONFIG.endQuality, progress ** 1.5), 0.01, 1);

      const canvas = document.createElement('canvas');
      canvas.width = Math.max(8, Math.round(renderWidth * scale));
      canvas.height = Math.max(8, Math.round(renderHeight * scale));
      drawSource(canvas.getContext('2d'), baseImg, canvas.width, canvas.height);

      const url = await encodeCanvas(canvas, quality);
      urls.push(url);

      const element = document.createElement('img');
      element.className = 'layer layer--pixelated';
      element.alt = '';
      element.draggable = false;
      element.src = url;
      element.decode().catch(() => {});

      layers.push({ element });

      // Deja respirar al navegador entre una versión y la siguiente.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  } catch (error) {
    urls.forEach((url) => URL.revokeObjectURL(url));
    throw error;
  }

  return {
    layers,
    destroy() {
      layers.slice(1).forEach((layer) => layer.element.remove());
      urls.forEach((url) => URL.revokeObjectURL(url));
    },
  };
}

// ─────────────────────────────────────────────────────────────
// 5. Motor: cruce entre dos capas contiguas
// ─────────────────────────────────────────────────────────────

function createEngine(layers, initialValue = 0, onChange) {
  const maxIndex = layers.length - 1;
  const painted = new Array(layers.length).fill(-1);
  let value = clamp(initialValue);

  function apply() {
    const position = value * maxIndex;
    const lower = Math.floor(position);
    const blend = position - lower;

    layers.forEach((layer, index) => {
      let opacity = 0;

      if (index === lower) {
        opacity = 1;
      } else if (index === lower + 1) {
        opacity = blend;
      }

      if (Math.abs(opacity - painted[index]) < 0.001) {
        return;
      }

      layer.element.style.opacity = String(opacity);
      layer.element.style.visibility = opacity > 0 ? 'visible' : 'hidden';
      painted[index] = opacity;
    });
  }

  function setValue(next) {
    const clamped = clamp(Number(next));

    if (!Number.isFinite(clamped) || Math.abs(clamped - value) < 0.0005) {
      return;
    }

    value = clamped;
    apply();

    if (onChange) {
      onChange(value);
    }
  }

  apply();

  return {
    setValue,
    getValue: () => value,
  };
}

// ─────────────────────────────────────────────────────────────
// 6. Entrada: mouse, touch y teclado. El valor solo sube.
// ─────────────────────────────────────────────────────────────

function createInput({ stage, engine, config }) {
  const step = 1 / Math.max(1, config.levels - 1);

  let current = engine;
  let active = false;
  let frozen = false;
  let pointerId = null;
  let lastX = 0;
  let lastY = 0;
  let lastTime = 0;
  let frame = 0;

  function setValue(next) {
    if (frozen) {
      return; // la imagen quedó fija
    }
    current.setValue(clamp(next));
  }

  // Mientras el puntero está encima, un bucle suma un poco por segundo.
  function startLoop() {
    if (!frame) {
      frame = requestAnimationFrame(tick);
    }
  }

  function stopLoop() {
    if (!frame) {
      return;
    }
    cancelAnimationFrame(frame);
    frame = 0;
    lastTime = 0;
  }

  // Un frame más de desgaste mientras el puntero esté quieto sobre la imagen.
  function tick(time) {
    frame = 0;

    if (!lastTime) {
      lastTime = time;
    }

    const dt = Math.min(Math.max(time - lastTime, 0), 100); // ignora saltos largos
    lastTime = time;

    if (dt > 0) {
      setValue(current.getValue() + (dt / 1000) * config.holdPerSecond);
    }

    frame = requestAnimationFrame(tick);
  }

  function isTouch(event) {
    return Boolean(event.pointerType) && event.pointerType !== 'mouse';
  }

  function remember(event) {
    lastX = event.clientX;
    lastY = event.clientY;
  }

  function activate(event) {
    if (frozen) {
      return;
    }
    active = true;
    lastTime = 0;
    remember(event);
    startLoop();
  }

  function onPointerEnter(event) {
    if (isTouch(event)) {
      return;
    }
    pointerId = event.pointerId;
    activate(event);
  }

  function onPointerDown(event) {
    if (isTouch(event)) {
      pointerId = event.pointerId;
      try {
        stage.setPointerCapture(event.pointerId);
      } catch {
        // Algunos navegadores no permiten capturar el puntero.
      }
      event.preventDefault();
    }

    stage.focus?.({ preventScroll: true });
    activate(event);
  }

  function onPointerMove(event) {
    if (!active) {
      return;
    }

    if (isTouch(event) && pointerId !== null && event.pointerId !== pointerId) {
      return;
    }

    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    remember(event);

    if (dx === 0 && dy === 0) {
      return;
    }

    setValue(current.getValue() + Math.hypot(dx, dy) * config.degradePerPx);
  }

  function onPointerLeave(event) {
    if (isTouch(event)) {
      return;
    }
    pointerId = null;
    active = false;
    stopLoop();
  }

  function onPointerUp(event) {
    if (!isTouch(event)) {
      return;
    }

    if (pointerId !== null && event.pointerId !== pointerId) {
      return;
    }

    pointerId = null;

    try {
      stage.releasePointerCapture(event.pointerId);
    } catch {
      // La captura ya puede estar liberada.
    }

    active = false;
    stopLoop();
  }

  function onLostCapture(event) {
    if (isTouch(event) && active) {
      pointerId = null;
      active = false;
      stopLoop();
    }
  }

  // Teclado: permite degradar sin mouse (una pulsación = un escalón).
  function onKeyDown(event) {
    if (event.key !== 'ArrowUp') {
      return;
    }

    event.preventDefault();
    setValue(current.getValue() + step);
  }

  stage.addEventListener('dragstart', (event) => event.preventDefault());
  stage.addEventListener('pointerenter', onPointerEnter);
  stage.addEventListener('pointerdown', onPointerDown, { passive: false });
  stage.addEventListener('pointermove', onPointerMove);
  stage.addEventListener('pointerleave', onPointerLeave);
  stage.addEventListener('pointerup', onPointerUp);
  stage.addEventListener('pointercancel', onPointerUp);
  stage.addEventListener('lostpointercapture', onLostCapture);
  stage.addEventListener('keydown', onKeyDown);

  return {
    setEngine(next) {
      current = next;
    },
    // Congela el desgaste: la imagen queda como está hasta recargar.
    freeze() {
      frozen = true;
      active = false;
      stopLoop();
    },
  };
}

// ─────────────────────────────────────────────────────────────
// 7. Pedazos y lo que se revela detrás
// ─────────────────────────────────────────────────────────────

const PIECE_SIZE = 48; // tamaño buscado del pedazo, en píxeles

let tearStart = null;  // dónde bajó el puntero, mientras todavía no es un pedazo
let dragging = null;   // { element, pointerId, offsetX, offsetY } del pedazo en la mano
let topZ = 1;          // para que el último pedazo agarrado quede adelante
const holes = [];      // huecos ya arrancados, en proporción a la imagen

function canTear() {
  return Boolean(engine) && engine.getValue() >= CONFIG.tearFrom;
}

// La imagen se divide en una grilla de celdas parejas y cada celda es un pedazo posible.
// La cantidad de columnas y filas se redondea para que la grilla cubra toda la imagen.
function gridOf(rect) {
  const columns = Math.max(1, Math.round(rect.width / PIECE_SIZE));
  const rows = Math.max(1, Math.round(rect.height / PIECE_SIZE));

  return { columns, rows, width: rect.width / columns, height: rect.height / rows };
}

// Celda que corresponde a un punto de la pantalla (null si el punto cae fuera de la imagen).
function cellAt(clientX, clientY) {
  const rect = stage.getBoundingClientRect();
  const grid = gridOf(rect);
  const column = Math.floor((clientX - rect.left) / grid.width);
  const row = Math.floor((clientY - rect.top) / grid.height);

  if (column < 0 || row < 0 || column >= grid.columns || row >= grid.rows) {
    return null;
  }

  return {
    rect,
    width: grid.width,
    height: grid.height,
    left: column * grid.width,
    top: row * grid.height,
  };
}

// ¿La celda pisa un hueco que ya existe?
function overlapsHole(cell) {
  const { rect } = cell;
  // Las celdas de la grilla comparten bordes exactos. Por redondeo, dos celdas
  // vecinas pueden "pisarse" una fracción de píxel: eso no cuenta como hueco.
  const EPSILON = 0.5;

  return holes.some((hole) => {
    const left = hole.x * rect.width;
    const top = hole.y * rect.height;
    const width = hole.w * rect.width;
    const height = hole.h * rect.height;

    return cell.left + EPSILON < left + width
      && cell.left + cell.width - EPSILON > left
      && cell.top + EPSILON < top + height
      && cell.top + cell.height - EPSILON > top;
  });
}

// Las dos capas que se están viendo ahora, con su opacidad.
// El motor muestra una capa entera y mezcla la siguiente según el valor,
// así que el pedazo tiene que copiar esa misma mezcla y no otra versión.
function visibleLayers() {
  const layers = levelSet.layers;
  const position = engine.getValue() * (layers.length - 1);
  const lower = Math.min(layers.length - 1, Math.floor(position));
  const upper = Math.min(layers.length - 1, lower + 1);

  return [
    { element: layers[lower].element, opacity: 1 },
    { element: layers[upper].element, opacity: position - lower },
  ];
}

// Recorta la celda de lo que se ve en pantalla y deja en su lugar un hueco igual.
function tearCell(cell) {
  if (overlapsHole(cell)) {
    return null;
  }

  const { rect, width, height, left, top } = cell;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width);
  canvas.height = Math.round(height);

  const context = canvas.getContext('2d');
  context.imageSmoothingEnabled = false; // conserva el aspecto pixelado

  for (const { element, opacity } of visibleLayers()) {
    if (opacity <= 0) {
      continue;
    }

    // Cada capa tiene su propio tamaño, así que cada una se escala por separado.
    const scaleX = element.naturalWidth / rect.width;
    const scaleY = element.naturalHeight / rect.height;

    context.globalAlpha = opacity;
    context.drawImage(
      element,
      left * scaleX,
      top * scaleY,
      width * scaleX,
      height * scaleY,
      0,
      0,
      canvas.width,
      canvas.height,
    );
  }

  context.globalAlpha = 1;

  // El hueco queda anotado en proporción a la imagen, para que siga en su lugar al redimensionar.
  holes.push({
    x: left / rect.width,
    y: top / rect.height,
    w: width / rect.width,
    h: height / rect.height,
  });
  layoutReveal();

  const piece = document.createElement('img');
  piece.className = 'piece';
  piece.alt = '';
  piece.draggable = false;
  // PNG: el pedazo se guarda tal cual se ve, sin comprimirlo otra vez.
  piece.src = canvas.toDataURL('image/png');
  // Se muestra al tamaño exacto del canvas y en píxeles enteros, así no se
  // reescala al moverse y el pixelado queda siempre igual.
  piece.style.width = `${canvas.width}px`;
  piece.style.height = `${canvas.height}px`;
  piece.style.left = `${Math.round(left + rect.left)}px`;
  piece.style.top = `${Math.round(top + rect.top)}px`;
  piecesEl.append(piece);

  return piece;
}

// Mantiene el pedazo dentro de la ventana mientras se lo arrastra.
function movePiece(piece, clientX, clientY, offsetX, offsetY) {
  const maxLeft = Math.max(0, window.innerWidth - piece.offsetWidth);
  const maxTop = Math.max(0, window.innerHeight - piece.offsetHeight);
  // En píxeles enteros: si cae en fracciones, el navegador reescala la imagen
  // y el pedazo se ve "temblar" mientras se mueve.
  const left = Math.round(clientX - offsetX);
  const top = Math.round(clientY - offsetY);
  piece.style.left = `${Math.min(Math.max(left, 0), maxLeft)}px`;
  piece.style.top = `${Math.min(Math.max(top, 0), maxTop)}px`;
}

// Lo que hay detrás de la imagen solo se ve a través de los huecos: se recorta con
// un camino que tiene un rectángulo cerrado (M ... Z) por cada hueco.
// Ojo: con polygon() no se puede, porque une todos los puntos en una sola figura
// y rellena los triángulos que quedan entre un hueco y el siguiente.
function layoutReveal() {
  const rect = stage.getBoundingClientRect();
  const partes = [];

  for (const hole of holes) {
    const left = hole.x * rect.width;
    const top = hole.y * rect.height;
    const right = left + hole.w * rect.width;
    const bottom = top + hole.h * rect.height;

    partes.push(`M ${left} ${top} H ${right} V ${bottom} H ${left} Z`);
  }

  // Sin huecos no se ve nada de lo que hay detrás.
  revealEl.style.clipPath = partes.length
    ? `path('${partes.join(' ')}')`
    : 'inset(100%)';
}

function grab(piece, pointerId, offsetX, offsetY) {
  topZ += 1;
  piece.style.zIndex = String(topZ);
  dragging = { element: piece, pointerId, offsetX, offsetY };
}

// Bajar el puntero sobre la imagen al tope: queda anotada la celda, el pedazo nace al mover.
stage.addEventListener('pointerdown', (event) => {
  if (!canTear() || event.button > 0) {
    return;
  }

  const cell = cellAt(event.clientX, event.clientY);

  if (!cell) {
    return;
  }

  tearStart = {
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    cell,
    offsetX: event.clientX - (cell.rect.left + cell.left),
    offsetY: event.clientY - (cell.rect.top + cell.top),
  };
});

window.addEventListener('pointermove', (event) => {
  if (tearStart && event.pointerId === tearStart.pointerId) {
    if (Math.hypot(event.clientX - tearStart.x, event.clientY - tearStart.y) < 4) {
      return; // un clic seco no arranca nada
    }

    const { cell, offsetX, offsetY } = tearStart;
    const piece = tearCell(cell);
    tearStart = null;

    if (piece) {
      if (input) {
        input.freeze(); // desde acá la imagen queda fija
      }
      grab(piece, event.pointerId, offsetX, offsetY);
      movePiece(piece, event.clientX, event.clientY, offsetX, offsetY);
    }
    return;
  }

  if (dragging && event.pointerId === dragging.pointerId) {
    movePiece(dragging.element, event.clientX, event.clientY, dragging.offsetX, dragging.offsetY);
  }
});

// Agarrar un pedazo que ya está suelto en la página.
piecesEl.addEventListener('pointerdown', (event) => {
  const piece = event.target.closest('.piece');

  if (!piece) {
    return;
  }

  event.preventDefault();

  try {
    piece.setPointerCapture(event.pointerId);
  } catch {
    // Los eventos sintéticos no permiten capturar el puntero.
  }

  const rect = piece.getBoundingClientRect();
  grab(piece, event.pointerId, event.clientX - rect.left, event.clientY - rect.top);
});

piecesEl.addEventListener('pointermove', (event) => {
  if (!dragging || event.pointerId !== dragging.pointerId) {
    return;
  }
  movePiece(dragging.element, event.clientX, event.clientY, dragging.offsetX, dragging.offsetY);
});

function endDrag(event) {
  if (tearStart && event.pointerId === tearStart.pointerId) {
    tearStart = null;
  }
  if (dragging && event.pointerId === dragging.pointerId) {
    dragging = null;
  }
}

window.addEventListener('pointerup', endDrag);
window.addEventListener('pointercancel', endDrag);

// ─────────────────────────────────────────────────────────────
// 8. Ventanas de archivo: los íconos de atrás abren su ventana
// ─────────────────────────────────────────────────────────────

// Los íconos que abren ventana, con su nombre y si piden uno o dos clics.
const fileItems = revealEl
  ? [...revealEl.querySelectorAll('[data-file]')].map((element) => ({
    name: element.dataset.file,
    mode: element.dataset.open, // 'click' o 'double'
    // Solo la imagen y su nombre son clickeables, no toda la columna.
    parts: [
      element.querySelector('.reveal-icon'),
      element.querySelector('.reveal-label'),
    ],
  }))
  : [];

let windowZ = 0;
let placedWindows = 0; // cuántas ventanas ya aparecieron, para escalonarlas
let draggingWindow = null;
let press = null; // dónde empezó el clic que se está midiendo
let lastClick = null; // para reconocer el doble clic

function insideRect(rect, x, y) {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

// ¿El punto cae dentro de un hueco abierto? Si no, el ícono sigue tapado.
function insideHole(clientX, clientY) {
  const rect = stage.getBoundingClientRect();
  const x = (clientX - rect.left) / rect.width;
  const y = (clientY - rect.top) / rect.height;

  return holes.some((hole) => (
    x >= hole.x && x <= hole.x + hole.w
    && y >= hole.y && y <= hole.y + hole.h
  ));
}

// Ícono que está justo en ese punto y se ve por un hueco.
function fileAt(clientX, clientY) {
  if (!insideHole(clientX, clientY)) {
    return null;
  }

  return fileItems.find((item) => item.parts.some((part) => (
    part && insideRect(part.getBoundingClientRect(), clientX, clientY)
  ))) || null;
}

// Mueve una ventana sin dejar que se salga de la pantalla.
function moveWindow(win, left, top) {
  const maxLeft = Math.max(0, window.innerWidth - win.offsetWidth);
  const maxTop = Math.max(0, window.innerHeight - win.offsetHeight);
  win.style.left = `${Math.round(Math.min(Math.max(left, 0), maxLeft))}px`;
  win.style.top = `${Math.round(Math.min(Math.max(top, 0), maxTop))}px`;
}

// Abre la ventana del archivo, o la trae al frente si ya estaba abierta.
function openWindow(name) {
  const win = windowsEl.querySelector(`[data-window="${name}"]`);

  if (!win) {
    return;
  }

  if (win.hidden) {
    win.hidden = false;

    // La primera vez aparece centrada sobre la obra; la segunda, un poco corrida
    // para que se note que hay dos. Después cada una queda donde la dejaste.
    if (!win.dataset.placed) {
      win.dataset.placed = 'true';
      const offset = placedWindows * 28;
      placedWindows += 1;
      const rect = stage.getBoundingClientRect();
      moveWindow(
        win,
        rect.left + (rect.width - win.offsetWidth) / 2 + offset,
        rect.top + (rect.height - win.offsetHeight) / 2 + offset,
      );
    }
  }

  windowZ += 1;
  win.style.zIndex = String(windowZ);
}

// Cerrar con la X.
windowsEl.addEventListener('click', (event) => {
  const close = event.target.closest('.window__close');

  if (close) {
    close.closest('.window').hidden = true;
  }
});

// Arrastrar la ventana desde su barra de título.
windowsEl.addEventListener('pointerdown', (event) => {
  const bar = event.target.closest('.window__bar');

  if (!bar || event.button > 0 || event.target.closest('.window__close')) {
    return;
  }

  const win = bar.closest('.window');
  const rect = win.getBoundingClientRect();
  draggingWindow = {
    element: win,
    pointerId: event.pointerId,
    offsetX: event.clientX - rect.left,
    offsetY: event.clientY - rect.top,
  };

  try {
    bar.setPointerCapture(event.pointerId);
  } catch {
    // Los eventos sintéticos no permiten capturar el puntero.
  }

  windowZ += 1;
  win.style.zIndex = String(windowZ);
});

window.addEventListener('pointermove', (event) => {
  if (!draggingWindow || event.pointerId !== draggingWindow.pointerId) {
    return;
  }

  moveWindow(
    draggingWindow.element,
    event.clientX - draggingWindow.offsetX,
    event.clientY - draggingWindow.offsetY,
  );
});
function endWindowDrag(event) {
  if (draggingWindow && event.pointerId === draggingWindow.pointerId) {
    draggingWindow = null;
  }
}

window.addEventListener('pointerup', endWindowDrag);
window.addEventListener('pointercancel', endWindowDrag);

// Si achicás la ventana del navegador, las que están abiertas vuelven a entrar.
function keepWindowsInside() {
  for (const win of windowsEl.querySelectorAll('.window:not([hidden])')) {
    const rect = win.getBoundingClientRect();
    moveWindow(win, rect.left, rect.top);
  }
}

// ── Clic y doble clic sobre los íconos ──
// No usamos los eventos 'click' y 'dblclick': en touch, el pointerdown del motor
// hace preventDefault() y esos eventos no llegan. Medimos el clic a mano:
// apretar y soltar casi en el mismo punto, en menos de medio segundo.

stage.addEventListener('pointerdown', (event) => {
  if (event.button > 0) {
    return;
  }
  press = {
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    time: performance.now(),
  };
});

window.addEventListener('pointerup', (event) => {
  if (!press || event.pointerId !== press.pointerId) {
    return;
  }

  const moved = Math.hypot(event.clientX - press.x, event.clientY - press.y);
  const quick = performance.now() - press.time < 500;
  press = null;

  if (moved > 6 || !quick) {
    return; // fue un arrastre, no un clic
  }

  const item = fileAt(event.clientX, event.clientY);

  if (!item) {
    return;
  }

  // Este ícono abre con un solo clic.
  if (item.mode !== 'double') {
    lastClick = null;
    openWindow(item.name);
    return;
  }

  // Este pide doble clic: dos clics seguidos sobre el mismo ícono.
  const now = performance.now();

  if (lastClick && lastClick.name === item.name && now - lastClick.time < 500) {
    lastClick = null;
    openWindow(item.name);
  } else {
    lastClick = { name: item.name, time: now };
  }
});

window.addEventListener('pointercancel', () => {
  press = null;
});

// El cursor avisa cuándo hay un ícono clickeable a la vista.
stage.addEventListener('pointermove', (event) => {
  if (event.pointerType !== 'mouse') {
    return;
  }
  stage.classList.toggle('over-file', Boolean(fileAt(event.clientX, event.clientY)));
});

stage.addEventListener('pointerleave', () => {
  stage.classList.remove('over-file');
});

// ─────────────────────────────────────────────────────────────
// 9. Arranque y regeneración al cambiar el tamaño de la ventana
// ─────────────────────────────────────────────────────────────

let engine = null;
let input = null;
let levelSet = null;
let lastSize = { width: 0, height: 0 };
let generating = false;
let pendingResize = false;
let resizeTimer = 0;

function onValueChange(value) {
  stage.classList.toggle('can-tear', value >= CONFIG.tearFrom); // ya se pueden arrancar pedazos

  if (!debug || !hud) {
    return;
  }
  hud.hidden = false;
  hud.textContent = `value ${value.toFixed(3)} · level ${(value * (CONFIG.levels - 1)).toFixed(2)}`;
}

function showLoading(visible) {
  if (loading) {
    loading.hidden = !visible;
  }
}

function showError(message) {
  if (errorBox) {
    errorBox.textContent = message;
    errorBox.hidden = false;
  }
  if (stage) {
    stage.setAttribute('aria-label', message);
  }
  showLoading(false);
}

function loadImage(image) {
  if (image.complete) {
    return image.naturalWidth > 0
      ? Promise.resolve()
      : Promise.reject(new Error('La imagen no está disponible.'));
  }

  return new Promise((resolve, reject) => {
    image.addEventListener('load', () => resolve(), { once: true });
    image.addEventListener('error', () => reject(new Error('No se pudo cargar la imagen.')), { once: true });
  });
}

// ¿Cambió lo suficiente como para volver a generar las capas?
function sizeChanged(rect) {
  if (rect.width < 1 || rect.height < 1) {
    return false;
  }
  if (!lastSize.width || !lastSize.height) {
    return true;
  }
  return Math.abs(rect.width - lastSize.width) / lastSize.width >= 0.02
    || Math.abs(rect.height - lastSize.height) / lastSize.height >= 0.02;
}

async function regenerate() {
  if (!engine || generating) {
    return;
  }

  const rect = stage.getBoundingClientRect();

  if (!sizeChanged(rect)) {
    return;
  }

  generating = true;

  try {
    const next = await buildLevels(rect);
    layersEl.append(...next.layers.slice(1).map((layer) => layer.element));
    engine = createEngine(next.layers, engine.getValue(), onValueChange);
    input.setEngine(engine);
    levelSet.destroy();
    levelSet = next;
    lastSize = { width: rect.width, height: rect.height };
    layoutReveal();
  } catch (error) {
    console.error('[obra] no se pudo regenerar', error);
  } finally {
    generating = false;

    if (pendingResize) {
      pendingResize = false;
      scheduleRegeneration();
    }
  }
}

function scheduleRegeneration() {
  if (!engine) {
    return;
  }

  layoutReveal();
  keepWindowsInside();
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (generating) {
      pendingResize = true;
      return;
    }
    void regenerate();
  }, 250);
}

async function boot() {
  if (!stage || !layersEl || !baseImg) {
    throw new Error('Falta la estructura del escenario.');
  }

  showLoading(true);
  await loadImage(baseImg);

  // El escenario toma la forma de la imagen.
  document.documentElement.style.setProperty(
    '--stage-aspect',
    String(baseImg.naturalWidth / baseImg.naturalHeight),
  );

  const rect = stage.getBoundingClientRect();
  levelSet = await buildLevels(rect);
  layersEl.append(...levelSet.layers.slice(1).map((layer) => layer.element));
  lastSize = { width: rect.width, height: rect.height };

  engine = createEngine(levelSet.layers, 0, onValueChange);
  onValueChange(engine.getValue()); // muestra el HUD apenas arranca (solo con ?debug)
  input = createInput({ stage, engine, config: CONFIG });

  new ResizeObserver(scheduleRegeneration).observe(stage);
  window.addEventListener('resize', scheduleRegeneration);

  layoutReveal(); // todavía no hay huecos: lo de atrás queda tapado
  showLoading(false);
}

boot().catch((error) => {
  console.error('[obra]', error);
  if (baseImg) {
    baseImg.hidden = true;
  }
  showError(error && error.name === 'SecurityError'
    ? 'Abrí esta obra desde un servidor local (por ejemplo, Live Server): el navegador bloquea procesar imágenes abiertas como archivo.'
    : 'No se pudo cargar la obra. Probá recargar la página.');
});
