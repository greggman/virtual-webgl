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
    disableWebGL2: false,
    compositorCreator() {
    },
  };
  const canvasToVirtualContextMap = new Map();
  const extensionInfo = {
    WEBGL_draw_buffers: {
      wrapperFnMakerFn: makeWEBGL_draw_buffersWrapper,
      saveRestoreMakerFn: makeWEBGL_drawBuffersSaveRestoreHelper,
    },
    OES_vertex_array_object: {
      wrapperFnMakerFn: makeOES_vertex_array_objectWrapper,
    },
    ANGLE_instanced_arrays: {
      wrapperFnMakerFn: makeANGLE_instanced_arraysWrapper,
    },
  };
  const extensionSaveRestoreHelpersArray = [];
  const extensionSaveRestoreHelpers = {};

  let currentVirtualContext = null;
  let someContextsNeedRendering;

  const sharedWebGLContext = document.createElement('canvas').getContext('webgl');
  const sharedVAOExtension = sharedWebGLContext.getExtension("OES_vertex_array_object");
  const sharedInstanceExtension = sharedWebGLContext.getExtension("ANGLE_instanced_arrays");
  const numAttributes = sharedWebGLContext.getParameter(sharedWebGLContext.MAX_VERTEX_ATTRIBS);
  const numTextureUnits = sharedWebGLContext.getParameter(sharedWebGLContext.MAX_COMBINED_TEXTURE_IMAGE_UNITS);
  let numDrawBuffers;
  const baseState = makeDefaultState(300, 150);

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

  const premultplyAlphaTrueProgram = createProgram(sharedWebGLContext, [vs, fs]);
  const premultplyAlphaFalseProgram = createProgram(sharedWebGLContext, [vs, fs2]);

  if (sharedVAOExtension) {
    const vao = sharedVAOExtension.createVertexArrayOES();
    sharedVAOExtension.bindVertexArrayOES(vao);
    baseState.vertexArray = vao;
  }

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
      if (type === 'webgl' || type === 'experimental-webgl') {
        return createOrGetVirtualWebGLContext(this, type, contextAttributes);
      } else if (type === 'webgl2' && settings.disableWebGL2) {
        return null;
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

      gl.useProgram(contextAttributes.premultipliedAlpha ? premultplyAlphaTrueProgram : premultplyAlphaFalseProgram);

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

  class VirtualWebGLContext {
    constructor(canvas, contextAttributes = {}, compositor, disposeHelper) {
      const gl = sharedWebGLContext;
      this.canvas = canvas;
      // Should use Symbols or someting to hide these variables from the outside.

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
      // default blend, stencil, zbuffer, culling, viewport etc... state
      this._state = makeDefaultState(canvas.width, canvas.height);
      this._state.framebuffer = this._drawingbufferFramebuffer;

      if (sharedVAOExtension) {
        this._state.vertexArray = sharedVAOExtension.createVertexArrayOES();
        this._defaultVertexArray = this._state.vertexArray;
      }
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

  function makeDefaultState(width, height) {
    const gl = WebGLRenderingContext;
    const state ={
      arrayBuffer: null,
      renderbuffer: null,
      framebuffer: null,

      blend: false,
      cullFace: false,
      depthTest: false,
      dither: false,
      polygonOffsetFill: false,
      sampleAlphaToCoverage: false,
      sampleCoverage: false,
      scissorTest: false,
      stencilTest: false,

      activeTexture: gl.TEXTURE0,

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
      stencilPassDpethPass: gl.KEEP,
      stencilRef: 0,
      stencilValueMask: 0xFFFFFFFF,
      stencilWriteMask: 0xFFFFFFFF,

      textureUnits: [],
    };

    if (sharedVAOExtension) {
      state.vertexArray = null;
    } else {
      state.elementArrayBuffer = null;
      state.attributes = [];
      for (let i = 0; i < numAttributes; ++i) {
        const attrib = {
          buffer: null,
          enabled: false,
          size: 4,
          stride: 0,
          type: gl.FLOAT,
          normalized: false,
          value: [0, 0, 0, 1],
        };
        if (sharedInstanceExtension) {
          attrib.divisor = 0;
        }
        state.attributes.push(attrib);
      }
    }

    for (let i = 0; i < numTextureUnits; ++i) {
      state.textureUnits.push({
        texture2D: null,
        textureCubemap: null,
      });
    }

    return state;
  }

  // copy all WebGL constants and functions to the prototype of
  // VirtualWebGLContext
  for (let key in WebGLRenderingContext.prototype) {
    switch (key) {
      case 'canvas':
      case 'drawingBufferWidth':
      case 'drawingBufferHeight':
        break;
      default: {
        const value = WebGLRenderingContext.prototype[key];
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
            newValue = createDrawWrapper(value);
            break;
          default:
            if (typeof value === 'function') {
              newValue = createWrapper(value);
            }
            break;
         }
         VirtualWebGLContext.prototype[key] = newValue;
         break;
      }
    }
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

  function isFramebufferBindingNull(vctx) {
    return vctx._state.framebuffer === vctx._drawingbufferFramebuffer;
  }

  function makeOES_vertex_array_objectWrapper(ext, origFn, name) {
    switch (name) {
      case 'bindVertexArrayOES':
        return virutalbindVertexArrayOES;
    }

    return function(...args) {
      makeCurrentContext(this._context);
      resizeCanvasIfChanged(this._context);
      return origFn.call(ext, ...args);
    }
  }

  function virutalbindVertexArrayOES(vao) {
    makeCurrentContext(this._context);
    resizeCanvasIfChanged(this._context);
    if (!vao) {
      vao = this._context._defaultVertexArray;
    }
    sharedVAOExtension.bindVertexArrayOES(vao);
  }


  function makeANGLE_instanced_arraysWrapper(ext, origFn, name) {
    switch (name) {
      case 'drawArraysInstancedANGLE':
      case 'drawElementsInstancedANGLE':
        return createExtDrawWrapper(ext, origFn);
      break;
    }

    return function(...args) {
      makeCurrentContext(this._context);
      resizeCanvasIfChanged(this._context);
      return origFn.call(ext, ...args);
    }
  }

  function createExtDrawWrapper(ext, origFn) {
    return function(...args) {
      // a rendering function was called so we need to copy are drawingBuffer
      // to the canvas for this context after the current event.
      beforeDraw(this._context);
      const result = origFn.call(exts, ...args);
      afterDraw(this._context);
      return result;
    };
  }

  function makeWEBGL_draw_buffersWrapper(ext, origFn, name) {
    const gl = sharedWebGLContext;
    const backBuffer = [gl.COLOR_ATTACHMENT0];

    return function(drawingBuffers) {
      makeCurrentContext(this._context);
      resizeCanvasIfChanged(this._context);
      // if the virtual context is bound to canvas then fake it
      if (isFramebufferBindingNull(this._context)) {
        // this really isn't checking everything
        // for example if the user passed in array.length != 1
        // then we are supposed to generate an error
        if (drawingBuffers[0] === gl.BACK) {
          drawingBuffers = backBuffer;
        }
      }
      origFn.call(ext, drawingBuffers);
    }
  }

  function makeWEBGL_drawBuffersSaveRestoreHelper(ext) {
    const gl = sharedWebGLContext;
    const maxDrawBuffers = gl.getParameter(ext.MAX_DRAW_BUFFERS_WEBGL);
    const defaultBackDrawBuffers = [gl.BACK];
    const defaultFBDrawBuffers = [gl.COLOR_ATTACHMENT0];
    for (let i = 1; i < maxDrawBuffers; ++i) {
      defaultFBDrawBuffers.push(gl.NONE);
    }

    function initDrawBufferState(state) {
      state.drawBuffers = state.framebuffer ? defaultFBDrawBuffers.slice() : defaultBackDrawBuffers.slice();
    }

    function save(state) {
      if (!state.drawBuffers) {
        initDrawBufferState(state);
      }
      // remember state.framebuffer is only null for the offscreen canvas
      const drawBuffers = state.drawBuffers;
      for (let i = 0; i < drawBuffers.length; ++i) {
        drawBuffers[i] = gl.getParameter(ext.DRAW_BUFFER0_WEBGL + i);
      }
    }

    function restore(state) {
      if (!state.drawBuffers) {
        initDrawBufferState(state);
      }
      ext.drawBuffersWEBGL(state.drawBuffers);
    }

    return {
      save,
      restore,
    };
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
      case 0x8825: // DRAW_BUFFER0_WEBGL
        if (isFramebufferBindingNull(this)) {
          if (value === gl.COLOR_ATTACHMENT0) {
            return gl.BACK;
          }
        }
        break;
      case 0x85B5: // VERTEX_ARRAY_BINDING_OES
        if (value === this._defaultVertexArray) {
          return null;
        }
        break;
    }
    return value;
  }

  function virtualBindFramebuffer(bindpoint, framebuffer) {
    makeCurrentContext(this);
    resizeCanvasIfChanged(this);
    const gl = sharedWebGLContext;
    if (bindpoint === WebGLRenderingContext.FRAMEBUFFER) {
      if (framebuffer === null) {
        // bind our drawingBuffer
        framebuffer = this._drawingbufferFramebuffer;
      }
    }

    gl.bindFramebuffer(bindpoint, framebuffer);
    this._state.framebuffer = framebuffer;
  }

  function createWrapper(origFn) {
    // lots of optimization could happen here depending on specific functions
    return function(...args) {
      makeCurrentContext(this);
      resizeCanvasIfChanged(this);
      return origFn.call(sharedWebGLContext, ...args);
    };
  }

  function clearIfNeeded(vctx) {
    if (vctx._needClear) {
      vctx._needClear = false;
      const gl = sharedWebGLContext;
      gl.bindFramebuffer(gl.FRAMEBUFFER, vctx._drawingbufferFramebuffer);
      gl.disable(gl.SCISSOR_TEST);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
      enableDisable(gl, gl.SCISSOR_TEST, vctx._state.scissorTest);
      gl.bindFramebuffer(gl.FRAMEBUFFER, vctx._state.framebuffer);
    }
  }

  function beforeDraw(vctx) {
    makeCurrentContext(vctx);
    resizeCanvasIfChanged(vctx);
    clearIfNeeded(vctx);
  }

  function afterDraw(vctx) {
    if (isFramebufferBindingNull(vctx)) {
      vctx._needComposite = true;
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

  function makeCurrentContext(vctx) {
    if (currentVirtualContext === vctx) {
      return;
    }

    // save all current WebGL state on the previous current virtual context
    if (currentVirtualContext) {
      saveAllState(currentVirtualContext._state, currentVirtualContext);
    }

    // restore all state for the new context
    restoreAllState(vctx._state, vctx);

    // check if the current state is supposed to be rendering to the canvas.
    // if so bind vctx._drawingbuffer

    currentVirtualContext = vctx;
  }

  function resizeCanvasIfChanged(vctx) {
    const width = vctx.canvas.width;
    const height = vctx.canvas.height;

    if (width !== vctx._width || height !== vctx._height) {
      vctx._width = width;
      vctx._height = height;
      const gl = sharedWebGLContext;
      const oldTexture = gl.getParameter(gl.TEXTURE_BINDING_2D);
      const format = vctx._contextAttributes.alpha ? gl.RGBA : gl.RGB;
      gl.bindTexture(gl.TEXTURE_2D, vctx._drawingbufferTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, format, width, height, 0, format, gl.UNSIGNED_BYTE, null);
      gl.bindTexture(gl.TEXTURE_2D, oldTexture);

      if (vctx._depthRenderbuffer) {
        const oldRenderbuffer = gl.getParameter(gl.RENDERBUFFER_BINDING);
        const internalFormat = vctx._contextAttributes.stencil ? gl.DEPTH_STENCIL : gl.DEPTH_COMPONENT16;
        gl.bindRenderbuffer(gl.RENDERBUFFER, vctx._depthRenderbuffer);
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

  function saveAllState(state, vctx) {
    // save all WebGL state (current bindings, current texture units,
    // current attributes and/or vertex shade object, current program,
    // current blend, stencil, zbuffer, culling, viewport etc... state
    const gl = sharedWebGLContext;

    state.activeTexture = gl.getParameter(gl.ACTIVE_TEXTURE);

    // save texture units
    for (let i = 0; i < numTextureUnits; ++i) {
      gl.activeTexture(gl.TEXTURE0 + i);
      const unit = state.textureUnits[i];
      unit.texture2D = gl.getParameter(gl.TEXTURE_BINDING_2D);
      unit.textureCubemap = gl.getParameter(gl.TEXTURE_BINDING_CUBE_MAP);
    }

    // bindings
    state.arrayBuffer = gl.getParameter(gl.ARRAY_BUFFER_BINDING);
    state.renderbuffer = gl.getParameter(gl.RENDERBUFFER_BINDING);
    state.framebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING);

    // save attributes
    if (sharedVAOExtension) {
      state.vertexArray = gl.getParameter(sharedVAOExtension.VERTEX_ARRAY_BINDING_OES);
    } else {
      for (let i = 0; i < numAttributes; ++i) {
        const attrib = state.attributes[i];
        attrib.buffer     = gl.getVertexAttrib(i, gl.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING);
        attrib.enabled    = gl.getVertexAttrib(i, gl.VERTEX_ATTRIB_ARRAY_ENABLED);
        attrib.size       = gl.getVertexAttrib(i, gl.VERTEX_ATTRIB_ARRAY_SIZE);
        attrib.stride     = gl.getVertexAttrib(i, gl.VERTEX_ATTRIB_ARRAY_STRIDE);
        attrib.type       = gl.getVertexAttrib(i, gl.VERTEX_ATTRIB_ARRAY_TYPE);
        attrib.normalized = gl.getVertexAttrib(i, gl.VERTEX_ATTRIB_ARRAY_NORMALIZED);
        attrib.value      = gl.getVertexAttrib(i, gl.CURRENT_VERTEX_ATTRIB);
        attrib.offset     = gl.getVertexAttribOffset(i, gl.VERTEX_ATTRIB_ARRAY_POINTER);
        if (sharedInstanceExtension) {
          attrib.divisor = gl.getVertexAttrib(i, sharedInstanceExtension.VERTEX_ATTRIB_ARRAY_DIVISOR_ANGLE);
        }
      }
      state.elementArrayBuffer = gl.getParameter(gl.ELEMENT_ARRAY_BUFFER_BINDING);
    }

    state.blend = gl.getParameter(gl.BLEND);
    state.cullFace = gl.getParameter(gl.CULL_FACE);
    state.depthTest = gl.getParameter(gl.DEPTH_TEST);
    state.dither = gl.getParameter(gl.DITHER);
    state.polygonOffsetFill = gl.getParameter(gl.POLYGON_OFFSET_FILL);
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
    state.stencilPassDpethPass = gl.getParameter(gl.STENCIL_PASS_DEPTH_PASS);
    state.stencilRef = gl.getParameter(gl.STENCIL_REF);
    state.stencilValueMask = gl.getParameter(gl.STENCIL_VALUE_MASK);
    state.stencilWriteMask = gl.getParameter(gl.STENCIL_WRITEMASK);

    for (const fns of extensionSaveRestoreHelpersArray) {
      fns.save(state, vctx);
    }
  }

  function restoreAllState(state, vctx) {
    // restore all WebGL state (current bindings, current texture units,
    // current attributes and/or vertex shade object, current program,
    // current blend, stencil, zbuffer, culling, viewport etc... state
    // save all WebGL state (current bindings, current texture units,
    // current attributes and/or vertex shade object, current program,
    // current blend, stencil, zbuffer, culling, viewport etc... state
    const gl = sharedWebGLContext;

    // restore texture units
    for (let i = 0; i < numTextureUnits; ++i) {
      gl.activeTexture(gl.TEXTURE0 + i);
      const unit = state.textureUnits[i];
      gl.bindTexture(gl.TEXTURE_2D, unit.texture2D);
      gl.bindTexture(gl.TEXTURE_CUBE_MAP, unit.textureCubemap);
    }
    gl.activeTexture(state.activeTexture);

    // restore attributes
    if (sharedVAOExtension) {
      sharedVAOExtension.bindVertexArrayOES(state.vertexArray);
    } else {
      for (let i = 0; i < numAttributes; ++i) {
        const attrib = state.attributes[i];
        if (attrib.enabled) {
          gl.enableVertexAttribArray(i);
        } else {
          gl.disableVertexAttribArray(i);
        }
        gl.vertexAttrib4fv(i, attrib.value);
        gl.bindBuffer(gl.ARRAY_BUFFER, attrib.buffer);
        gl.vertexAttribPointer(i, attrib.size, attrib.type, attrib.normalized, attrib.stride, attrib.offset);
        if (sharedInstanceExtension) {
          sharedInstanceExtension.vertexAttribDivisorANGLE(i, attrib.divisor);
        }
      }
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, state.elementArrayBuffer);
    }

    // bindings'
    gl.bindBuffer(gl.ARRAY_BUFFER, state.arrayBuffer);
    gl.bindRenderbuffer(gl.RENDERBUFFER, state.renderbuffer);
    gl.bindFramebuffer(gl.FRAMEBUFFER, state.framebuffer);

    enableDisable(gl, gl.BLEND, state.blend);
    enableDisable(gl, gl.CULL_FACE, state.cullFace);
    enableDisable(gl, gl.DEPTH_TEST, state.depthTest);
    enableDisable(gl, gl.DITHER, state.dither);
    enableDisable(gl, gl.POLYGON_OFFSET_FILL, state.polygonOffsetFill);
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
      fns.restore(state, vctx);
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

    for (const vctx of canvasToVirtualContextMap.values()) {
      if (!vctx._needComposite) {
        continue;
      }

      vctx._needComposite = false;
      vctx.composite(sharedWebGLContext);
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

