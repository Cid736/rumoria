# TubeGrab y Rumoria: arquitectura tras la separación

La pestaña «Escuchar» de TubeGrab es ahora una app independiente, **Rumoria**. TubeGrab se queda con lo suyo: descargar, convertir y la biblioteca de archivos con su reproductor.

| | TubeGrab | Rumoria |
|---|---|---|
| Para qué | Descargar y convertir; tu biblioteca de archivos | Escuchar sin descargar: listas, favoritas, «Hecho para ti» |
| Repositorio | `Cid736/tubegrab` (`main`) | `Cid736/rumoria` (público, `main`) |
| Pila | Electron 44 + Express 5 + JavaScript sin framework | Electron 44 + Express 5 (servidor) · React 19 + Vite 8 + Zustand 5 (interfaz) |
| Tests | `node --test` (242) | `node --test` (49: servidor y seguridad) + Vitest (31: interfaz) |
| Datos | `%APPDATA%\tubegrab` | `%APPDATA%\rumoria` (copiados de TubeGrab la primera vez) |

---

## 1. Arquitectura

### 1.1 Qué se movió y qué se quedó

| Pieza | Antes (TubeGrab) | Ahora |
|---|---|---|
| Reproducir desde YouTube sin descargar (`lib/stream.js`) | TubeGrab | **Rumoria** |
| Listas de Spotify / Apple Music / YouTube (`lib/streamlists.js`) y perfiles de Spotify | TubeGrab | **Rumoria** |
| Historial de escucha, «Hecho para ti», resumen del año (`lib/listenlog.js`) | TubeGrab (Escuchar + Estadísticas) | **Rumoria** («Tu resumen») |
| Favoritas (`lib/likes.js`), Novedades de tus artistas (`lib/news.js`) | TubeGrab | **Rumoria** |
| Búsqueda de YouTube y listas en el mini reproductor; «poner una canción» desde el móvil | TubeGrab | Quitado de TubeGrab (lo hace Rumoria) |
| Biblioteca de archivos, su reproductor, ecualizador, letras `.lrc`, mini reproductor, modo juego, Last.fm, Discord, tele, el móvil | TubeGrab | **TubeGrab** (solo archivos locales) |
| Importar una lista de Spotify/Apple **para descargarla** | TubeGrab | **TubeGrab** |

Las dos apps se hablan en un solo sentido y sin servidor compartido. «Descargar con TubeGrab» en Rumoria abre `tubegrab://download?url=…`: TubeGrab rellena su cuadro de descarga y el usuario confirma. Rumoria, por su parte, lee tu carpeta de descargas de TubeGrab como «Tu música» (solo lectura).

```
┌──────────────────────── Rumoria (Electron) ────────────────────────┐
│ electron/main.js ── ventana sandbox, cookie httpOnly con el secreto │
│        │ fork (ELECTRON_RUN_AS_NODE) + secreto de 32 bytes          │
│        ▼                                                             │
│ server/main.js → server/app.js (Express, 127.0.0.1:puerto libre)     │
│   guard: Host + secreto + X-Rumoria · helmet/CSP · rate limit       │
│   lib/: stream · streamlists · listenlog · likes · news · importlist │
│         lyrics · ytdlp · localmusic · netfetch · migrate · lrc       │
│        ▲ /api/*                                   │ yt-dlp (execFile) │
│ dist/ (React) ── store/player · store/library · store/ui (Zustand)   │
│                  player/engine.js → un solo <audio>                  │
└─────────────────────────────── │ tubegrab://download?url=… ──────────┘
                                 ▼
┌──────────────────────── TubeGrab (Electron) ────────────────────────┐
│ electron-main.js · server.js (descargas, conversión, biblioteca)    │
│ public/app.js (Descargar, Convertir, Cola, Biblioteca + reproductor) │
└──────────────────────────────────────────────────────────────────────┘
```

### 1.2 Rumoria por dentro

**Proceso principal (`electron/main.js`)**
- Una sola instancia y una sola ventana con `contextIsolation`, `sandbox` y sin `nodeIntegration`. No navega fuera de su origen, no abre ventanas emergentes (solo enlaces de YouTube, Spotify y Apple Music, en el navegador) y no concede ningún permiso (cámara, micrófono…).
- Al arrancar genera un secreto de 32 bytes y lanza el servidor como proceso hijo. Electron hace de Node, así yt-dlp lo usa para resolver los retos de YouTube. El secreto se guarda en una cookie `httpOnly; SameSite=Strict`, que la página nunca puede leer.
- yt-dlp: su propia copia en `userData/bin`. Sale de la que trae la app, de la de TubeGrab o de la última versión publicada, y solo se instala si su SHA-256 coincide con `SHA2-256SUMS`. Una vez al día pasa `yt-dlp -U`.
- La primera vez copia de TubeGrab `stream-lists.json`, `listen-history.json`, `likes.json` y `news.json`. Solo copia (nunca mueve), nunca sobrescribe y solo acepta JSON válido.
- La página solo puede pedir unas pocas cosas por `preload.js`, cada una comprobada otra vez en el proceso principal (quién la pide y qué valores trae): los ajustes, elegir la carpeta de música (con un diálogo nativo, nunca una ruta que mande la página), «Descargar con TubeGrab» (solo un id de vídeo de 11 caracteres), las actualizaciones (estado, buscar, reiniciar), el mini reproductor (abrirlo, decirle qué suena, sus ajustes, sus botones) y el zoom (del 80 al 150 %).
- **El puerto se recuerda** entre arranques (`settings.json`). Así el origen de la página no cambia y lo que guarda en el navegador (tema, volumen, Recientes, tu aspecto) no se pierde. Si ese puerto está ocupado, se usa otro y se recuerda ese.
- **Actualizaciones (`electron/updater.js`):** 15 s después de arrancar y cada 6 h consulta la última release de `Cid736/rumoria`. Descarga en segundo plano el archivo de esta versión (instalador, portable o Lite), solo de GitHub, por HTTPS y comprobando cada redirección, a una carpeta temporal nueva, y lo conserva solo si su SHA-256 y su tamaño coinciden con lo que publica GitHub. «Actualizar a X» (o cerrar Rumoria) lo instala: el instalador en silencio, o en la portable un paso de PowerShell que recibe las rutas por variables de entorno (nunca dentro del texto del comando) y cambia el `.exe`.
- **Mini reproductor (`electron/mini.js`, `mini-preload.js`, `public/mini.*`):** una ventana sin marco, encima de las demás, con su propio preload mínimo. La música sigue en la ventana principal; el mini solo la muestra (texto con `textContent` y portadas de `i.ytimg.com`) y envía sus botones, de una lista cerrada (`toggle`, `next`, `prev`, `like`, `seek`, `volume`…), que el proceso principal comprueba antes de pasarlos a la página. Si cierras la ventana grande con el mini abierto, solo se oculta (`backgroundThrottling: false`) y la música sigue; al cerrar el mini, Rumoria se cierra.

**Servidor (`server/app.js`)**
- Escucha solo en `127.0.0.1`. Cada petición pasa por el mismo control de entrada:
  1. `Host` = `127.0.0.1:<puerto>` o `localhost:<puerto>` (contra DNS rebinding); si no, 421.
  2. Secreto (cookie o cabecera `X-Rumoria-Token` en desarrollo), comparado en tiempo constante; si no, 401.
  3. Toda petición que cambia algo necesita además `X-Rumoria: 1` (contra CSRF: otra web no puede enviarla sin un preflight CORS, y nunca se permite); si no, 403.
- Helmet con una CSP estricta (`script-src 'self'`, sin `unsafe-inline`), `nosniff`, `no-referrer` y `frame-ancestors 'none'`. JSON de 256 KB como máximo y límites de peticiones por minuto. Los errores devuelven un mensaje corto, nunca la traza.
- API:

| Ruta | Qué hace |
|---|---|
| `GET /api/search?q=` | Búsqueda en YouTube (solo vídeos válidos) |
| `GET /api/find?q=&d=&list=&n=` | Canción conocida por su nombre → su vídeo (se recuerda en la lista) |
| `GET /api/stream/{info,audio,radio,lyrics}?id=` | Información, audio con `Range` (solo desde `*.googlevideo.com`), radio, letra |
| `GET/POST/PATCH/DELETE /api/lists…` | Listas: importar (Spotify, Apple, YouTube, perfil de Spotify), crear, mover, quitar, deshacer, releer |
| `POST /api/history`, `GET /api/history/{smart,summary}`, `PATCH /api/history/settings`, `DELETE /api/history` | Historial de escucha |
| `GET/POST /api/likes`, `POST /api/likes/remove` | Favoritas |
| `GET /api/news` | Novedades de tus artistas |
| `POST /api/lists/auto` | Lista que se llena sola: `{ q, every, folder? }`. El tema es texto plano (sin caracteres de control, 100 como máximo) y solo va detrás de `--` (`ytsearch30:` o la URL de búsqueda de playlists). Se guardan títulos e ids, nunca audio. `POST /api/lists/:id/refresh` busca canciones nuevas y `PATCH` cambia la frecuencia o la para (`auto: null`) |
| `GET` / `PATCH /api/curator`, `POST /api/curator/run` | «Para ti» (`server/lib/curator.js`): estado, encendido, renovar cada 3/7/14 días y renovar ahora. Los géneros se calculan en local cruzando los artistas de tu historial con los de cada categoría de Explorar; la predicción es la categoría que comparte más artistas con las tuyas y que aún no escuchas, alternando semana a semana entre las 3 mejores |
| `GET /api/browse`, `GET /api/browse/:id` | «Explorar»: listas ya hechas. Cada id tiene una búsqueda fija de playlists de YouTube (nunca texto de la página); solo canciones, en caché 6 h |
| `GET /api/local`, `POST /api/local/rescan`, `GET /api/local/file?id=` | Tu carpeta de música (por id, nunca por ruta) |

- En segundo plano: las listas «al día» se releen cada pocas horas y las novedades de tus artistas se buscan cada 12 h.

**v1.3: rendimiento, reproducción y recomendaciones**

- **Perfiles de rendimiento (`src/store/perf.js`, `server/lib/prefs.js`):** Automático (con los núcleos y la memoria del equipo, que da el proceso principal), Mínimo, Medio o Alto. La página pone `data-perf` en `<html>` (los estilos apagan desenfoques, sombras y movimiento en Mínimo) y el servidor recibe el perfil por `PATCH /api/prefs` (Mínimo no lee Explorar por adelantado ni prepara canciones; Medio, las destacadas; Alto, todas). Además: portadas pequeñas en Mínimo, comprobaciones menos frecuentes y filas de listas largas con `content-visibility: auto`.
- **Carga y reintentos (`src/player/engine.js`):** la siguiente canción (o las dos siguientes, en Alto) se resuelve por adelantado (`POST /api/stream/prepare`). Una canción que falla o se queda cargando 20 s se reintenta hasta 3 veces con `fresh=1`, y el servidor busca su dirección de nuevo, como mucho una vez cada 10 s por canción. Tras el tercer fallo se olvida (`POST /api/stream/forget`), y si viene de una lista de más de 50 canciones se quita de la lista (con «Deshacer») y de la cola. La caché de direcciones dura 4 h y guarda hasta 400.
- **Listas que se vuelven a leer (`streamlists.reread`):** si la lectura llega vacía, la lista se queda como estaba. Las canciones que quitaste no vuelven (`gone`, por artista y título o por vídeo), las que añadiste tú se conservan al final (`mine`) y los vídeos ya encontrados se mantienen. Una lectura por lista a la vez. Spotify a veces devuelve la página sin canciones (1 de cada 3 lecturas en las pruebas): se reintenta hasta 4 veces.
- **Sonido (`src/player/sound.js`, `src/store/sound.js`):** una cadena de Web Audio que solo se monta cuando hace falta: karaoke, ecualizador de 5 bandas, limitador, mismo volumen (medido mientras suena y recordado por canción), fundido, fundido del temporizador y salida. También velocidad con o sin mantener el tono, la salida elegida (`setSinkId`) y pausa al desconectar una salida de audio.
- **Sesión (`src/player/session.js`):** la cola (hasta 500 canciones, cada campo comprobado), la canción, el segundo y el modo de repetir se guardan al cambiar de canción y cada 5 s, y vuelven al abrir. La canción arranca en su segundo cuando ya se puede (`resumeAt`).
- **Segundo plano (`electron/tray.js`):** con «Al cerrar, seguir sonando en la bandeja», cerrar oculta la ventana (`backgroundThrottling: false`) y aparece un icono en la bandeja con la canción, reproducir/pausa, siguiente, anterior, abrir y salir.
- **Mini reproductor v2:** la portada difuminada de fondo, la línea de la letra que suena (el puente baja la letra solo si el mini la muestra), la siguiente canción, aleatorio, repetir y volumen, y el videoclip: `GET /api/stream/video` (formato de vídeo de 360p sin sonido, por el mismo relé que el audio, solo desde `*.googlevideo.com`) en un `<video muted>` que sigue el tiempo de la canción. La CSP no cambia (`media-src 'self'`).
- **Recomendaciones (`src/views/recommend.js`):** una canción que aparece en las mezclas de varias de tus canciones puntúa más, y más cuanto más arriba esté. Las que saltas (`smart.skipped`) quedan fuera, los artistas que sueles saltar (`smart.cold`) van al final y hay como mucho 2 canciones por artista (reconocido por el título, no por el canal). «Para hoy» se hace con tus 6 últimas canciones y se rehace cuando cambian (como mucho cada 2 h) o al día siguiente.
**v1.6.3: vídeos que YouTube ya no sirve**

- **Filtro:** `ytdlp.isUnavailable` descarta los vídeos sin título, los `[Private video]` / `[Deleted video]` (también en español) y los que tienen `availability` privada o solo para miembros. Se aplica en `flatList`, así que cubre Explorar, las radios, las importaciones de YouTube y las listas que se llenan solas; nunca quita listas ni canales que salgan en una búsqueda. `songsOf` (Explorar) lo vuelve a aplicar al leer la caché del disco, y `cleanTrack` quita esas entradas de las listas guardadas.
- **Caché de Explorar:** cada lista guarda la búsqueda con la que se hizo (`q`). Si la búsqueda cambia en una versión nueva, la lista se lee de nuevo al momento y se sustituye aunque salga más corta.
- **«Recientes»:** las listas de Explorar muestran las portadas que tienen ahora, no las que se guardaron al ponerlas.

**v1.6: estilo de la interfaz y búsquedas recientes**

- **Barra de título propia:** la ventana usa `titleBarStyle: 'hidden'`, así que Windows deja de dibujar su barra. Sigue pudiendo cambiar de tamaño, ajustarse a los lados y maximizarse con doble clic en la zona de arrastre. La dibuja `TitleBar.jsx`, con la zona de arrastre marcada con `-webkit-app-region` y los botones fuera de ella. Esos botones mandan `rumoria:window` (solo `minimize`, `maximize`, que alterna con restaurar, y `close`, que se comporta como la X: bandeja o mini si toca), siempre comprobando quién lo envía. El proceso principal avisa con `rumoria:windowState` (`maximized`, `fullscreen`). En pantalla completa la barra desaparece (`data-titlebar`).
- **Estilo (`look.ui`: `rumoria`, `windows`, `mac`):** `data-ui` en `<html>` y `src/styles/ui.css`. Cada estilo cambia la letra, los colores de las superficies (oscuro y claro), las esquinas (solo si «Esquinas» está en «Normales»), los interruptores, los bordes y los botones de la ventana. Windows usa los botones a la derecha y el cierre en rojo. Mac usa los tres botones a la izquierda, el título centrado, la biblioteca y los menús translúcidos (sin desenfoque en el perfil Mínimo) y un brillo del acento de fondo. No se usan los materiales Mica ni Acrílico de Windows: dependen de la versión de Windows, y con un estilo sólido se ve igual en todas. El mini lee el estilo de `rumoria_look` y cambia la letra y las esquinas.
- **Guía de bienvenida (`src/components/Guide.jsx`):** cinco pasos. El primero deja elegir el estilo y el tema. Se abre sola si `rumoria_guide.show` es verdadero, y si no está guardado, solo para quien no ha usado Rumoria antes (sin `rumoria_look`, `rumoria_recent`, `rumoria_session` ni `rumoria_volume`). Al cerrarla, «No volver a mostrarla» (marcada por defecto) la apaga. Ajustes → Guía de bienvenida tiene el interruptor y «Ver la guía». Se maneja con las flechas y Esc.
- **Fondo (v1.6.1, `look.bg`, `src/styles/backgrounds.css`):** `data-bg` en `<html>` cambia `--bg` y `--surface` a `--surface-3`, cada uno con su versión clara y oscura. Se carga después de `ui.css`, así que vale con cualquier estilo. «Según el estilo» quita el atributo. «Teñido de tu color» mezcla el acento con `color-mix`. El mini lee lo mismo de `rumoria_look`. Ya no hay brillo del acento detrás del estilo Mac.
- **Búsquedas recientes (`src/store/searches.js`):** `rumoria_searches`, con un máximo de 30, la más nueva primero y sin repetir (sin contar mayúsculas ni acentos). Al leerlas se limpian: una línea de 2 a 200 caracteres. Una búsqueda se guarda cuando sus resultados llevan 1,5 s en pantalla, cuando pones uno o cuando pulsas Intro, así no se guarda cada letra que escribes. Se quitan una a una o todas («Deshacer» las devuelve), y con «Guardar lo que busco» apagado no se guarda nada y se borra lo que había.

**v1.5: atajos globales, «No me recomiendes», Historial, listas, enlaces, «Sonando» y mini v3**

- **Atajos globales (`electron/shortcuts.js`):** `globalShortcut` de Electron. Cada combinación se comprueba (`cleanAccel`): debe llevar Ctrl, Alt o Win, solo con teclas conocidas y sin repetir una combinación entre acciones. Se guardan en `settings.json` y, si otra aplicación ya tiene una, se informa en `failed` en vez de forzarla. Reproducir, siguiente, anterior y favorita van a la página como las órdenes del mini; el volumen va en pasos (`volumeStep`, ±0,05 como mucho); el mini y mostrar Rumoria los resuelve el proceso principal. Puertas nuevas en el preload: `rumoria:shortcuts` y `rumoria:setShortcuts` (las dos comprueban quién pregunta).
- **«No me recomiendes» (`server/lib/hidden.js`, `src/store/hidden.js`):** `hidden.json` guarda hasta 500 canciones (por clave) y 200 artistas (por nombre, comparado sin «- Topic», «VEVO», «Official» ni símbolos, y también por el «Artista - Título» del título). El servidor los quita de `/api/stream/radio`, `/api/browse/:id`, `/api/news`, de lo que encuentran las listas que se llenan solas y «Para ti» (`songsFor`) y de las semillas de las mezclas (`smart.artists`). La página los quita de las semillas de «Radios para ti», de «Para hoy» y «Descubre» (también de lo guardado) y de las radios populares de Inicio. «Lo más escuchado» y tu historial no se tocan.
- **Historial (`GET /api/history/recent`, `src/views/History.jsx`):** escuchas de los últimos 1 a 366 días, de la más nueva a la más vieja (500 como mucho). Si la misma canción suena dos veces seguidas, cuenta como una escucha y se suman sus segundos; `played` dice si llegó a contar como escuchada. Se agrupan por día (Hoy, Ayer, fecha) en la página.
- **Ordenar listas (`src/lib/sorting.js`):** el orden es una vista: la lista no cambia y cada canción conserva su posición `n`, así que quitar canciones y marcar la que suena siguen funcionando. Arrastrar para reordenar se desactiva mientras hay otro orden puesto. «Más escuchadas» usa `GET /api/history/counts`, que se pide como mucho una vez por minuto. El orden elegido se guarda por lista en `rumoria_sorts`, y al leerlo solo se aceptan valores conocidos.
- **Quitar repetidas (`streamlists.dedupe`, `POST /api/lists/:id/dedupe`):** se queda la primera aparición de cada canción. Dos son la misma si comparten vídeo, o si coinciden el primer artista y el título después de quitar los paréntesis de «(Official Video)», «[Lyrics]» o «(feat. …)» y los añadidos del canal. Los paréntesis como «(Remix)» o «(Live)» no se quitan, así que esas versiones se quedan. A diferencia de quitar una canción a mano, no se anota en `gone`, porque si no la canción que se queda desaparecería al releer la lista.
- **Enlaces arrastrados (`src/lib/links.js`, `DropLink.jsx`):** `classifyLink` solo acepta direcciones http(s) de YouTube, Spotify o Apple Music, sin usuario ni contraseña. Un vídeo (`v=`, `youtu.be`, `/shorts/`) suena y después se añade su radio. Una playlist (`PL…`, `OLAK…`; las mezclas `RD…` cuentan como un vídeo) o un enlace de Spotify o Apple Music se importa, y el servidor lo vuelve a comprobar. No reacciona a las filas que arrastras dentro de una lista ni a los archivos.
- **Sonando (`NowPlaying.jsx`, `ClipVideo.jsx`, `src/player/useLyrics.js`):** pide pantalla completa. Es el único permiso que se concede, y solo a la ventana principal en su propio origen (`setPermissionRequestHandler`). Muestra la portada `hqdefault` o el videoclip por el mismo relé que el mini, la letra sincronizada (el mismo hook que el panel Letra) y las tres siguientes. Si el ratón está 3 s quieto, el puntero y los controles se esconden. Esc, o salir de la pantalla completa, lo cierra.
- **Bandeja y mini v3:** el estado que se envía (`cleanState`) añade `muted` y `queue`, con las 5 siguientes: posición, título y artista, como texto. Las órdenes nuevas son `jump` (una posición entera, solo hacia delante) y `mute`. El mini tiene una forma nueva, «Tarjeta» (300×470, prefs `card`). La barra se mueve sola entre actualizaciones (`requestAnimationFrame`). Hay panel «A continuación», rueda para el volumen o para avanzar, teclas, y al soltarlo cerca de un borde se pega a él (`mini:dragEnd`, a menos de 24 px). Los iconos son SVG dentro del HTML: sin código ni estilos en línea, porque la CSP los bloquea.

**v1.4: estanterías que rotan**

- **`src/views/rotation.js`:** «Explorar», «Radios populares» y «Si te gusta» se eligen al azar con peso (Efraimidis–Spirakis, con semilla), de modo que la misma semilla da la misma selección. La semilla cambia cada 3 h, cada día o en cada arranque (`look.rotate`), y «Otras» cambia solo la de su estantería (`turns`). Lo que se enseñó la vez anterior pesa un 35 %. Tus géneros tienen asientos fijos (`pickLeaning`): un tercio de Explorar y la mitad de las radios, por turnos entre ellos. Mientras dura una selección, la estantería no cambia aunque lleguen géneros o portadas nuevas (`settled`). Se guarda en `rumoria_rotation`, limpiado campo a campo al leerlo.
- **Tus géneros, al momento:** `GET /api/browse` devuelve `taste`, calculado en el equipo por `Curator.taste()` (el mismo cálculo que «Para ti», sin pedir nada a la red; se guarda 1 minuto). Con el historial en pausa no hay géneros.
- **Radios populares:** unas 60 en `server/lib/browse.js`, cada una con las categorías a las que pertenece (`tags`). Las 12 primeras se leen por adelantado; el resto, cuando Inicio las muestra sin portada (hasta 4 seguidas, nunca en el perfil Mínimo) o cuando las abres.
- **«Si te gusta»:** uno de tus artistas (más probable cuanto más lo escuchas). Sus 20 vecinos de la mezcla de YouTube se guardan un día (`rumoria_similar`, hasta 8 artistas tuyos, con las portadas solo de `i.ytimg.com`), y se enseñan 8: los más cercanos, más a menudo.
- **Actualizador:** al arrancar borra las carpetas `rumoria-update-XXXXXX` de actualizaciones anteriores, solo si son carpetas de verdad y tienen más de 10 minutos.

- **Permisos:** sigue sin concederse ninguna petición (micrófono, cámara…). La única comprobación que pasa es la de la ventana principal sobre su propio origen para ver las salidas de audio y elegir una (`media`, `speaker-selection`).

**Interfaz (`src/`)**

```
src/
├─ main.jsx · App.jsx        diseño, tema, atajos de teclado
├─ api.js                    cliente: cookie, X-Rumoria, errores legibles
├─ store/
│  ├─ look.js                tu aspecto: color, tamaño, densidad, esquinas, movimiento, estanterías (solo valores conocidos)
│  ├─ player.js              cola, índice, quiero-sonar, posición, volumen, repetir, aleatorio, radio
│  ├─ library.js             listas, favoritas (optimista, con vuelta atrás), historial, novedades, carpeta
│  └─ ui.js                  vista con atrás/adelante, panel lateral, menús, diálogos, avisos
├─ lib/queue.js · tracks.js  reglas puras (cola, aleatorio, mezclas, formatos): probadas sin navegador
├─ player/miniBridge.js      la página ↔ el mini reproductor (estado a ráfagas de 250 ms, botones de vuelta)
├─ player/engine.js          hace que un <audio> siga al store: carga, busca, registra lo escuchado,
│                            radio al acabar, teclas multimedia (Media Session)
├─ components/               Sidebar, TopBar, PlayerBar, SidePanel (cola/letra), TrackTable, Overlays…
└─ views/                    Home, Search, Pages (lista, Favoritas, Tu música, mix), Summary, Settings
```

La decisión clave de diseño es que **el store solo guarda estado e intención** (`wantPlaying`, `seekTo`, `queue`); el motor es el único que toca `<audio>`. Así la barra del reproductor, la tabla de canciones, la cola y la letra leen del mismo sitio, y la lógica se prueba sin navegador de audio.

**Diseño:** una disposición conocida de app de música (biblioteca a la izquierda, página en el centro, cola o letra a la derecha y reproductor abajo) con identidad propia: fondo tinta, acento coral, tarjetas redondeadas y tema claro y oscuro. No copia colores, nombres ni el aspecto de Spotify.

### 1.3 TubeGrab tras la separación

Se quitó, sin dejar rutas muertas:
- **Servidor:** las rutas `/api/stream/*`, `/api/streamlists*` y `/api/listen*` (316 líneas) y los módulos `stream`, `streamlists`, `listenlog`, `likes` y `news`. También salió la importación de perfiles de Spotify de `lib/importlist.js` (la de listas para descargar se queda).
- **Página:** la vista Escuchar (1.027 líneas de `app.js`), la reproducción de YouTube dentro del reproductor (búsqueda, radio de YouTube, registro de escucha, «tu archivo en vez del streaming»), el resumen anual de Estadísticas y los botones «▶ Rumoria todo» y «Guardar como lista» de Buscar. Ctrl+K ya no muestra listas.
- **Mini reproductor:** se quitan las pestañas Buscar y Listas; se quedan «A continuación» y «Ajustes».
- **Móvil:** se quita «poner una canción por su nombre» y las carátulas de YouTube (su CSP pasa a `img-src 'none'`).
- **Electron:** los comandos `stream`, `enqueue`, `playList`, `playQuery` y `save`, y el botón de YouTube en Discord.
- **Estilos y textos:** 296 selectores CSS y 179 traducciones que solo usaba Escuchar, detectados comparando con `HEAD` (no a ojo).

Las comprobaciones para que la limpieza fuera segura:
- Antes y después de cada archivo editado se compararon los identificadores no definidos o sin usar (ESLint `no-undef`/`no-unused-vars` sobre `HEAD` y sobre el cambio): 0 nuevos en `app.js`, `mini.js`, `server.js`, `electron-main.js` y `remote.js`.
- Un test nuevo comprueba que ninguna ruta de Escuchar responde ya en TubeGrab, ni en la web ni en el escritorio, y que no se crean sus archivos de datos.
- Se probó en la app real: la Biblioteca reproduce, la cola, Estadísticas, Ctrl+K y el mini reproductor, todo sin errores en consola.

---

## 2. Levantar los entornos en local

Requisitos: **Windows 10/11, Node 22 o superior, Git**. (Los dos generan binarios de Windows; los tests corren también en Linux.)

### 2.1 TubeGrab

```powershell
git clone https://github.com/Cid736/tubegrab.git
cd tubegrab
git switch split/listen-app      # hasta que se fusione en main
npm install                      # postinstall descarga ffmpeg verificado (bin/ffmpeg.exe)
# yt-dlp.exe junto a package.json (o el que ya tengas)
npm test                         # 242 tests
npm start                        # servidor web en http://localhost:3000
npx electron .                   # la app de escritorio desde el código
```

Para probar sin tocar tus datos: `$env:TUBEGRAB_USER_DATA="C:\ruta\temporal"` antes de `npx electron .` (y quita `ELECTRON_RUN_AS_NODE` si lo tienes definido).

### 2.2 Rumoria

```powershell
git clone https://github.com/Cid736/rumoria.git
cd rumoria
npm install
npm run fetch-ytdlp              # yt-dlp verificado por SHA-256 en bin/ (opcional: también lo toma de TubeGrab)
npm test                         # servidor + seguridad (node --test) e interfaz (Vitest)
npm run dev                      # servidor + Vite: abre http://127.0.0.1:5173 (sin las funciones de escritorio)
npm start                        # compila la interfaz y abre la app de escritorio
npm run dist                     # instalador (Rumoria-Setup.exe) con electron-builder
```

Variables útiles:

| Variable | Para qué |
|---|---|
| `RUMORIA_USER_DATA` | Carpeta de datos aparte (pruebas, un segundo perfil) |
| `RUMORIA_DEV_PORT` | Puerto del servidor en `npm run dev` (por defecto 5174) |
| `RUMORIA_YTDLP` | Usar un yt-dlp concreto |

### 2.3 Crear el repositorio de Rumoria en GitHub

```powershell
cd C:\Users\ericc\OneDrive\Desktop\C\Rumoria
gh repo create Cid736/rumoria --public --source . --remote origin --push   # así se creó
# (o privado: --private)
gh repo edit --enable-issues --delete-branch-on-merge
```

Después, en GitHub: *Settings → Code security* activa **Dependabot alerts**, **Secret scanning** y **Push protection**. Los flujos de `.github/` (CI, CodeQL y Dependabot) arrancan solos con el primer push.

---

## 3. Tests de calidad y seguridad

### 3.1 Cómo ejecutarlos («los tests de siempre»)

| Proyecto | Comando | Qué corre |
|---|---|---|
| TubeGrab | `npm test` | Unitarios e integración con `node --test` (servidor real arrancado en un puerto libre, ffmpeg real cuando está) |
| Rumoria | `npm test` | `test:server` (unitarios e integración del servidor) + `test:ui` (Vitest + Testing Library) |
| Rumoria | `npm run test:security` | Solo la suite de seguridad |
| Rumoria | `npm run lint` | ESLint con `eslint-plugin-security` y las reglas de React Hooks |
| Rumoria | `npm run audit` | `npm audit` de las dependencias de producción (falla con severidad alta) |

### 3.2 Suite de seguridad de Rumoria (`test/security/security.test.js`)

| Riesgo | Qué se comprueba |
|---|---|
| **Acceso sin autorización** (OWASP A01/A07) | Las 35 rutas (también `/api/browse`, `/api/lists/auto` y `/api/curator`) devuelven 401 sin el secreto; un secreto falso (misma longitud, más corto, con un carácter de más) se rechaza; el servidor no arranca sin un secreto de 64 hex |
| **DNS rebinding** | Solo responde a `Host` 127.0.0.1/localhost con su puerto; otro host, otro puerto o ningún `Host` → rechazado |
| **CSRF / CORS** | Un POST «simple» de otra web, aunque lleve la cookie, se rechaza (403) sin cambiar nada; nunca hay `Access-Control-Allow-Origin` |
| **Inyección** (A03) | Ids de vídeo con `--exec`, `;`, `../`, `%00`, parámetros duplicados → 400 y **nada llega a yt-dlp**; la búsqueda va en una sola línea y siempre después de `--`; ids de lista con trucos de ruta → 404; *prototype pollution* por JSON sin efecto; el texto guardado vuelve como JSON con `nosniff` y la interfaz lo pinta como texto (test de XSS en React) |
| **SSRF** (A10) | Solo enlaces de Spotify, Apple Music o YouTube; `127.0.0.1`, `169.254.169.254`, `file://`, `[::1]`, `gopher://` → 400 sin pedir nada; el cliente de red solo conecta con IPs públicas (también tras DNS y redirecciones); el audio solo viene de `*.googlevideo.com` |
| **Path traversal** | Tus archivos solo por id y dentro de tu carpeta (también si se mueven o son enlaces); los archivos ocultos y `../` de la web → 403/404 |
| **Exposición de datos** (A05) | Los errores son cortos, sin trazas, rutas ni el secreto; la página nunca ve la dirección del audio de YouTube; JSON demasiado grande → 413 |
| **Cabeceras** | CSP sin `unsafe-inline` ni `unsafe-eval`, `nosniff`, `no-referrer`, sin `X-Powered-By`, límites de peticiones (y un test que los agota → 429) |
| **Electron** | Comprobación estática de que siguen `sandbox`, `contextIsolation`, sin `nodeIntegration`, bloqueo de navegación y `webview`, permisos denegados, cookie `httpOnly` y `SameSite=Strict`; cada IPC comprueba quién lo pide; el preload no expone `ipcRenderer`; yt-dlp solo con SHA-256 y desde GitHub |

TubeGrab conserva su propia batería (pruebas de ataque al servidor, al móvil, a las subidas y al protocolo `tubegrab://`). Ahora incluye además el test de que las rutas de Rumoria ya no existen.

### 3.3 CI/CD y análisis estático (Rumoria, en `.github/`)

- **`ci.yml`**: en cada push y PR corre lint, tests del servidor y de la interfaz y la compilación en **Windows y Ubuntu**. Un segundo trabajo pasa la suite de seguridad, `npm audit --omit=dev --audit-level=high` y **gitleaks** (secretos subidos por error). En los PR se añade **dependency-review** (bloquea dependencias nuevas con vulnerabilidades altas).
- **`codeql.yml`**: CodeQL con las consultas `security-extended`, en cada push, en cada PR y cada lunes.
- **`dependabot.yml`**: actualizaciones semanales de npm (las de desarrollo agrupadas) y mensuales de las Actions.

Para TubeGrab, el mismo `codeql.yml` y `dependabot.yml` sirven tal cual. Su `ci.yml` sería el de Rumoria con `npm test` en lugar de los tres pasos de test.

### 3.4 Resultados en el momento de la separación

| | Resultado |
|---|---|
| TubeGrab `npm test` | 242 superados, 0 fallos, 2 omitidos (dependen de herramientas opcionales) |
| Rumoria `npm test` | 49 + 31 superados, 0 fallos |
| Rumoria `npm run lint` | 0 errores; 10 avisos de `eslint-plugin-security` sobre expresiones regulares del código heredado (entradas ya acotadas en longitud) |
| `npm audit` (producción) | 0 vulnerabilidades en las dos apps. En desarrollo, Rumoria tiene 8 moderadas en `sprintf-js` (herramientas de compilación; no viajan en la app) |
| Pruebas en la app real | Rumoria: arranque, migración de tus datos, reproducción desde una lista de Spotify, búsqueda, letra sincronizada y Tu resumen. TubeGrab: Biblioteca, reproductor, cola, Estadísticas, Ctrl+K y mini reproductor |

### 3.5 Revisión de seguridad y fallos tras las recomendaciones (2026-10-07)

Revisado: `server/lib/browse.js`, las rutas `/api/browse*` y el trabajo en segundo plano, `src/views/Home.jsx`, `recommend.js`, `Discover.jsx` y el almacén de «Recientes». En TubeGrab, la ruta `/api/rumoria/latest` y su página. El detalle está en [BUGLOG.md](../BUGLOG.md).

| | Resultado |
|---|---|
| Fallos encontrados y arreglados | 6 (3 del servidor, 3 de la interfaz), con sus tests |
| Rumoria `npm test` | 55 + 37 superados, 0 fallos |
| Rumoria `npm run lint` | 0 errores; 11 avisos de `eslint-plugin-security` sobre expresiones regulares con entradas ya acotadas en longitud |
| TubeGrab `npm test` | 242 superados, 0 fallos |
| `npm audit` (producción) | Rumoria: 0. TubeGrab tenía 1 crítica (`proxy-addr` ≤ 2.0.7, suplantación de IP con una subred de confianza IPv4-mapeada), ya actualizada a 2.0.8. En la práctica no le afectaba: `trust proxy` solo se activa con `TRUST_PROXY` y por número de saltos |

### 3.6 Pendiente o fuera de alcance

- **«Mantener descargada una lista»** y **«guardar solas las que más escucho»** necesitaban la cola de descargas de TubeGrab dentro del mismo proceso. En Rumoria se sustituyen por «Descargar con TubeGrab» canción a canción. Para recuperarlas haría falta una API entre las dos apps (por ejemplo, el mismo `tubegrab://` con varias URL).
- La migración de datos copia; los archivos originales siguen en `%APPDATA%\tubegrab` hasta que los borres.
