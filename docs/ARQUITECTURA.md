# TubeGrab y Rumoria: arquitectura tras la separación

La pestaña «Escuchar» de TubeGrab es ahora una app independiente, **Rumoria**. TubeGrab se queda con lo suyo: descargar, convertir y la biblioteca de archivos con su reproductor.

| | TubeGrab | Rumoria |
|---|---|---|
| Para qué | Descargar y convertir; tu biblioteca de archivos | Escuchar sin descargar: listas, favoritas, «Elegido para ti» |
| Repositorio | `Cid736/tubegrab` (`main`) | `Cid736/rumoria` (público, `main`) |
| Pila | Electron 44 + Express 5 + JavaScript sin framework | Electron 44 + Express 5 (servidor) · React 19 + Vite 8 + Zustand 5 (interfaz) |
| Tests | `node --test` (242) | `node --test` (servidor y seguridad) + Vitest (interfaz) + Playwright (la app de verdad, capturas) |
| Datos | `%APPDATA%\tubegrab` | `%APPDATA%\rumoria` (copiados de TubeGrab la primera vez) |

---

## 1. Arquitectura

### 1.1 Qué se movió y qué se quedó

| Pieza | Antes (TubeGrab) | Ahora |
|---|---|---|
| Reproducir desde YouTube sin descargar (`lib/stream.js`) | TubeGrab | **Rumoria** |
| Listas de Spotify / Apple Music / YouTube (`lib/streamlists.js`) y perfiles de Spotify | TubeGrab | **Rumoria** |
| Historial de escucha, «Elegido para ti», resumen del año (`lib/listenlog.js`) | TubeGrab (Escuchar + Estadísticas) | **Rumoria** («Tu resumen») |
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
**v1.12.3: cerrar el reproductor del móvil, y aleatorio y repetir en la notificación**

- **La barrita de la app** tiene una X: para la música y vacía la cola (`usePlayer.close()`), así que la barrita desaparece. La sesión guardada también se borra, para que no vuelva a salir al abrir la app.
- **La notificación:**
  - si la deslizas para quitarla (Android solo lo deja en pausa), se cierra también el reproductor (`setDeleteIntent` → `close`);
  - si se cierra en la app, la página manda «no suena nada», y la notificación, el primer plano y el servicio se van (`closeNotification`). Antes la notificación se quedaba a la vista;
  - lleva aleatorio y repetir, cada uno diciendo si está encendido. En Android 13 y posteriores son los dos botones extra de los controles del sistema (`CustomAction` en el `PlaybackState`), y hasta Android 12, botones de la notificación. También responden a `ACTION_SET_SHUFFLE_MODE` y `ACTION_SET_REPEAT_MODE`, para el coche y el Bluetooth.
- **Favorita** no cabe en la notificación (Android 13 solo deja dos botones extra), así que sigue en el corazón de la barrita.
- Los iconos (`ic_shuffle*`, `ic_repeat*`) están dibujados para Rumoria, no copiados de un juego de iconos.

**v1.12.2: rendimiento y sin restos**

- **El visualizador gastaba un cuarto de núcleo** mientras sonaba la música, con la ventana visible: un 29 % de un núcleo en total, frente al 4 % sin él. Cada fotograma volvía a pintar la barra del reproductor, que tiene detrás la portada con `blur(40px)`, y además llevaba un `drop-shadow` en CSS. Lo que se ha cambiado:
  - el lienzo y la portada desenfocada van en capas propias (`will-change`);
  - la sombra se dibuja dentro del lienzo;
  - se dibuja a 30 fotogramas por segundo, no a 60, y no se redibuja si las barras no se mueven.

  Medido con un audio parecido a la música real: del 29,1 % al 10,9 % de un núcleo.
- **La barra del reproductor** se redibuja una vez por segundo (segundos enteros), no con cada aviso de tiempo (4 por segundo).
- **El detector del modo juego** es ahora un programa propio, compilado una sola vez por `Add-Type` (`-OutputAssembly`, con la ruta por `RU_OUT`). Ocupa 12 MB, frente a los 66 de PowerShell.
  - Se guarda como `rumoria-game-<hash del código>.exe` en `userData/bin` y su SHA-256 queda en `settings.json`. Antes de cada arranque se comprueba la huella, y si no coincide se vuelve a compilar.
  - Se borran los `.exe` de versiones anteriores.
  - Si no se puede compilar (o sale una DLL), se usa el bucle de PowerShell de antes.
  - Comprobado con League of Legends a pantalla completa.
- **`PROFILES.mid.visualizer`** decía `false`, pero la app (y su texto en Ajustes) lo enciende en Medio. Ahora dice `true`; lo que ves no cambia.
- **Android, sin restos:** el APK de cada actualización (unos 38 MB) se quedaba en `cache/updates`. Ahora los de la versión instalada o anteriores se borran al abrir, y al descargar uno nuevo se borran los demás.
- **`npm run android:build`** funciona en Windows: lanza `gradlew.bat` con su ruta (`scripts/android-build.js`), porque con `NoDefaultCurrentDirectoryInExePath` cmd no encuentra `gradlew`.
- **Medido y descartado**, por no mejorar de forma apreciable el arranque (unos 1,0 s hasta ver la página):
  - cargar Ajustes, Estadísticas y el móvil por separado;
  - crear la ventana mientras arranca el servidor;
  - la caché de compilación de Node para el servidor.

**v1.12.1: límites en la nube de Sincronizar (todo en [SINCRONIZAR.md](SINCRONIZAR.md))**

- La clave publicable va en cada copia de la app, así que cualquiera podía llamar a `rumoria_put` en bucle con ids inventados y llenar la base de datos.
- Ahora `supabase/rumoria-sync.sql` limita, por IP, los guardados (60 cada 10 min), las bibliotecas nuevas (5 por hora) y los borrados (20 cada 10 min), y responde 429 al pasarse.
- Cada biblioteca ocupa como mucho 6 MB y la tabla deja de crecer a las 20 000 bibliotecas o los 400 MB.
- Las funciones solo las puede llamar `anon`.
- La app explica los rechazos con un mensaje claro y vuelve a intentarlo más tarde.
- Probado en un Postgres real (PGlite) con 22 casos de abuso. `test/security/sync-sql.test.js` comprueba que el SQL no pierde nada de esto.

**v1.12: Modo juego (Windows)**

- **Qué lo motiva:** con Rumoria abierta, un juego en línea (el FIFA) iba a tirones. Lo que choca con el juego es el trabajo que Rumoria hace por su cuenta: leer Explorar a los 90 s de abrirse, buscar las siguientes canciones, revisar listas, las animaciones y el visualizador (tarjeta gráfica) y descargar actualizaciones.
- **Cómo lo nota (`electron/game.js`):** un pequeño programa con prioridad «Inactiva» mira cada 5 s la ventana de delante. Desde la v1.12.2 es un `.exe` propio de 12 MB; antes era un bucle de PowerShell de 67 MB, que sigue de respaldo. Gasta menos del 0,2 % de un núcleo. Cuenta como juego si Windows dice que hay Direct3D a pantalla completa (`SHQueryUserNotificationState` = 3) o si la ventana tapa su monitor entero. Las ventanas de Rumoria, el escritorio y la barra de tareas nunca cuentan. El pid de Rumoria entra por el entorno (`RU_PID`), nunca en el texto del script, y el bucle se cierra solo si Rumoria ya no está. Se entra en el modo juego al momento y se sale un minuto después de que no haya nada a pantalla completa: un Alt+Tab para cambiar de canción no lo despierta todo. Si el bucle muere solo, se reintenta 3 veces y después se sigue sin él.
- **Qué cambia mientras dura:**
  - la página pasa a Mínimo, elijas el perfil que elijas, y tu elección no se toca (`usePerf.game`): sin animaciones, sin desenfoque, sin visualizador y sin buscar canciones por adelantado;
  - la página deja de revisar listas y Explorar;
  - el servidor no empieza `warmBrowse`, `curate` (salvo «Renovar ahora»), `fillAutoLists`, `syncLists` ni `lookForNews`, y si una ronda está en marcha la para tras la lista que lleva;
  - Sincronizar deja las rondas periódicas para después; lo cambiado entretanto sube al terminar y «Sincronizar ahora» sigue funcionando;
  - el servidor y el yt-dlp que lanza bajan a prioridad «Por debajo de lo normal»;
  - las actualizaciones de Rumoria (se vuelven a mirar cada 5 min) y las de yt-dlp esperan.
  - La canción que suena no cambia.
- **Ajuste:** Ajustes → Rendimiento → «Modo juego», encendido por defecto (`gameMode` en `settings.json`). Solo aparece en Windows. Por IPC, `rumoria:game` (estado) y `rumoria:setGame` (solo un booleano), los dos con `isTrustedSender`.
- **Tests:** `test/security/game.test.js` y `test/ui/game.test.jsx`.

**v1.11: Android Auto, la música sin la ventana y avisos discretos (todo en [ANDROID.md](ANDROID.md))**

- **`WebHost.java`:** la página, que es la que reproduce, vive con la app y no con la ventana: es un WebView con `MutableContextWrapper` que la ventana solo muestra. Sin ventana sigue sonando, por ejemplo al quitar la app de recientes o al empezar desde el coche. Las órdenes que llegan mientras carga esperan en cola.
- **Android Auto:** `PlaybackService` es un `MediaBrowserServiceCompat`.
  - `AutoLibrary.java` le da dos pestañas, Favoritas y Tus listas, y las canciones de cada lista. Las saca del servidor local con el secreto de esa sesión.
  - Con `onPlayFromMediaId` y `onPlayFromSearch` se pone música desde el coche o por voz (`playFromCar` en `src/lib/android.js`).
  - Solo pueden navegar esta app, Android Auto, el coche, el Asistente y el sistema; se comprueba el paquete contra el uid de quien llama.
  - Hay una prueba instrumentada (`androidTest/.../AutoTest.java`).
- **Bluetooth:** con `ACTION_AUDIO_BECOMING_NOISY` se pausa al desconectar los auriculares o el Bluetooth.
- **Actualizaciones en Android:** una versión encontrada sola no abre ninguna ventana. Sale un punto en Ajustes, «Instalar» en Ajustes → Sistema y un aviso corto, una vez por versión.

**v1.10.2:** si la copia de la nube desaparece o empieza de nuevo (falta, o su versión es más antigua que la última vista), ya no hay nada en común y las bibliotecas se juntan, en vez de darlo todo por borrado. Una tabla o funciones que faltan se explican con un mensaje claro.

**v1.10.1:** Ajustes → Tu móvil, en el ordenador. Lleva un QR (`public/qr-android.svg`, generado una sola vez, porque el enlace a `releases/latest/download/Rumoria-Android.apk` no cambia), «Abrir el enlace» y «Copiar enlace». `EXTERNAL_RE` solo deja abrir, de GitHub, las releases de Rumoria.

**v1.10: Sincronizar (todo en [SINCRONIZAR.md](SINCRONIZAR.md))**

- Las listas, las Favoritas y las listas inteligentes se sincronizan entre PC, Mac y móvil, sin cuenta y sin que la nube pueda leerlas.
  - El código son 6 palabras y no sale del dispositivo.
  - Del código se sacan, con PBKDF2 de 600 000 vueltas, el id, la clave AES-256-GCM y una clave de escritura.
  - En Supabase la tabla está cerrada: solo se puede usar `rumoria_get`, `rumoria_put` (con la clave de escritura y la versión) y `rumoria_delete`.
- La mezcla es en tres vías, sin necesidad de que los dispositivos coincidan. Lo que un dispositivo no puede guardar se respeta para los demás.
- El servidor sincroniza al abrir, cada 5 minutos y después de cada cambio. La página vuelve a leer la biblioteca cuando llega algo (`syncWatch`).

**v1.9.1: Rumoria para Mac (todo en [MAC.md](MAC.md))**

- Se compila en los Mac de GitHub (`.github/workflows/mac.yml`), para chip de Apple (arm64) e Intel (x64), con firma *ad-hoc*: sin ella, macOS no abre una app en un Mac con chip de Apple.
- **yt-dlp:** la versión independiente de cada sistema (`yt-dlp_macos`; un Mac no trae Python).
- **Ventana:** los tres botones propios del Mac (la página les deja sitio, `.titlebar-native`), su menú (Edición, para copiar y pegar) y el Dock devuelve la ventana.
- **Actualizaciones:** `Rumoria-mac-<arch>.zip`, comprobado con su SHA-256. Al cerrar Rumoria, un paso de shell (las rutas solo por el entorno) cambia `Rumoria.app` y, si algo falla, vuelve a poner la anterior. No se actualiza desde el `.dmg` ni desde una copia que macOS haya trasladado (*App Translocation*).
- **Comprobado en el Mac de GitHub** (macOS 14, chip de Apple), con la app empaquetada:
  - arranca;
  - busca en YouTube (20 resultados en 5 s);
  - recibe el audio;
  - la firma es válida en los dos tipos de procesador;
  - el cambio del `.app` funciona con `ditto` de verdad, y si el zip está mal se queda la versión anterior.

**v1.9: Rumoria para Android (`android/`, todo en [ANDROID.md](ANDROID.md))**

- **La misma pila dentro del teléfono:**
  - Node 18 (nodejs-mobile) ejecuta el mismo `server/` en el proceso de la app.
  - La página de siempre se ve en un WebView.
  - yt-dlp es el de youtubedl-android (Python), con QuickJS para los retos de YouTube.
  - La app no necesita el ordenador.
- **Servidor:** las dos llamadas a yt-dlp pasan por `ytdlp.run()`. En Android el programa es Python con el script delante y su entorno, y en lugar de Node se usa QuickJS con `--cache-dir`. El puerto se escribe en `RUMORIA_PORT_FILE`. Lo que pides tú (buscar, abrir una lista, poner una canción, la radio, importar) espera hasta 25 s su turno (`takeWithin`) en vez de responder «hay mucho en marcha»: en un móvil, Inicio tarda más en llenar sus listas.
- **Sin Intl:** el Node del móvil no trae ICU. Al empaquetar, los `\p{…}` se reescriben como rangos y `android/node/shim.js` devuelve `normalize('NFD')` e `Intl.Collator`.
- **Diseño de teléfono:** se activa con `isPhone` (`window.RumoriaAndroid`, o `?phone` en un navegador). Tiene:
  - cuatro pestañas, mini reproductor y reproductor grande;
  - la cola, la letra y el sonido a pantalla completa;
  - los menús como hoja desde abajo y filas de canción de un toque;
  - Ajustes sin lo que solo sirve en el ordenador.
- **Nativo (Java):**
  - `NodeRunner` arranca Node y prepara yt-dlp.
  - `MainActivity` es el WebView y el canal `RumoriaAndroid`.
  - `PlaybackService` lleva la notificación, la `MediaSession` y el *wake lock*.
  - `Updater` descarga el APK de GitHub y lo comprueba con su SHA-256.
- **Comprobado en el emulador** (Pixel 7, Android 15):
  - arranca en unos 4 s;
  - busca en menos de 3 s, y la primera canción suena en unos 10 s;
  - sigue sonando con la pantalla apagada;
  - la notificación pausa, reanuda y pasa a la siguiente;
  - el botón atrás funciona como en cualquier app;
  - girar la pantalla no corta la música.

**v1.8: revisión de toda la interfaz (`src/styles/v18.css`, se carga la última)**

- Se recorrieron todas las pantallas en tema oscuro y claro, a 1280×820 y con la ventana mínima (900×600), con datos de prueba.
- **Arreglos:**
  - El visualizador va encima de la portada (`.pb-art`) y ya no deja 60 px vacíos al lado mientras está en pausa.
  - Los botones redondos (`.big-play`, `.play-btn`, `.icon-btn`) ya no se aplastan (`flex: none`).
  - Las acciones de una lista pasan a otra línea si no caben.
  - Los filtros de la biblioteca van en una sola línea.
  - Con poca altura, el menú ocupa menos.
- **Ayuda:** los botones de la barra del reproductor dicen lo que hacen nada más pasar el ratón (`data-tip`, en vez del `title` nativo, que tardaba un segundo). Con la ventana estrecha, «Sonando» y el mini salen de la barra (siguen en F11 y Ctrl+M). «Tu música» no aparece en la biblioteca si la carpeta está vacía.
- **Algo menos parecido a Spotify:** «Hecho para ti» pasa a «Elegido para ti», y la portada de Favoritas usa tu color en vez del degradado morado con corazón. La estructura (biblioteca a la izquierda, reproductor abajo) es la habitual de cualquier reproductor de música.

**v1.7.1: Ajustes por temas y con buscador (`src/views/Settings.jsx`)**

- `TABS` son los temas del menú y `SECTIONS`, cada sección con su tema y las palabras por las que se encuentra (las suyas y las que escribiría alguien). Se ve un tema a la vez y se recuerda en `rumoria_settings_tab`. `findSections` busca sin mayúsculas ni acentos, y cada palabra escrita tiene que aparecer. Los resultados dicen en qué tema están y llevan a él. Con la página estrecha, el menú pasa a ser una fila de botones. En Personalizar se quedan a la vista el tema, el estilo, el color, el fondo y el tamaño del texto; lo demás va en «Más opciones de aspecto» (`<details>`).

**v1.7: listas inteligentes, Estadísticas, «Tal día como hoy», despertador, letra romanizada o traducida, Modo sesión, Discord y un plan B para YouTube**

- **Listas inteligentes (`server/lib/rulelists.js`, `src/components/RuleDialog.jsx`, `RulePage` en `Pages.jsx`):** se guardan solo las reglas (`rule-lists.json`, 50 como mucho): de dónde salen las canciones (`likes`, `heard`, `all`), reproducciones mínimas y máximas, sin escuchar en N días, escuchada en N días, añadida a Favoritas en N días, artista o título, orden y cuántas. `cleanRules` acepta solo valores conocidos (al leer del disco y al recibirlos de la página). Las canciones se calculan al abrirla (`evaluate`, con `likes.list()` y `ListenLog.perSong()`), así que siempre están al día. `POST /api/rulelists/preview` dice cuántas daría mientras escribes. Rutas: `GET/POST /api/rulelists`, `GET/PATCH/DELETE /api/rulelists/:id` (el id, 16 hex).
- **Estadísticas (`server/lib/stats.js`, `GET /api/history/stats?tz=`, `src/views/Stats.jsx`):** minutos y canciones por semana (52, de lunes a domingo), día de la semana × hora del último año, rachas (días con al menos una canción escuchada de verdad; la actual sigue contando hasta que acaba el día) y géneros mes a mes (los artistas de cada mes contra los de cada categoría de Explorar, el mismo cálculo que «Para ti»; los 5 géneros principales y «Otros», en partes de lo que se puede reconocer). Todo con la zona horaria de la página. Gráficas según la guía de visualización: una serie en columnas, mapa de calor de un solo tono (`color-mix` del color de las gráficas con la superficie) y columnas apiladas con la paleta categórica validada en los dos temas, leyenda, aviso al pasar el ratón y tabla.
- **«Tal día como hoy» (`stats.onThisDay`, `GET /api/history/onthisday?tz=`, `src/views/OnThisDay.jsx`):** para hace 1, 2 y 3 años, las canciones escuchadas ese mismo día (o esa semana, ±3 días, si el día tiene menos de 3), las más escuchadas primero. Una estantería en Inicio (se puede ocultar) y una página por año; cuenta en «Recientes» (`onthisday`).
- **Despertador (`src/store/alarm.js`, `src/player/alarm.js`, `AlarmSettings.jsx`):** hora, días (lunes primero), qué suena (Para hoy, Favoritas, Lo más escuchado, Descubre, una lista o lo que estaba sonando), en cuánto sube el volumen y hasta dónde. Mira cada 15 s si toca (dentro de los 10 minutos siguientes a su hora y una vez al día, `last`). Empieza al 3 % y sube cada 2 s; si tocas el volumen, deja de subir. Necesita Rumoria abierta (vale en la bandeja, que no se duerme: `backgroundThrottling: false`).
- **Letra romanizada o traducida (`src/lib/romanize.js`, `src/store/lyrics.js`, `src/player/useLyricsExtra.js`, `server/lib/translate.js`):** debajo de cada línea, nada, letras latinas o español. La romanización es local: hangul (Revised Romanization con el enlace de la consonante final), kana (Hepburn con っ, ゃゅょ, ー y los sonidos extranjeros), cirílico y griego; los kanji se quedan. La traducción va a `translate.googleapis.com` (POST, sin redirecciones, 12 s y 1 MB como mucho, 250 líneas y 9000 caracteres) solo si `prefs.translate` está activo: el servidor lo comprueba (`GET /api/stream/translation` responde 403 si no) y la página pregunta antes de activarlo. Se guarda por el texto de la letra (`translations.json`, 300). Si la letra ya está en español, lo dice. La letra se guarda 1 hora en memoria del servidor, así el panel, el mini y la traducción no piden lo mismo tres veces.
- **Modo sesión (`src/player/dj.js`, botón en la Cola):** escucha el principio de las 30 siguientes, de dos en dos: pide 1,6 MB del audio por el relé de siempre (`Range`) y lo decodifica con `OfflineAudioContext` a 11 025 Hz (unos 99 s; comprobado en Electron con el audio m4a de YouTube). El tempo sale de la autocorrelación de los ataques (60–200 BPM, plegado a 70–180, con preferencia suave por 120) y la energía, del volumen, de lo cargada que va y del tempo. Se guarda por canción (`rumoria_dj`, 1500). Si no se puede escuchar, se estima por el título. Órdenes: sin saltos (siempre la más cercana a la anterior; medio y doble tempo cuentan como cercanos), subiendo, bajando y en ola. `reorderUpcoming` cambia solo lo que va después de la canción actual y quita el aleatorio.
- **Discord (`electron/discord.js`):** Rich Presence por la tubería local de Discord (`\\?\pipe\discord-ipc-0…9`), sin red ni dependencias: handshake con el id de la aplicación de Rumoria y `SET_ACTIVITY` (tipo «Escuchando», título, artista, portada solo de `i.ytimg.com`, tiempo y un botón a YouTube) con lo que ya recibe el mini reproductor (`cleanState`), como mucho cada 4 s. Se borra al pausar, al apagarlo y al salir. Solo se ofrece si hay id (`CLIENT_ID` o `RUMORIA_DISCORD_ID`). Puertas nuevas: `rumoria:discord`, `rumoria:setDiscord`.
- **Plan B para YouTube (`electron/ytdlp.js`, `YouTubeNotice.jsx`):** `yt-dlp -U` cada 6 h (antes, una vez al día) y al momento cuando fallan 3 canciones distintas en 10 minutos (lo que el reproductor da por perdido tras sus reintentos), como mucho una vez cada 30 min. Una canción que suena borra el problema. La página muestra un aviso con lo que pasa (actualizando, actualizado, ya era la última, sin conexión) y Ajustes la versión y «Buscar ahora». Puertas nuevas: `rumoria:ytdlp:state`, `rumoria:ytdlp:update`, `rumoria:ytdlp:report` (solo `ok` o `fail` y un id de 11 caracteres).
- **Tests de extremo a extremo (`test/e2e`, `playwright.config.mjs`):** Playwright abre la app de verdad con `RUMORIA_E2E=1` (sin actualizaciones, sin trabajo de fondo del servidor, sin copiar nada de TubeGrab ni leer tu carpeta de música) y compara capturas: la ventana con los estilos Rumoria, Windows y Mac (sin el contenido de Inicio, que rota), Ajustes en Mac claro y el mini reproductor en sus tres formas. `npm run test:e2e` (y `:update` tras un cambio de aspecto querido). Las capturas dependen de las fuentes y el escalado: se hacen en Windows al 100 %.

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
