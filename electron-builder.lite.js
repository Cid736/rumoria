// Light portable build (Rumoria-Lite.exe): the same app without yt-dlp inside;
// it downloads it (SHA-256 verified) on first launch.
const { build } = require('./package.json');

module.exports = {
  ...build,
  win: { ...build.win, target: 'portable' },
  portable: { artifactName: 'Rumoria-Lite.exe' },
  files: build.files.filter((f) => !/^bin\//.test(f)),
};
