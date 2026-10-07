# Rumoria

Tu música en el escritorio: tus listas de **Spotify, Apple Music y YouTube**, favoritas, «Hecho para ti» y tu resumen del año. Suena directamente desde YouTube, sin descargar nada. Tus propios archivos también suenan («Tu música»).

Nació como la pestaña «Escuchar» de [TubeGrab](https://github.com/Cid736/tubegrab). La primera vez trae de allí tus listas, tu historial, tus favoritas y las novedades. Con «Descargar con TubeGrab» le pasas una canción para guardarla.

## Funciones

- **Biblioteca a la izquierda**: Favoritas, Tu música, tus listas en carpetas, con filtros y buscador
- **Importa** una playlist o un perfil entero de Spotify; las listas de un enlace se mantienen al día solas
- **Reproductor abajo**: aleatorio, repetir (todo / una), radio al acabar la cola, volumen, teclas multimedia
- **Cola y letra sincronizada** en el panel derecho (pulsa una línea para ir a ella)
- **Listas que se llenan solas**: escribe un estilo, un artista o un momento («Rock de los 80», «Bad Bunny», «lo-fi para estudiar»), o pulsa ✨ junto a una carpeta para usar su nombre, y Rumoria la llena al momento y le añade canciones nuevas cada 6 h, 12 h, día o semana. Si quitas una, no vuelve
- **«Para ti»**: nada más instalarla ya tienes una carpeta con 6 listas llenas. Según lo que escuchas, Rumoria deduce tus géneros (cruzando tus artistas con los de cada categoría), crea sus listas con tus artistas primero, añade una para **descubrir** el género que más se parece a lo tuyo y las **renueva** cada 3 días, semana o 2 semanas. Las que renombres o muevas pasan a ser tuyas; se puede apagar en Ajustes
- **Inicio con recomendaciones**, sin tener que añadir nada:
  - **Hecho para ti**: «Descubre algo nuevo» (cada semana, solo canciones que aún no has escuchado), una **Mezcla del día** por cada uno de tus seis artistas favoritos, novedades de tus artistas, lo más escuchado, escuchado hace poco y para redescubrir
  - **Lo que más vuelves a poner** y **Recientes** (listas, mezclas, radios…)
  - **Radios para ti** (de tus artistas), **Radios populares** (Bad Bunny, KAROL G, Rosalía, Coldplay…) y **Si te gusta …** (radios de artistas parecidos a tu favorito)
  - **Explorar** y **Todas las categorías**: más de 40 listas ya hechas (éxitos, pop, urbano, rock, K-pop, anime, jazz, flamenco, salsa, para dormir, para entrenar, décadas…), también en Buscar
- Cada estantería enseña una fila y tiene «Mostrar todo»
- Todo suena directamente desde YouTube, sin descargar nada; cualquier lista se puede guardar como tuya, y descargar una canción es opcional («Descargar con TubeGrab»)
- **Novedades de tus artistas** y **Tu resumen** del año
- Botón derecho en cualquier canción: a continuación, a la cola, a una lista, favorita, radio, descargar con TubeGrab
- Tema oscuro, claro o el del sistema; atajos de teclado (Espacio, Ctrl+←/→, Ctrl+S, Ctrl+R, Ctrl+L, Alt+←/→)

## Desarrollo

```powershell
npm install
npm run fetch-ytdlp   # opcional
npm test              # servidor + seguridad + interfaz
npm run dev           # http://127.0.0.1:5173
npm start             # app de escritorio
```

La arquitectura, la guía completa para levantar los dos proyectos y el resumen de los tests de seguridad están en [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md).

## Privacidad

Todo se queda en tu ordenador: listas, historial y favoritas. El historial se puede pausar o borrar en Ajustes. Solo se conecta a YouTube (para buscar y reproducir), a LRCLIB (para las letras) y a Spotify o Apple Music (solo cuando importas una lista).

## Licencia

MIT. Para uso personal; respeta los derechos de autor y las condiciones de los servicios que uses. Reproducir YouTube fuera de su web no está permitido por sus condiciones. Rumoria no está afiliado a YouTube, Spotify, Apple, LRCLIB ni a los artistas que aparecen en sus radios. Privacidad, condiciones y licencias de terceros: [LEGAL.md](LEGAL.md) y [third-party/](third-party/README.txt).
