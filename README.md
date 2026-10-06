# Escuchar

Tu música en el escritorio: tus listas de **Spotify, Apple Music y YouTube**, favoritas, «Hecho para ti» y tu resumen del año. Suena directamente desde YouTube, sin descargar nada. Tus propios archivos también suenan («Tu música»).

Nació como la pestaña «Escuchar» de [TubeGrab](https://github.com/Cid736/tubegrab). La primera vez trae de allí tus listas, tu historial, tus favoritas y las novedades. Con «Descargar con TubeGrab» le pasas una canción para guardarla.

## Funciones

- **Biblioteca a la izquierda**: Favoritas, Tu música, tus listas en carpetas, con filtros y buscador
- **Importa** una playlist o un perfil entero de Spotify; las listas de un enlace se mantienen al día solas
- **Reproductor abajo**: aleatorio, repetir (todo / una), radio al acabar la cola, volumen, teclas multimedia
- **Cola y letra sincronizada** en el panel derecho (pulsa una línea para ir a ella)
- **Hecho para ti**: mixes diarios de tus artistas, lo más escuchado, escuchado hace poco y para redescubrir
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

MIT. Para uso personal; respeta los derechos de autor y las condiciones de los servicios que uses.
