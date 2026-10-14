# Rumoria para Android

La app de Android es la misma Rumoria que la de escritorio, con el mismo servidor y la misma página, metida en un teléfono. Este documento explica cómo está hecha, cómo se compila y cómo se publica.

## Cómo está hecha

```
┌─────────────────────────── el proceso de la app ───────────────────────────┐
│  MainActivity (WebView) ──http://127.0.0.1:27315──▶ Node (nodejs-mobile)    │
│      │  la página de siempre (dist/)                   server/ de siempre   │
│      │  canal «RumoriaAndroid»                             │ execFile        │
│      ▼                                                      ▼                │
│  PlaybackService: notificación,              Python + yt-dlp + QuickJS       │
│  pantalla de bloqueo, auriculares            (youtubedl-android)             │
└─────────────────────────────────────────────────────────────────────────────┘
```

- **Node en el móvil:** [nodejs-mobile](https://github.com/nodejs-mobile/nodejs-mobile) v18.20.4 arranca `server/main.js` dentro del proceso de la app (`NodeRunner.java` y `cpp/native-lib.cpp`). Escucha solo en `127.0.0.1` y pide un secreto nuevo en cada arranque. La página lo recibe como cookie `HttpOnly`, igual que en el escritorio.
- **yt-dlp en el móvil:** [youtubedl-android](https://github.com/yausername/youtubedl-android) 0.18.1 trae Python, yt-dlp y QuickJS, que resuelve los retos de YouTube. El servidor lanza yt-dlp con `RUMORIA_YTDLP` (el Python), `RUMORIA_YTDLP_PREFIX` (el script), `RUMORIA_YTDLP_ENV` y `RUMORIA_JS_RUNTIMES=quickjs:…`, todo en `server/lib/ytdlp.js` → `run()`. yt-dlp se pone al día solo cada 6 horas y, desde Ajustes → Sistema, también al momento.
- **Node sin Intl:** el Node de nodejs-mobile está compilado sin ICU, así que no tiene `Intl`, `\p{…}` en las expresiones regulares ni `normalize`. `scripts/android-prepare.js` reescribe cada `\p{L}`, `\p{N}`, `\p{ID_Start}` y `\p{ID_Continue}` del servidor y sus dependencias como los rangos que significan, calculados con el Node completo del ordenador que compila. Además `android/node/shim.js`, que se carga con `node -r`, devuelve los acentos (`normalize('NFD')`) y un `Intl.Collator` básico. Lo comprueba `test/server/android.test.js`.
- **La página:** detecta el móvil por `window.RumoriaAndroid` y cambia al diseño de teléfono, que también se puede probar en un navegador con `?phone` en la dirección:
  - `src/components/Phone.jsx`: las pestañas, el mini reproductor y el reproductor grande.
  - `src/styles/phone.css`: los estilos del teléfono.
  - `src/lib/android.js`: el canal con la app.
- **El canal con la app:** se abre con `WebViewCompat.addWebMessageListener`, solo para el origen `http://127.0.0.1:<puerto>` y solo desde el marco principal.
  - La página manda a la app lo que suena (para la notificación), el color del tema (para las barras del sistema) y si quiere salir.
  - La app manda a la página los botones de la notificación y el botón atrás.
  - No hay `addJavascriptInterface`.
- **El reproductor vive con la app, no con la ventana** (`WebHost.java`). La página está en un WebView con `MutableContextWrapper`: la ventana la muestra mientras está abierta, y sin ventana sigue sonando, por ejemplo al quitar la app de recientes o al empezar desde Android Auto. Las órdenes que llegan mientras la página carga esperan en cola.
- **Android Auto:** `PlaybackService` es un `MediaBrowserServiceCompat`, y `AutoLibrary.java` le da Favoritas, Tus listas y las canciones de cada lista. `onPlayFromMediaId` y `onPlayFromSearch` pasan a la página (`playFromCar` en `src/lib/android.js`). Solo navegan esta app, Android Auto, el coche, el Asistente y el sistema. Hay una prueba instrumentada que hace lo mismo que el coche: `cd android && ./gradlew assembleDebug assembleDebugAndroidTest`, se instalan los dos APK y se ejecuta `adb shell am instrument -w -e class com.rumoria.app.AutoTest com.rumoria.app.test/androidx.test.runner.AndroidJUnitRunner`. Necesita un emulador o un móvil con red.
- **Música en segundo plano:** `PlaybackService` es un servicio en primer plano de tipo `mediaPlayback`. Se encarga de:
  - la `MediaSession`, que da la pantalla de bloqueo, los auriculares y Bluetooth,
  - la notificación con portada, posición, anterior, pausa y siguiente, y (v1.12.3) aleatorio y repetir. Android 13 y posteriores dibujan esos dos botones a partir de las acciones propias de la sesión (`CustomAction`), y hasta Android 12, a partir de los de la notificación. Si la deslizas para quitarla (solo se puede en pausa), se cierra también el reproductor de la app, y si se cierra el reproductor en la app, se va la notificación,
  - un *wake lock* parcial mientras suena.

  Si se quita la app de recientes mientras suena, la música sigue; si está en pausa, se cierra. Se pausa sola al desconectar los auriculares o el Bluetooth.
- **Actualizaciones:** cada 12 horas, `Updater.java` mira la última release de `Cid736/rumoria`. Descarga el APK de su procesador, lo comprueba con el SHA-256 que publica GitHub y pide permiso para instalarlo encima.

## Compilar

Hace falta:
- Node 22
- JDK 17 o posterior
- el Android SDK con:
  - `platforms;android-37.0`
  - `build-tools;36.0.0`
  - `ndk;28.2.13676358`
  - `cmake;3.31.6`

Se compila así:

```powershell
npm ci
npm run android:prepare      # libnode (con su SHA-256 fijado) + servidor y página en assets/nodejs-project.zip
cd android
./gradlew assembleDebug      # o assembleRelease (firmado, ver abajo)
```

Salen tres APK, uno por procesador, en `android/app/build/outputs/apk/<tipo>/`:

| APK de Gradle | Se publica como | Para |
|---|---|---|
| `app-arm64-v8a-*.apk` | `Rumoria-Android.apk` | casi todos los móviles |
| `app-armeabi-v7a-*.apk` | `Rumoria-Android-32bit.apk` | móviles antiguos de 32 bits |
| `app-x86_64-*.apk` | `Rumoria-Android-x86_64.apk` | emulador, Chromebook |

La versión sale de `package.json`: `versionName` 1.9.0 corresponde a `versionCode` 10900.

## La clave de firma

Android solo acepta una actualización firmada con **la misma clave** que la versión instalada. La clave vive fuera del repositorio:

- `%USERPROFILE%\.rumoria\android-release.jks`
- `%USERPROFILE%\.rumoria\android-signing.properties` (`storeFile`, `storePassword`, `keyAlias`, `keyPassword`)

Otra ruta se puede indicar con `RUMORIA_ANDROID_SIGNING`. Sin ese archivo, `assembleRelease` firma con la clave de depuración, que no sirve para publicar.

**Haz una copia de los dos archivos en un sitio seguro** (un USB o un gestor de contraseñas). Si se pierden, quien tenga Rumoria instalada tendrá que desinstalarla y perder sus datos para poner la versión nueva.

Huella SHA-256 del certificado: `D3:0C:5C:9B:52:AD:21:A9:F3:E2:DC:38:BD:0D:7E:42:FB:BF:98:B0:4C:79:85:EF:A7:3F:EE:58:8E:93:F4:44`

## Publicar

1. `npm run android:build` (prepara y compila firmado; equivale a `npm run android:prepare` y después `./gradlew assembleRelease` en `android/`).
2. Copia los APK con los nombres de la tabla.
3. Súbelos a la misma release de GitHub que los `.exe`. El actualizador de Windows sigue buscando sus tres `.exe` en la última release, así que **cada release lleva los `.exe` y los APK**.

## Probar

- `npm test` incluye:
  - `test/server/android.test.js`: la reescritura sin Intl, el shim y el zip.
  - `test/security/android.test.js`: el manifiesto, el WebView, el canal, el secreto y las actualizaciones.
  - `test/ui/phone.test.jsx`: las pestañas, los reproductores, el botón atrás, la notificación y los Ajustes del móvil.
- La CI compila los APK de depuración en cada cambio (trabajo «Android app builds»).
- **Para probar a mano en el emulador**, con un APK de depuración:
  1. Crea el móvil virtual: `avdmanager create avd -n rumoria -k "system-images;android-35;google_apis;x86_64" -d pixel_7`.
  2. Abre el WebView en `chrome://inspect`, o usa `adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>`.

## Límites conocidos

- **Se instala desde GitHub, no desde Google Play.** Google Play no acepta apps que reproducen YouTube en segundo plano. La primera vez, Android pide permitir «instalar apps de origen desconocido».
- **Móviles con páginas de memoria de 16 KB:** libnode no está alineado a 16 KB. En Android 16, `android:pageSizeCompat="enabled"` lo hace funcionar en modo de compatibilidad.
- **Sin «Tu música»:** de momento no lee archivos del teléfono.
- **iPhone:** no se hace. Apple no permite instalar fuera del App Store, y en el App Store no aceptan apps que reproduzcan audio de YouTube.
