import * as twgl from '../js/twgl-full.module.js';
import {
  assertArrayEqual,
  assertNoGLError,
  assertRectIsColor,
} from '../assert.js';
import {describe, it} from '../mocha-support.js';
import {
  createContext,
  createContext2,
  setupTexturedPointProgram,
} from '../webgl.js';

describe('basic tests', () => {

  function testSharingTexture(gl1, gl2) {
    const fb1 = gl1.createFramebuffer();
    gl1.bindFramebuffer(gl1.FRAMEBUFFER, fb1);
    const t1 = gl1.createTexture();
    gl1.bindTexture(gl1.TEXTURE_2D, t1);
    gl1.texImage2D(gl1.TEXTURE_2D, 0, gl1.RGBA, 1, 1, 0, gl1.RGBA, gl1.UNSIGNED_BYTE,
                   new Uint8Array([0, 255, 0, 255]));

    setupTexturedPointProgram(gl2);
    gl2.bindTexture(gl2.TEXTURE_2D, t1);
    
    gl2.viewport(0, 0, 1, 1);
    gl2.clearColor(1, 0, 0, 1);
    gl2.clear(gl2.COLOR_BUFFER_BIT);
    gl2.drawArrays(gl2.POINTS, 0, 1);

    assertRectIsColor(gl2, 0, 0, 1, 1, [0, 255, 0, 255]);

    assertNoGLError(gl1);
    assertNoGLError(gl2);
  }

  it('test can share texture WebGL2', () => {
    const {gl: gl1} = createContext2();
    const {gl: gl2} = createContext2();
    testSharingTexture(gl1, gl2)
  });

  it('test can share texture WebGL1', () => {
    const {gl: gl1} = createContext();
    const {gl: gl2} = createContext();
    testSharingTexture(gl1, gl2)
  });

  it('test can share texture WebGL1->WebGL2', () => {
    const {gl: gl1} = createContext();
    const {gl: gl2} = createContext2();
    testSharingTexture(gl1, gl2)
  });

  it('test can share texture WebGL2->WebGL1', () => {
    const {gl: gl1} = createContext2();
    const {gl: gl2} = createContext();
    testSharingTexture(gl1, gl2)
  });

  it('restores attribute values', () => {
    const {gl: gl1} = createContext2();
    const {gl: gl2} = createContext2();

    const v1 = [11, 12, 13, 14];
    const v2 = [21, 22, 23, 24];
    gl1.vertexAttrib4fv(5, v1);
    gl2.vertexAttrib4f(5, ...v2);

    assertArrayEqual(gl1.getVertexAttrib(5, gl1.CURRENT_VERTEX_ATTRIB), v1);
    assertArrayEqual(gl2.getVertexAttrib(5, gl2.CURRENT_VERTEX_ATTRIB), v2);
  });

});