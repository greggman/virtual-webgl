import * as twgl from '../js/twgl-full.module.js';
import {assertFalsy, assertNoGLError, assertRectIsColor, assertTruthy} from '../assert.js';
import {describe, it} from '../mocha-support.js';
import {createContext, setupTexturedPointProgram} from '../webgl.js';

describe('WebGL1 tests', () => {

  it('test is not WebGL2', () => {
    const {gl} = createContext();
    // Note: We don't disallow WebGL2 constants from being passed
    // to functions.
    assertFalsy(gl.drawBuffers);
    assertFalsy(gl.texImage3D);
    assertFalsy(gl.TEXTURE_3D);
    assertFalsy(gl.READ_FRAMEBUFFER);
  });

  it('handles depth stencil', () => {

  });

  it('test can use OES_texture_float', () => {
    const {gl} = createContext();
    assertTruthy(gl.getSupportedExtensions().includes('OES_texture_float'));
    const ext = gl.getExtension('OES_texture_float');
    assertTruthy(ext);

    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    // This would fail in WebGL2
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.FLOAT,
                  new Float32Array([0, 1, 0, 1]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    setupTexturedPointProgram(gl);

    gl.viewport(0, 0, 1, 1);
    gl.clearColor(1, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.POINTS, 0, 1);

    assertRectIsColor(gl, 0, 0, 1, 1, [0, 255, 0, 255]);

    assertNoGLError(gl);
  });

  it('test can use WEBGL_depth_texture', () => {
    const {gl} = createContext();
    assertTruthy(gl.getSupportedExtensions().includes('WEBGL_depth_texture'));

  });

  it('test can use OES_vertex_array_object', () => {
    const {gl} = createContext();
    assertTruthy(gl.getSupportedExtensions().includes('OES_vertex_array_object'));
    const ext = gl.getExtension('OES_vertex_array_object');
    assertTruthy(ext);

    const vs = `
    attribute vec4 position;
    attribute vec4 color;
    varying vec4 v_color;
    void main() {
      gl_Position = position;
      gl_PointSize = 1.0;
      v_color = color;
    }
    `;
    const fs = `
    precision mediump float;
    varying vec4 v_color;
    void main() {
      gl_FragColor = v_color;
    }
    `;
    const prg = twgl.createProgram(gl, [vs, fs]);
    gl.useProgram(prg);
    const colorLoc = gl.getAttribLocation(prg, 'color');

    gl.viewport(0, 0, 1, 1);
    gl.clearColor(1, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    assertRectIsColor(gl, 0, 0, 1, 1, [255, 0, 0, 255]);

    const va1 = ext.createVertexArrayOES();
    ext.bindVertexArrayOES(va1);
    const b1 = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b1);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 1, 0, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(colorLoc);
    gl.vertexAttribPointer(colorLoc, 4, gl.FLOAT, false, 0, 0);

    const va2 = ext.createVertexArrayOES();
    ext.bindVertexArrayOES(va2);
    const b2 = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b2);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(colorLoc);
    gl.vertexAttribPointer(colorLoc, 4, gl.FLOAT, false, 0, 0);

    ext.bindVertexArrayOES(va1);
    gl.drawArrays(gl.POINTS, 0, 1);
    assertRectIsColor(gl, 0, 0, 1, 1, [0, 255, 0, 255]);

    ext.bindVertexArrayOES(va2);
    gl.drawArrays(gl.POINTS, 0, 1);
    assertRectIsColor(gl, 0, 0, 1, 1, [0, 0, 255, 255]);

    assertTruthy(ext.isVertexArrayOES(va1));
    assertTruthy(ext.isVertexArrayOES(va2));

    ext.deleteVertexArrayOES(va1);
    ext.deleteVertexArrayOES(va2);

    assertFalsy(ext.isVertexArrayOES(va1));
    assertFalsy(ext.isVertexArrayOES(va2));

    assertNoGLError(gl);
  });

  it('test can use WEBGL_draw_buffers', () => {
    const {gl} = createContext();
    const ext = gl.getExtension('WEBGL_draw_arrays');

    // See comment in virtual-webgl2 why this can't be done easily.
    assertFalsy(ext);
    if (!ext) {
      return;
    }
    assertTruthy(gl.getSupportedExtensions().includes('WEBGL_draw_arrays'));

    const vs = `
    uniform float u_pointSize;
    void main() {
      gl_Position = vec4(0, 0, 0, 1);
      gl_PointSize = u_pointSize;
    }
    `;

    const colorFS = `
    #extension GL_EXT_draw_buffers : require
    precision mediump float;

    uniform vec4 u_colors[4];

    void main() {
      gl_FragData[0] = u_colors[0];
      gl_FragData[1] = u_colors[1];
      gl_FragData[2] = u_colors[2];
      gl_FragData[3] = u_colors[3];
    }
    `;

    const arrayFS = `
    precision mediump float;

    uniform sampler2D u_texture[4];

    void main() {
      vec4 color = vec4(0);
      float s = floor(mod(gl_FragCoord.x / 16., 4.));
      for(int i = 0; i < 4; ++i) {
        float t = float(i);
        vec4 c = texture2D(u_texture[i], vec2(0));
        color = mix(color, c, step(t - .5, s) * step(s, t + .5));
      }
      gl_FragColor = color;
    }
    `;

    const colorProgramInfo = twgl.createProgramInfo(gl, [vs, colorFS]);
    const arrayProgramInfo = twgl.createProgramInfo(gl, [vs, arrayFS]);

    const fb = gl.createFramebuffer()
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);

    const textures = [];
    for (let i = 0; i < 4; ++i) {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, tex, 0);
      textures.push(tex);
    }

    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      console.error("frame buffer not complete");
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);

    ext.drawBuffersWEBGL([
      gl.COLOR_ATTACHMENT0 + 0,
      gl.COLOR_ATTACHMENT0 + 1,
      gl.COLOR_ATTACHMENT0 + 2,
      gl.COLOR_ATTACHMENT0 + 3,
    ]);

    gl.viewport(0, 0, 1, 1);
    gl.useProgram(colorProgramInfo.program);
    twgl.setUniforms(colorProgramInfo, {
      u_pointSize: 64,
      u_colors: [
        1, 0, 0, 1,
        0, 1, 0, 1,
        0, 0, 1, 1,
        1, 1, 0, 1,
      ],
    });
    gl.drawArrays(gl.POINTS, 0, 1);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    ext.drawBuffersWEBGL([
      gl.BACK,
    ]);

    gl.viewport(0, 0, 64, 64);
    gl.useProgram(arrayProgramInfo.program);
    twgl.setUniforms(arrayProgramInfo, {
      u_pointSize: 64,
      u_texture: textures,
    });
    gl.drawArrays(gl.POINTS, 0, 1);

    assertRectIsColor(gl,  0, 0, 16, 64, [255, 0, 0, 255]);
    assertRectIsColor(gl, 16, 0, 16, 64, [0, 255, 0, 255]);
    assertRectIsColor(gl, 32, 0, 16, 64, [0, 0, 255, 0, 255]);
    assertRectIsColor(gl, 48, 0, 16, 64, [255, 255, 0, 255]);
  });

});