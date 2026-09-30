// Mouse → botones del jugador local. Solo dos botones:
//   Click izq.: patear (mantener = potencia; subir la mira mientras cargás = altura). Sin la pelota: barrida.
//   Click der.: cubrir (con la pelota la protegés; sin la pelota, postura defensiva).
// El movimiento sale de la posición de la mira (lo calcula Game.jsx).
export function createMouseButtons() {
  const buttons = new Set()
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
  const onBlur = () => buttons.clear()
  window.addEventListener('mousedown', onMouseDown)
  window.addEventListener('mouseup', onMouseUp)
  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('contextmenu', onContextMenu)
  window.addEventListener('blur', onBlur)

  return {
    read() {
      return { kick: buttons.has(0), cover: buttons.has(2) }
    },
    dispose() {
      window.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('mouseup', onMouseUp)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('contextmenu', onContextMenu)
      window.removeEventListener('blur', onBlur)
    },
  }
}
