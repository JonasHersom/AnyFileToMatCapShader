// Responsibility: turn mouse and keyboard into intent. Pointer lock, key bindings, nothing else.
// It does not know what a camera is: it reports "how far did the mouse move" and "which way
// does the user want to go". (Pointer lock and key handling from worksheet 11, part 3.)

// The key bindings live here and only here. event.code is the physical key, so this also
// works with other keyboard layouts.
const BINDINGS = {
  forward: 'KeyW',
  back: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  up: 'Space',
  down: 'ShiftLeft',
};
const BOUND_CODES = new Set(Object.values(BINDINGS));

export function createFirstPersonInput(canvas) {
  const pressed = new Set();
  let locked = false;
  let lookX = 0;
  let lookY = 0;
  const lockListeners = [];

  // click: lock the pointer to the canvas, or release it if it is locked already
  canvas.addEventListener('click', () => {
    try {
      if (document.pointerLockElement === canvas) {
        document.exitPointerLock();
      } else {
        // some browsers refuse a new lock right after the pointer was released
        canvas.requestPointerLock()?.catch(() => {});
      }
    } catch (error) {
      // nothing to do, the next click tries again
    }
  });

  // the pointer can also be released by the browser (Esc), so look at what actually happened
  document.addEventListener('pointerlockchange', () => {
    locked = document.pointerLockElement === canvas;
    if (!locked) {
      pressed.clear();   // a key released while unlocked would stay pressed forever
      lookX = lookY = 0;
    }
    lockListeners.forEach(listener => listener(locked));
  });

  canvas.addEventListener('mousemove', (event) => {
    if (!locked) return;
    lookX += event.movementX;
    lookY += event.movementY;
  });

  // Keys only count while the pointer is locked, so typing in the side panel never moves the
  // camera. The listeners are on window: after the click that locked the pointer, the
  // browser's focus may be anywhere.
  window.addEventListener('keydown', (event) => {
    if (!locked || !BOUND_CODES.has(event.code)) return;
    pressed.add(event.code);
    event.preventDefault();   // no scrolling with the space bar
  });
  window.addEventListener('keyup', (event) => pressed.delete(event.code));
  window.addEventListener('blur', () => pressed.clear());

  const axis = (positive, negative) =>
    Number(pressed.has(BINDINGS[positive])) - Number(pressed.has(BINDINGS[negative]));

  return {
    get locked() { return locked; },

    // Mouse movement in pixels since the last call. Call once per frame.
    consumeLook() {
      const look = { x: lookX, y: lookY };
      lookX = lookY = 0;
      return look;
    },

    // Each component -1, 0 or 1: dollying (forward/back), panning (sideways) and rising/sinking.
    moveAxes() {
      return {
        forward: axis('forward', 'back'),
        sideways: axis('right', 'left'),
        rise: axis('up', 'down'),
      };
    },

    onLockChange(listener) { lockListeners.push(listener); },
  };
}
