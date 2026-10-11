// Ajustes → Tu móvil: Rumoria for Android, from the computer — a QR code
// (made once: the link never changes, it always gives the newest APK), the
// link to open or copy, and how to install it. Not shown on the phone itself.
import { isPhone } from '../lib/android.js';
import { useUi } from '../store/ui.js';

export const ANDROID_URL = 'https://github.com/Cid736/rumoria/releases/latest/download/Rumoria-Android.apk';

export default function MobileApp() {
  if (isPhone) return null;
  const copy = async () => {
    try { await navigator.clipboard.writeText(ANDROID_URL); useUi.getState().toast('Enlace copiado: mándatelo al móvil'); } catch { useUi.getState().toast('No se pudo copiar'); }
  };
  return (
    <section className="set-group mobile-app">
      <h2>Rumoria en tu móvil</h2>
      <div className="mobile-app-body">
        <img className="mobile-qr" src="/qr-android.svg" width="168" height="168" alt="Código QR con el enlace para descargar Rumoria para Android" />
        <div className="mobile-app-text">
          <ol className="mobile-steps">
            <li>Apunta la <strong>cámara de tu móvil Android</strong> a este código y abre el enlace.</li>
            <li>Se descarga <strong>Rumoria-Android.apk</strong>: ábrelo.</li>
            <li>Si el móvil lo pide, permite instalar apps de ese origen y pulsa «Instalar».</li>
          </ol>
          <div className="mobile-actions">
            <a className="btn btn-accent" href={ANDROID_URL} target="_blank" rel="noopener noreferrer">Abrir el enlace</a>
            <button type="button" className="btn btn-ghost" onClick={copy}>Copiar enlace</button>
          </div>
          <p className="muted">
            Siempre es la última versión, y luego se actualiza sola. No está en Google Play, que no acepta apps que reproducen YouTube.
            Para tener las mismas listas en los dos, usa <strong>Sincronizar</strong>, aquí debajo.
          </p>
          <p className="muted"><strong>¿iPhone?</strong> Por ahora no hay: Apple no deja instalar apps fuera de su tienda, y en ella no aceptan apps que reproducen YouTube.</p>
        </div>
      </div>
    </section>
  );
}
