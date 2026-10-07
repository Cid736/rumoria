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
