// Teclado + mouse → input del jugador local.
// WASD (o flechas): mover · Shift: correr · Mouse: apuntar
// Click izq.: rasante (con la pelota) / quite (sin la pelota) / barrida (sin la pelota, mantenido)
// Click der.: por arriba · Los dos a la vez: media altura · Mantener carga la potencia.
// Espacio: saltar · Click izq. en el aire: cabezazo · Alt: postura defensiva
const GAME_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight', 'Space', 'AltLeft', 'AltRight'])

export function createKeyboard() {
  const down = new Set()
  const buttons = new Set()
  const onDown = (e) => {
    // Alt (defender) + otra tecla: bloquear los atajos del navegador (Alt+D, Alt+F…)
    if (GAME_KEYS.has(e.code) || e.altKey) e.preventDefault()
    down.add(e.code)
  }
  const onUp = (e) => {
    // soltar Alt solo no tiene que activar el menú del navegador
    if (e.code === 'AltLeft' || e.code === 'AltRight') e.preventDefault()
    down.delete(e.code)
  }
  const onMouseDown = (e) => {
    e.preventDefault()
    buttons.add(e.button)
  }
  const onMouseUp = (e) => buttons.delete(e.button)
  // Si soltás el botón fuera de la ventana no llega el mouseup y el click queda "pegado":
  // en cada movimiento sincronizamos con los botones realmente apretados (e.buttons).
  const onMouseMove = (e) => {
    if (!(e.buttons & 1)) buttons.delete(0)
    if (!(e.buttons & 2)) buttons.delete(2)
  }
  const onContextMenu = (e) => e.preventDefault()
  const onBlur = () => {
    down.clear()
    buttons.clear()
  }
  window.addEventListener('keydown', onDown)
  window.addEventListener('keyup', onUp)
  window.addEventListener('mousedown', onMouseDown)
  window.addEventListener('mouseup', onMouseUp)
  window.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseleave', onBlur)
  window.addEventListener('contextmenu', onContextMenu)
  window.addEventListener('blur', onBlur)

  return {
    read() {
      return {
        up: down.has('KeyW') || down.has('ArrowUp'),
        down: down.has('KeyS') || down.has('ArrowDown'),
        left: down.has('KeyA') || down.has('ArrowLeft'),
        right: down.has('KeyD') || down.has('ArrowRight'),
        sprint: down.has('ShiftLeft') || down.has('ShiftRight'),
        shoot: buttons.has(0),
        lob: buttons.has(2),
        jump: down.has('Space'),
        jockey: down.has('AltLeft') || down.has('AltRight'),
      }
    },
    dispose() {
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup', onUp)
      window.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('mouseup', onMouseUp)
      window.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseleave', onBlur)
      window.removeEventListener('contextmenu', onContextMenu)
      window.removeEventListener('blur', onBlur)
    },
  }
}
