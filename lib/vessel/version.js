// System Objects
// ...

// Third Party Dependencies
// ...

// Internal
var Vessel = require('./vessel');

/*
  Gathers node version.
*/
Vessel.prototype.fetchNodeProcessVersion = function() {
  return this.simpleExec(['node', '--version'])
    .then(version => {
      // strip the `v` preceding the version
      return version.trim().substring(1);
    });
};

Vessel.prototype.fetchNodeProcessVersions = function() {
  return this.simpleExec(['node', '-p', 'JSON.stringify(process.versions)'])
    .then(versions => JSON.parse(versions.trim()));
};
