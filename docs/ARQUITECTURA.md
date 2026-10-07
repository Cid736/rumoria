# TubeGrab y Rumoria: arquitectura tras la separación

La pestaña «Escuchar» de TubeGrab es ahora una app independiente, **Rumoria**. TubeGrab se queda con lo suyo: descargar, convertir y la biblioteca de archivos con su reproductor.

| | TubeGrab | Rumoria |
|---|---|---|
| Para qué | Descargar y convertir; tu biblioteca de archivos | Escuchar sin descargar: listas, favoritas, «Hecho para ti» |
| Repositorio | `Cid736/tubegrab` (`main`, v4.0.0) | `Cid736/rumoria` (público, `main`) |
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
