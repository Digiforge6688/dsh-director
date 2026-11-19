/**
 * ZipX × DSH client bundle — conversation-first shell.
 *
 * Format is DSH's factory bundle: window.__ModuleLoader__.load({ id, factory }).
 * The id must equal the package name. Only 'react' may be required.
 *
 * Source is split into ordered parts under src/client/*.js and concatenated by
 * scripts/build.mjs. Every part shares this factory closure.
 */
window.__ModuleLoader__.load({
  id: 'dsh-director',
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;
    var ReactNS = require('react');
    var React = ReactNS && ReactNS.default && ReactNS.default.createElement ? ReactNS.default : ReactNS;
    var h = React.createElement;
    var useState = React.useState;
    var useEffect = React.useEffect;
    var useMemo = React.useMemo;
    var useRef = React.useRef;
    var useCallback = React.useCallback;

    var NS = 'zipx';
    var API = '/zipx-api';
    var ACCOUNT = '/zipx-account';
    var AUTH = '/zipx-auth';
    var DOCTOR = '/zipx-doctor';
    var BUDGET = '/zipx-budget';

    /** Runtime handles captured at apply(): no React context reaches outside the factory. */
    var RUNTIME = { ctx: null, studioUrl: '', shell: 'conversation', lastSessionId: '', pendingProject: '', pendingCreate: null };
