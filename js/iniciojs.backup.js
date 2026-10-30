// webreso — obra interactiva de pérdida de resolución.
// Archivo único: configuración, niveles, motor, input, persistencia y arranque.

// ─────────────────────────────────────────────────────────────
// Configuración
// ─────────────────────────────────────────────────────────────

const CONFIG = {
  imageSrc: 'imagenes/inicioMain.JPG',
  levels: 16,
  padding: { x: 0.04, y: 0.06 },
  fit: 'contain',
  maxRenderPx: 2400,
  minScale: 0.035,
  startQuality: 0.85,
  endQuality: 0.03,
  degradePerPx: 1 / 3200,
  holdPerSecond: 0.035,
  decayMs: 2200,
  decayEasing: 'easeOutCubic',
  persistKey: 'webreso.degradation.v1',
  persistMode: 'off',
  cursor: 'crosshair',
  debug: false,
};

// ─────────────────────────────────────────────────────────────
// Utilidades
// ─────────────────────────────────────────────────────────────

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function lerp(from, to, amount) {
  return from + (to - from) * amount;
}

function easeOutCubic(progress) {
  return 1 - Math.pow(1 - progress, 3);
}

// ─────────────────────────────────────────────────────────────
// Niveles: generación de capas JPEG
// ─────────────────────────────────────────────────────────────

function drawSource(context, source, width, height) {
  let current = source;
  let currentWidth = source.naturalWidth;
  let currentHeight = source.naturalHeight;

  while (currentWidth > width * 2 || currentHeight > height * 2) {
    const nextWidth = Math.max(width, Math.round(currentWidth / 2));
    const nextHeight = Math.max(height, Math.round(currentHeight / 2));
    const step = document.createElement('canvas');
    step.width = nextWidth;
    step.height = nextHeight;
    const stepContext = step.getContext('2d');
    if (!stepContext) {
      throw new Error('No se pudo crear el contexto 2D.');
    }
    stepContext.imageSmoothingEnabled = true;
    stepContext.imageSmoothingQuality = 'high';
    stepContext.drawImage(current, 0, 0, nextWidth, nextHeight);
    current = step;
    currentWidth = nextWidth;
    currentHeight = nextHeight;
  }

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(current, 0, 0, width, height);
}

function encodeCanvas(canvas, quality) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = 0;

    const fallback = () => {
      if (settled) {
        return;
      }
      settled = true;
      window.clearTimeout(timer);
      try {
        resolve({ url: canvas.toDataURL('image/jpeg', quality), isObjectUrl: false });
      } catch (error) {
        reject(error);
      }
    };

    if (typeof canvas.toBlob !== 'function') {
      fallback();
      return;
    }

    timer = window.setTimeout(fallback, 100);

    try {
      canvas.toBlob((blob) => {
        if (settled) {
          return;
        }
        if (!blob) {
          fallback();
          return;
        }
        settled = true;
        window.clearTimeout(timer);
        resolve({ url: URL.createObjectURL(blob), isObjectUrl: true });
      }, 'image/jpeg', quality);
    } catch (error) {
      settled = true;
      window.clearTimeout(timer);
      reject(error);
    }
  });
}

async function buildLevels({ source, rect, config, debug = false, onProgress }) {
  if (!source || !rect) {
    throw new Error('Faltan la imagen o el rectángulo del escenario.');
  }

  const startedAt = performance.now();
  const count = Math.max(2, Math.floor(config.levels));
  const displayWidth = Math.max(1, Math.round(rect.width));
  const displayHeight = Math.max(1, Math.round(rect.height));
  const cap = Math.min(1, config.maxRenderPx / Math.max(displayWidth, displayHeight));
  const renderWidth = Math.max(1, Math.round(displayWidth * cap));
  const renderHeight = Math.max(1, Math.round(displayHeight * cap));

  const layers = [
    {
      index: 0,
      element: source,
      url: null,
      width: source.naturalWidth,
      height: source.naturalHeight,
      scale: 1,
      quality: 1,
      owned: false,
    },
  ];
  const objectUrls = [];
  const timings = [];

  try {
    for (let index = 1; index < count; index += 1) {
      const levelStartedAt = performance.now();
      const progress = index / (count - 1);
      const scale = Math.exp(lerp(Math.log(0.92), Math.log(config.minScale), progress));
      const quality = clamp(lerp(config.startQuality, config.endQuality, Math.pow(progress, 1.5)), 0.01, 1);
      const width = Math.max(8, Math.round(renderWidth * scale));
      const height = Math.max(8, Math.round(renderHeight * scale));

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;

      const context = canvas.getContext('2d');
      if (!context) {
        throw new Error('No se pudo crear el contexto 2D.');
      }

      drawSource(context, source, width, height);
      const encoded = await encodeCanvas(canvas, quality);

      if (encoded.isObjectUrl) {
        objectUrls.push(encoded.url);
      }

      const element = document.createElement('img');
      element.className = 'layer layer--pixelated';
      element.alt = '';
      element.draggable = false;
      element.decoding = 'async';
      element.style.opacity = '0';
      element.src = encoded.url;

      if (typeof element.decode === 'function') {
        element.decode().catch(() => {});
      }

      layers.push({
        index,
        element,
        url: encoded.url,
        width,
        height,
        scale,
        quality,
        owned: true,
      });

      timings.push({
        level: index,
        ms: Math.round(performance.now() - levelStartedAt),
        width,
        height,
        quality: Number(quality.toFixed(3)),
      });

      if (onProgress) {
        onProgress({ done: index, total: count - 1 });
      }

      await new Promise((resolve) => {
        window.setTimeout(resolve, 0);
      });
    }
  } catch (error) {
    for (const layer of layers) {
      if (layer.owned) {
        layer.element.remove();
      }
    }
    for (const url of objectUrls) {
      URL.revokeObjectURL(url);
    }
    objectUrls.length = 0;
    throw error;
  }

  const totalMs = performance.now() - startedAt;

  if (debug) {
    console.info(`[webreso] ${count - 1} niveles generados en ${Math.round(totalMs)} ms`);
    console.table(timings);
  }

  return {
    layers,
    timings,
    totalMs,
    renderWidth,
    renderHeight,
    destroy() {
      for (const layer of layers) {
        if (layer.owned) {
          layer.element.remove();
        }
      }
      for (const url of objectUrls) {
        URL.revokeObjectURL(url);
      }
      objectUrls.length = 0;
    },
  };
}

// ─────────────────────────────────────────────────────────────
// Motor: crossfade entre capas
// ─────────────────────────────────────────────────────────────

function createEngine({ layers, initialValue = 0, onChange }) {
  if (!Array.isArray(layers) || layers.length === 0) {
    throw new Error('No hay capas para el motor.');
  }

  const elements = layers.map((layer) => (layer && layer.element ? layer.element : layer));

  if (elements.some((element) => !element)) {
    throw new Error('Hay una capa inválida.');
  }

  const maxIndex = elements.length - 1;
  const current = new Array(elements.length).fill(-1);
  const initial = Number(initialValue);
  let value = Number.isFinite(initial) ? clamp(initial) : 0;

  function getState() {
    const position = value * maxIndex;
    const lower = Math.min(maxIndex, Math.floor(position));
    const upper = Math.min(maxIndex, lower + 1);
    const blend = position - lower;
    const active = [{ index: lower, opacity: 1 }];

    if (lower !== upper && blend > 0) {
      active.push({ index: upper, opacity: blend });
    }

    return { value, position, lower, upper, blend, active };
  }

  function apply() {
    const position = value * maxIndex;
    const lower = Math.min(maxIndex, Math.floor(position));
    const upper = Math.min(maxIndex, lower + 1);
    const blend = position - lower;

    for (let index = 0; index < elements.length; index += 1) {
      let opacity = 0;

      if (lower === upper) {
        opacity = index === lower ? 1 : 0;
      } else if (index === lower) {
        opacity = 1;
      } else if (index === upper) {
        opacity = blend;
      }

      if (Math.abs(opacity - current[index]) < 0.0005) {
        continue;
      }

      const element = elements[index];
      element.style.opacity = String(opacity);
      element.style.visibility = opacity > 0 ? 'visible' : 'hidden';
      current[index] = opacity;
    }
  }

  function setValue(nextValue) {
    const next = Number(nextValue);

    if (!Number.isFinite(next)) {
      return getState();
    }

    const clamped = clamp(next);

    if (Math.abs(clamped - value) < 0.0002) {
      return getState();
    }

    value = clamped;
    apply();

    const state = getState();

    if (onChange) {
      onChange(state);
    }

    return state;
  }

  apply();

  return {
    setValue,
    getValue: () => value,
    getState,
    destroy({ resetStyles = true } = {}) {
      if (resetStyles) {
        for (const element of elements) {
          element.style.opacity = '';
          element.style.visibility = '';
        }
      }
      current.fill(-1);
    },
  };
}

// ─────────────────────────────────────────────────────────────
// Input: puntero, touch, teclado y decay
// ─────────────────────────────────────────────────────────────

function createInput({ stage, engine: initialEngine, config, floor = 0 }) {
  if (!stage || !initialEngine) {
    throw new Error('Faltan el escenario o el motor.');
  }

  let engine = initialEngine;
  const step = 1 / Math.max(1, config.levels - 1);
  const motionQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

  let floorValue = clamp(floor);
  let peak = Math.max(floorValue, engine.getValue());
  let active = false;
  let decaying = false;
  let pointerId = null;
  let lastX = 0;
  let lastY = 0;
  let lastFrame = 0;
  let rafId = 0;
  let decayFrom = 0;
  let decayStart = 0;
  let reducedMotion = motionQuery ? motionQuery.matches : false;

  function applyValue(next, trackPeak = true) {
    const value = Math.min(1, Math.max(floorValue, next));
    if (trackPeak && value > peak) {
      peak = value;
    }
    engine.setValue(value);
    return value;
  }

  function setLast(event) {
    lastX = event.clientX;
    lastY = event.clientY;
  }

  function isMouse(event) {
    return !event.pointerType || event.pointerType === 'mouse';
  }

  function ensureLoop() {
    if (rafId) {
      return;
    }
    lastFrame = 0;
    rafId = window.requestAnimationFrame(tick);
  }

  function stopLoopIfIdle() {
    if (!active && !decaying && rafId) {
      window.cancelAnimationFrame(rafId);
      rafId = 0;
      lastFrame = 0;
    }
  }

  function tick(timestamp) {
    rafId = 0;
    const time = typeof timestamp === 'number' ? timestamp : performance.now();

    if (active) {
      if (!lastFrame) {
        lastFrame = time;
      }
      const dt = Math.min(Math.max(time - lastFrame, 0), 100);
      lastFrame = time;
      if (dt > 0) {
        applyValue(engine.getValue() + (dt / 1000) * config.holdPerSecond);
      }
    }

    if (decaying) {
      const progress = Math.min(1, Math.max(0, (time - decayStart) / Math.max(1, config.decayMs)));
      if (progress >= 1) {
        decaying = false;
        applyValue(floorValue, false);
      } else {
        applyValue(floorValue + (decayFrom - floorValue) * (1 - easeOutCubic(progress)), false);
      }
    }

    if (active || decaying) {
      rafId = window.requestAnimationFrame(tick);
    } else {
      lastFrame = 0;
    }
  }

  function startActive() {
    active = true;
    decaying = false;
    ensureLoop();
  }

  function startDecay() {
    active = false;
    lastFrame = 0;

    if (decaying) {
      return;
    }

    const current = engine.getValue();

    if (current <= floorValue + 0.0001) {
      decaying = false;
      if (current !== floorValue) {
        applyValue(floorValue, false);
      }
      stopLoopIfIdle();
      return;
    }

    if (reducedMotion) {
      decaying = false;
      applyValue(floorValue, false);
      stopLoopIfIdle();
      return;
    }

    decayFrom = current;
    decayStart = performance.now();
    decaying = true;
    ensureLoop();
  }

  function cancelDecay() {
    decaying = false;
    decayStart = 0;
  }

  function onPointerEnter(event) {
    if (!isMouse(event)) {
      return;
    }
    pointerId = event.pointerId ?? null;
    setLast(event);
    startActive();
  }

  function onPointerDown(event) {
    if (!isMouse(event)) {
      if (pointerId !== null && pointerId !== event.pointerId) {
        return;
      }
      pointerId = event.pointerId;
      try {
        stage.setPointerCapture(event.pointerId);
      } catch {
        // El puntero sintético o el navegador pueden no soportar captura.
      }
    }

    if (typeof stage.focus === 'function') {
      stage.focus({ preventScroll: true });
    }

    if (!isMouse(event)) {
      event.preventDefault();
    }

    setLast(event);
    startActive();
  }

  function onPointerMove(event) {
    if (!active) {
      return;
    }

    if (!isMouse(event) && pointerId !== null && event.pointerId !== pointerId) {
      return;
    }

    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    setLast(event);

    if (dx === 0 && dy === 0) {
      return;
    }

    applyValue(engine.getValue() + Math.hypot(dx, dy) * config.degradePerPx);
  }

  function onPointerLeave(event) {
    if (!isMouse(event)) {
      return;
    }
    pointerId = null;
    startDecay();
  }

  function finishPointer(event) {
    if (isMouse(event)) {
      return;
    }
    if (pointerId !== null && event.pointerId !== pointerId) {
      return;
    }

    pointerId = null;

    try {
      stage.releasePointerCapture(event.pointerId);
    } catch {
      // La captura puede haberse liberado ya.
    }

    startDecay();
  }

  function onLostPointerCapture(event) {
    if (!isMouse(event) && active) {
      pointerId = null;
      startDecay();
    }
  }

  function onKeyDown(event) {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown' && event.key !== 'Home') {
      return;
    }

    event.preventDefault();
    cancelDecay();

    const current = engine.getValue();

    if (event.key === 'Home') {
      applyValue(floorValue);
    } else if (event.key === 'ArrowUp') {
      applyValue(current + step);
    } else {
      applyValue(current - step);
    }
  }

  function onMotionChange(event) {
    reducedMotion = event.matches;

    if (reducedMotion && decaying) {
      cancelDecay();
      applyValue(floorValue, false);
      stopLoopIfIdle();
    }
  }

  function onDragStart(event) {
    event.preventDefault();
  }

  function setEngine(nextEngine) {
    if (!nextEngine) {
      throw new Error('Falta el motor.');
    }

    engine = nextEngine;

    if (engine.getValue() < floorValue) {
      applyValue(floorValue, false);
    }
  }

  function getPeak() {
    return peak;
  }

  function getFloor() {
    return floorValue;
  }

  function setFloor(nextFloor) {
    floorValue = clamp(nextFloor);
    peak = Math.max(peak, floorValue);

    if (engine.getValue() < floorValue) {
      applyValue(floorValue, false);
    }
  }

  function reset(nextFloor = 0) {
    floorValue = clamp(nextFloor);
    peak = floorValue;
    cancelDecay();
    applyValue(floorValue, false);
    stopLoopIfIdle();
  }

  function destroy() {
    stage.removeEventListener('pointerenter', onPointerEnter);
    stage.removeEventListener('pointerdown', onPointerDown);
    stage.removeEventListener('pointermove', onPointerMove);
    stage.removeEventListener('pointerleave', onPointerLeave);
    stage.removeEventListener('pointerup', finishPointer);
    stage.removeEventListener('pointercancel', finishPointer);
    stage.removeEventListener('lostpointercapture', onLostPointerCapture);
    stage.removeEventListener('keydown', onKeyDown);
    stage.removeEventListener('dragstart', onDragStart);

    if (motionQuery) {
      if (typeof motionQuery.removeEventListener === 'function') {
        motionQuery.removeEventListener('change', onMotionChange);
      } else if (typeof motionQuery.removeListener === 'function') {
        motionQuery.removeListener(onMotionChange);
      }
    }

    if (rafId) {
      window.cancelAnimationFrame(rafId);
      rafId = 0;
    }

    if (pointerId !== null) {
      try {
        stage.releasePointerCapture(pointerId);
      } catch {
        // La captura puede haberse liberado ya.
      }
    }

    active = false;
    decaying = false;
    pointerId = null;
    lastFrame = 0;
  }

  if (engine.getValue() < floorValue) {
    applyValue(floorValue, false);
  }

  stage.addEventListener('pointerenter', onPointerEnter);
  stage.addEventListener('pointerdown', onPointerDown, { passive: false });
  stage.addEventListener('pointermove', onPointerMove);
  stage.addEventListener('pointerleave', onPointerLeave);
  stage.addEventListener('pointerup', finishPointer);
  stage.addEventListener('pointercancel', finishPointer);
  stage.addEventListener('lostpointercapture', onLostPointerCapture);
  stage.addEventListener('keydown', onKeyDown);
  stage.addEventListener('dragstart', onDragStart);

  if (motionQuery) {
    if (typeof motionQuery.addEventListener === 'function') {
      motionQuery.addEventListener('change', onMotionChange);
    } else if (typeof motionQuery.addListener === 'function') {
      motionQuery.addListener(onMotionChange);
    }
  }

  return {
    getPeak,
    getFloor,
    setFloor,
    setEngine,
    reset,
    destroy,
  };
}

// ─────────────────────────────────────────────────────────────
// Persistencia: localStorage y ?reset
// ─────────────────────────────────────────────────────────────

function readFloor(key) {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) {
      return 0;
    }
    const value = Number(raw);
    return Number.isFinite(value) ? clamp(value) : 0;
  } catch {
    return 0;
  }
}

function saveFloor(key, value) {
  try {
    window.localStorage.setItem(key, String(clamp(value)));
  } catch {
    // Modo privado, cuota llena o almacenamiento bloqueado.
  }
}

function clearFloor(key) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Modo privado, cuota llena o almacenamiento bloqueado.
  }
}

function createPersistence({ config, input, engine, reset = false }) {
  if (!input || !engine) {
    throw new Error('Faltan el input o el motor.');
  }

  const mode = config.persistMode === 'immediate' || config.persistMode === 'off'
    ? config.persistMode
    : 'visit';

  let destroyed = false;
  let lastSaved = 0;
  let lastSavedValue = -1;

  function peakValue() {
    return clamp(Math.max(input.getFloor(), input.getPeak()));
  }

  function commit() {
    if (destroyed || mode === 'off') {
      return;
    }

    const value = peakValue();
    saveFloor(config.persistKey, value);
    lastSaved = performance.now();
    lastSavedValue = value;
  }

  function onChange(state) {
    if (destroyed || mode !== 'immediate') {
      return;
    }

    if (state.value > input.getFloor() + 0.0001) {
      input.setFloor(state.value);
    }

    const now = performance.now();
    const current = peakValue();

    if (now - lastSaved >= 1000 && current > lastSavedValue + 0.0001) {
      saveFloor(config.persistKey, current);
      lastSaved = now;
      lastSavedValue = current;
    }
  }

  function onPageHide() {
    commit();
  }

  function onVisibilityChange() {
    if (document.visibilityState === 'hidden') {
      commit();
    }
  }

  if (reset) {
    clearFloor(config.persistKey);
    input.reset(0);

    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('reset');
      url.searchParams.delete('value');
      url.searchParams.delete('level');
      const search = url.searchParams.toString();
      window.history.replaceState(null, '', `${url.pathname}${search ? `?${search}` : ''}${url.hash}`);
    } catch {
      // history.replaceState puede fallar en contextos restringidos.
    }
  }

  if (mode !== 'off') {
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onVisibilityChange);
  }

  return {
    mode,
    onChange,
    commit,
    destroy() {
      destroyed = true;
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    },
  };
}

// ─────────────────────────────────────────────────────────────
// Orquestación, carga y resize
// ─────────────────────────────────────────────────────────────

const stage = document.querySelector('#stage');
const layerContainer = document.querySelector('#layers');
const loading = document.querySelector('#loading');
const errorBox = document.querySelector('#error');
const hud = document.querySelector('#hud');
const baseLayer = layerContainer ? layerContainer.querySelector('.layer--base') : null;

const params = new URLSearchParams(window.location.search);
const debug = CONFIG.debug || params.has('debug');

let engine = null;
let input = null;
let persistence = null;
let debugInfo = null;
let levelSet = null;
let generating = false;
let pendingRegenerate = false;
let resizeTimer = 0;
let resizeObserver = null;
let lastRenderRect = { width: 0, height: 0 };

function handleEngineChange(state) {
  if (persistence) {
    persistence.onChange(state);
  }
  if (debug) {
    renderHud(state);
  }
}

function applyPadding() {
  const root = document.documentElement;
  root.style.setProperty('--pad-x', `${CONFIG.padding.x * 100}vw`);
  root.style.setProperty('--pad-y', `${CONFIG.padding.y * 100}vh`);
}

function showError(message) {
  if (errorBox) {
    errorBox.textContent = message;
    errorBox.hidden = false;
  }
  if (stage) {
    stage.setAttribute('aria-label', message);
  }
  if (loading) {
    loading.hidden = true;
  }
}

function decodeImage(img) {
  if (typeof img.decode !== 'function') {
    return Promise.resolve();
  }
  const timeout = new Promise((resolve) => {
    window.setTimeout(resolve, 3000);
  });
  return Promise.race([img.decode(), timeout]);
}

function loadImage(img) {
  if (img.complete) {
    if (img.naturalWidth > 0) {
      return decodeImage(img);
    }
    return Promise.reject(new Error('La imagen no está disponible.'));
  }

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      img.removeEventListener('load', onLoad);
      img.removeEventListener('error', onError);
    };
    const onLoad = () => {
      cleanup();
      decodeImage(img).then(resolve, reject);
    };
    const onError = () => {
      cleanup();
      reject(new Error('No se pudo cargar la imagen.'));
    };
    img.addEventListener('load', onLoad);
    img.addEventListener('error', onError);
  });
}

function renderGenerationProgress(done, total) {
  if (!debug || !hud) {
    return;
  }
  hud.textContent = `generando niveles ${done}/${total}…`;
  hud.hidden = false;
}

function renderHud(state) {
  if (!debug || !hud) {
    return;
  }

  const lines = [];

  if (debugInfo) {
    lines.push(
      `img ${debugInfo.imageWidth}×${debugInfo.imageHeight}`,
      `stage ${Math.round(debugInfo.rect.width)}×${Math.round(debugInfo.rect.height)}`,
      `ratio ${debugInfo.ratio.toFixed(3)}`,
      `dpr ${window.devicePixelRatio.toFixed(2)}`,
    );

    if (debugInfo.levelCount) {
      lines.push(`levels ${debugInfo.levelCount} · ${Math.round(debugInfo.levelMs)} ms`);
      lines.push(`render ${debugInfo.renderWidth}×${debugInfo.renderHeight}`);
    }
  }

  if (state) {
    lines.push(`value ${state.value.toFixed(3)} · level ${state.position.toFixed(2)}`);
    if (input) {
      lines.push(`floor ${input.getFloor().toFixed(3)} · peak ${input.getPeak().toFixed(3)}`);
    }
    lines.push(`layers ${state.active.map((layer) => `${layer.index}:${layer.opacity.toFixed(2)}`).join(' ')}`);
  }

  if (lines.length === 0) {
    return;
  }

  hud.textContent = lines.join('\n');
  hud.hidden = false;
}

function resolveInitialValue(levelCount, fallbackFloor) {
  if (!debug) {
    return fallbackFloor;
  }

  if (params.has('value')) {
    const parsed = Number(params.get('value'));
    if (Number.isFinite(parsed)) {
      return Math.min(1, Math.max(0, parsed));
    }
  }

  if (params.has('level')) {
    const parsed = Number(params.get('level'));
    if (Number.isInteger(parsed) && parsed >= 0 && parsed < levelCount) {
      return parsed / (levelCount - 1);
    }
  }

  return fallbackFloor;
}

function mountLevels(levels) {
  layerContainer.append(...levels.layers.slice(1).map((layer) => layer.element));
}

function updateDebugInfo(levels, rect) {
  if (!debugInfo) {
    return;
  }

  debugInfo.rect = rect;
  debugInfo.levelCount = levels.layers.length - 1;
  debugInfo.levelMs = levels.totalMs;
  debugInfo.renderWidth = levels.renderWidth;
  debugInfo.renderHeight = levels.renderHeight;
}

function measureStage() {
  const rect = stage.getBoundingClientRect();
  return { width: rect.width, height: rect.height };
}

function rectChangedEnough(next, previous) {
  if (next.width < 1 || next.height < 1) {
    return false;
  }

  if (!previous || !previous.width || !previous.height) {
    return true;
  }

  const widthDelta = Math.abs(next.width - previous.width) / previous.width;
  const heightDelta = Math.abs(next.height - previous.height) / previous.height;
  return widthDelta >= 0.02 || heightDelta >= 0.02;
}

async function regenerate() {
  if (!engine || !input || !baseLayer || generating) {
    if (generating) {
      pendingRegenerate = true;
    }
    return;
  }

  const rect = measureStage();

  if (!rectChangedEnough(rect, lastRenderRect)) {
    return;
  }

  generating = true;

  try {
    const nextLevels = await buildLevels({
      source: baseLayer,
      rect,
      config: CONFIG,
      debug,
      onProgress: ({ done, total }) => renderGenerationProgress(done, total),
    });

    const value = engine.getValue();
    const previousEngine = engine;
    const previousLevels = levelSet;
    let nextEngine;

    try {
      nextEngine = createEngine({
        layers: nextLevels.layers,
        initialValue: value,
        onChange: handleEngineChange,
      });
    } catch (error) {
      nextLevels.destroy();
      throw error;
    }

    mountLevels(nextLevels);

    engine = nextEngine;
    levelSet = nextLevels;

    if (input) {
      input.setEngine(nextEngine);
    }

    if (previousEngine) {
      previousEngine.destroy({ resetStyles: false });
    }

    if (previousLevels) {
      previousLevels.destroy();
    }

    lastRenderRect = { width: rect.width, height: rect.height };
    updateDebugInfo(nextLevels, rect);
    renderHud(engine.getState());
  } catch (error) {
    console.error('[webreso] regeneración', error);
    if (engine) {
      renderHud(engine.getState());
    }
  } finally {
    generating = false;

    if (pendingRegenerate) {
      pendingRegenerate = false;
      scheduleRegeneration();
    }
  }
}

function scheduleRegeneration() {
  if (!engine || !input) {
    return;
  }

  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    resizeTimer = 0;

    if (!engine || !input) {
      return;
    }

    if (!rectChangedEnough(measureStage(), lastRenderRect)) {
      return;
    }

    if (generating) {
      pendingRegenerate = true;
      return;
    }

    void regenerate();
  }, 250);
}

function setupResize() {
  if (typeof window.ResizeObserver === 'function') {
    resizeObserver = new window.ResizeObserver(scheduleRegeneration);
    resizeObserver.observe(stage);
  }

  window.addEventListener('resize', scheduleRegeneration);
  window.addEventListener('orientationchange', scheduleRegeneration);

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', scheduleRegeneration);
  }
}

async function boot() {
  if (!stage || !layerContainer || !baseLayer) {
    throw new Error('Falta la estructura del escenario.');
  }

  if (loading) {
    loading.hidden = false;
  }

  const resetRequested = params.has('reset');

  if (resetRequested) {
    clearFloor(CONFIG.persistKey);
  }

  const storedFloor = resetRequested || CONFIG.persistMode === 'off'
    ? 0
    : readFloor(CONFIG.persistKey);

  stage.style.cursor = CONFIG.cursor;
  applyPadding();

  if (baseLayer.getAttribute('src') !== CONFIG.imageSrc) {
    baseLayer.src = CONFIG.imageSrc;
  }

  await loadImage(baseLayer);

  const ratio = baseLayer.naturalWidth / baseLayer.naturalHeight;
  document.documentElement.style.setProperty('--stage-aspect', String(ratio));

  const rect = stage.getBoundingClientRect();

  debugInfo = {
    imageWidth: baseLayer.naturalWidth,
    imageHeight: baseLayer.naturalHeight,
    rect,
    ratio,
    levelCount: 0,
    levelMs: 0,
    renderWidth: 0,
    renderHeight: 0,
  };

  renderGenerationProgress(0, CONFIG.levels - 1);

  try {
    levelSet = await buildLevels({
      source: baseLayer,
      rect,
      config: CONFIG,
      debug,
      onProgress: ({ done, total }) => renderGenerationProgress(done, total),
    });

    mountLevels(levelSet);
    updateDebugInfo(levelSet, rect);
    lastRenderRect = { width: rect.width, height: rect.height };

    engine = createEngine({
      layers: levelSet.layers,
      initialValue: resetRequested ? 0 : resolveInitialValue(levelSet.layers.length, storedFloor),
      onChange: handleEngineChange,
    });
  } catch (error) {
    console.error('[webreso] niveles', error);
    showError('No se pudieron generar los niveles de la obra.');
  }

  if (engine) {
    try {
      input = createInput({
        stage,
        engine,
        config: CONFIG,
        floor: storedFloor,
      });
    } catch (error) {
      console.error('[webreso] input', error);
    }
  }

  if (input) {
    try {
      persistence = createPersistence({
        config: CONFIG,
        input,
        engine,
        reset: resetRequested,
      });
    } catch (error) {
      console.error('[webreso] persistencia', error);
    }
  }

  renderHud(engine ? engine.getState() : null);
  setupResize();

  if (loading) {
    loading.hidden = true;
  }
}

(async () => {
  try {
    await boot();
  } catch (error) {
    console.error('[webreso]', error);
    if (baseLayer) {
      baseLayer.hidden = true;
    }
    showError('No se pudo cargar la obra. Probá recargar la página.');
  }
})();
