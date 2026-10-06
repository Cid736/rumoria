// Synced lyrics ("[01:23.45] words") → [{ t: seconds, text }], in order.
function parseLrc(text) {
  const out = [];
  for (const line of String(text).split(/\r?\n/).slice(0, 5000)) {
    const stamps = [...line.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    if (!stamps.length) continue;
    const words = line.replace(/\[[^\]]*\]/g, '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 300);
    for (const m of stamps) {
      const frac = m[3] ? Number(m[3]) / 10 ** m[3].length : 0;
      out.push({ t: Number(m[1]) * 60 + Number(m[2]) + frac, text: words });
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

module.exports = { parseLrc };
