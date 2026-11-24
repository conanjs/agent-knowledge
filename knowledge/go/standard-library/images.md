---
schema: knowledge-doc/v1
type: concept
topic: go/standard-library
status: verified
applies-to: ["Go 1.27 (go1.27.4)", "golang.org/x/tour v0.1.0 (pic.ShowImage)", "new JPEG encoder and decoder: Go ≥ 1.26", "PNG bytes may change with compress/flate: Go 1.27"]
last-verified: 2026-11-24
last-updated: 2026-11-24
tags: [go, golang, image, image-color, image-png, image-draw, image-decode, rgba, nrgba, alpha-premultiplied, subimage, porter-duff, tour-of-go]
ranked-sources: true
---

# Images: the image, color, png and draw packages

## Summary
**TL;DR:** An `image.Image` is any value with three methods: `ColorModel`, `Bounds` and `At(x, y)`. Its bounds are an `image.Rectangle` that includes `Min` and excludes `Max`, and need not start at (0, 0). A `color.Color` reports itself through `RGBA()` (red, green, blue, alpha: opacity) as alpha-premultiplied 16-bit values (0–65535), not 8-bit ones. In-memory types such as `*image.RGBA`, `*image.NRGBA`, `*image.Gray` and `*image.Paletted` keep pixels in a `Pix` byte slice, and `SubImage` returns a view that shares those bytes. `image.Decode` knows only the formats whose packages were imported, often with a blank import such as `_ "image/png"`; for any other input it returns `image: unknown format`. `draw.Draw` with `draw.Src` replaces pixels, and with `draw.Over` blends the source over what is there.
**Use this when:** you do the "Images" pages of A Tour of Go, generate or decode PNG (Portable Network Graphics), JPEG (Joint Photographic Experts Group) or GIF (Graphics Interchange Format) files, convert between colour types, crop or paste images, or hit `image: unknown format`.
**Not this doc:** interfaces in general → `go/methods-interfaces/interfaces.md`; blank imports and `init` → `go/packages-modules/packages-and-initialization.md`; base64 text, which the Tour's `pic.ShowImage` prints → `go/standard-library/csv-xml-and-binary-encodings.md`; readers and writers → `go/standard-library/io-and-encoding-json.md`.

## Problem
Image code fails quietly. A loop from 0 to `Width` misses pixels when an image's bounds do not start at (0, 0), which is common for the frames of an animated GIF ✅[^10]. Code that expects 255 for full red gets 65535 from `RGBA()` ✅[^10]. A half-transparent red does not report red 255 ✅[^1]. A perfectly valid PNG file fails with `image: unknown format` because no PNG decoder was registered ✅[^1]. And painting on a cropped region changes the original image too ✅[^1].

## Mental model
**Analogy:** an image is a sheet of graph paper with a frame drawn on it. The frame (`Bounds`) says which squares belong to the picture; you ask for the colour of a square by its coordinates (`At`). The frame works like a slice `s[i:j]`: the top-left corner is inside, the bottom-right corner is just outside ✅[^10]. Because `Image` is an interface, the "paper" can be a stored grid of bytes or a function that computes each colour on demand.

**Artifact:** the Tour's first image program ✅[^7], run on Go 1.27.4 ✅[^1]:
```go
m := image.NewRGBA(image.Rect(0, 0, 100, 100))
fmt.Println(m.Bounds())         // (0,0)-(100,100)
fmt.Println(m.At(0, 0).RGBA())  // 0 0 0 0   (a new RGBA image is transparent black)
```

## How it works

### The interface and its geometry
- `image.Image` has `ColorModel() color.Model`, `Bounds() Rectangle` and `At(x, y int) color.Color`; `At(Bounds().Min.X, Bounds().Min.Y)` is the upper-left pixel and `At(Bounds().Max.X-1, Bounds().Max.Y-1)` the lower-right one ✅[^2] ✅[^7].
- A `Point` is an X, Y pair; the axes grow right and down ✅[^2]. A `Rectangle` holds the points with `Min.X <= X < Max.X` and `Min.Y <= Y < Max.Y` ✅[^2]. `image.Rect` swaps coordinates if needed so the rectangle is well formed ✅[^2]: `image.Rect(5, 5, 0, 0)` printed `(0,0)-(5,5)` ✅[^1].
- With `r := image.Rect(2, 1, 5, 5)`, `r.Dx(), r.Dy()` are `3 4`, `Pt(2, 1).In(r)` is true and `Pt(5, 5).In(r)` is false ✅[^1]. `Intersect` returns the zero rectangle when two rectangles do not overlap ✅[^2] (`(0,0)-(0,0)`, `Empty()` true ✅[^1]).
- The correct pixel loop runs from `b.Min` to `b.Max` of `b := m.Bounds()`, not from 0 ✅[^10].
- An `Image` does not need stored pixels: `image.Uniform` is an image of one colour with enormous bounds ✅[^10]. The Tour exercise asks for exactly such a type, with `Bounds` returning `image.Rect(0, 0, w, h)`, `ColorModel` returning `color.RGBAModel`, and `At` returning `color.RGBA{v, v, 255, 255}` ✅[^7].

### Colours and colour models
- `color.Color` has one method, `RGBA() (r, g, b, a uint32)`: alpha-premultiplied values in `[0, 0xffff]`, held in `uint32` so that multiplying by a blend factor up to 0xffff cannot overflow ✅[^3].
- **Alpha-premultiplied** means each colour channel is already scaled by alpha, so a channel is never larger than alpha ✅[^3]. Think of paint already mixed with clear varnish: a 50 % transparent red stores "half the red". In the lab `color.NRGBA{255, 0, 0, 128}.RGBA()` returned `32896 0 0 32896` ✅[^1].
- **16-bit range:** `color.RGBA` turns its 8-bit fields into 16-bit values by multiplying by 0x101 ✅[^10]: `color.RGBA{255, 0, 0, 255}.RGBA()` returned `65535 0 0 65535` ✅[^1].
- `color.RGBA` stores premultiplied 8-bit channels; `color.NRGBA` stores non-premultiplied ones, as PNG does ✅[^3] ✅[^10]. `RGBA{128, 0, 0, 128}` and `NRGBA{255, 0, 0, 128}` are the same colour: both returned `32896 0 0 32896` ✅[^1].
- A `color.Model` converts any colour into its own type, possibly losing information ✅[^3]. `RGBAModel`, `NRGBAModel`, `GrayModel`, `CMYKModel`, `YCbCrModel` and others are predefined ✅[^3]. `GrayModel.Convert(RGBA{255, 0, 0, 255})` gave `Gray{Y:0x4c}` ✅[^1].
- A `color.Palette` is a `[]color.Color`; `Convert` returns the closest palette colour in Euclidean R, G, B space and `Index` its position ✅[^3]. `{200, 30, 30}` mapped to red, index 2, in a black-white-red palette ✅[^1].

### Concrete image types
| Type | `Pix` holds ✅[^2] ✅[^3] | `At` returns | Lab ✅[^1] |
|---|---|---|---|
| `*image.RGBA` | 4 bytes per pixel, R G B A, premultiplied | `color.RGBA` | 2×2 image: `Stride` 8, pixel (1, 0) at `Pix[4:8]` |
| `*image.NRGBA` | 4 bytes per pixel, R G B A, not premultiplied | `color.NRGBA` | — |
| `*image.Gray` | 1 byte per pixel | `color.Gray` | `Set` of pure red stored `76` |
| `*image.Paletted` | 1 byte per pixel: an index into `Palette` | a palette colour | near-white stored index `1` |

- The pixel at (x, y) starts at `Pix[(y-Rect.Min.Y)*Stride + (x-Rect.Min.X)*4]` for 4-byte types; `Stride` is the distance in bytes between vertically adjacent pixels ✅[^2].
- `Set(x, y, c)` changes one pixel ✅[^10]; for a large amount of pixel data, reading `Pix` directly can be faster but more complicated ✅[^10].
- `At` outside the bounds returned transparent black, `{0 0 0 0}` ✅[^1].

### Formats: encode, decode and registration
**4 actors:**
- **Your `main` package** — its job: choose which formats the program understands, via imports such as `_ "image/png"`.
- **A format package** (`image/png`, `image/jpeg`, `image/gif`) — its job: register a name, a magic prefix and its decoders, via `image.RegisterFormat` in its `init` function.
- **`image.Decode` / `image.DecodeConfig`** — its job: sniff the first bytes of the input and dispatch, via the table of registered formats.
- **The format's decoder** — its job: build an `image.Image` (or just a `Config`), via `png.Decode` and friends.

```
main imports _ "image/png" ──▶ image/png init() ──RegisterFormat("png", magic, Decode, DecodeConfig)──▶ [format table]
                                                                                                         │
io.Reader (file bytes) ──▶ image.Decode(r) ── compare first bytes with each magic ──────────────────────┘
                                   │ match "png"                         │ no match
                                   ▼                                     ▼
                         png.Decode(r) ──▶ *image.NRGBA, "png", nil     nil, "", image.ErrFormat
```

1. **Your program (at start-up, in process):** the blank import runs the format package's initialization; the `_` imports a package only for that side effect ✅[^2].
2. **Format package (`init`):** calls `RegisterFormat(name, magic, decode, decodeConfig)`. The magic string is the prefix that identifies the format's encoding, like the label on a jar, and may contain `?` wildcards that match any one byte ✅[^2].
3. **`image.Decode` (reading the input):** returns the image and the format name used at registration ✅[^2]. With no matching registration it returns `ErrFormat`, whose text is `image: unknown format` ✅[^2]. In the lab, a program that imported only `image`, and another that imported `image/gif` and `image/jpeg`, both failed on the same PNG file; adding `_ "image/png"` decoded it as `*image.NRGBA`, format `"png"` ✅[^1].
4. **The decoder:** for PNG, the concrete type depends on the file's contents ✅[^4]. Encoding an opaque `*image.RGBA`, a `*image.Gray`, a `*image.Paletted` and the Tour's computed image, then decoding, gave back `*image.RGBA`, `*image.Gray`, `*image.Paletted` and `*image.RGBA` ✅[^1].

Encoding needs no registration: `png.Encode(w, m)` takes any `image.Image`, but anything that is not an `*image.NRGBA` might be encoded lossily ✅[^4]. The exact bytes it writes are outside the Go 1 compatibility promise, so tests must not compare them ✅[^4]; in Go 1.27 the new `compress/flate` encoder may change `image/png` output ✅[^9]. `png.Encoder` adds a `CompressionLevel` ✅[^4]. `jpeg.Encode` takes `*jpeg.Options` with `Quality` 1–100, default 75 ✅[^6], and Go 1.26 replaced the JPEG encoder and decoder, so code that expects specific bit-for-bit output may need updating ✅[^8].

For untrusted input, call `DecodeConfig` first: it reads only the header (colour model, width, height) without allocating a full-size pixel buffer, while `Decode` of an arbitrarily large image can exhaust the machine's memory ✅[^2].

### Drawing with `image/draw`
- `draw.Draw(dst, r, src, sp, op)` aligns `r.Min` in `dst` with `sp` in `src` and replaces rectangle `r` of `dst` with the Porter-Duff composition of the two; it is `DrawMask` with a nil mask ✅[^5]. Porter-Duff is the compositing model of the classic paper "Compositing Digital Images", which combines a source and a destination pixel by their transparency ✅[^11].
- `dst` must be a `draw.Image`, which is an `image.Image` with `Set` ✅[^5].
- **`draw.Over`** layers the source over the destination: the more transparent the source, the less the destination changes ✅[^11]. **`draw.Src`** copies the source and ignores what was there ✅[^11]. For opaque sources both give the same output, and `Src` is usually faster ✅[^11].
- Half-transparent red (`NRGBA{255, 0, 0, 128}`) on opaque blue gave `RGBA{0x80, 0, 0x7f, 0xff}` with `Over` and `RGBA{0x80, 0, 0, 0x80}` with `Src` ✅[^1].
- Fill: draw an `&image.Uniform{c}` with `Src`. Convert any image to RGBA: draw it into a new `image.NewRGBA` of the same size with `src.Bounds().Min` as `sp` ✅[^11]. The lab converted a paletted image this way ✅[^1].
- Drawing clips to each image's bounds ✅[^11].

### Sub-images share pixels
`SubImage(r)` returns the part of an image visible through `r`, sharing pixels with the original ✅[^2]. It is like a sub-slice: writes through it change the original ✅[^10].
```go
m0 := image.NewRGBA(image.Rect(0, 0, 8, 5))
m1 := m0.SubImage(image.Rect(1, 2, 5, 5)).(*image.RGBA)
fmt.Println(m0.Bounds().Dx(), m1.Bounds().Dx(), m0.Stride == m1.Stride, m1.Bounds()) // 8 4 true (1,2)-(5,5)
m1.Set(1, 2, color.RGBA{255, 0, 0, 255})
fmt.Println(m0.At(1, 2))   // {255 0 0 255}: the original changed
```
The sub-image keeps the original coordinates, so its first pixel is (1, 2), not (0, 0) ✅[^1]. Its `Pix` is 92 bytes long against the original's 160: it runs from (1, 2) to the end of the parent's buffer ✅[^1], so ranging over `Pix` can touch pixels outside the sub-image ✅[^10].

## Worked example
Write a 4×3 PNG, read it back, and check every pixel ✅[^1]:

```go
img := image.NewNRGBA(image.Rect(0, 0, 4, 3))
for y := 0; y < 3; y++ {
	for x := 0; x < 4; x++ {
		img.Set(x, y, color.NRGBA{uint8(x * 60), uint8(y * 100), 200, 255})
	}
}
img.Set(3, 2, color.NRGBA{255, 0, 0, 128}) // one half-transparent pixel
f, _ := os.Create("out.png")
png.Encode(f, img)
f.Close()

data, _ := os.ReadFile("out.png")
cfg, format, _ := image.DecodeConfig(bytes.NewReader(data))
dec, _, _ := image.Decode(bytes.NewReader(data))
```

| Step | Observed on Go 1.27.4 ✅[^1] |
|---|---|
| File written | `out.png`, 121 bytes, first bytes `89 50 4e 47 0d 0a 1a 0a` |
| `DecodeConfig` | `4 3 png`, colour model `NRGBAModel`; only the header is read ✅[^2] |
| `Decode` | `*image.NRGBA`, bounds `(0,0)-(4,3)` |
| Pixel (1, 1) | `NRGBA{R:0x3c, G:0x64, B:0xc8, A:0xff}`, that is 60, 100, 200 |
| Pixel (3, 2) | `NRGBA{R:0xff, G:0x0, B:0x0, A:0x80}`: the non-premultiplied value survived |
| All 12 pixels compared with `==` | identical |
| Same file, program without `_ "image/png"` | `img=<nil> format="" err=image: unknown format`, `errors.Is(err, image.ErrFormat)` true |

The Tour exercise checks its answer with `pic.ShowImage` ✅[^7]. With `golang.org/x/tour` v0.1.0 it printed `IMAGE:` followed by base64 text; decoding that text with `image/png` gave a `*image.RGBA` 4×2 image whose pixel (1, 0) was `{1 1 255 255}`, the `x ^ y` value the exercise's `At` computed ✅[^1].

## Edge cases
| Case | What happens | Why |
|---|---|---|
| Loop `for x := 0; x < b.Dx(); x++` over a sub-image or GIF frame | Wrong pixels or transparent black outside the bounds ✅[^1] | Bounds need not contain (0, 0) ✅[^2] ✅[^10] |
| Expecting 255 from `RGBA()` | Gets 65535 ✅[^1] | 16-bit range ✅[^3] |
| Reading `R` of a half-transparent `color.RGBA` as "the red" | `RGBA{128,0,0,128}` is full red at half opacity ✅[^1] | Premultiplied storage ✅[^3] |
| `image.Decode` with no format package imported | `image: unknown format` ✅[^1] | Formats are registered by the codec package's `init` ✅[^2] |
| Garbage passed to `png.Decode` directly | `png: invalid format: not a PNG file` ✅[^1] | A `FormatError` reports input that is not a valid PNG ✅[^4] |
| Truncated PNG | The error depends on where the file ends: the worked example's 121-byte file cut after 40 bytes gave `unexpected EOF`, cut after 60 bytes `png: invalid format: not enough pixel data` ✅[^1] | — |
| Huge dimensions in an untrusted header | `Decode` may allocate memory for the full size first ✅[^2] | Check `DecodeConfig` first ✅[^2] |
| `png.Encode` of a non-NRGBA image | Possibly lossy ✅[^4] | PNG stores non-premultiplied colour ✅[^10] |
| Golden-file test on encoder output | Breaks across releases | Exact bytes are not covered by compatibility ✅[^4]; Go 1.27 changed the output of DEFLATE, the compression inside PNG ✅[^9] |
| Writing to a `SubImage` | Changes the parent ✅[^1] | Shared pixels ✅[^2] |
| `draw.Over` with an opaque source | Same result as `Src`, which is usually faster ✅[^11] | Nothing to blend |

## Trade-offs
| Option | Gains | Costs |
|---|---|---|
| `At` and `Set` | Simple; work on any image and clip to bounds ✅[^10] | Less efficient than `Pix` for a lot of pixel data ✅[^10] |
| Direct `Pix` access | Faster for bulk work ✅[^10] | Must handle `Stride`, `Rect.Min` and the shared tail of a sub-image ✅[^10] |
| `image.Decode` | One call for every registered format ✅[^2] | Needs the right blank imports |
| `png.Decode`, `jpeg.Decode` | No registration needed ✅[^10] | Only that one format |

## Takeaways
- Loop from `b.Min` to `b.Max` of `b := m.Bounds()`, never from 0. [rule-candidate]
- Put `_ "image/png"`, `_ "image/jpeg"`, `_ "image/gif"` in `main` for every format `image.Decode` must read. [rule-candidate]
- Call `image.DecodeConfig` and reject oversized images before `image.Decode` on untrusted input ✅[^2]. [rule-candidate]
- Use `*image.NRGBA` when you produce PNG files, so nothing is lost on encode ✅[^4].
- Compare decoded pixels in tests, not encoded bytes ✅[^4]. [rule-candidate]
- Copy a `SubImage` with `draw.Draw` into a new image when it must be independent of its parent.

## Verification status
- Verified: 104 claims (✅) · Unverified: 0 claims (⚠️) · Last verified: 2026-11-24

## References
- `go/lab-setup.md` — the Go 1.27.4 lab (`golang:1.27.4`) where every behaviour marked with this note ran on 2026-11-24: the Tour program, rectangles, colour values and conversions, `Pix` layouts, `SubImage`, `draw` with `Src` and `Over`, PNG encode and decode, decoded types, registration with and without blank imports, and the Tour exercise with `golang.org/x/tour` v0.1.0 (downloaded from `proxy.golang.org`). [^1]
- [image package](https://pkg.go.dev/image) — Go team, living. Rank 1. Backs: the `Image` interface, `Point`, `Rectangle` and `Rect`, `Intersect`, concrete types and `Pix` layout, `SubImage` sharing, `RegisterFormat`, `Decode`, `DecodeConfig`, `ErrFormat`, blank-import registration, Security Considerations. [^2]
- [image/color package](https://pkg.go.dev/image/color) — Go team, living. Rank 1. Backs: `Color.RGBA` range and premultiplication, `RGBA` and `NRGBA`, `Model` and the predefined models, `Palette.Convert` and `Index`. [^3]
- [image/png package](https://pkg.go.dev/image/png) — Go team, living. Rank 1. Backs: `Decode` type depends on contents, `Encode` lossy for non-NRGBA, bytes outside the compatibility promise, `Encoder.CompressionLevel`, `FormatError`. [^4]
- [image/draw package](https://pkg.go.dev/image/draw) — Go team, living. Rank 1. Backs: `Draw`, `DrawMask`, `draw.Image`, `Op` (`Over`, `Src`). [^5]
- [image/jpeg package](https://pkg.go.dev/image/jpeg) — Go team, living. Rank 1. Backs: `Options.Quality` 1–100, `DefaultQuality` 75. [^6]
- [A Tour of Go: Methods and interfaces, "Images" and "Exercise: Images"](https://github.com/golang/website/blob/b02076ae6df08ee9d495fe4b283f88ac18e51012/_content/tour/methods.article) — Go team, living (commit b02076a). Rank 1. Backs: the `Image` interface, the `NewRGBA` example, the exercise's `Bounds`, `ColorModel`, `At` and `pic.ShowImage`. [^7]
- [Go 1.26 Release Notes](https://go.dev/doc/go1.26) — Go team, 2026. Rank 1. Backs: new JPEG encoder and decoder. [^8]
- [Go 1.27 Release Notes](https://go.dev/doc/go1.27) — Go team, 2026. Rank 1. Backs: `compress/flate` changes may change `image/png` output. [^9]
- [The Go image package](https://go.dev/blog/image) — Nigel Tao, Go blog, 2011. Rank 4. Backs: premultiplied and 16-bit values, the 0x101 factor, NRGBA as PNG's model, inclusive and exclusive bounds, the GIF-frame pitfall and the right loop, `Uniform`, `Set` and `Pix`, `SubImage` as a sub-slice, registration by blank import. [^10]
- [The Go image/draw package](https://go.dev/blog/image-draw) — Nigel Tao, Go blog, 2011. Rank 4. Backs: Porter-Duff, `Over` versus `Src`, filling with `Uniform`, converting to RGBA, clipping. [^11]

## Related
- `go/methods-interfaces/interfaces.md` — why any type with these three methods is an `image.Image`.
- `go/packages-modules/packages-and-initialization.md` — blank imports and `init` order.
- `go/data-types/arrays-and-slices.md` — the slice sharing that `SubImage` copies.
- `go/standard-library/csv-xml-and-binary-encodings.md` — base64, used to embed or print PNG bytes as text.
- `go/standard-library/io-and-encoding-json.md` — `io.Reader` and `io.Writer`, which every codec takes.
- `go/learning-path.md`
