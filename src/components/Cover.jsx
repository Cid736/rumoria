// A cover: the picture, a mosaic of four, or (without any) a gradient made
// from the name, so every list looks like itself.
import { useState } from 'react';
import { Heart, Note } from './Icons.jsx';

const SAFE_IMG = /^https:\/\/i\d?\.ytimg\.com\//;

function hue(text) {
  let h = 0;
  for (const c of String(text || '')) h = (h * 31 + c.codePointAt(0)) % 360;
  return h;
}

export function gradientOf(name) {
  const h = hue(name);
  return `linear-gradient(135deg, hsl(${h} 70% 55%), hsl(${(h + 50) % 360} 65% 32%))`;
}

export default function Cover({ src, thumbs, name, size = 48, round = false, liked = false, className = '' }) {
  const [broken, setBroken] = useState(false);
  const style = { width: size, height: size };
  const cls = `cover ${round ? 'cover-round' : ''} ${className}`;
  if (liked) {
    return <div className={`${cls} cover-liked`} style={style}><Heart filled size={Math.round(size * 0.42)} /></div>;
  }
  const pics = [...new Set((thumbs || []).filter((t) => SAFE_IMG.test(t)))];
  if (pics.length >= 4) {
    return (
      <div className={`${cls} cover-mosaic`} style={style}>
        {pics.slice(0, 4).map((t) => <img key={t} src={t} alt="" loading="lazy" draggable="false" />)}
      </div>
    );
  }
  const one = src || pics[0];
  if (one && !broken && (SAFE_IMG.test(one) || one.startsWith('/api/'))) {
    return <img className={cls} style={style} src={one} alt="" loading="lazy" draggable="false" onError={() => setBroken(true)} />;
  }
  return (
    <div className={`${cls} cover-blank`} style={{ ...style, background: gradientOf(name) }}>
      <Note size={Math.round(size * 0.38)} />
    </div>
  );
}
