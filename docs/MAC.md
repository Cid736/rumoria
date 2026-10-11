# Rumoria para Mac

Es la misma app de escritorio que en Windows (Electron), compilada para macOS. Las herramientas para empaquetar y firmar una app de Mac solo funcionan en macOS, así que **la compilan los Mac de GitHub**. Para publicar no hace falta tener un Mac.

## Cómo se publica

1. Se crea una release en GitHub (`gh release create vX.Y.Z …` con los `.exe` y los APK, como siempre).
2. Al publicarla, `.github/workflows/mac.yml` arranca solo en un Mac de GitHub (`macos-14`, con chip de Apple) y hace esto:
   - Pasa los tests de servidor, seguridad e interfaz. En el Mac también corre el test que cambia de verdad un `Rumoria.app` con `ditto`.
   - Ejecuta `npm run dist:mac`, que crea `Rumoria.app` para chip de Apple (`arm64`) y para Intel (`x64`), con firma *ad-hoc* (`identity: "-"`, `hardenedRuntime: false`) y yt-dlp para Mac (`yt-dlp_macos`) dentro.
   - Comprueba la firma (`codesign --verify --deep --strict`), el procesador de cada app (`lipo`), que el `.zip` lleva `Rumoria.app` y que yt-dlp se puede ejecutar.
   - Abre la app empaquetada con Playwright (`test/e2e/mac.spec.mjs`). Comprueba los botones propios del Mac, el servidor y una búsqueda y un audio de YouTube, y guarda capturas y un informe en el artefacto `mac-screenshots`.
   - Sube a la release `Rumoria-mac-arm64.dmg`, `Rumoria-mac-x64.dmg`, `Rumoria-mac-arm64.zip` y `Rumoria-mac-x64.zip`.
3. También se puede lanzar a mano en Actions → Mac → *Run workflow*: sin etiqueta solo compila y prueba; con una etiqueta, añade los archivos a esa release.

## Para quien la instala

- Abre el `.dmg` del procesador de su Mac y arrastra Rumoria a **Aplicaciones**.
- La primera vez, macOS avisa de «desarrollador no identificado». Hay que hacer clic derecho → Abrir → Abrir, o ir a Ajustes del Sistema → Privacidad y seguridad → «Abrir igualmente». Solo una vez.
- **Se actualiza sola** si está en Aplicaciones:
  1. Descarga `Rumoria-mac-<procesador>.zip` y lo comprueba con su SHA-256.
  2. Al cerrar Rumoria, cambia `Rumoria.app`. Si algo falla, vuelve a poner la anterior.
- **Dónde no se actualiza:** si se abre desde el `.dmg` o desde Descargas (macOS la traslada a otra carpeta), no se actualiza y lo dice.
- **Datos:** están en `~/Library/Application Support/rumoria`.

## Diferencias con Windows

- La ventana tiene los tres botones propios del Mac. La barra de la página les deja sitio y no dibuja los suyos.
- Tiene menú de Mac: Rumoria, Edición (para copiar y pegar en los cuadros de texto) y Ventana.
- El icono del Dock devuelve la ventana si estaba escondida.
- Los atajos globales son los mismos (Ctrl + Opción + tecla).

## Pendiente

- **Firmar y notarizar con una cuenta de desarrollador de Apple** (99 $ al año) para quitar el aviso de la primera vez. Haría falta:
  - poner el certificado y la contraseña en los secretos del repositorio;
  - cambiar `identity: "-"` por el certificado;
  - activar `hardenedRuntime` y la notarización en `package.json`.
- Nadie la ha probado aún en un Mac de verdad con altavoces. En el Mac de GitHub se comprobó que el audio llega, no que suena.
