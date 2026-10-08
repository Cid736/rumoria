<p align="center">
  <a href="#español">🇪🇸 Español</a> &nbsp;·&nbsp; <a href="#english">🇬🇧 English</a>
</p>

---

<a name="español"></a>

# Privacidad y condiciones de uso

Rumoria es software gratuito y de código abierto (licencia MIT), mantenido por Eric Cid López a título personal. No se vende nada, no hay cuentas de usuario, pagos ni publicidad.

## Privacidad

**Rumoria no recoge ni envía datos personales al autor.** No hay analíticas, telemetría ni rastreadores. Todo se guarda en tu equipo (`%APPDATA%\rumoria`):

| Dato | Para qué |
|---|---|
| Tus listas (títulos, artistas e ids de vídeo; nunca audio) | Mostrarlas y reproducirlas |
| Historial de escucha (qué canción y cuántos segundos) | «Hecho para ti», novedades de tus artistas y «Tu resumen». Se puede **pausar o borrar** en Ajustes |
| Favoritas | Tu lista de Favoritas |
| Ajustes (tema, volumen, carpeta de música, tu aspecto, el mini reproductor y su posición, el sonido, el perfil de rendimiento) | Recordarlos |
| La cola, la canción y el segundo en que estabas | «Seguir donde lo dejaste» (se puede apagar en Ajustes) |
| Lo fuerte que suena cada canción (un número por canción) | «Mismo volumen» |
| «Recientes» (qué listas, mezclas o radios pusiste y cuántas veces) y las recomendaciones ya calculadas | «Recientes», «Lo que más vuelves a poner», «Descubre algo nuevo» y las mezclas del día |
| Copia de las listas de Explorar (datos públicos de YouTube, hasta 6 horas) | Que se abran rápido y tengan portada |
| «Para ti»: tus géneros calculados, cuándo se renovó y los géneros que quitaste (`curator.json`) | Crear y renovar las listas de «Para ti» |

La primera vez, si tienes TubeGrab, Rumoria **copia** (no mueve) tus listas, historial, favoritas y novedades desde `%APPDATA%\tubegrab`.

Conexiones a terceros (cada servicio aplica su propia política de privacidad):

- **YouTube** (Google): buscar, leer playlists, reproducir, mostrar portadas (`i.ytimg.com`) y, si lo activas en el mini reproductor, su videoclip (un vídeo sin sonido de 360p como mucho, que llega por la misma vía que el audio y no se guarda). Recibe tu dirección IP, como cualquier visita a YouTube. Con la app abierta también lo consulta **en segundo plano**: las listas de Explorar (las destacadas cada 6 h, el resto una vez al día), las listas que se llenan solas (según lo que elijas, de cada 6 h a cada semana), «Para ti» (al empezar y cada pocos días), las novedades de tus artistas (cada 12 h) y las listas importadas desde un enlace (cada 3 h). Solo envía búsquedas fijas de la app, los temas que tú escribes para tus listas, los nombres de tus artistas más escuchados (para sus novedades y, si no salen en ninguna categoría, para ver qué artistas suenan con ellos) e ids de canciones. Tus géneros se calculan en tu equipo: tu historial no sale de él.
- **Spotify** (`open.spotify.com`) y **Apple Music** (`music.apple.com`): solo al importar o actualizar una lista desde su enlace; se lee su página pública.
- **LRCLIB** (`lrclib.net`): al abrir la letra; recibe el artista, el título y la duración.
- **GitHub** (`api.github.com`, `github.com`): descargar y actualizar yt-dlp, y buscar y descargar las actualizaciones de Rumoria (al abrirla y cada 6 horas). Solo se instala un archivo cuya huella SHA-256 coincide con la que publica GitHub.

Tu carpeta de música solo se lee en tu equipo; nada de ella sale a internet.

**Cookies:** el servidor interno de la app usa una cookie técnica que caduca al cerrarla, imprescindible para que solo la propia app pueda hablar con él. Está exenta de consentimiento (art. 22.2 LSSI / art. 5.3 Directiva ePrivacy).

## Condiciones de uso

- **Uso personal y responsabilidad del usuario.** Rumoria reproduce contenido de YouTube fuera de su web y de su reproductor. Las condiciones de servicio de YouTube no lo permiten y pueden suspender el acceso. Úsalo solo para uso personal y privado, nunca para difundir, emitir en público ni sacar beneficio. Tú eres responsable del uso que hagas de la app.
- **Derechos de autor.** La música, las letras y las imágenes pertenecen a sus titulares. Rumoria no aloja, guarda ni distribuye contenido: lo pide en el momento a quien lo publica, y las letras a LRCLIB, un servicio colaborativo.
- **Sin afiliación.** Rumoria no está afiliado, patrocinado ni aprobado por YouTube, Google, Spotify, Apple ni LRCLIB. Sus nombres son marcas de sus titulares y se citan solo para indicar de dónde se pueden importar listas. Rumoria no usa sus logotipos, colores ni diseño.
- **Artistas y listas de terceros.** Los nombres de artistas («Radio de …», «Radios populares», «Si te gusta …») solo indican qué música suena. No implican relación, patrocinio ni aprobación de esos artistas ni de sus sellos. Las listas de Explorar y las radios se forman con playlists y mezclas públicas de YouTube creadas por otros; los nombres y descripciones de las categorías son de Rumoria. Si eres titular de derechos o artista y quieres que algo deje de aparecer, abre un *issue* (ver Contacto).
- **Sin garantía.** Se ofrece "tal cual", sin garantías de ningún tipo, según la [licencia MIT](LICENSE). Los servicios cambian a menudo y la reproducción puede fallar.
- **Componentes de terceros:** [yt-dlp](https://github.com/yt-dlp/yt-dlp) (Unlicense; su .exe incluye Python y otras bibliotecas con sus licencias), Electron, React y los paquetes npm listados en [`third-party/`](third-party/README.txt), que también va dentro de la app.

## Contacto

Dudas, problemas o solicitudes de retirada: abre un *issue* en [github.com/Cid736/rumoria](https://github.com/Cid736/rumoria/issues).

---

<a name="english"></a>

# Privacy and terms of use

Rumoria is free, open-source software (MIT licence), maintained by Eric Cid López as an individual. Nothing is sold; there are no user accounts, payments or ads.

## Privacy

**Rumoria doesn't collect or send any personal data to the author.** No analytics, telemetry or trackers. Everything stays on your computer (`%APPDATA%\rumoria`): your lists (titles, artists and video ids, never audio), your listening history (which song and for how many seconds — it can be **paused or wiped** in Settings), favourites and settings (also your look, the sound and the performance profile), where you left off (the queue, the song and the second; can be switched off), how loud each song is (for "Mismo volumen"), "Recientes" (which lists, mixes or radios you put on and how often) with the recommendations already worked out, and a copy of the Explorar lists (public YouTube data, kept up to 6 hours). On first launch, if you have TubeGrab, Rumoria **copies** (doesn't move) your lists, history, favourites and news from `%APPDATA%\tubegrab`.

Third-party connections (each service has its own privacy policy): **YouTube** (search, playlists, playback, covers from `i.ytimg.com` and, if you turn it on in the mini player, its video clip — a soundless video of 360p at most, through the same relay as the sound, never saved; receives your IP like any visit. While the app is open it is also asked **in the background**: Explorar lists (featured every 6 h, the rest once a day), lists that fill themselves (from every 6 h to weekly, as you choose), "Para ti" (at start and every few days), news of your artists every 12 h, lists imported from a link every 3 h — only the app's fixed searches, the topics you type for your lists, your most-played artists' names (for their news and, when no category knows them, to see who plays alongside them) and song ids are sent; your genres are worked out on your computer and your history never leaves it), **Spotify** and **Apple Music** (only when importing or refreshing a list from its link; their public page is read), **LRCLIB** (when showing lyrics; receives artist, title and length), **GitHub** (downloading and updating yt-dlp, and checking for and downloading Rumoria's own updates at start and every 6 hours; only a file whose SHA-256 matches the one GitHub publishes is installed). Your music folder is only read on your computer.

**Cookies:** the app's internal server uses one technical session cookie, so that only the app itself can talk to it; it's exempt from consent (EU ePrivacy Directive art. 5(3)).

## Terms of use

- **Personal use; you are responsible.** Rumoria plays YouTube content outside YouTube's website and player, which YouTube's terms of service don't allow; they may suspend access. Use it only privately, never to redistribute, broadcast in public or make money. You are responsible for how you use the app.
- **Copyright.** Music, lyrics and images belong to their owners. Rumoria doesn't host, store or distribute content: it requests it on the spot from whoever publishes it (lyrics from LRCLIB, a community service).
- **No affiliation.** Rumoria isn't affiliated with, sponsored or endorsed by YouTube, Google, Spotify, Apple or LRCLIB. Their names are trademarks of their owners and are mentioned only to say where lists can be imported from. Rumoria doesn't use their logos, colours or design.
- **Artists and third-party lists.** Artist names ("Radio de …", popular radios, "Si te gusta …") only say what music plays; they imply no connection with, sponsorship or endorsement by those artists or their labels. Explorar lists and radios are made from public YouTube playlists and mixes created by others; the category names and descriptions are Rumoria's own. Rights holders or artists who want something removed can open an issue (see Contact).
- **No warranty.** Provided "as is", without warranty of any kind, under the [MIT licence](LICENSE). Services change often and playback may fail.
- **Third-party components:** [yt-dlp](https://github.com/yt-dlp/yt-dlp) (Unlicense; its .exe bundles Python and other libraries under their licences), Electron, React and the npm packages listed in [`third-party/`](third-party/README.txt), which also ships inside the app.

## Contact

Questions, problems or takedown requests: open an issue at [github.com/Cid736/rumoria](https://github.com/Cid736/rumoria/issues).
