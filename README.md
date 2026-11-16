# Spec Decoder (PWA)

Point your phone's camera at a computer's spec sticker, shop label, or *Settings › About* screen. A live scanner
guides you until the text is readable:

- **Move closer** when the text is too small, **move back** when it's too close or doesn't fit the frame
- **Too blurry** while it can't focus. If it stays blurry: "wipe the lens, move back, or use a better camera"
- **Too dark / too much glare**, **hold still**, plus a 🔦 torch button where the phone supports it
- A warning if the camera's resolution is low

Light, Focus and Distance checks are shown at the top of the screen. A loader shows while each frame is being read.
The text is read on the device, and the scanner closes as soon as it has confidently recognised a processor name.
It then decodes the name using the rules from the "how to read a processor's name" video:

| Part | Example (`i7-13700H`) | Meaning |
|---|---|---|
| Tier | `i7` | i3 / i5 / i7 / i9: like plane classes. Means nothing on its own. |
| Generation | `13` | Often the most important number. |
| Rank | `700` | Position within the tier and generation. Bigger is stronger. |
| Letter | `H` | **U** saves battery · **H** high performance · **HX** monster · **K** overclockable desktop · **F** no built-in graphics |

Each chip is put in one of these categories: **Work & school**, **Balanced**, **High performance**, **Monster**, **Desktop**, **Entry level**.
The app also shows:

- an age verdict
- rough single-core (gaming) and multi-core (video editing) scores, where i7-13700H = 100
- a fit grid for work, gaming, video editing and battery
- a benchmark search link

Compare mode puts two chips side by side. The built-in example is the one from the video: 8th-gen i7 U vs 13th-gen i5 H gives ≈ 4.7×.

Supported: Intel Core i3–i9 (1st–14th gen), Core Ultra (Series 1/2), Core 3/5/7, AMD Ryzen (incl. AI 300, PRO, X3D, 2023+ laptop numbering),
Apple M1–M5 (Pro/Max/Ultra), Snapdragon X, and Celeron/Pentium/N-series/Athlon. It also picks up RAM, GHz, storage and GPU when they are visible.

Live: **https://spec-decoder.njmalaza.workers.dev**

## Run

```bash
npm install
npm start        # wrangler dev → http://localhost:8787 (service worker needs http(s), not file://)
npm test         # decoder unit tests
npm run icons    # regenerate PNG icons
npm run deploy   # deploy to Cloudflare Workers (static assets)
```

There is no build step. Everything in `public/` is served as-is by a static-assets-only Cloudflare Worker (`wrangler.jsonc`).
The camera and the install prompt need HTTPS on phones.

## How it works

- `public/src/decoder.js`: pure, tested rule engine (regex → tier / gen / rank / suffix → category and scores).
- `public/src/scanner.js`: the live camera loop. It crops the frame under the on-screen guide, checks quality about 6×/s, and runs OCR when the frame is steady. It accepts a result on a confident read, or when two reads in a row agree.
- `public/src/quality.js`: pure, tested frame metrics (brightness, contrast, strongest-edge sharpness, motion) plus closer/further advice based on the size of the OCR'd words.
- `public/src/ocr.js`: Tesseract.js 5, loaded lazily. It upscales the image and converts it to grayscale with stretched contrast before reading.
- `public/sw.js`: precaches the app shell. It also caches the OCR engine and English language data the first time they are used, so scanning works offline after that.

The scores come from name-based heuristics, not real benchmarks. The app always links out to check real numbers, as the video says to.
