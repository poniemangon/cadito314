// Todas las unidades están en "px de mundo" y "ticks" (60 ticks = 1 segundo).
export const TICK_RATE = 60
export const DT = 1 / TICK_RATE

export const PLAYER = {
  radius: 15,
  height: 34, // la pelota pasa por encima si su base está más alta que esto (≈ altura del modelo 3D)
  accel: 0.1, // velocidad máx caminando ≈ accel / (1 - damping) = 2.5
  sprintAccel: 0.145, // ≈ 3.6
  damping: 0.96,
  dribbleFactor: 0.92, // se corre un poco más lento con la pelota
  brakeBoost: 2.8, // aceleración extra al moverte en contra de tu velocidad actual
  turnRate: 0.2, // radianes por tick que puede girar el cuerpo (180° en ~0,26 s)
  invMass: 0.5,
  bCoef: 0.5,
}

// Movimiento con la mira (o el joystick): la intensidad (0..1) sale de la distancia de la mira al jugador
export const MOVE = {
  stopDist: 22, // mira más cerca que esto: quieto
  sprintDist: 170, // mira más lejos que esto: corre (sprint)
  minMag: 0.3, // intensidad mínima al empezar a caminar
  sprintAt: 0.95, // intensidad desde la que se corre
}

export const STAMINA = {
  max: 100,
  drain: 0.45, // por tick corriendo (~3.7 s de sprint)
  regenIdle: 0.35,
  regenMoving: 0.18,
  recover: 25, // si llegás a 0 no podés volver a correr hasta tener esto
}

export const BALL = {
  radius: 7,
  invMass: 1,
  bCoef: 0.5,
  gravity: 0.25,
  groundDamping: 0.99,
  airDamping: 0.996,
  bounce: 0.5, // rebote contra el piso
  bounceFriction: 0.92,
  minBounce: 1.2,
  stopSpeed: 0.08, // por debajo de esto, rodando, la pelota se detiene
}

export const KICK = {
  reach: 6, // distancia extra (borde a borde) para poder patear
  maxHeight: 22, // más alta que esto, no se puede patear
  maxCharge: 50, // ticks para llegar a potencia máxima
  buffer: 10, // ticks que el tiro queda "pendiente" si soltás lejos de la pelota
  groundMin: 2.6,
  groundMax: 9,
  lobMinSpeed: 2.8,
  lobMaxSpeed: 7,
  lobMinLift: 3,
  lobMaxLift: 7.5,
  liftMax: 8, // impulso vertical máximo al subir la mira del todo (con potencia máxima)
  // media altura (click izq. + der.): tenso y bajo, pasa a la altura de las rodillas/cintura
  midMinSpeed: 3.5,
  midMaxSpeed: 8.5,
  midMinLift: 2.6, // el impulso vertical crece con la potencia: más alto y más tiempo en el aire
  midMaxLift: 4.7,
}

// Conducción (posesión estilo FIFA)
export const CONTROL = {
  radius: 7, // distancia extra (borde a borde) para dominarla
  keepExtra: 5, // el dueño actual la retiene con un poco más de margen
  maxHeight: 10,
  maxTrapSpeed: 5.5, // pelotas más rápidas que esto (relativas al jugador) no se dominan
  pull: 0.07,
  match: 0.22,
  maxPull: 1.2,
  sprintLead: 4, // corriendo, la pelota va un poco más adelantada (sin salir del radio de control)
  cooldown: 18, // ticks sin poder dominar después de patear o perderla
  stealMargin: 5,
}

// Quite (toque de click izq. sin la pelota) y barrida (click izq. cargado sin la pelota)
export const TACKLE = {
  slideThreshold: 12, // ticks de carga a partir de los cuales es barrida en vez de quite
  standRange: 36, // distancia (centro a centro) para sacarla parado
  standCooldown: 30,
  missTicks: 16, // si el quite falla, quedás trastabillando
  slideTicks: 26,
  slideMin: 4.5,
  slideMax: 7,
  slideBallReach: 8,
  slideHitReach: 4,
  getupTicks: 28, // después de barrer tardás en levantarte
  fallTicks: 55, // el derribado queda en el piso
  victimCooldown: 45,
  staminaCost: 12,
}

// Salto (Espacio) y cabezazo (click izq. en el aire)
export const JUMP = {
  speed: 4.2, // altura máx ≈ speed² / (2·gravity) ≈ 29
  gravity: 0.3,
  airControl: 0.25, // en el aire casi no podés cambiar de dirección
  staminaCost: 8,
  headerWindow: 8, // ticks que dura el intento de cabezazo después del click
  headerReach: 10, // distancia extra (borde a borde) para llegar de cabeza
  headMin: 22, // la pelota tiene que estar entre estas alturas respecto de tus pies
  headMax: 60,
  headerSpeed: 6.5,
  headerLift: 0.8,
}

// Postura defensiva (mantener Alt), como el "jockey" del FIFA: agachado, de frente a la pelota,
// moviéndose de costado. Cubre más y amortigua los tiros que le pegan.
export const JOCKEY = {
  speedFactor: 0.62, // se mueve más lento (y sin sprint)
  turnRate: 0.35, // gira rápido para quedar de frente a la pelota
  blockExtra: 5, // radio extra para tapar la pelota (piernas abiertas)
  bounce: 0.08, // la pelota casi no rebota: queda amortiguada
  shieldSpeed: 0.72, // cubriendo la pelota vas más lento
  shieldMargin: 14, // y al rival le cuesta más sacártela (tiene que estar bastante más cerca)
  blockPush: 0.9, // al taparla, la pelota queda adelante con esta velocidad (muerta)
}

export const WALL_BOUNCE = 0.5
export const NET_BOUNCE = 0.2
export const POST_BOUNCE = 0.6
export const POST_RADIUS = 6
export const MARGIN = 60 // pasto fuera de las líneas por donde pueden moverse los jugadores
export const HEIGHT_PROJECTION = 0.8 // cuánto "sube" en pantalla la pelota por unidad de altura

export const MATCH_TICKS = 180 * TICK_RATE
export const GOAL_PAUSE_TICKS = 150
export const OUT_PAUSE_TICKS = 50 // pausa después de que sale la pelota (fulbo)
export const SETPIECE_RADIUS = 60 // distancia que tienen que respetar los rivales en un saque

// Modalidades de juego
export const VARIANTS = {
  futsal: {
    label: 'Futsal',
    walls: true, // la pelota rebota en paredes sobre las líneas y nunca sale
    playerMargin: 0, // los jugadores quedan adentro de las paredes
    groundDamping: 0.994, // pelota más rápida (menos rozamiento)
    rollingFriction: 0.012, // frenado fijo por tick rodando (piso liso)
    airDamping: 0.997,
    wallBounce: 0.75,
    kickMult: 1.1,
  },
  fulbo: {
    label: 'Fulbo',
    walls: false, // la pelota sale: lateral, córner, saque de arco
    playerMargin: MARGIN,
    groundDamping: 0.99,
    rollingFriction: 0.028, // el pasto frena más
    airDamping: 0.996,
    wallBounce: 0.3, // contra los carteles de afuera
    kickMult: 1,
  },
}

export const FIELDS = {
  '1v1': { label: '1 vs 1', perTeam: 1, width: 800, height: 380, goalWidth: 130, crossbar: 50, goalDepth: 40, kickoffRadius: 70, areaDepth: 100, areaHeight: 200 },
  '2v2': { label: '2 vs 2', perTeam: 2, width: 1000, height: 460, goalWidth: 150, crossbar: 55, goalDepth: 40, kickoffRadius: 80, areaDepth: 120, areaHeight: 240 },
  '3v3': { label: '3 vs 3', perTeam: 3, width: 1200, height: 540, goalWidth: 170, crossbar: 60, goalDepth: 45, kickoffRadius: 90, areaDepth: 140, areaHeight: 280 },
  '5v5': { label: '5 vs 5', perTeam: 5, width: 1600, height: 720, goalWidth: 200, crossbar: 70, goalDepth: 50, kickoffRadius: 100, areaDepth: 180, areaHeight: 360 },
}

// Posiciones iniciales del equipo rojo como fracción de medio campo (x negativo = campo propio).
// El índice 0 es el más defensivo; el azul usa la misma formación espejada.
export const FORMATIONS = {
  1: [[-0.5, 0]],
  2: [[-0.7, 0], [-0.3, 0]],
  3: [[-0.85, 0], [-0.35, -0.35], [-0.35, 0.35]],
  5: [[-0.9, 0], [-0.6, -0.4], [-0.6, 0.4], [-0.25, -0.25], [-0.25, 0.25]],
}

export const TEAM_NAMES = { red: 'Rojo', blue: 'Azul' }

// Cámaras de juego
export const VIEWS = {
  '3d': { label: 'Isométrica' },
  tps: { label: 'Tercera persona' },
}
