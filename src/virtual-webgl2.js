/*
 * Copyright 2018, Gregg Tavares.
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are
 * met:
 *
 *  * Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 *
 *  * Redistributions in binary form must reproduce the above
 *    copyright notice, this list of conditions and the following disclaimer
 *    in the documentation and/or other materials provided with the
 *    distribution.
 *
 *  * Neither the name of Gregg Tavares. nor the names of his
 *    contributors may be used to endorse or promote products derived from
 *    this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
 * A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
 * OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
 * LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */
(function() {
  const settings = {
    disableWebGL1: false,
    compositorCreator() {
    },
  };
  const canvasToVirtualContextMap = new Map();
  const extensionInfo = {};
  const extensionSaveRestoreHelpersArray = [];
  const extensionSaveRestoreHelpers = {};

  let currentVirtualContext = null;
  let someContextsNeedRendering;

  const sharedWebGLContext = document.createElement('canvas').getContext('webgl2');
  const numTextureUnits = sharedWebGLContext.getParameter(sharedWebGLContext.MAX_COMBINED_TEXTURE_IMAGE_UNITS);
  const numUniformBufferBindings = sharedWebGLContext.getParameter(sharedWebGLContext.MAX_UNIFORM_BUFFER_BINDINGS);
  const baseState = makeDefaultState(sharedWebGLContext, 300, 150);

  const vs = `
  attribute vec4 position;
  varying vec2 v_texcoord;
  void main() {
    gl_Position = position;
    v_texcoord = position.xy * .5 + .5;
  }
  `;

  const fs = `
  precision mediump float;
  varying vec2 v_texcoord;
  uniform sampler2D u_tex;
  void main() {
    gl_FragColor = texture2D(u_tex, v_texcoord);
  }
  `;

  const fs2 = `
  precision mediump float;
  varying vec2 v_texcoord;
  uniform sampler2D u_tex;
  void main() {
    gl_FragColor = texture2D(u_tex, v_texcoord);
    gl_FragColor.rgb *= gl_FragColor.a;
  }
  `;

  const premultiplyAlphaTrueProgram = createProgram(sharedWebGLContext, [vs, fs]);
  const premultiplyAlphaFalseProgram = createProgram(sharedWebGLContext, [vs, fs2]);

  {
    const gl = sharedWebGLContext;
    const positionLoc = 0;  // hard coded in createProgram

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1,
       1, -1,
      -1,  1,
      -1,  1,
       1, -1,
       1,  1,
    ]), gl.STATIC_DRAW);

    gl.enableVertexAttribArray(positionLoc);
    gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);

  }

  saveAllState(baseState);

  HTMLCanvasElement.prototype.getContext = (function(origFn) {
    return function(type, contextAttributes) {
      if ((type === 'webgl' || type === 'experimental-webgl') && settings.disableWebGL1) {
        return null;
      } else if (type === 'webgl2') {
        return createOrGetVirtualWebGLContext(this, type, contextAttributes);
      }
      return origFn.call(this, type, contextAttributes);
    };

  }(HTMLCanvasElement.prototype.getContext));

  function valueOrDefault(value, defaultValue) {
    return value === undefined ? defaultValue : value;
  }

  function errorDisposedContext(fnName) {
    return function() {
      throw new Error(`tried to call ${fnName} on disposed context`);
    };
  }

  class DefaultCompositor {
    constructor(canvas) {
      this._ctx = canvas.getContext('2d');
    }
    composite(gl, texture, canvas, contextAttributes) {
      // note: not entirely sure what to do here. We need this canvas to be at least as large
      // as the canvas we're drawing to. Resizing a canvas is slow so I think just making
      // sure we never get smaller than the largest canvas. At the moment though I'm too lazy
      // to make it smaller.
      const ctx = this._ctx;
      const width = canvas.width;
      const height = canvas.height;
      const maxWidth = Math.max(gl.canvas.width, width);
      const maxHeight = Math.max(gl.canvas.height, height);
      if (gl.canvas.width !== maxWidth || gl.canvas.height !== maxHeight) {
        gl.canvas.width = maxWidth;
        gl.canvas.height = maxHeight;
      }

      gl.viewport(0, 0, width, height);

      gl.useProgram(contextAttributes.premultipliedAlpha ? premultiplyAlphaTrueProgram : premultiplyAlphaFalseProgram);

      // draw the drawingbuffer's texture to the offscreen canvas
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      // copy it to target canvas
      ctx.globalCompositeOperation = 'copy';
      ctx.drawImage(
        gl.canvas,
        0, maxHeight - height, width, height,   // src rect
        0, 0, width, height);  // dest rect
    }
    dispose() {
    }
  }

  // This exists so VirtualWebGLContext has a base class we can replace
  // because otherwise it's base is Object which we can't replace.
  class Base {};
  class VirtualWebGLContext extends Base {
    constructor(canvas, contextAttributes = {}, compositor, disposeHelper) {
      super();
      const gl = sharedWebGLContext;
      this._canvas = canvas;
      // Should use Symbols or something to hide these variables from the outside.

      this._compositor = compositor;
      this._disposeHelper = disposeHelper;
      this._extensions = {};
      // based on context attributes and canvas.width, canvas.height
      // create a texture and framebuffer
      this._drawingbufferTexture = gl.createTexture();
      this._drawingbufferFramebuffer = gl.createFramebuffer();
      this._contextAttributes = {
        alpha: valueOrDefault(contextAttributes.alpha, true),
        antialias: false,
        depth: valueOrDefault(contextAttributes.depth, true),
        failIfMajorPerformanceCaveat: false,
        premultipliedAlpha: valueOrDefault(contextAttributes.premultipliedAlpha, true),
        stencil: valueOrDefault(contextAttributes.stencil, false),
      };
      this._preserveDrawingbuffer = valueOrDefault(contextAttributes.preserveDrawingBuffer, false);

      const oldTexture = gl.getParameter(gl.TEXTURE_BINDING_2D);
      const oldFramebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING);

      gl.bindTexture(gl.TEXTURE_2D, this._drawingbufferTexture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      // this._drawingbufferTexture.id = canvas.id;
      // this._drawingbufferFramebuffer.id = canvas.id;

      gl.bindFramebuffer(gl.FRAMEBUFFER, this._drawingbufferFramebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this._drawingbufferTexture, 0);

      if (this._contextAttributes.depth) {
        const oldRenderbuffer = gl.getParameter(gl.RENDERBUFFER_BINDING);
        this._depthRenderbuffer = gl.createRenderbuffer();
        gl.bindRenderbuffer(gl.RENDERBUFFER, this._depthRenderbuffer);
        const attachmentPoint = this._contextAttributes.stencil  ? gl.DEPTH_STENCIL_ATTACHMENT : gl.DEPTH_ATTACHMENT;
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, attachmentPoint, gl.RENDERBUFFER, this._depthRenderbuffer);
        gl.bindRenderbuffer(gl.RENDERBUFFER, oldRenderbuffer);
      }

      gl.bindTexture(gl.TEXTURE_2D, oldTexture);
      gl.bindFramebuffer(gl.FRAMEBUFFER, oldFramebuffer);

      // remember all WebGL state (default bindings, default texture units,
      // default attributes and/or vertex shade object, default program,
      // default blend, stencil, zBuffer, culling, viewport etc... state
      this._state = makeDefaultState(gl, canvas.width, canvas.height);
      this._state.readFramebuffer = this._drawingbufferFramebuffer;
      this._state.drawFramebuffer = this._drawingbufferFramebuffer;

      this._state.vertexArray = gl.createVertexArray();
      this._defaultVertexArray = this._state.vertexArray;
    }
    dispose() {
      this._disposeHelper();
      const gl = sharedWebGLContext;
      gl.deleteFramebuffer(this._drawingbufferFramebuffer);
      gl.deleteTexture(this._drawingbufferTexture);
      if (this._depthRenderbuffer) {
        gl.deleteRenderbuffer(this._depthRenderbuffer);
      }
      if (this._compositor.dispose) {
        this._compositor.dispose();
      }
      for (const [key, value] of Object.entries(this)) {
        if (typeof value === 'function') {
          this[key] = errorDisposedContext(key);
        }
      }
      for (const [key, value] of Object.entries(VirtualWebGLContext.prototype)) {
        if (typeof value === 'function') {
          this[key] = errorDisposedContext(key);
        }
      }
    }
    get canvas() {
      return this._canvas;
    }
    get drawingBufferWidth() {
      return this.canvas.width;
    }
    get drawingBufferHeight() {
      return this.canvas.height;
    }
    composite(gl) {
      this._compositor.composite(gl, this._drawingbufferTexture, this.canvas, this._contextAttributes);
      if (!this._preserveDrawingbuffer) {
        this._needClear = true;
      }
    }
  }

  // Replace the prototype with WebGL2RenderingContext so that someCtx instanceof WebGL2RenderingContext works
  Object.setPrototypeOf(Object.getPrototypeOf(VirtualWebGLContext.prototype), WebGL2RenderingContext.prototype);


  function makeDefaultState(gl, width, height) {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);

    const state ={
      arrayBuffer: null,
      renderbuffer: null,
      drawFramebuffer: null,
      readFramebuffer: null,
      copyReadBuffer: null,
      copyWriteBuffer: null,
      pixelPackBuffer: null,
      pixelUnpackBuffer: null,
      transformFeedbackBuffer: null,
      uniformBuffer: null,
 
      readBuffer: null,

      blend: false,
      cullFace: false,
      depthTest: false,
      dither: false,
      polygonOffsetFill: false,
      rasterDiscard: false,
      sampleAlphaToCoverage: false,
      sampleCoverage: false,
      scissorTest: false,
      stencilTest: false,

      vertexArray: vao,
      activeTexture: gl.TEXTURE0,
      transformFeedback: null,

      packAlignment: 4,
      unpackAlignment: 4,
      unpackColorspaceConversion: gl.BROWSER_DEFAULT_WEBGL,
      unpackFlipY: 0,
      unpackPremultiplyAlpha: 0,

      currentProgram: null,
      viewport: [0, 0, width, height],
      scissor: [0, 0, 0, 0],
      blendSrcRgb: gl.ONE,
      blendDstRgb: gl.ZERO,
      blendSrcAlpha: gl.ONE,
      blendDstAlpha: gl.ZERO,
      blendEquationRgb: gl.FUNC_ADD,
      blendEquationAlpha: gl.FUNC_ADD,
      blendColor: [0, 0, 0, 0],
      colorClearValue: [0, 0, 0, 0],
      colorMask: [true, true, true, true],
      cullFaceMode: gl.BACK,
      depthClearValue: 1,
      depthFunc: gl.LESS,
      depthRange: [0, 1],
      depthMask: true,
      frontFace: gl.CCW,
      generateMipmapHint: gl.DONT_CARE,
      lineWidth: 1,
      polygonOffsetFactor: 0,
      polygonOffsetUnits: 0,
      sampleCoverageValue: 1,
      sampleCoverageUnits: false,
      stencilBackFail: gl.KEEP,
      stencilBackFunc: gl.ALWAYS,
      stencilBackPassDepthFail: gl.KEEP,
      stencilBackPassDepthPass: gl.KEEP,
      stencilBackRef: 0,
      stencilBackValueMask: 0xFFFFFFFF,
      stencilBackWriteMask: 0xFFFFFFFF,
      stencilClearValue: 0,
      stencilFail: gl.KEEP,
      stencilFunc: gl.ALWAYS,
      stencilPassDepthFail: gl.KEEP,
      stencilPassDepthPass: gl.KEEP,
      stencilRef: 0,
      stencilValueMask: 0xFFFFFFFF,
      stencilWriteMask: 0xFFFFFFFF,

      textureUnits: new Array(numTextureUnits).fill(0).map(_ => {
        return {
          texture2D: null,
          textureCubemap: null,
          texture2DArray: null,
          texture3D: null,
        };
      }),
      samplerUnits: new Array(numTextureUnits).fill(null),
      uniformBufferBindings: new Array(numUniformBufferBindings).fill(0).map(_ => {
        return {
          buffer: null,
          size: 0,
          start: 0,
        };
      }),
    };

    return state;
  }

  function createGetExtensionWrapper(origFn) {
    return function(name) {
      // just like the real context each extension needs a virtual class because each use
      // of the extension might be modified (as in people adding properties to it)
      const existingExt = this._extensions[name];
      if (existingExt) {
        return existingExt;
      }

      const ext = origFn.call(sharedWebGLContext, name);
      const wrapperInfo = extensionInfo[name] || {};
      const wrapperFnMakerFn = wrapperInfo.wrapperFnMakerFn || (() => { console.log("trying to get extension:", name); });
      const saveRestoreHelper = extensionSaveRestoreHelpers[name];
      if (!saveRestoreHelper) {
        const saveRestoreMakerFn = wrapperInfo.saveRestoreMakerFn;
        if (saveRestoreMakerFn) {
          const saveRestore = saveRestoreMakerFn(ext);
          extensionSaveRestoreHelpers[name] = saveRestore;
          extensionSaveRestoreHelpersArray.push(saveRestore);
        }
      }

      const wrapper = {
        _context: this,
      };
      for (let key in ext) {
        let value = ext[key];
        if (typeof value === 'function') {
          value = wrapperFnMakerFn(ext, value, name);
        }
        wrapper[key] = value;
      }

      return wrapper;
    };
  }

  function isFramebufferBindingNull(vCtx) {
    return vCtx._state.drawFramebuffer === vCtx._drawingbufferFramebuffer;
  }

  function virtualGetContextAttributes() {
    return this._contextAttributes;
  }

  function virtualReadPixels(...args) {
    makeCurrentContext(this);
    resizeCanvasIfChanged(this);
    clearIfNeeded(this);
    const gl = sharedWebGLContext;
    return gl.readPixels(...args);
  }

  function virtualGetParameter(pname) {
    makeCurrentContext(this);
    resizeCanvasIfChanged(this);
    const gl = sharedWebGLContext;
    const value = gl.getParameter(pname);
    switch (pname) {
      case gl.FRAMEBUFFER_BINDING:
        if (value === this._drawingbufferFramebuffer) {
          return null;
        }
        break;
      case gl.DRAW_BUFFER0:
        if (isFramebufferBindingNull(this)) {
          if (value === gl.COLOR_ATTACHMENT0) {
            return gl.BACK;
          }
        }
        break;
      case gl.VERTEX_ARRAY_BINDING:
        if (value === this._defaultVertexArray) {
          return null;
        }
        break;
    }
    return value;
  }

  function virtualBindFramebuffer(bindPoint, framebuffer) {
    makeCurrentContext(this);
    resizeCanvasIfChanged(this);
    const gl = sharedWebGLContext;
    if (framebuffer === null) {
      // bind our drawingBuffer
      framebuffer = this._drawingbufferFramebuffer;
    }
    gl.bindFramebuffer(bindPoint, framebuffer);
    switch (bindPoint) {
      case gl.FRAMEBUFFER:
        this._state.readFramebuffer = framebuffer;
        this._state.drawFramebuffer = framebuffer;
        break;
      case gl.DRAW_FRAMEBUFFER:
        this._state.drawFramebuffer = framebuffer;
        break;
      case gl.READ_FRAMEBUFFER:
        this._state.readFramebuffer = framebuffer;
        break;
    }
  }

  const virtualDrawBuffers = (function() {
    const gl = sharedWebGLContext;
    const backBuffer = [gl.COLOR_ATTACHMENT0];

    return function(drawingBuffers) {
      makeCurrentContext(this);
      resizeCanvasIfChanged(this);
      // if the virtual context is bound to canvas then fake it
      if (isFramebufferBindingNull(this)) {
        // this really isn't checking everything
        // for example if the user passed in array.length != 1
        // then we are supposed to generate an error
        if (drawingBuffers[0] === gl.BACK) {
          drawingBuffers = backBuffer;
        }
      }

      gl.drawBuffers(drawingBuffers);
      if (gl.getError()) {
        debugger;
      }
    };
  }());

  function createWrapper(origFn, name) {
    // lots of optimization could happen here depending on specific functions
    return function(...args) {
      makeCurrentContext(this);
      resizeCanvasIfChanged(this);
      return origFn.call(sharedWebGLContext, ...args);
    };
  }

  function clearIfNeeded(vCtx) {
    if (vCtx._needClear) {
      vCtx._needClear = false;
      const gl = sharedWebGLContext;
      gl.bindFramebuffer(gl.FRAMEBUFFER, vCtx._drawingbufferFramebuffer);
      gl.disable(gl.SCISSOR_TEST);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
      enableDisable(gl, gl.SCISSOR_TEST, vCtx._state.scissorTest);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, vCtx._state.drawFramebuffer);
    }
  }

  function beforeDraw(vCtx) {
    makeCurrentContext(vCtx);
    resizeCanvasIfChanged(vCtx);
    clearIfNeeded(vCtx);
  }

  function afterDraw(vCtx) {
    if (isFramebufferBindingNull(vCtx)) {
      vCtx._needComposite = true;
      if (!someContextsNeedRendering) {
        someContextsNeedRendering = true;
        setTimeout(renderAllDirtyVirtualCanvases, 0);
      }
    }
  }

  function createDrawWrapper(origFn) {
    return function(...args) {
      // a rendering function was called so we need to copy are drawingBuffer
      // to the canvas for this context after the current event.
      beforeDraw(this);
      const result = origFn.call(sharedWebGLContext, ...args);
      afterDraw(this);
      return result;
    };
  }

  // copy all WebGL constants and functions to the prototype of
  // VirtualWebGLContext
  for (let key in WebGL2RenderingContext.prototype) {
    switch (key) {
      case 'canvas':
      case 'drawingBufferWidth':
      case 'drawingBufferHeight':
        break;
      default: {
        const value = WebGL2RenderingContext.prototype[key];
        let newValue = value;
        switch (key) {
          case 'getContextAttributes':
            newValue = virtualGetContextAttributes;
            break;
          case 'getExtension':
            newValue = createGetExtensionWrapper(value);
            break;
          case 'bindFramebuffer':
            newValue = virtualBindFramebuffer;
            break;
          case 'getParameter':
            newValue = virtualGetParameter;
            break;
          case 'readPixels':
            newValue = virtualReadPixels;
            break;
          case 'clear':
          case 'drawArrays':
          case 'drawElements':
          case 'drawArraysInstanced':
          case 'drawElementsInstanced':
          case 'drawRangeElements':
            newValue = createDrawWrapper(value);
            break;
          case 'drawBuffers':
            newValue = virtualDrawBuffers;
            break;
          default:
            if (typeof value === 'function') {
              newValue = createWrapper(value, key);
            }
            break;
         }
         VirtualWebGLContext.prototype[key] = newValue;
         break;
      }
    }
  }

  function makeCurrentContext(vCtx) {
    if (currentVirtualContext === vCtx) {
      return;
    }

    // save all current WebGL state on the previous current virtual context
    if (currentVirtualContext) {
      saveAllState(currentVirtualContext._state, currentVirtualContext);
    }

    // restore all state for the new context
    restoreAllState(vCtx._state, vCtx);

    // check if the current state is supposed to be rendering to the canvas.
    // if so bind vCtx._drawingbuffer

    currentVirtualContext = vCtx;
  }

  function resizeCanvasIfChanged(vCtx) {
    const width = vCtx.canvas.width;
    const height = vCtx.canvas.height;

    if (width !== vCtx._width || height !== vCtx._height) {
      vCtx._width = width;
      vCtx._height = height;
      const gl = sharedWebGLContext;
      const oldTexture = gl.getParameter(gl.TEXTURE_BINDING_2D);
      const format = vCtx._contextAttributes.alpha ? gl.RGBA : gl.RGB;
      gl.bindTexture(gl.TEXTURE_2D, vCtx._drawingbufferTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, format, width, height, 0, format, gl.UNSIGNED_BYTE, null);
      gl.bindTexture(gl.TEXTURE_2D, oldTexture);

      if (vCtx._depthRenderbuffer) {
        const oldRenderbuffer = gl.getParameter(gl.RENDERBUFFER_BINDING);
        const internalFormat = vCtx._contextAttributes.stencil ? gl.DEPTH_STENCIL : gl.DEPTH_COMPONENT16;
        gl.bindRenderbuffer(gl.RENDERBUFFER, vCtx._depthRenderbuffer);
        gl.renderbufferStorage(gl.RENDERBUFFER, internalFormat, width, height);
        gl.bindRenderbuffer(gl.RENDERBUFFER, oldRenderbuffer);
      }
    }
  }

  function createOrGetVirtualWebGLContext(canvas, type, contextAttributes) {
    // check if this canvas already has a context
    const existingVirtualCtx = canvasToVirtualContextMap.get(canvas);
    if (existingVirtualCtx) {
      return existingVirtualCtx;
    }

    const compositor = settings.compositorCreator(canvas, type, contextAttributes) || new DefaultCompositor(canvas, type, contextAttributes);
    const newVirtualCtx = new VirtualWebGLContext(canvas, contextAttributes, compositor, () => {
      canvasToVirtualContextMap.delete(canvas);
    });
    canvasToVirtualContextMap.set(canvas, newVirtualCtx);

    return newVirtualCtx;
  }

  function createProgram(gl, shaderSources) {
    const program = gl.createProgram();
    [gl.VERTEX_SHADER, gl.FRAGMENT_SHADER].forEach((type, ndx) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, shaderSources[ndx]);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error(gl.getShaderInfoLog(shader)); // eslint-disable-line
      }
      gl.attachShader(program, shader);
    });
    gl.bindAttribLocation(program, 0, 'position');
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error(gl.getProgramInfoLog(program)); // eslint-disable-line
    }

    return program;
  }

  function saveAllState(state, vCtx) {
    // save all WebGL state (current bindings, current texture units,
    // current attributes and/or vertex shade object, current program,
    // current blend, stencil, zBuffer, culling, viewport etc... state
    const gl = sharedWebGLContext;

    state.activeTexture = gl.getParameter(gl.ACTIVE_TEXTURE);

    // save texture units
    for (let i = 0; i < numTextureUnits; ++i) {
      gl.activeTexture(gl.TEXTURE0 + i);
      const unit = state.textureUnits[i];
      unit.texture2D = gl.getParameter(gl.TEXTURE_BINDING_2D);
      unit.textureCubemap = gl.getParameter(gl.TEXTURE_BINDING_CUBE_MAP);
      unit.texture2DArray = gl.getParameter(gl.TEXTURE_BINDING_2D_ARRAY);
      unit.texture3D = gl.getParameter(gl.TEXTURE_BINDING_3D);
      gl.bindSampler(i, state.samplerUnits[i]);
    }

    // bindings
    state.arrayBuffer = gl.getParameter(gl.ARRAY_BUFFER_BINDING);
    state.renderbuffer = gl.getParameter(gl.RENDERBUFFER_BINDING);
    state.copyReadBuffer = gl.getParameter(gl.COPY_READ_BUFFER_BINDING);
    state.copyWriteBuffer = gl.getParameter(gl.COPY_WRITE_BUFFER_BINDING);
    state.pixelPackBuffer = gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING);
    state.pixelUnpackBuffer = gl.getParameter(gl.PIXEL_UNPACK_BUFFER_BINDING);
    state.transformFeedbackBuffer = gl.getParameter(gl.TRANSFORM_FEEDBACK_BUFFER_BINDING);
    state.uniformBuffer = gl.getParameter(gl.UNIFORM_BUFFER_BINDING);
    state.drawFramebuffer = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING);
    state.readFramebuffer = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);

    // uniform buffer bindings
    for (let i = 0; i < numUniformBufferBindings; ++i) {
      const ub = state.uniformBufferBindings[i];
      ub.buffer = gl.getIndexedParameter(gl.UNIFORM_BUFFER_BINDING, i);
      ub.size = gl.getIndexedParameter(gl.UNIFORM_BUFFER_SIZE, i);
      ub.start = gl.getIndexedParameter(gl.UNIFORM_BUFFER_START, i);
    }

    state.readBuffer = gl.getParameter(gl.READ_BUFFER);
 
    // save attributes
    state.vertexArray = gl.getParameter(gl.VERTEX_ARRAY_BINDING);
    state.transformFeedback = gl.getParameter(gl.TRANSFORM_FEEDBACK_BINDING);

    state.blend = gl.getParameter(gl.BLEND);
    state.cullFace = gl.getParameter(gl.CULL_FACE);
    state.depthTest = gl.getParameter(gl.DEPTH_TEST);
    state.dither = gl.getParameter(gl.DITHER);
    state.polygonOffsetFill = gl.getParameter(gl.POLYGON_OFFSET_FILL);
    state.rasterDiscard = gl.getParameter(gl.RASTERIZER_DISCARD);
    state.sampleAlphaToCoverage = gl.getParameter(gl.SAMPLE_ALPHA_TO_COVERAGE);
    state.sampleCoverage = gl.getParameter(gl.SAMPLE_COVERAGE);
    state.scissorTest = gl.getParameter(gl.SCISSOR_TEST);
    state.stencilTest = gl.getParameter(gl.STENCIL_TEST);

    state.packAlignment = gl.getParameter(gl.PACK_ALIGNMENT);
    state.unpackAlignment = gl.getParameter(gl.UNPACK_ALIGNMENT);
    state.unpackColorspaceConversion = gl.getParameter(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL);
    state.unpackFlipY = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL);
    state.unpackPremultiplyAlpha = gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL);

    state.currentProgram = gl.getParameter(gl.CURRENT_PROGRAM);
    state.viewport = gl.getParameter(gl.VIEWPORT);
    state.scissor = gl.getParameter(gl.SCISSOR_BOX);
    state.blendSrcRgb = gl.getParameter(gl.BLEND_SRC_RGB);
    state.blendDstRgb = gl.getParameter(gl.BLEND_DST_RGB);
    state.blendSrcAlpha = gl.getParameter(gl.BLEND_SRC_ALPHA);
    state.blendDstAlpha = gl.getParameter(gl.BLEND_DST_ALPHA);
    state.blendEquationRgb = gl.getParameter(gl.BLEND_EQUATION_RGB);
    state.blendEquationAlpha = gl.getParameter(gl.BLEND_EQUATION_ALPHA);
    state.blendColor = gl.getParameter(gl.BLEND_COLOR);
    state.colorClearValue = gl.getParameter(gl.COLOR_CLEAR_VALUE);
    state.colorMask = gl.getParameter(gl.COLOR_WRITEMASK);
    state.cullFaceMode = gl.getParameter(gl.CULL_FACE_MODE);
    state.depthClearValue = gl.getParameter(gl.DEPTH_CLEAR_VALUE);
    state.depthFunc = gl.getParameter(gl.DEPTH_FUNC);
    state.depthRange = gl.getParameter(gl.DEPTH_RANGE);
    state.depthMask = gl.getParameter(gl.DEPTH_WRITEMASK);
    state.frontFace = gl.getParameter(gl.FRONT_FACE);
    state.generateMipmapHint = gl.getParameter(gl.GENERATE_MIPMAP_HINT);
    state.lineWidth = gl.getParameter(gl.LINE_WIDTH);
    state.polygonOffsetFactor = gl.getParameter(gl.POLYGON_OFFSET_FACTOR);
    state.polygonOffsetUnits = gl.getParameter(gl.POLYGON_OFFSET_UNITS);
    state.sampleCoverageValue = gl.getParameter(gl.SAMPLE_COVERAGE_VALUE);
    state.sampleCoverageUnits = gl.getParameter(gl.SAMPLE_COVERAGE_INVERT);
    state.stencilBackFail = gl.getParameter(gl.STENCIL_BACK_FAIL);
    state.stencilBackFunc = gl.getParameter(gl.STENCIL_BACK_FUNC);
    state.stencilBackPassDepthFail = gl.getParameter(gl.STENCIL_BACK_PASS_DEPTH_FAIL);
    state.stencilBackPassDepthPass = gl.getParameter(gl.STENCIL_BACK_PASS_DEPTH_PASS);
    state.stencilBackRef = gl.getParameter(gl.STENCIL_BACK_REF);
    state.stencilBackValueMask = gl.getParameter(gl.STENCIL_BACK_VALUE_MASK);
    state.stencilBackWriteMask = gl.getParameter(gl.STENCIL_BACK_WRITEMASK);
    state.stencilClearValue = gl.getParameter(gl.STENCIL_CLEAR_VALUE);
    state.stencilFail = gl.getParameter(gl.STENCIL_FAIL);
    state.stencilFunc = gl.getParameter(gl.STENCIL_FUNC);
    state.stencilPassDepthFail = gl.getParameter(gl.STENCIL_PASS_DEPTH_FAIL);
    state.stencilPassDepthPass = gl.getParameter(gl.STENCIL_PASS_DEPTH_PASS);
    state.stencilRef = gl.getParameter(gl.STENCIL_REF);
    state.stencilValueMask = gl.getParameter(gl.STENCIL_VALUE_MASK);
    state.stencilWriteMask = gl.getParameter(gl.STENCIL_WRITEMASK);

    for (const fns of extensionSaveRestoreHelpersArray) {
      fns.save(state, vCtx);
    }
  }

  function restoreAllState(state, vCtx) {
    // restore all WebGL state (current bindings, current texture units,
    // current attributes and/or vertex shade object, current program,
    // current blend, stencil, zBuffer, culling, viewport etc... state
    // save all WebGL state (current bindings, current texture units,
    // current attributes and/or vertex shade object, current program,
    // current blend, stencil, zBuffer, culling, viewport etc... state
    const gl = sharedWebGLContext;

    // restore texture units
    for (let i = 0; i < numTextureUnits; ++i) {
      gl.activeTexture(gl.TEXTURE0 + i);
      const unit = state.textureUnits[i];
      gl.bindTexture(gl.TEXTURE_2D, unit.texture2D);
      gl.bindTexture(gl.TEXTURE_CUBE_MAP, unit.textureCubemap);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, unit.texture2DArray);
      gl.bindTexture(gl.TEXTURE_3D, unit.texture3D);
    }
    gl.activeTexture(state.activeTexture);

    // restore attributes
    gl.bindVertexArray(state.vertexArray);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, state.transformFeedback);

    // bindings'
    gl.bindBuffer(gl.ARRAY_BUFFER, state.arrayBuffer);
    gl.bindBuffer(gl.COPY_READ_BUFFER, state.copyReadBuffer);
    gl.bindBuffer(gl.COPY_WRITE_BUFFER, state.copyWriteBuffer);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, state.pixelPackBuffer);
    gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, state.pixelUnpackBuffer);
    gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, state.transformFeedbackBuffer);
    gl.bindBuffer(gl.UNIFORM_BUFFER, state.uniformBuffer);
    gl.bindRenderbuffer(gl.RENDERBUFFER, state.renderbuffer);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, state.readFramebuffer);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, state.drawFramebuffer);

    // uniform buffer bindings
    for (let i = 0; i < numUniformBufferBindings; ++i) {
      const ub = state.uniformBufferBindings[i];
      if (ub.size || ub.start) {
        gl.bindBufferRange(gl.UNIFORM_BUFFER, i, ub.buffer, ub.start, ub.size);
      } else {
        gl.bindBufferBase(gl.UNIFORM_BUFFER, i, ub.buffer);
      }
    }

    gl.readBuffer(state.readBuffer);

    enableDisable(gl, gl.BLEND, state.blend);
    enableDisable(gl, gl.CULL_FACE, state.cullFace);
    enableDisable(gl, gl.DEPTH_TEST, state.depthTest);
    enableDisable(gl, gl.DITHER, state.dither);
    enableDisable(gl, gl.POLYGON_OFFSET_FILL, state.polygonOffsetFill);
    enableDisable(gl, gl.RASTERIZER_DISCARD, state.rasterDiscard);
    enableDisable(gl, gl.SAMPLE_ALPHA_TO_COVERAGE, state.sampleAlphaToCoverage);
    enableDisable(gl, gl.SAMPLE_COVERAGE, state.sampleCoverage);
    enableDisable(gl, gl.SCISSOR_TEST, state.scissorTest);
    enableDisable(gl, gl.STENCIL_TEST, state.stencilTest);


    gl.pixelStorei(gl.PACK_ALIGNMENT, state.packAlignment);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, state.unpackAlignment);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, state.unpackColorspaceConversion);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, state.unpackFlipY);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, state.unpackPremultiplyAlpha);

    gl.useProgram(state.currentProgram);

    gl.viewport(...state.viewport);
    gl.scissor(...state.scissor);
    gl.blendFuncSeparate(state.blendSrcRgb, state.blendDstRgb, state.blendSrcAlpha, state.blendDstAlpha);
    gl.blendEquationSeparate(state.blendEquationRgb, state.blendEquationAlpha);
    gl.blendColor(...state.blendColor);
    gl.clearColor(...state.colorClearValue);
    gl.colorMask(...state.colorMask);
    gl.cullFace(state.cullFaceMode);
    gl.clearDepth(state.depthClearValue);
    gl.depthFunc(state.depthFunc);
    gl.depthRange(...state.depthRange);
    gl.depthMask(state.depthMask);
    gl.frontFace(state.frontFace);
    gl.hint(gl.GENERATE_MIPMAP_HINT, state.generateMipmapHint);
    gl.lineWidth(state.lineWidth);
    gl.polygonOffset(state.polygonOffsetFactor, state.polygonOffsetUnits);
    gl.sampleCoverage(state.sampleCoverageValue, state.sampleCoverageUnits);
    gl.stencilFuncSeparate(gl.BACK, state.stencilBackFunc, state.stencilBackRef, state.stencilBackValueMask);
    gl.stencilFuncSeparate(gl.FRONT, state.stencilFunc, state.stencilRef, state.stencilValueMask);
    gl.stencilOpSeparate(gl.BACK, state.stencilBackFail, state.stencilBackPassDepthFail, state.stencilBackPassDepthPass);
    gl.stencilOpSeparate(gl.FRONT, state.stencilFail, state.stencilPassDepthFail, state.stencilPassDepthPass);
    gl.stencilMaskSeparate(gl.BACK, state.stencilBackWriteMask);
    gl.stencilMaskSeparate(gl.FRONT, state.stencilWriteMask);
    gl.clearStencil(state.stencilClearValue);

    for (const fns of extensionSaveRestoreHelpersArray) {
      fns.restore(state, vCtx);
    }
  }

  function enableDisable(gl, feature, enable) {
    if (enable) {
      gl.enable(feature);
    } else {
      gl.disable(feature);
    }
  }

  function renderAllDirtyVirtualCanvases() {
    if (!someContextsNeedRendering) {
      return;
    }
    someContextsNeedRendering = false;

    // save all current WebGL state on the previous current virtual context
    if (currentVirtualContext) {
      saveAllState(currentVirtualContext._state, currentVirtualContext);
      currentVirtualContext = null;
    }

    // set the state back to the one for drawing the canvas
    restoreAllState(baseState);

    for (const vCtx of canvasToVirtualContextMap.values()) {
      if (!vCtx._needComposite) {
        continue;
      }

      vCtx._needComposite = false;
      vCtx.composite(sharedWebGLContext);
    }
  }

  window.requestAnimationFrame = (function(origFn) {
    return function(callback) {
      return origFn.call(window, (time) => {
        const result = callback(time);
        renderAllDirtyVirtualCanvases();
        return result;
      });
    };

  }(window.requestAnimationFrame))

  function setup(options) {
    Object.assign(settings, options);
  }

  window.virtualWebGL = {
    setup,
  };

}());

