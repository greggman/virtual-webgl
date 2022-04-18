/* global mocha */
/* global URLSearchParams */
/* global window */

import './tests/basic-tests.js';
//import './tests/lose-context-tests.js';
import './tests/webgl1-on-webgl2-tests.js';

const settings = Object.fromEntries(new URLSearchParams(window.location.search).entries());
if (settings.reporter) {
  mocha.reporter(settings.reporter);
}
mocha.run((failures) => {
  window.testsPromiseInfo.resolve(failures);
});
