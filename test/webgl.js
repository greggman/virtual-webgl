/* global document */
import * as twgl from './js/twgl-full.module.js';

export function createContext() {
  const gl = document.createElement('canvas').getContext('webgl');
  return { gl };
}

export function createContext2() {
  const gl = document.createElement('canvas').getContext('webgl2');
  return { gl };
}

function resetContext(gl) {
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
  gl.bindRenderbuffer(gl.RENDERBUFFER, null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, null);
  gl.bindTexture(gl.TEXTURE_CUBE_MAP, null);
  gl.useProgram(null);
}

export function resetContexts(context) {
  const { gl, gl2, vaoExt } = context;
  if (vaoExt) {
    vaoExt.bindVertexArrayOES(null);
  }
  resetContext(gl);

  if (gl2) {
    gl2.bindVertexArray(null);
    resetContext(gl2);
  }
}

const pointVS = `
attribute vec4 position;
varying vec4 v_color;

void main() {
  gl_Position = position;
  gl_PointSize = 1.0;
}
`;

const pointColorFS = `
precision mediump float;

uniform vec4 color;

void main() {
  gl_FragColor = color;
}
`;

const pointTextureFS = `
precision mediump float;

uniform sampler2D tex;

void main() {
  gl_FragColor = texture2D(tex, gl_PointCoord.xy);
}
`;

export function setupProgram(gl, shaders) {
  const prgInfo = twgl.createProgramInfo(gl, shaders);
  gl.useProgram(prgInfo.program);
  return prgInfo;
}

export function setupColoredPointProgram(gl) {
  return setupProgram(gl, [pointVS, pointColorFS]);
}

export function setupTexturedPointProgram(gl) {
  return setupProgram(gl, [pointVS, pointTextureFS]);
}

export function escapeRE(str) {
    return str.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
}

export function not(str) {
  return new RegExp(`^((?!${escapeRE(str)}).)*$`);
}

