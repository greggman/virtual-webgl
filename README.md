# Virtual WebGL

Virtualizes a single WebGL context into multiple contexts

[Demo of 4 WebGL apps running with only 1 WebGL context](https://greggman.github.io/virtual-webgl/example/example.html)

## What?

Browsers usually limit WebGL to 8 to 16 contexts max. This is one idea to overcome that limit.

I don't actually recommend this at all. If you're in control of your code then there are
much better solutions [like this for raw webgl](http://twgljs.org/examples/itemlist.html)
and [this for three.js](https://threejs.org/examples/webgl_multiple_elements.html) (both if which I wrote BTW &#x1F61B;)

I mostly wrote this for a fun short techincal challenge. I have no plans to acutally use it
or maintain it. If you find a problem feel free to file an issue but I can't promise I
can spend anytime addressing it. Pull requests are more welcome or just fork it.

## How to use?

Include it on your page before other scripts

```
<script src="virtual-webgl.js"></script>
```

## Limits and Issues

At the moment I just wanted to see it work so I only supported WebGL1 and I didn't support
any extensions that have methods.


