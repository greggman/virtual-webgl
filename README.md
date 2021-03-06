# Virtual WebGL

Virtualizes a single WebGL context into multiple contexts

[A demo of some WebGL apps running with only 1 shared WebGL context](https://greggman.github.io/virtual-webgl/example/example.html)
and using `alpha: false`, `premultipledAlpha: false`, `preserveDrawingBuffer: true` and some other things.

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

I don't actually recommend this at all. If you're in control of your code then there are
much better solutions [like this for raw webgl](http://twgljs.org/examples/itemlist.html)
and [this for three.js](https://threejs.org/examples/webgl_multiple_elements.html) (both if which I wrote BTW &#x1F61B;)

I mostly wrote this for a fun short techincal challenge. I have no plans to acutally use it
or maintain it. If you find a problem feel free to file an issue but I can't promise I
can spend anytime addressing it. Pull requests are more welcome or just fork it.

## Some things you could do with this other can just get more contexts:

### Share resources across contexts.

Since underneath there is really only one context from the POV of the app
you can do things like

    const gl1 = document.createElement("canvas").getContext("webgl");
    const gl2 = document.createElement("canvas").getContext("webgl");

    const tex1 = gl1.createTexture();

    gl2.bindTexture(gl1.TEXTURE_2D, tex1);  // this would normally fail

With normal WebGL contexts you can't use resources from one context in another
context but with virtual contexts you can.

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

## Writing your own compositor

A full solution would probably require some other method but ... If you look in
[unity-example/index.html](https://greggman.github.io/virtual-webgl/unity-example/index.html)
you'll see code that (a) disables WebGL2 so that Unity falls
back to WebGL1 (since this virtual-webgl currently only supports WebGL1), and (b) creates a custom
compositor that draws a different result than the default compositor.

The idea for the `createCompostor` function is that you probably need different compositors
for each canvas on the page so it's up to you how to do that. Either check the `canvas` passed
in and it's ID or keep a count of compositors created and do different things for different ones
or whatever. If you return nothing/undefined the default compositor will be created for that canvas.

As another example if you wanted to draw a MapGL texture inside THREE.js then you'd probably
make the one compositor do nothing except record the texture needed to use inside three.
For three's canvas you'd use the default compositor. [see this](https://greggman.github.io/virtual-webgl/mapbox-gl/index.html).
Not sure how to use an external WebGL texture in THREE.js so the example uses twgl.

Note: If a compositor has a `dispose` method it will be called if `context.dispose` is called
to give your custom compositor a chance to clean up.

## Limits and Issues

* Only WebGL1 is supported at the moment

  WebGL2 gets harder likely because of issues with queries, sync objects, and various issues related to PBUFFERS
  and transform feedback. If you ignore those issues then it would be relatively easy. Handling those issues
  is probably much more work.

* There are no checks for errors.

  WebGL (and OpenGL) use a asynchronous command buffer error system
  which means checking for errors really slows things down so
  this Virtual WebGL also doesn't check for errors. Your code
  should not be generating errors in the first place so if it is
  fix your code.

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

Saving and restoring all the state is probably pretty dang slow. I tried rendering
a bunch of 300x150 canvases with a single cube and it can't do 60fps with just a few
canvases. I even made it ony render the first canvas, no compositing for the others
and it still couldn't keep perf meaning it's slow and you should use another solution
if possible.

There are certain low-hanging optimizations. For example you could track the highest used attribute and
highest used texture unit across contexts and only save and restore up to that highest
attribute and texture unit since most apps don't use all of them. If your app use VAOs that issue
disappears.

The other big perf issue is you can't render directly to different canvases so I have
to make each of the canvases use a `Canvas2DRendernigContext` and call `drawImage`.

That could be solved maybe with `OffscreenCanvas` and `ImageBitmapRenderingContext`
but those features haven't shipped without a flag as of 2018-06-05.

It could also be solved using the techiques used in [this sample](http://twgljs.org/examples/itemlist.html)

Basically put the canvas of the shared GL context full window size in the background and instead
of compositing by copying to a 2D canvas, composite by setting the viewport/scissor and render to
the shared GL context's canvas. The limitation of course is that the result won't appear in front
of other elements but usually that's ok.

That should be trivial to implement using a custom compositor. The first time you get a compositor
put the canvas of the shared context (the one that gets passed to `compsite`) in the page and then
render the texture being composited using `gl.viewport` and `gl.scissor`

If your canvases are not all on screen you could try using [an augmented requestAnimationFrame](https://github.com/greggman/requestanimationframe-fix.js)
that only calls the requestAnimationFrame callback to draw the canvases that are on screen.

All those optimizaton don't add up to much given the test mentioned in the first paragraph.

Another solution is to track all the state internally rather than querying it from WebGL. There's a lot
of state to track. You'd track it, and then ideally only lazily restore it if possible.

## Future Enhancements

virutal-webgl adds a `dispose` method to the virtual contexts letting you free the virutal context.
As it is it leaves it up to the app to free all of its own GPU resources. `dispose` only disposes of
internal resources.

It probably would not be that hard to track resources by context and free them on dispose. It's not
100% clear that's the right thing to do always. For example since virutal-webgl lets you share
resources across contexts it would be a perfectly valid usecase to create a temporary context just to create some
resources and the dispose of that context but keep the created resources around.

It's perfectly resonable to do this yourself 100% outside virual-webgl. You just *either* augment the context.

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

You'd need to do the same for textures, renderbuffers, framebuffers, vaos, programs, shaders

Or you just make helper functions and make your app call those functions that does the same tracking
instead of calling functions directly on the context. In other words.

    const buffer = customFunctionThatCreatesABufferAndTracksIt(gl);

instead of

    const buffer = gl.createBuffer();

## License

MIT (see top of js file)

