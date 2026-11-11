/**
 * Test support for the art importers (`stickers.mjs`, `portraits.mjs`,
 * `backdrops.mjs`): a local stand-in for the MediaWiki responses they use, and
 * a synthetic character drawn with `sharp`. Nothing here touches the network.
 */
import { createServer } from "node:http";
import sharp from "sharp";

/**
 * Serves `api.php?action=query&prop=imageinfo` and the image files for `files`
 * (file name → PNG buffer). `failures` maps a file name to an HTTP status its
 * download answers with. Thumbnails are resized with a different kernel than
 * `sharp`'s default, as a wiki's own thumbnailer would be.
 *
 * `categories` (`Category:Name` → file names) answers
 * `list=categorymembers&cmtype=file`, at most `pageSize` a page (whatever
 * `cmlimit` asks) with a `cmcontinue` for the next. `fandom: false` serves
 * files without `format=original`, as a plain MediaWiki does.
 */
export async function startFakeWiki(
  files,
  { failures = {}, categories = {}, fandom = true, pageSize = 10 } = {},
) {
  const requests = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url, "http://localhost");
    requests.push(url.pathname + url.search);
    const send = (status, type, body) => {
      response.writeHead(status, { "Content-Type": type });
      response.end(body);
    };
    void (async () => {
      if (
        url.pathname === "/api.php" &&
        url.searchParams.get("list") === "categorymembers"
      ) {
        const members = categories[url.searchParams.get("cmtitle")];
        if (!members)
          return send(
            200,
            "application/json",
            JSON.stringify({ query: { categorymembers: [] } }),
          );
        const limit = Math.min(
          Number(url.searchParams.get("cmlimit")) || 10,
          pageSize,
        );
        const from = Number(
          (url.searchParams.get("cmcontinue") ?? "file|0").split("|")[1],
        );
        const page = members.slice(from, from + limit);
        const next = from + limit;
        return send(
          200,
          "application/json",
          JSON.stringify({
            ...(next < members.length
              ? { continue: { cmcontinue: `file|${next}`, continue: "-||" } }
              : {}),
            query: {
              categorymembers: page.map((name) => ({
                ns: 6,
                title: `File:${name}`,
              })),
            },
          }),
        );
      }
      if (url.pathname === "/api.php") {
        const width = Number(url.searchParams.get("iiurlwidth")) || undefined;
        const pages = [];
        for (const title of url.searchParams.get("titles").split("|")) {
          const name = title.replace(/^File:/, "");
          const buffer = files.get(name);
          if (!buffer) {
            pages.push({ title, missing: true });
            continue;
          }
          const meta = await sharp(buffer).metadata();
          const image = {
            width: meta.width,
            height: meta.height,
            size: buffer.length,
            mime: "image/png",
            url: `${base}/images/${encodeURIComponent(name)}?cb=1`,
            descriptionurl: `${base}/wiki/File:${encodeURIComponent(name)}`,
          };
          if (width) {
            image.thumbwidth = Math.min(width, meta.width);
            image.thumburl = `${base}/thumb/${image.thumbwidth}/${encodeURIComponent(name)}?cb=1`;
          }
          pages.push({ title, imageinfo: [image] });
        }
        return send(
          200,
          "application/json",
          JSON.stringify({ query: { pages } }),
        );
      }
      const match = /^\/(?:images|thumb\/(\d+))\/(.+)$/.exec(url.pathname);
      const name = match && decodeURIComponent(match[2]);
      if (!match || !files.has(name)) return send(404, "text/plain", "none");
      if (failures[name]) return send(failures[name], "text/plain", "failed");
      // Like Fandom: without `format=original` the answer would be WebP.
      if (fandom && url.searchParams.get("format") !== "original")
        return send(400, "text/plain", "ask for the original");
      const buffer = files.get(name);
      if (!match[1]) return send(200, "image/png", buffer);
      const meta = await sharp(buffer).metadata();
      const width = Number(match[1]);
      return send(
        200,
        "image/png",
        await sharp(buffer)
          .resize(width, Math.round((meta.height * width) / meta.width), {
            fit: "fill",
            kernel: "mitchell",
          })
          .png()
          .toBuffer(),
      );
    })().catch((error) => send(500, "text/plain", String(error)));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    url: base,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/** What each expression draws, so tests can tell them apart by name. */
export const EXPRESSIONS = ["neutral", "happy", "surprised", "angry", "sad"];

/**
 * A full-body character on a transparent `width` × `height` canvas: the same
 * body and head in every picture, with eyes, brows and mouth that change by
 * `expression`. `tweak` adds a dot of `tweak` px to the cheek, for
 * near-identical variants; `wave` raises a hand far to the upper left, which
 * widens the picture's opaque area without moving the body. Returns the PNG and
 * the head's box in canvas pixels.
 */
export async function drawCharacter({
  width = 600,
  height = 1000,
  expression = "neutral",
  tweak = 0,
  wave = false,
  left = 0.5,
}) {
  const u = width / 100;
  const cx = width * left;
  const headY = height * 0.2;
  const r = 14 * u;
  const eyeY = headY - 1 * u;
  const mouthY = headY + 7 * u;
  const eye = (x) =>
    ({
      neutral: `<circle cx="${x}" cy="${eyeY}" r="${2 * u}" fill="#223"/>`,
      happy: `<path d="M${x - 3 * u} ${eyeY + u} Q${x} ${eyeY - 3 * u} ${x + 3 * u} ${eyeY + u}" stroke="#223" stroke-width="${u}" fill="none"/>`,
      surprised: `<circle cx="${x}" cy="${eyeY}" r="${3.4 * u}" fill="#fff" stroke="#223" stroke-width="${u}"/>`,
      angry: `<path d="M${x - 3 * u} ${eyeY - 3 * u} L${x + 3 * u} ${eyeY - u}" stroke="#223" stroke-width="${u}"/><circle cx="${x}" cy="${eyeY + u}" r="${1.6 * u}" fill="#a22"/>`,
      sad: `<path d="M${x - 3 * u} ${eyeY} L${x + 3 * u} ${eyeY + 2 * u}" stroke="#335" stroke-width="${0.8 * u}"/><circle cx="${x}" cy="${eyeY + 3 * u}" r="${u}" fill="#6af"/>`,
    })[expression];
  const mouth = {
    neutral: `<path d="M${cx - 3 * u} ${mouthY} L${cx + 3 * u} ${mouthY}" stroke="#733" stroke-width="${0.8 * u}"/>`,
    happy: `<path d="M${cx - 5 * u} ${mouthY - u} Q${cx} ${mouthY + 5 * u} ${cx + 5 * u} ${mouthY - u}" fill="#c44"/>`,
    surprised: `<ellipse cx="${cx}" cy="${mouthY + u}" rx="${2.5 * u}" ry="${3.5 * u}" fill="#622"/>`,
    angry: `<path d="M${cx - 4 * u} ${mouthY + 2 * u} Q${cx} ${mouthY - 3 * u} ${cx + 4 * u} ${mouthY + 2 * u}" stroke="#733" stroke-width="${u}" fill="none"/>`,
    sad: `<path d="M${cx - 3 * u} ${mouthY + 2 * u} Q${cx} ${mouthY} ${cx + 3 * u} ${mouthY + 2 * u}" stroke="#733" stroke-width="${0.6 * u}" fill="none"/>`,
  }[expression];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#3a5fcd"/><stop offset="1" stop-color="#1b2f6b"/>
    </linearGradient></defs>
    <rect x="${cx - 18 * u}" y="${headY + r - u}" width="${36 * u}" height="${height * 0.5}" rx="${6 * u}" fill="url(#g)"/>
    <rect x="${cx - 14 * u}" y="${headY + r + height * 0.48}" width="${10 * u}" height="${height * 0.22}" fill="#2a2a2a"/>
    <rect x="${cx + 4 * u}" y="${headY + r + height * 0.48}" width="${10 * u}" height="${height * 0.22}" fill="#2a2a2a"/>
    ${wave ? `<circle cx="${cx - 40 * u}" cy="${headY - 10 * u}" r="${5 * u}" fill="#f2c9a8"/><rect x="${cx - 42 * u}" y="${headY - 6 * u}" width="${4 * u}" height="${32 * u}" fill="#3a5fcd"/>` : ""}
    <circle cx="${cx}" cy="${headY}" r="${r}" fill="#f2c9a8"/>
    <path d="M${cx - r - u} ${headY} A${r + u} ${r + u} 0 0 1 ${cx + r + u} ${headY} L${cx + r - 2 * u} ${headY - 6 * u} L${cx - r + 2 * u} ${headY - 6 * u} Z" fill="#5b3a1e"/>
    ${eye(cx - 5.5 * u)}${eye(cx + 5.5 * u)}${mouth}
    ${tweak ? `<rect x="${cx + 9 * u}" y="${headY + 4 * u}" width="${tweak}" height="${tweak}" fill="#d88"/>` : ""}
  </svg>`;
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  return {
    png,
    head: {
      left: cx - r,
      top: headY - r,
      right: cx + r,
      bottom: headY + r,
    },
    eyeY,
  };
}
