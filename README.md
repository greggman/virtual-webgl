# Virtual WebGL

Virtualizes a single WebGL context into multiple contexts

[Demo of some WebGL apps running with only 1 WebGL context](https://greggman.github.io/virtual-webgl/example/example.html)
and using `alpha: false`, `premultipledAlpha: false`, `preserveDrawingBuffer: true` and some other things.

## What?

Browsers usually limit WebGL to 8 to 16 contexts max. This is one idea to overcome that limit.

I don't actually recommend this at all. If you're in control of your code then there are
much better solutions [like this for raw webgl](http://twgljs.org/examples/itemlist.html)
and [this for three.js](https://threejs.org/examples/webgl_multiple_elements.html) (both if which I wrote BTW &#x1F61B;)

I mostly wrote this for a fun short techincal challenge. I have no plans to acutally use it
or maintain it. If you find a problem feel free to file an issue but I can't promise I
can spend anytime addressing it. Pull requests are more welcome or just fork it.

Some things you could do with this other can just get more contexts:

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

To do this you'd probably want to modify this code so that it uses the normal
virtual context framebuffer for mapbox-gl-js but doesn't try to composite it.
Then for the three.js virutal context it just draws directly to the canvas.
You'd need to expose the mapbox-gl-js's virtual context's texture object
and pass that into three.js

## How to use?

Include it on your page before other scripts

```
<script src="virtual-webgl.js"></script>
```

## Limits and Issues

* Only WebGL1 is supported

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

  In any case run your apps without virtual-webgl and make sure they
  get no errors. Then after try running them with virtual-webgl
  and they should hopefully still get no errors.

## Perf

Saving and restoring all the state is probably pretty dang slow but generally it should
only happen once per canvas per render so that might not be too bad.

There are certain low-hanging optimizations. For example you could track the highest used attribute and
highest used texture unit across contexts and only save and restore up to that highest
attribute and texture unit since most apps don't use all of them.

The other big perf issue is you can't render directly to different canvases so I have
to make each of the canvases use a `Canvas2DRendernigContext` and call `drawImage`.

That could be solved maybe with `OffscreenCanvas` and `ImageBitmapRenderingContext`
but those features haven't shipped without a flag as of 2018-06-05.

## License

MIT (see top of js file)

