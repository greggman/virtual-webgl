import * as twgl from '../js/twgl-full.module.js';
import {assertFalsy, assertNoGLError, assertRectIsColor, assertTruthy} from '../assert.js';
import {describe, it} from '../mocha-support.js';
import {createContext, setupColoredPointProgram} from '../webgl.js';

describe('Lost Context tests', () => {

  it('Can use WEBGL_lose_context', () => {
    const {gl} = createContext();
    const ext = gl.getExtension('WebGL_lose_context');
    assertTruthy(ext);
  });

});