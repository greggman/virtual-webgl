# Virtual WebGL

Virtualizes a single WebGL context into multiple contexts

[A demo of some WebGL apps running with only 1 shared WebGL context](https://greggman.github.io/virtual-webgl/example/example.html)
and using `alpha: false`, `premultipliedAlpha: false`, `preserveDrawingBuffer: true`
and some other things. [A similar demo for WebGL2](https://greggman.github.io/virtual-webgl/example/example2.html).
And, [one for a mix of WebGL1 and WebGL2](https://greggman.github.io/virtual-webgl/example/example1and2.html).

[A demo of creating and disposing of webgl contexts](https://greggman.github.io/virtual-webgl/example/dispose.html).
WebGL implementations often delete the oldest context when too many are created. Using virtual-webgl you can
solve this issue. Note you are still responsible for freeing all WebGL resources used by the context. All buffers,
textures, renderbuffers, framebuffers, shaders, and programs. On top of that when you're done with the context
call `context.dispose()` which gives virtual-webgl a chance to free its internal stuff as well.

[A demo of post processing a Unity app from outside Unity](https://greggman.github.io/virtual-webgl/unity-example/index.html).
Compare to [the original without post processing](https://greggman.github.io/virtual-webgl/unity-example/index-original.html).

[A demo displaying mapbox-gl results on a cube](https://greggman.github.io/virtual-webgl/mapbox-gl/index.html).

## What?

Browsers usually limit WebGL to 8 to 16 contexts max. This is one idea to overcome that limit.

If you're in control of your code then there are arguably better solutions
[like this for raw webgl](http://twgljs.org/examples/itemlist.html)
and [this for three.js](https://threejs.org/examples/webgl_multiple_elements.html)
(both if which I wrote BTW &#x1F61B;)

I mostly wrote this for a fun short technical challenge. I have no plans to actually use it
or maintain it. If you find a problem feel free to file an issue but I can't promise I
can spend anytime addressing it. Pull requests are more welcome or just fork it.

## Some things you could do with this other than just get more contexts:

### Share resources across contexts.

Since underneath there is really only one context from the POV of the app
you can do things like

    const gl1 = document.createElement("canvas").getContext("webgl");
    const gl2 = document.createElement("canvas").getContext("webgl");

    const tex1 = gl1.createTexture();

    gl2.bindTexture(gl1.TEXTURE_2D, tex1);  // this would normally fail

With normal WebGL contexts you can't use resources from one context in another
context but with virtual contexts you can.

This is actually probably the best use-case. You can write 2 different libraries
independently of each other using WebGL and have them share resources and they
won't have to worry about stepping on each other's WebGL state. An example might
be, you have a video conferencing library and you want to add an effects library.

### Use the output of one WebGL app inside another

For example use a [mapbox-gl-js](https://www.mapbox.com/mapbox-gl-js/api/) map
inside a three.js app.

I suppose you can already do this by just copying the canvas of the first
app into the second but that copy is probably slow where as just rendering
to a texture is fast.

See the [mapbox-gl demo](https://greggman.github.io/virtual-webgl/mapbox-gl/index.html).
It creates it's own compositor.

## How to use?

Include it on your page before other scripts

```
<script src="virtual-webgl.js"></script>
```

or for WebGL2 use

```
<script src="virtual-webgl2.js"></script>
```

### Using CDN

WebGL2 is also hosted on a CDN:

```
<script src="https://cdn.jsdelivr.net/npm/virtual-webgl"></script>
```

To use a specific version, add `@1.0.6` to the URL.


## Writing your own compositor

The compositor is the part of virtual-webgl that's responsible for updating the
individual canvas. The default compositor draws the framebuffer representing the
drawingbuffer of that canvas, into an offscreen canvas and then calls canvas
2D's drawImage to get the WebGL results into the canvas. You can change this to
do something else by providing your own compositor.

A full solution would probably require some other method but ... If you look in
[unity-example/index2.html](https://greggman.github.io/virtual-webgl/unity-example/index2.html)
you'll see code that creates a custom compositor that draws a different result
than the default compositor.

The idea for the `createCompositor` function is that you probably need different
compositors for each canvas on the page so it's up to you how to do that. For
example you could check the `canvas` passed in and its ID or some `data`
attribute and do create different compositors for different canvases. If you
return nothing/undefined the default compositor will be created for that canvas.

As another example, if you wanted to draw a MapGL texture inside THREE.js then
you'd probably make the one compositor do nothing except record the texture
needed to use inside three.js. For three's canvas you'd use the default compositor.
[see this](https://greggman.github.io/virtual-webgl/mapbox-gl/index.html). I was not
sure how to use an external WebGL texture in THREE.js so the example uses twgl.

Note: If a compositor has a `dispose` method it will be called if `context.dispose` is called
to give your custom compositor a chance to clean up.

## Limits and Issues

* In WebGL2 you must end queries and transformFeedback before exiting the
  current event. The good things is, AFAIK, pretty much all WebGL2 apps that use
  queries and/or transformFeedback already do this so it should't be a problem.
  But, not finishing those before exiting the event is not technically against
  the spec.

* WebGL1 is emulated on WebGL2 in virtual-webgl2.js

  When using virtual-webgl2.js WebGL2 functions are not available on virtual
  WebGL1 contexts but WebGL2 constants can be passed to WebGL1 contexts.

  In other words:
  
  ```js
  webgl1Ctx.texImage3D(...);                         // error! no such function
  webgl1Ctx.bindTexture(webgl1ctx.TEXTURE_3D, tex);  // error! TEXTURE_3D is not defined
  webgl1Ctx.bindTexture(webgl2ctx.TEXTURE_3D, tex);  // ok
  ```

  This should arguably not a come up. A WebGL1 context would be using
  WebGL1 constants. I only point this out to say virtual-webgl doesn't
  force WebGL1 compliance.

* WebGL1 on WebGL2 support is limited

  I took a quick stab at trying to emulate WebGL1 on WebGL2 so that
  you could mix WebGL1 and WebGL2 in the same WebGL2 context.
  That includes extensions like `OES_vertex_array_object`, `OES_texture_float`,
  and `ANGLE_instanced_arrays`.

  Unfortunately, when I got to `WEBGL_draw_buffers` I realized that
  emulating that would require a full GLSL parser and re-writer to
  change GLSL ES 1.0 to GLSL ES 3.0 and several complex transformations.

  That's the long way of saying WebGL1 emulation on WebGL2 is incomplete.

* There are no checks for errors.

  WebGL (and OpenGL) use a asynchronous command buffer error system
  which means checking for errors really slows things down so
  this Virtual WebGL also doesn't check for errors. Your code
  should not be generating errors in the first place so if it is
  fix your code!

  Where this might come up? I forget the details of the spec but,
  lets say you make an invalid program. When you call `gl.useProgram`
  it will fail and leave the previous program still the current program.
  so if you call `gl.uniformXXX` you'll be setting the uniforms for
  the previous current program. With one WebGL app that was your own
  previous current program. With multiple WebGL apps that could be
  some other app's current program.

  That's just one example. Lots of apps don't setup textures correctly
  at the beginning, start loading images, start rendering, get errors,
  those errors stop when the image finally downloads. Those kinds of
  errors could bleed from one context to another.

  So, run your apps without virtual-webgl and make sure they
  get no errors. Then after try running them with virtual-webgl
  and they should hopefully still get no errors.

## Perf

The WebGL2 wrapper (virtual-webgl2.js) is newer and saves state so it's pretty fast. 
The WebGL1 wrapper (virtual-webgl.js) is older and queries state so it's pretty slow.

You could probably get even more perf by changing all the functions that set GL state
to just save the state but not actually set it and then just set the dirty state
at draw time. And further, for all the functions that query state just return the
saved state instead of asking WebGL. That would actually probably a speedup for
many poorly written apps that query things they shouldn't.

Another perf issue is you can't render directly to different canvases so I have
to make each of the canvases use a `Canvas2DRenderingContext` and call
`drawImage`. That could be solved maybe with `OffscreenCanvas` and
`ImageBitmapRenderingContext` but those features haven't shipped without a flag
as of 2018-06-05.

It could also be solved using the techniques used in
[this sample](http://twgljs.org/examples/itemlist.html)

Basically, put the canvas of the shared GL context full window size in the
background and instead of compositing by copying to a 2D canvas, composite by
setting the viewport/scissor and render to the shared GL context's canvas. The
limitation of course is that the result won't appear in front of other elements
but usually that's ok.

That should be trivial to implement using a custom compositor. The first time
you get a compositor put the canvas of the shared context (the one that gets
passed to `composite`) in the page and then render the texture being composited
using `gl.viewport` and `gl.scissor`

If your canvases are not all on screen you could try using
[an augmented requestAnimationFrame](https://github.com/greggman/requestanimationframe-fix.js)
that only calls the requestAnimationFrame callback to draw the canvases that are on screen.

## Future Enhancements

virtual-webgl adds a `dispose` method to the virtual contexts letting you free
the virtual context. As it is it leaves it up to the app to free all of its own
GPU resources. `dispose` only disposes of internal resources.

It probably would not be that hard to track resources by context and free them
on dispose. It's not 100% clear that's the right thing to do always. For example
since virtual-webgl lets you share resources across contexts it would be a
perfectly valid use-case to create a temporary context just to create some
resources and the dispose of that context but keep the created resources around.

It's perfectly reasonable to do this yourself 100% outside virtual-webgl. You
just *either* augment the context.

Example

    const buffers = new Set();
    gl.createBuffer = function(oldFn) {
      return function() {
        const b = oldFn.call(this);
        buffers.set(b);
        return b;
      }
    }(gl.createBuffer);
    gl.deleteBuffer = function(oldFn) {
      return function(b) {
        buffers.delete(b);
        oldFn.call(this, b);
      }
    }(gl.deleteBuffer);
    gl.dispose = function(oldFn) {
      [...buffers].forEach(b) {
        this.deleteBuffer(b);
      });
      if (oldFn) {
        oldFn();
      }
    }(gl.dispose);

You'd need to do the same for textures, renderbuffers, framebuffers, VAOs, programs, shaders

Or you just make helper functions and make your app call those functions that does the same tracking
instead of calling functions directly on the context. In other words.

    const buffer = customFunctionThatCreatesABufferAndTracksIt(gl);

instead of

    const buffer = gl.createBuffer();

## License

MIT (see top of js file)

