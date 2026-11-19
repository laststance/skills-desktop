// electron-builder validates this dependency as semver before packaging the app.
module.exports = {
  extraMetadata: {
    dependencies: {
      'electron-updater': require('electron-updater/package.json').version,
    },
  },
}
