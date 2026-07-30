import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const OUTFITS_API = "/api/outfits";
const FEEDBACK_API = "/api/outfit-feedback";
const OUTFIT_ASSET_ROOT = "/api/import/outfits";

function json(res, status, value) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(value));
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function body(req, limit = 32 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error("Request body too large."), { status: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("Expected a JSON request body."), { status: 400 });
  }
}

export function outfitGalleryApi(options = {}) {
  let manifestFile;
  let libraryFile;
  let feedbackFile;
  let outfitAssetDir;
  let feedbackWriteQueue = Promise.resolve();

  async function saveFeedback(feedback) {
    await mkdir(path.dirname(feedbackFile), { recursive: true });
    const temporary = `${feedbackFile}.tmp`;
    await writeFile(temporary, `${JSON.stringify(feedback, null, 2)}\n`);
    await rename(temporary, feedbackFile);
  }

  function updateFeedback(mutator) {
    const update = feedbackWriteQueue.then(async () => {
      const feedback = await readJson(feedbackFile, { version: 1, ratings: {} });
      feedback.version = 1;
      feedback.ratings = feedback.ratings && typeof feedback.ratings === "object" ? feedback.ratings : {};
      const result = await mutator(feedback);
      await saveFeedback(feedback);
      return result;
    });
    feedbackWriteQueue = update.catch(() => {});
    return update;
  }

  async function handler(req, res, next) {
    const url = new URL(req.url, "http://localhost");

    if (url.pathname === OUTFITS_API && req.method === "GET") {
      try {
        const [manifest, library, feedback] = await Promise.all([
          readJson(manifestFile, { version: 1, outfits: [] }),
          readJson(libraryFile, []),
          readJson(feedbackFile, { version: 1, ratings: {} }),
        ]);
        const garmentsById = new Map(library.map((item) => [item.id, item]));
        const outfits = Array.isArray(manifest.outfits) ? manifest.outfits : [];

        return json(res, 200, {
          ...manifest,
          outfits: outfits.map((outfit) => {
            const filename = path.basename(outfit.image || `${outfit.id}.png`);
            return {
              ...outfit,
              image: `${OUTFIT_ASSET_ROOT}/${filename}`,
              rating: feedback.ratings?.[outfit.id]?.rating || null,
              garments: (outfit.garmentIds || []).map((id) => {
                const garment = garmentsById.get(id);
                return garment ? { id, name: garment.name, part: garment.part } : { id, name: "Wardrobe piece", part: null };
              }),
            };
          }),
        });
      } catch (error) {
        return json(res, 500, {
          error: "Could not load generated outfits.",
          ...(options.exposeErrors ? { detail: error.message } : {}),
        });
      }
    }

    if (url.pathname === FEEDBACK_API && req.method === "GET") {
      try {
        return json(res, 200, await readJson(feedbackFile, { version: 1, ratings: {} }));
      } catch {
        return json(res, 500, { error: "Could not load outfit feedback." });
      }
    }

    const feedbackMatch = url.pathname.match(/^\/api\/outfit-feedback\/([a-z0-9-]+)$/i);
    if (feedbackMatch && req.method === "PUT") {
      try {
        const id = feedbackMatch[1];
        const input = await body(req);
        if (![null, "up", "down"].includes(input.rating ?? null)) {
          return json(res, 400, { error: "rating must be up, down, or null." });
        }
        const manifest = await readJson(manifestFile, { version: 1, outfits: [] });
        const outfit = manifest.outfits?.find((record) => record.id === id);
        if (!outfit) {
          return json(res, 404, { error: "Outfit not found." });
        }

        const rating = input.rating ?? null;
        const saved = await updateFeedback((feedback) => {
          if (rating === null) delete feedback.ratings[id];
          else {
            feedback.ratings[id] = {
              rating,
              updatedAt: new Date().toISOString(),
              outfit: {
                id: outfit.id,
                name: outfit.name,
                occasion: outfit.occasion || [],
                styleArchetype: outfit.styleArchetype || null,
                styleSignals: outfit.styleSignals || [],
                garmentIds: outfit.garmentIds || [],
                reason: outfit.reason || "",
              },
            };
          }
          return feedback.ratings[id] || null;
        });
        return json(res, 200, { id, rating, feedback: saved });
      } catch (error) {
        return json(res, error.status || 500, { error: error.status ? error.message : "Could not save outfit feedback." });
      }
    }

    const assetMatch = url.pathname.match(/^\/api\/import\/outfits\/([\w.-]+\.png)$/i);
    if (assetMatch && req.method === "GET") {
      try {
        const file = path.join(outfitAssetDir, path.basename(assetMatch[1]));
        await stat(file);
        res.statusCode = 200;
        res.setHeader("Content-Type", "image/png");
        res.setHeader("Cache-Control", "no-store");
        return res.end(await readFile(file));
      } catch (error) {
        if (error.code === "ENOENT") return json(res, 404, { error: "Outfit image not found." });
        return json(res, 500, { error: "Could not load outfit image." });
      }
    }

    return next();
  }

  return {
    name: "wardrobe-outfit-gallery-api",
    apply: "serve",
    configResolved(config) {
      const dataDir = path.resolve(config.root, options.dataDir || "data");
      manifestFile = path.join(dataDir, "outfits.json");
      libraryFile = path.join(dataDir, "library.json");
      feedbackFile = path.join(dataDir, "outfit-feedback.json");
      outfitAssetDir = path.join(dataDir, "outfit-images");
    },
    configureServer(server) { server.middlewares.use(handler); },
    configurePreviewServer(server) { server.middlewares.use(handler); },
  };
}
