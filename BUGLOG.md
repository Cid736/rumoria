# Bug Log — Rumoria

El historial anterior a la separación (cuando era la pestaña «Escuchar») está en el `BUGLOG.md` de TubeGrab.

---

## 2026-10-07 — Revisión 1: recomendaciones, Explorar y Recientes

Revisado: `server/lib/browse.js`, `/api/browse` y `/api/browse/:id`, la lectura en segundo plano, `src/views/Home.jsx`, `recommend.js`, `Discover.jsx` y el almacén de «Recientes» (`src/store/ui.js`).

### [Bug] La lectura en segundo plano de Explorar no refrescaba nada
- **Archivo:** `server/app.js` (`warmBrowse`)
- **Descripción:** solo leía las listas que nunca se habían leído (`!count`). Pasadas 6 h, el intervalo no hacía nada y abrir una lista caducada hacía esperar varios segundos a YouTube.
- **Fix:** `Browse.isFresh(id)`. Ahora se vuelven a leer en segundo plano las destacadas con más de 6 h.

### [Bug] Una respuesta pobre de YouTube sustituía a una lista buena
- **Archivo:** `server/lib/browse.js` (`Browse.get`)
- **Descripción:** si YouTube respondía a medias (por ejemplo, 3 canciones), esas 3 sustituían en la caché a las 40 que había.
- **Fix:** solo se guarda el resultado nuevo si trae al menos 10 canciones (o tantas como la copia anterior). Si no, se sirve la copia anterior.

### [Seguridad — BAJA] Portadas de la caché de disco sin validar
- **Archivo:** `server/lib/browse.js` (`songsOf`)
- **Descripción:** `browse-cache.json` se leía de vuelta sin comprobar la dirección de las portadas. Un archivo manipulado podía meter cualquier URL en un `<img>`; la CSP la limita, pero podía servir para rastrear.
- **Fix:** solo se aceptan `https://i.ytimg.com/` (o `i1…i9`), y título, canal y duración se acotan, tanto al leer de YouTube como del disco.

### [Seguridad — BAJA] «Recientes» guardaba el `payload` de una radio tal cual
- **Archivo:** `src/store/ui.js` (`cleanItem`)
- **Descripción:** el objeto se copiaba entero en `localStorage`, con cualquier campo y cualquier URL de portada. Un valor que no se pudiera serializar vaciaba «Recientes» entero.
- **Fix:** `cleanPayload` guarda solo `title`, `artist`, `name` (textos de hasta 150 caracteres) y `thumb` (solo de `ytimg.com`).

### [Bug] Una radio puesta desde «Recientes» no empezaba por su canción
- **Archivo:** `src/views/Home.jsx` (`tracksOf`)
- **Descripción:** desde su estantería, la radio empieza por la canción de la que sale; desde «Recientes» o los accesos rápidos solo sonaban las parecidas.
- **Fix:** la canción de la radio va la primera también ahí.

### [Bug] «Si te gusta …» podía quedarse vacía
- **Archivo:** `src/views/Home.jsx` (`LikeArtistShelf`)
- **Descripción:** si el nombre del artista favorito quedaba en blanco, `who.includes('')` descartaba a todos los artistas parecidos.
- **Fix:** ese filtro solo se aplica si hay nombre.

### Resultado de la revisión
- **Inyección:** nada de la página llega a yt-dlp en Explorar. Cada lista es una búsqueda fija nuestra, el id se busca en un `Map` (`__proto__`, `../`, mayúsculas → 404) y el destino va siempre después de `--`. Lo cubre un test con `?q=--exec calc`.
- **Recursos:** `/api/browse/:id` usa el limitador de YouTube y los 3 huecos compartidos. Dos peticiones a la misma lista comparten una sola consulta, y la lectura en segundo plano va de una en una y cede el hueco a lo que escuchas.
- **XSS:** los nombres y las portadas se pintan con React (texto y `src`, nunca HTML), y `localStorage` se valida al leerlo (tipos, longitudes, hosts de imagen).
- **Privacidad:** el historial, «Recientes» y las recomendaciones no salen del ordenador; a YouTube solo le llegan las búsquedas fijas, los ids de canciones y, para las novedades, los nombres de tus artistas más escuchados.
- `npm audit --omit=dev`: 0 vulnerabilidades.
- **Pruebas:** 55 del servidor y de seguridad, más 37 de la interfaz, todas superadas. Lint: 0 errores.

### Revisión legal
- `LEGAL.md` (ES/EN) cubre ahora lo nuevo:
  - Qué se guarda de «Recientes», de las recomendaciones y de la copia de Explorar.
  - Las consultas a YouTube **en segundo plano**: Explorar cada 6 h, novedades cada 12 h y listas enlazadas cada 3 h, con qué se envía en cada una.
  - Que las portadas vienen de `i.ytimg.com`.
  - Que los nombres de artistas solo indican qué suena, sin relación ni aprobación suya.
  - Que las listas de Explorar se hacen con playlists públicas de terceros, que los nombres de las categorías son propios y cómo pedir una retirada.
- README: aviso sobre las condiciones de YouTube, la falta de afiliación y enlaces a `LEGAL.md` y `third-party/`.
- `THIRD-PARTY-NOTICES.txt` se vuelve a generar en cada compilación (`npm run notices`). Ninguna dependencia nueva: todas siguen con licencias permisivas.

---

## 2026-10-07 — El nombre: Rumoria

### [Legal] La app se llamaba «CLMusic»
- **Conflictos de «CLMusic»:** ya existía «CLMusicPlayer», un reproductor de música para Windows en itch.io; además hay una empresa británica «CL MUSIC LTD» y la cantante «CL».
- **Rumoria:** no tiene marcas registradas en EE. UU. (Trademarkia/USPTO; el buscador se comprobó con «Deezer» y «Sonora»), ni uso en la web, ni repos en GitHub, y `rumoria.com`, `.app` y `.es` están libres. Se descartaron, entre otros, Melovia, Sonvia y Sonaro, demasiado parecidos a apps de música que ya existen, y Muselo, que es una marca registrada.
- **Pendiente:** buscarla en TMview (EUIPO y OEPM) antes de registrarla; su API no responde a consultas automáticas.
- **Cambiado:** nombre, `appId` (`com.rumoria.app`), los tres `.exe`, la carpeta de datos (`%APPDATA%\rumoria`), las variables `RUMORIA_*`, la cabecera `X-Rumoria`, el canal IPC `rumoria:*`, las claves de `localStorage`, el User-Agent y la documentación. TubeGrab enlaza a `Cid736/rumoria`.

---

## 2026-10-07 — Revisión 2: seguridad tras publicar el repositorio

CodeQL (`security-extended`) dio 12 avisos en su primer análisis y Dependabot, 1. Cada aviso se revisó en el código antes de tocar nada.

### [Seguridad — BAJA] Archivos temporales con nombre fijo (CodeQL #4–#8)
- **Archivos:** `server/lib/browse.js`, `likes.js`, `listenlog.js`, `news.js` y `streamlists.js`
- **Descripción:** se guardaba escribiendo `<archivo>.tmp` y renombrándolo. Alguien con acceso a la carpeta podía dejar ahí un enlace con ese nombre fijo para que la app escribiera en otro sitio. La carpeta de datos es del usuario, así que el riesgo práctico es bajo.
- **Fix:** `server/lib/atomic.js` (`writeFileAtomic`) escribe un temporal con nombre aleatorio, creado en exclusiva (`wx`, permisos `0600`), lo renombra después y no deja restos si algo falla.

### [Seguridad — BAJA] Comprobar y después usar un archivo (CodeQL #9–#11)
- **Archivos:** `server/lib/migrate.js` y `scripts/fetch-ytdlp.js`
- **Descripción:** se comprobaba que un archivo existía y se usaba después. Entre una cosa y otra podía cambiar.
- **Fix:** la migración descarta los enlaces simbólicos, lee el archivo una sola vez desde el mismo descriptor (tamaño y tipo con `fstat`) y escribe la copia en exclusiva (`wx`), sin sustituir nunca una que ya exista. La descarga de yt-dlp no sobrescribe una copia aparecida entretanto, salvo con `--force`.

### [Seguridad — BAJA] Tus canciones sin límite de peticiones (CodeQL #3)
- **Archivo:** `server/app.js` (`/api/local/file`)
- **Fix:** límite propio de 3000 por minuto, generoso porque al reproducir se piden muchos trozos.

### [Bug] Títulos de Apple Music decodificados dos veces (CodeQL #2)
- **Archivo:** `server/lib/importlist.js`
- **Descripción:** `&amp;` se decodificaba antes que las demás entidades, así que `&amp;quot;` acababa en `"`. Solo afectaba al texto, que React pinta siempre como texto.
- **Fix:** `&amp;` se decodifica la última.

### Descartados tras revisarlos
- **CodeQL #1, petición a una URL que viene de fuera (SSRF), en `netfetch.js`:** falso positivo. Solo admite `https`, ni usuario ni contraseña, y puertos 80/443/8080/8443. Rechaza IPs privadas o locales en la dirección, al resolver el DNS (el socket usa esa misma resolución, así que no hay DNS rebinding) y en cada redirección (máximo 5). Además, cada llamada solo pasa hosts permitidos (Spotify, Apple Music, YouTube, LRCLIB, GitHub).
- **CodeQL #12, datos de HTTP escritos en disco, en `listenlog.js`:** es la función: guardar tu historial. Cada campo se limpia y se acota antes (`cleanSong`) y el archivo se escribe con `writeFileAtomic`.
- **Dependabot, `sprintf-js` (DoS con especificadores de precisión):** solo lo usan herramientas de desarrollo (el linter), no va dentro de la app y no hay versión corregida.

### Además
- **gitleaks en local:** todo el historial de TubeGrab (83 commits) y de Rumoria, sin secretos. Tampoco se ha subido nunca un archivo sensible (cookies, `.env`, ajustes, historiales, claves).
- **Ejecutables publicados:** sin datos, sin rutas del equipo, sin source maps ni secretos.
- **GitHub:**
  - Los workflows solo tienen permiso de lectura por defecto (CodeQL, además, `security-events: write`), no pueden aprobar PR y no se usa `pull_request_target`.
  - Están activos el escaneo de secretos con bloqueo al subir y las alertas de Dependabot.
- **CI:** gitleaks se ejecuta sobre todo el historial con una versión fija verificada por SHA-256. La acción oficial fallaba en el primer push.
- **Pruebas:** `test/security/hardening.test.js`. En total, 59 del servidor y de seguridad y 37 de la interfaz, todas superadas.
- **Migración:** también se comprueba que el archivo abierto es el mismo que se miró (mismo identificador de archivo, `ino` en `bigint`; en Windows `lstat` no da número de dispositivo), así que no cuela uno cambiado entre medias.
- v1.0.1 con estos arreglos.

---

## 2026-10-08 — v1.1.0: listas que se llenan solas y «Para ti»

### [Función] Listas que se llenan solas
- **Qué hacen:** a partir de un tema («Rock de los 80», «Bad Bunny»…) o del nombre de una carpeta (botón ✨), Rumoria busca canciones en YouTube y llena la lista al momento. Después añade las nuevas cada 6 h, 12 h, día o semana.
- **Sin descargas:** se guardan títulos e ids de YouTube; todo suena al momento, como el resto de listas.
- **Reglas:** las canciones nuevas van arriba, como mucho 100 canciones por lista, y las que quites no vuelven (se recuerdan hasta 500).
- **Seguridad:** el tema es texto plano (sin caracteres de control, 100 como máximo) y solo llega a yt-dlp detrás de `--`, como `ytsearch30:…` o dentro de la URL de búsqueda. Un test usa `--exec calc` como tema.
- **Recursos:** el relleno en segundo plano mira cada hora, rellena una lista cada vez y solo si hay un hueco libre.

### [Función] «Para ti»
- **Para todos:** una instalación nueva tiene en 1–2 minutos una carpeta «Para ti» con 6 listas de las categorías destacadas. Probado en un perfil vacío: 38–40 canciones por lista a los 80 s.
- **Según lo que escuchas:** tus géneros se calculan en local, cruzando los artistas de tu historial (ponderados por escuchas) con los de cada categoría de Explorar. Cada género tuyo tiene su lista, con tus artistas primero.
- **Predicción:** «Descubre: …» es la categoría que comparte más artistas con las tuyas y que aún no escuchas, alternando semana a semana entre las 3 mejores.
- **Rotación:** cada 3, 7 o 14 días se recalcula. Se quitan las listas de Rumoria que ya no encajan y se crean las nuevas; si antes no se podían saber tus géneros y ahora sí, se adelanta.
- **Lo tuyo se respeta:** una lista renombrada o movida pasa a ser tuya y nunca se rota. Si borras una, su género no vuelve en 60 días. Apagado en Ajustes, lo que ya hay se queda como está.
- **Explorar:** todas las categorías se precargan (las destacadas cada 6 h, el resto una vez al día), así que abren al momento y sirven para calcular tus géneros.

### [Bug] La cookie de sesión aún se llamaba `clm_t`
- Era un resto del nombre antiguo; ahora es `rum_t`.

### [Legal] `LEGAL.md`
- Añadido qué guarda «Para ti» (`curator.json`) y las nuevas consultas en segundo plano, incluidos los temas que escribes. Tus géneros se calculan en tu equipo y el historial no sale de él.
- En Ajustes se aclara que las listas iniciales son las mismas para todos y que Rumoria no recoge datos de nadie.

### [Ajuste] Saber bien tus géneros (probado con tus datos reales)
- **Primera prueba, con 135 escuchas:** solo detectó J-pop. Cris Leiva, tu artista más escuchado (109 escuchas), no salía en ninguna categoría, y «Descubre» eligió Cumbia por un único artista que coincidía por casualidad («dax»).
- **Nombres limpios:** se quitan «Official», «YouTube Channel», «VEVO» y «- Topic», y los nombres se comparan por palabras completas («kenshi yonezu» casa con «米津玄師 kenshi yonezu»).
- **«Descubre» más exigente:** pide al menos 2 artistas en común.
- **Artistas que no salen en ninguna categoría:** se miran los artistas que suenan con ellos, en la radio de una de sus canciones y en las playlists públicas donde aparecen (como mucho 3 artistas por vez, guardado 30 días). La radio sola no servía: casi solo ponía al mismo artista.
- **Resultado:** Pop en español (por Cris Leiva, a través de Morad, DELLAFUENTE y JC Reyes), J-pop, Éxitos y Urbano latino, y para descubrir, Pop internacional.
- **Legal:** `LEGAL.md` dice que el nombre de esos artistas se busca en YouTube para esto.
- **Pruebas:** 67 de servidor y seguridad, 41 de interfaz.

---

## 2026-10-08 — v1.2.0: se actualiza sola, mini reproductor, personalizar

### [Bug] Rumoria olvidaba tus ajustes al reiniciarse
- **Archivos:** `server/main.js`, `electron/main.js`
- **Descripción:** el servidor escuchaba en un puerto libre al azar en cada arranque. La página cambiaba así de origen (`127.0.0.1:<puerto>`) y el navegador le daba un almacenamiento vacío, así que se perdían el tema, el volumen, «Recientes», la mezcla semanal y las cachés de recomendaciones.
- **Fix:** el puerto se elige una vez y se guarda en `settings.json`; si otro programa lo ocupa, se usa otro y se recuerda ese. Probado: al reiniciar, el mismo puerto (56755) y el volumen guardado.

### [Función] Se actualiza sola, como TubeGrab
- **Cuándo:** `electron/updater.js` busca la última release 15 s después de arrancar y cada 6 h.
- **Cómo descarga:** baja en segundo plano el archivo de tu versión (instalador, portable o Lite), solo de GitHub, por HTTPS y comprobando cada redirección, a una carpeta temporal nueva y con creación exclusiva. Lo conserva solo si su SHA-256 y su tamaño coinciden con los publicados.
- **Cómo instala:** «Actualizar a X» en la barra superior, o simplemente cerrar Rumoria. El instalador se ejecuta en silencio; en la portable, un paso de PowerShell recibe las rutas por variables de entorno y cambia el `.exe`.
- **En Ajustes:** la versión, el estado, «Buscar ahora» y «Reiniciar y actualizar».

### [Función] Mini reproductor
- **Qué es:** una ventana pequeña encima de las demás, con portada, título, artista, barra (clic o flechas para saltar), anterior, pausa, siguiente y favorita. Se abre con Ctrl+M o con el botón junto al volumen.
- **Opciones:** compacto, siempre encima, fijo, portada, transparencia y opaco al pasar el ratón, desde su menú ⋯ o desde Ajustes.
- **Cerrar:** si cierras la ventana grande con el mini abierto, solo se oculta y la música sigue; al cerrar el mini, Rumoria se cierra. Probado enviando a la ventana el mismo `WM_CLOSE` que manda Windows.
- **Seguridad:** el mini tiene su propio preload mínimo y cada mensaje comprueba de qué ventana viene. Solo muestra texto (`textContent`) y portadas de `i.ytimg.com`, y sus botones son una lista cerrada con valores acotados.

### [Función] Personalizar
- **Opciones:** 8 colores (cada uno con su versión para el tema claro y el oscuro, todos con contraste de 4,5:1 o más con su texto), tamaño del texto (zoom del 80 al 150 %), densidad de las listas, esquinas, menos animaciones, portadas en la biblioteca y qué estanterías salen en Inicio.
- **Al momento:** se aplica sin reiniciar, también en el mini reproductor si está abierto.
- **Valores seguros:** solo valores conocidos; lo que se lee del almacenamiento se limpia antes de usarlo.

### Revisión de seguridad y fallos
- **ReDoS:** comprobado con `recheck` en todo el código nuevo; ninguna expresión es vulnerable.
- **Tests de seguridad nuevos:** `test/security/updater.test.js` (solo GitHub, solo con SHA-256, tamaño acotado, rutas fuera del comando) y `test/security/mini.test.js` (qué muestra, qué órdenes acepta, que cada mensaje comprueba quién lo envía, sin código en línea). La suite principal cuenta ahora las puertas del preload, comprueba que cada `ipcMain.on` verifica quién llama y que el zoom está acotado.
- **Prueba en la app real:** el mini muestra la canción y avanza; pausa y «siguiente» funcionan desde él; cerrar la ventana grande no corta la música; cerrar el mini cierra la app. El color cambia al momento y se recuerda.
- **Dos fallos de mis propias pruebas** (no de la app): `window.close()` desde la página destruye la ventana sin pasar por su evento `close`, así que no imita la X; y `sed` se comía las barras invertidas de una expresión regular en un test.
- **Pruebas:** 75 de servidor y seguridad y 47 de interfaz, todas superadas. Lint: 0 errores, 12 avisos (el nuevo es la expresión de portadas del mini, acotada y comprobada con `recheck`). `npm audit`: 0.

### Prueba real del actualizador (tras publicar)
- **Montaje:** compilé una portable que decía ser la 1.1.9 y la abrí con un perfil aparte.
- **Resultado:** a los pocos segundos encontró la 1.2.0 en GitHub, descargó `Rumoria.exe`, comprobó su SHA-256 y su tamaño, y mostró «Actualizar a 1.2.0». Al pulsarlo se cerró, el `.exe` quedó cambiado (su huella es la de la 1.2.0 publicada) y se abrió de nuevo, ya en la 1.2.0, con el mismo perfil.
- **Pendiente menor:** queda una carpeta temporal vacía (`%TEMP%\rumoria-update-…`) por actualización. Es inofensivo; se limpiará en la próxima versión.
- **CodeQL:** sin avisos en el código de la app. El único nuevo era un test (comprueba que la página del mini no tiene `<script>` en línea) y se descartó con ese motivo.

---

## 2026-10-08 — v1.6.2: revisión de los CSS y menú del mini

### [Bug] Las bandas del ecualizador tapaban «Reproducción» en el panel Sonido
- **Archivos:** `src/components/SoundPanel.jsx`, `src/styles/look.css`
- **Causa:** la caja de las bandas usaba la clase `.eq`, que `app.css` ya usaba para las barritas animadas de «sonando» con `height: 14px`. La caja medía 14 px y las bandas se salían por encima de lo siguiente.
- **Solución:** la caja pasa a llamarse `.eq-bands`. El desplegable de preajustes también tiene ya el mismo estilo que los demás (salía el nativo, con borde blanco).

### Revisión de todos los CSS
- **Choques de nombres:** un script listó cada clase con reglas en varios sitios y dónde se usa. El único choque entre componentes distintos era `.eq`; los demás son variantes de un mismo componente.
- **Contenido que se sale:** en la app real, con los tres estilos, recorrí Inicio, Buscar, Tu resumen, Historial, una lista, Ajustes y los paneles Sonido, Letra y Cola, buscando elementos cuyo contenido sale de su caja sin barra de desplazamiento, o que se salen de la ventana.
  - **Encontrado:** el título grande de las listas (`.col-name`, interlineado 1.02): la «g», la «p» o la «y» bajaban sobre el subtítulo. Ahora tiene 1.12.

### Mini reproductor
- **[Bug] Forma normal:** los cuatro botones pequeños en columna medían más que la cabecera, y «⋯» quedaba encima de la duración total. Ahora van en dos columnas.
- **Forma compacta:** se quita el botón de abrir Rumoria (el doble clic en la portada sigue abriéndola), para que quepa más título.
- **Revisión:** en las cinco formas (normal, con videoclip, tarjeta, tarjeta con videoclip, compacta) y con los tres estilos, comprobé que nada sale de la ventana ni se monta sobre otro botón, y que los paneles «A continuación» y «⋯» caben.
- **Menú «⋯» rediseñado:**
  - ocupa el mini entero, con fondo difuminado y un botón para cerrarlo;
  - la forma se elige con tres botones con dibujo (Normal, Tarjeta, Compacto);
  - lo que enseña, con etiquetas que se encienden;
  - la ventana, con interruptores;
  - la opacidad, con su porcentaje;
  - en la forma compacta solo sale la fila de la forma, para poder volver a una más grande.

---

## 2026-10-08 — v1.6.1: fondo a elegir con cualquier estilo

### [Bug] El estilo Mac teñía la ventana
- **Archivo:** `src/styles/ui.css`
- **Problema:** el fondo del estilo Mac mezclaba tu color de acento con el gris. Con algunos colores, como el violeta, el resultado parecía sepia.
- **Solución:** el estilo Mac usa un gris neutro sin mezcla.

### [Función] Fondo (Ajustes → Personalizar)
- **Archivos:** `src/store/look.js`, `src/styles/backgrounds.css` (nuevo), `src/views/Customize.jsx`, `public/mini.*`
- **Qué hace:** el color de la ventana y de los paneles se elige aparte del estilo: el del estilo, gris neutro, negro, azul noche, morado, verde bosque, granate o teñido de tu color, con versión clara y oscura.
- **Seguridad:** al leerlo solo se aceptan valores conocidos (lo comprueba un test).
- **Comprobado en la app:** estilo Mac con color violeta en gris neutro; con «Azul noche», la ventana cambia de color.
- **Tests:** servidor y seguridad 94, interfaz 87.

---

## 2026-10-08 — v1.6.0: estilo Rumoria / Windows / Mac, búsquedas recientes y guía de bienvenida

### [Función] Estilo de la interfaz (Ajustes → Personalizar)
- **Archivos:** `src/components/TitleBar.jsx` (nuevo), `src/styles/ui.css` (nuevo), `src/store/look.js`, `src/views/Customize.jsx`, `electron/main.js`, `electron/preload.js`, `public/mini.*`
- **Barra de título:** la ventana tiene la suya propia, igual que TubeGrab. Con el estilo Windows y el de Rumoria, los botones van a la derecha; con el de Mac, los tres botones de colores van a la izquierda.
- **Comprobado en la app:**
  - los tres estilos;
  - maximizar y restaurar desde el botón (la ventana pasó de 1280 a 1920 px de ancho y volvió);
  - el mini sigue el estilo.
- **Diferencia con TubeGrab:** el estilo se elige en Ajustes, no hay botón en la barra. Tampoco se usan los materiales Mica ni Acrílico: en Windows 10 podían dejar el fondo negro.

### [Función] Búsquedas recientes
- **Archivos:** `src/store/searches.js` (nuevo), `src/views/Search.jsx`, `src/components/TopBar.jsx`, `src/views/MoreSettings.jsx`
- **Cuándo se guarda:** cuando los resultados llevan un momento en pantalla, cuando pones uno o cuando pulsas Intro. No se guarda cada letra.
- **Dónde salen:** en Buscar, con la caja vacía.
- **Cómo se borran:** una a una (✕), todas («Borrar todo», con «Deshacer») o dejando de guardarlas (Ajustes → Historial de escucha).
- **Comprobado en la app:** buscar «bad bunny» y «rosalia» dejó las dos guardadas, la más nueva primero.

### [Función] Guía de bienvenida
- **Archivo:** `src/components/Guide.jsx` (nuevo)
- **Qué es:** cinco pasos como en TubeGrab: estilo y tema, buscar, tus listas, «Hecho para ti» y controles.
- **A quién le sale:** solo a quien abre Rumoria por primera vez. Quien ya la usaba no la ve al actualizar, salvo que la active.
- **Cómo se desactiva:** «No volver a mostrarla» viene marcado; también hay un interruptor en Ajustes, junto con «Ver la guía».
- **Comprobado en la app:** con un perfil nuevo se abrió sola en el primer paso.

### Seguridad y legal
- **Puerta nueva del preload:** `rumoria:window`. Comprueba quién la envía y solo acepta `minimize`, `maximize` y `close`; hay un test que lo verifica. El preload tiene ahora 5 `send`.
- **Búsquedas:** solo en este ordenador; al leerlas, solo se aceptan textos de una línea.
- **LEGAL:** los estilos «Windows» y «Mac» solo describen el aspecto. Están dibujados por Rumoria, sin logotipos ni recursos de Microsoft ni de Apple, y se citan sus marcas.
- **Tests:** servidor y seguridad 94, interfaz 86. Lint sin errores.

---

## 2026-10-08 — v1.5.0: atajos globales, «No me recomiendes», Historial, listas, enlaces, «Sonando», bandeja y mini v3

### [Función] Lo nuevo
- **Atajos globales** (`electron/shortcuts.js`, Ajustes): se pueden cambiar o apagar, y avisa si otra aplicación ya usa una combinación.
  - En este PC, otra aplicación ya tenía Ctrl + Alt + M, así que el mini queda por defecto en Ctrl + Alt + Mayús + M.
  - Probado pulsando Ctrl + Alt + P a nivel del sistema: pausó y reanudó la canción.
- **«No me recomiendes…»** en el menú de una canción, para esa canción o su artista.
  - Probado con la radio real de «Bohemian Rhapsody»: de 25 canciones se quitaron las 8 de Queen.
- **Historial** (barra lateral): por días, con la hora, buscador y «solo las que escuchaste».
- **Listas:**
  - ordenar por título, artista, fecha en que se añadió, más escuchadas o duración, y se recuerda por lista;
  - «Quitar canciones repetidas», con «Deshacer».
- **Arrastrar un enlace:** probado con un vídeo de YouTube, que empezó a sonar al soltarlo.
- **Sonando a pantalla completa** (F11): portada o videoclip, letra sincronizada, siguientes y controles que se esconden.
- **Bandeja:** las 5 siguientes canciones y Favorita.
- **Mini v3:**
  - forma «Tarjeta»;
  - panel con las 5 siguientes;
  - silenciar;
  - rueda para el volumen y para avanzar;
  - teclas;
  - se pega a los bordes;
  - iconos SVG;
  - barra que avanza sin saltos;
  - indicador de que suena;
  - título largo que se desliza;
  - dos líneas de letra en la tarjeta.

### [Bug evitado] Quitar repetidas no podía usar «quitar canciones»
- **Problema:** quitar una canción de una lista con enlace la anota como quitada (`gone`, por artista y título) para que no vuelva al releer la lista. Si se hacía así con una repetida, al releer la lista desaparecería también la copia que se queda.
- **Solución:** `dedupe` quita sin anotar nada. Hay un test que relee la lista y comprueba que la canción sigue una vez.

### [Bug] Pantalla completa denegada
- **Problema:** Electron rechazaba todas las peticiones de permiso, y entre ellas la de pantalla completa.
- **Solución:** solo se concede `fullscreen`, y solo a la ventana principal en su propio origen. Un test lo comprueba en el código.

### Seguridad
- **Rutas nuevas:** `/api/hidden` (GET y POST), `/api/hidden/remove`, `/api/history/recent`, `/api/history/counts` y `/api/lists/:id/dedupe`. Todas exigen el token y cambiar algo exige además `X-Rumoria` y límite de peticiones. Están en la lista del test de autenticación.
- **Validación:**
  - `hidden`: solo claves de canción válidas y nombres con alguna letra o número, con un máximo de entradas;
  - `days`: se limita a entre 1 y 366;
  - el mini: `jump` solo admite una posición entera y `cleanState` limpia `queue` y `muted`;
  - el orden de las listas solo admite valores conocidos.
- **Electron:**
  - preload con 9 `invoke` (2 nuevos, los dos con `isTrustedSender`);
  - el mini añade `mini:dragEnd`, que comprueba quién lo envía;
  - el único permiso que se concede es la pantalla completa.
- **Enlaces arrastrados:** solo http(s) de YouTube, Spotify o Apple Music, sin usuario ni contraseña. El servidor vuelve a validar al importar.
- **Atajos:** solo combinaciones con Ctrl, Alt o Win; nunca se registra una tecla sola ni Mayús más una tecla.
- **ReDoS (recheck):** ninguna expresión nueva es exponencial. Dos polinómicas nuevas se cambiaron por una búsqueda única (`search`): « feat.» en `sameSongKey` y el primer artista en `mainArtistOf`. La de los paréntesis (`[([]([^)\]]{0,80})[)\]]`) mira 80 caracteres como mucho desde cada paréntesis, así que su coste es lineal.
- **Tests:** servidor y seguridad 94, interfaz 78. Lint sin errores. `npm audit`: 0.

---

## 2026-10-08 — v1.4.0: Explorar, radios y «Si te gusta» que rotan según tus gustos

### [Función] Estanterías que rotan
- **Archivos:** `src/views/rotation.js` (nuevo), `src/views/Home.jsx`, `server/lib/browse.js`, `server/lib/curator.js`, `server/app.js`, `src/store/library.js`, `src/store/look.js`, `src/views/Customize.jsx`
- **Antes:** «Explorar» y «Radios populares» eran siempre las mismas 12. «Si te gusta» era siempre tu artista número uno.
- **Ahora:**
  - una selección semialeatoria con peso, entre las 45 categorías y unas 60 radios;
  - tus géneros tienen sitio fijo: un tercio de Explorar y la mitad de las radios;
  - lo que viste la última vez pesa menos;
  - cambia cada 3 h, cada día o al abrir, a tu elección;
  - «Otras» cambia una sola estantería;
  - «Si te gusta» va pasando por tus artistas y por sus vecinos.
- **Comprobado en la app (perfil de prueba con Queen):**
  - géneros detectados: rock y años 80, que encabezaron Explorar;
  - en las radios salieron Queen y Estopa;
  - «Otras» en Explorar no tocó las radios;
  - las radios mostradas sin portada (Rema, Bizarrap) la tuvieron a los pocos segundos.

### [Bug] Carpetas temporales del actualizador
- **Archivo:** `electron/updater.js`
- **Problema:** cada actualización dejaba una carpeta `%TEMP%\rumoria-update-…`, con el instalador dentro en la versión instalable.
- **Fix:** al arrancar, `sweepOld` borra las de actualizaciones anteriores. Solo borra las que tienen exactamente ese nombre, son carpetas de verdad y llevan más de 10 minutos.

### Seguridad
- No hay rutas nuevas. `/api/browse` solo añade `taste` (ids de categoría y una puntuación), con el mismo token.
- Lo guardado en el navegador (`rumoria_rotation`, `rumoria_similar`) se limpia campo a campo al leerlo. Solo se aceptan:
  - ids conocidos y textos cortos;
  - ids de vídeo de 11 caracteres;
  - portadas de `i.ytimg.com`.
- Las búsquedas en YouTube siguen siendo fijas: los artistas de las radios están escritos en el código y la página solo puede pedir una radio por su id, nunca con texto suyo.
- ReDoS (recheck): ninguna expresión exponencial. Una polinómica de `curator.js` (`\s*-\s*topic$`) pasa a `/ ?- ?topic$/`, que no puede retroceder. Quedan tres polinómicas antiguas (en `stream.js` y `recommend.js`) que solo leen títulos o canales de 300 caracteres como mucho: el peor caso son unas decenas de miles de pasos.
- Tests: servidor y seguridad 83, interfaz 68.

---

## 2026-10-08 — v1.3.0: rendimiento, reproducción como en TubeGrab, mini v2, recomendaciones

### [Bug] Actualizar una lista podía vaciarla o deshacer lo que habías hecho
- **Archivos:** `server/lib/streamlists.js`, `server/app.js`, `server/lib/importlist.js`
- **Vaciaba la lista:** «Leer de nuevo» dejaba la lista vacía si Spotify o Apple Music devolvían 0 canciones (la sincronización automática sí lo comprobaba).
- **Volvían las quitadas:** las canciones que quitabas de una lista importada reaparecían al releerla.
- **Se perdían las añadidas:** las que añadías tú desaparecían.
- **Doble lectura:** dos clics lanzaban dos lecturas.
- **Spotify a medias:** a veces sirve la página sin canciones. Lo medí con tus listas: falló 1 de cada 3 lecturas.
- **Fix:**
  - `reread`: una lectura vacía no cambia nada, las canciones quitadas se recuerdan (`gone`), las tuyas se conservan (`mine`, al final) y los vídeos ya encontrados se mantienen;
  - una lectura por lista a la vez;
  - Spotify se lee hasta 4 veces (20 de 20 lecturas bien después del arreglo).
- **Función:** «Actualizar» dentro de cada lista (de un enlace o que se llena sola) dice cuántas canciones llegaron.

### [Función] Rendimiento
- **Perfiles:** Automático, Mínimo, Medio o Alto. En este PC (12 núcleos, 32 GB) el automático elige «Alto».
- **Optimizaciones:**
  - la siguiente canción se resuelve por adelantado;
  - la caché de direcciones dura 4 h y guarda 400;
  - las filas de las listas largas que no se ven no se pintan;
  - en «Mínimo», sin animaciones ni desenfoques y con portadas pequeñas.
- **Canciones que no cargan:** hasta 3 intentos, y tras 20 s cargando cuenta como fallo. En listas de más de 50, si sigue fallando se quita de la lista (con «Deshacer») y de la caché.

### [Función] Reproducción
- **Seguir donde lo dejaste:** probado cerrando la app a la 1:57 de «Bohemian Rhapsody»; al abrirla, la misma canción en ese segundo, en pausa.
- **Segundo plano:** con la opción de la bandeja, cerrar la ventana la oculta y la música sigue (probado: 2:48 → 2:53 con la ventana cerrada).
- **Opciones de TubeGrab, de vuelta:**
  - ecualizador de 5 bandas con preajustes y los tuyos;
  - mismo volumen para todas las canciones;
  - velocidad, manteniendo el tono o no;
  - fundido;
  - karaoke;
  - temporizador (minutos o al acabar la canción);
  - salida de sonido (8 salidas detectadas);
  - pausa al desconectar los auriculares;
  - visualizador.
- **Prueba en la app real:** con el preajuste Rock y 1,25×, la canción avanzó 5 s en 4 s.

### [Función] Mini reproductor v2
- **Qué trae:** portada de fondo, línea de la letra («♪ When I look into your eyes» en «November Rain»), siguiente canción, aleatorio, repetir y volumen.
- **Videoclip** (🎬): vídeo de 360p sin sonido, por el propio relé de la app, sincronizado con la canción (probado: 1:19 en los dos).

### [Función] Recomendaciones
- **«Descubre algo nuevo»:** cuenta más una canción que aparece en las mezclas de varias tuyas, deja fuera las que saltas y pone al final a los artistas que sueles saltar. Como mucho 2 por artista, reconocido por el título y no por el canal: Queen salía 3 veces («Queen», «Queen Official», «Live Aid»).
- **«Para hoy»:** parecidas a lo último que escuchaste; probado con 17 canciones (Queen, Bon Jovi, Aerosmith, Amy Winehouse).

### [Bug] El mini reproductor nunca bajaba la letra
- `usePlayer.getState().current()` siempre lee el estado actual, así que comparar «antes» y «ahora» con él nunca veía el cambio de canción. Ahora se comparan las canciones de la cola.

### [Bug] Los deslizadores del ecualizador se salían de su caja
- En vertical tapaban la sección «Reproducción»; ahora son filas horizontales.

### [Legacy] TubeGrab
- **«Descargar con TubeGrab»:** sin TubeGrab instalado, abre su página de descarga y lo avisa (antes, el protocolo no hacía nada).
- **Documentación:** quitadas la rama `split/listen-app`, ya fusionada, y la versión fija de TubeGrab en ARQUITECTURA.
- **TubeGrab v4.0.4:** el texto de su pestaña Rumoria cuenta lo nuevo.

### Seguridad
- **Rutas nuevas:** `/api/stream/video`, `/prepare`, `/forget` y `/api/prefs`. Todas exigen el token y validan el id (o solo aceptan valores conocidos), con límite de peticiones. El vídeo usa el mismo relé que el audio (solo `*.googlevideo.com`). `fresh=1` relanza yt-dlp como mucho una vez cada 10 s por canción.
- **Permisos:** sigue sin concederse ninguna petición. La única comprobación que pasa es la de la ventana principal sobre su propio origen, para listar las salidas de audio.
- **Datos guardados:** todo lo que se lee de `localStorage` (sesión, sonido, perfil, aspecto, última página) se limpia campo a campo. Las portadas que van en CSS solo se aceptan de `i.ytimg.com`.
- **Comprobaciones:**
  - `recheck` sobre 72 expresiones: ninguna exponencial;
  - `npm audit`: 0 vulnerabilidades;
  - 80 pruebas de servidor y seguridad y 58 de interfaz, todas superadas;
  - lint: 0 errores.
