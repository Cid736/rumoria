# Sincronizar

Tus listas, Favoritas y listas inteligentes quedan iguales en el PC, el Mac y el móvil. No hay cuenta, no hace falta tener dos dispositivos encendidos a la vez, y la nube no puede leer nada.

## Cómo funciona

| Paso | Dónde |
|---|---|
| Crear un código de 6 palabras de la lista BIP-39 en español (2048 palabras, unas 7·10¹⁹ combinaciones) | en el dispositivo |
| Sacar del código, despacio (PBKDF2-SHA256, 600 000 vueltas), tres cosas: el **id** de la fila, la **clave de cifrado** y una **clave de escritura** | en el dispositivo |
| Cifrar la biblioteca: JSON → gzip → **AES-256-GCM** (con el id como dato asociado y un nonce nuevo cada vez) → `v1:…` | en el dispositivo |
| Guardar `id`, el texto cifrado, una **huella SHA-256** de la clave de escritura y un número de versión | en Supabase |

- **El código no sale nunca del dispositivo.**
  - El id no es el SHA-256 del código. Sale de la derivación lenta, así que no sirve para probar códigos rápido.
  - Sin el código no se puede descifrar ni escribir.
- **Nadie puede leer ni listar la tabla.** La app solo puede llamar a tres funciones (`supabase/rumoria-sync.sql`):
  - `rumoria_get(id)`: devuelve esa fila.
  - `rumoria_put(id, datos, clave_escritura, versión)`: solo guarda con la clave y sobre la versión de la que partía. Si otro dispositivo guardó antes, contesta «conflicto» y el dispositivo vuelve a mezclar.
  - `rumoria_delete(id, clave_escritura)`: borra la fila.
- **Cuándo se sincroniza:** al abrir Rumoria, cada 5 minutos y unos segundos después de cambiar algo. El otro dispositivo encuentra la copia cuando se abra.
- **Cómo se mezcla:** en tres vías, contra lo que tenían en común la última vez (solo se guarda la huella de cada elemento).
  - Lo cambiado en un lado gana.
  - Si se cambió en los dos, gana lo más reciente.
  - Si se borró en un lado y en el otro no se tocó, se borra.
  - Lo nuevo de cualquier lado se queda.
  - Al unirse con un código, se juntan las dos bibliotecas.
  - Las listas de «Para ti» no se sincronizan, porque cada dispositivo hace las suyas.
- **Dónde está el código:** en `sync.json`, dentro de la carpeta de datos de cada dispositivo, junto al resto de tu biblioteca.

## Ponerlo en marcha (una vez)

1. En Supabase → **SQL Editor**, pega y ejecuta `supabase/rumoria-sync.sql`. Hace tres cosas:
   - añade las columnas que faltan a `sync_libraries`;
   - **cierra la tabla**: quita las políticas públicas y desactiva Realtime;
   - crea las tres funciones.
2. Pon la URL del proyecto en `server/lib/sync-config.js`. La clave `sb_publishable_…` ya está; es pública por diseño.
3. **Nunca** pongas la clave `sb_secret_…` en la app ni en el repositorio.

## Código

- `server/lib/cloudsync.js`: el código, las claves, el cifrado, la mezcla y el cliente de la nube.
- `server/app.js`: `/api/sync`, `/api/sync/create`, `/api/sync/join`, `/api/sync/now` y `/api/sync/leave`.
- `src/views/SyncSettings.jsx`: Ajustes → Sincronizar.
- `src/lib/syncWatch.js`: vuelve a leer la biblioteca cuando llega algo de otro dispositivo.
- Tests:
  - `test/server/cloudsync.test.js`: dos dispositivos que nunca coinciden, conflictos, alguien con el id pero sin el código, borrar.
  - `test/ui/sync.test.jsx`: la pantalla de Ajustes.
