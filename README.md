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

One other thing you could do with this is share resources across contexts.
Since underneath there is really only one context from the POV of the app
you can do things like

    const gl1 = document.createElement("canvas").getContext("webgl");
    const gl2 = document.createElement("canvas").getContext("webgl");

    const tex1 = gl1.createTexture();

    gl2.bindTexture(gl1.TEXTURE_2D, tex1);  // this would normally fail

With normal WebGL contexts you can't use resources from one context in another
context but with virtual contexts you can.

## How to use?

Include it on your page before other scripts

```
<script src="virtual-webgl.js"></script>
```

## Limits and Issues

At the moment I just wanted to see it work so I only supported WebGL1 and I didn't support
any extensions that have methods. In particular there's no support for `WebGL_draw_buffers`,
`OES_vertex_array_object` nor `ANGLE_instanced_arrays`.

## Perf

Saving and restoring all the state is probably pretty dang slow but generally it should
only happen once per canvas per render so that might not be too bad. There are certain
low-hanging optimizations for example you could track the highest used attribute and
highest used texture unit across contexts and only save and restore up to that highest
attribute and texture unit since most apps don't use all of them.

The other big perf issue is you can't render directly to different canvases so I have
to make each of the canvases use a `Canvas2DRendernigContext` and call `drawImage`.

That could be solved maybe with `OffscreenCanvas` and `ImageBitmapRenderingContext`
but those features haven't shipped without a flag as of 2018-06-05.

## License

MIT (see top of js file)

