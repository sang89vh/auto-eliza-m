import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { runLogger } from './logger.js';
import { sleep } from './retry.js';

/**
 * Client for the `music_video_maker` project -- the Mjudio macOS app -- via its
 * loopback automation REST API (music_video_maker/docs/AUTOMATION-API.md).
 *
 * Two facts from that document shape this file:
 *   - The app is sandboxed, so no endpoint accepts a *path*. Audio goes in as
 *     request bytes and the finished mp4 comes back over HTTP.
 *   - The port and bearer token are published in endpoint.json at start-up and the
 *     file is deleted when the app stops, so both are discovered per call rather
 *     than configured. That is why there is no MVM_API_URL setting.
 */

interface Endpoint {
  baseURL: string;
  port: number;
  token: string;
}

export interface MjudioHealth {
  version?: string;
  plan?: string;
  rendererAvailable?: boolean;
  projectCount?: number;
  remainingFreeExports?: number;
}

interface TemplateSummary {
  id: string;
  name: string;
  category?: string;
  premium?: boolean;
}

interface ExportJob {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress?: number;
  errorMessage?: string;
}

export class MjudioUnavailableError extends Error {}

function readEndpoint(): Endpoint {
  const file = config.mvmEndpointFile;
  if (!fs.existsSync(file)) {
    throw new MjudioUnavailableError(
      'Mjudio (music_video_maker) is not running: its automation endpoint.json is missing. ' +
        'Launch Mjudio and turn on Settings ▸ Automation.',
    );
  }
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<Endpoint>;
  if (!parsed.baseURL || !parsed.token) {
    throw new MjudioUnavailableError(`Mjudio endpoint.json at ${file} is missing baseURL or token`);
  }
  // The server refuses a Host header that is not a loopback literal, so keep the
  // numeric address even if the file ever spells it differently.
  return {
    baseURL: parsed.baseURL.replace('localhost', '127.0.0.1'),
    port: parsed.port ?? 8787,
    token: parsed.token,
  };
}

async function call(
  method: string,
  routePath: string,
  options: { json?: unknown; body?: Uint8Array; contentType?: string; timeoutMs?: number; raw?: boolean } = {},
): Promise<unknown> {
  const endpoint = readEndpoint();
  const headers: Record<string, string> = { Authorization: `Bearer ${endpoint.token}` };

  let body: string | Uint8Array | undefined;
  if (options.json !== undefined) {
    body = JSON.stringify(options.json);
    headers['Content-Type'] = 'application/json';
  } else if (options.body) {
    body = options.body;
    headers['Content-Type'] = options.contentType ?? 'application/octet-stream';
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 120_000);

  let response: Response;
  try {
    response = await fetch(`${endpoint.baseURL}${routePath}`, {
      method,
      headers,
      body,
      signal: controller.signal,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    // A refused connection is authoritative "not running"; a stale endpoint.json is not.
    throw new MjudioUnavailableError(`Mjudio request ${method} ${routePath} failed: ${detail}`);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    let code = '';
    let message = text;
    try {
      const parsed = JSON.parse(text) as { error?: string; message?: string };
      code = parsed.error ?? '';
      message = parsed.message ?? text;
    } catch {
      // keep the raw body
    }
    throw new Error(`Mjudio ${method} ${routePath} -> ${response.status} ${code}: ${message}`.trim());
  }

  if (options.raw) return new Uint8Array(await response.arrayBuffer());
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

export async function health(): Promise<MjudioHealth> {
  return (await call('GET', '/v1/health', { timeoutMs: 15_000 })) as MjudioHealth;
}


// Categories whose visual style suits calm instrumental piano: cozy/ambient rather
// than the energetic edm/hiphop templates, or lyric/podcast layouts built for content
// this pipeline never has (synced lyrics, spoken word).
const CALM_CATEGORIES = ['lofi', 'acoustic'];

let cachedTemplatePool: TemplateSummary[] | null = null;
let lastPickedTemplateId: string | null = null;
let cachedBackgrounds: string[] | null = null;
let lastPickedBackground: string | null = null;

const BACKGROUND_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

/**
 * A random backdrop per clip, from BACKGROUND_DIR. Returns null when there is nothing to
 * send, which leaves the Mjudio template's own backdrop in place -- the same behaviour as
 * before this folder existed. Like the template pick, the directory is read once and only
 * the choice is re-rolled, and the previous pick is avoided so neighbouring sections of a
 * merged video differ.
 */
export function pickBackground(): string | null {
  if (!cachedBackgrounds) {
    let files: string[] = [];
    try {
      files = fs
        .readdirSync(config.backgroundDir)
        .filter((name) => BACKGROUND_EXTENSIONS.has(path.extname(name).toLowerCase()))
        .map((name) => path.join(config.backgroundDir, name))
        .sort();
    } catch {
      files = [];
    }
    // The single-file setting stays supported for anyone who never made a folder.
    if (files.length === 0 && fs.existsSync(config.backgroundImagePath)) {
      files = [config.backgroundImagePath];
    }
    cachedBackgrounds = files;
    runLogger.info(
      files.length > 0
        ? `Background pool: ${files.length} image(s) from ${config.backgroundDir}`
        : 'No background images found; the Mjudio template backdrop will be used',
    );
  }

  const pool = cachedBackgrounds;
  if (pool.length === 0) return null;
  const candidates = pool.length > 1 ? pool.filter((file) => file !== lastPickedBackground) : pool;
  const chosen = candidates[Math.floor(Math.random() * candidates.length)] ?? pool[0]!;
  lastPickedBackground = chosen;
  return chosen;
}

/**
 * Picks a template at random for a *single clip*, so one merged video cycles through
 * several looks rather than repeating one for hours. The catalogue is fetched once and
 * reused -- only the choice is re-rolled -- and the immediately preceding pick is
 * excluded so neighbouring sections of the merged video never share a look.
 */
export async function pickTemplate(): Promise<string | undefined> {
  if (config.mvmTemplateId) return config.mvmTemplateId;

  if (!cachedTemplatePool) {
    const templates = (await call('GET', '/v1/templates', { timeoutMs: 30_000 })) as TemplateSummary[];
    const plan = await health().catch(() => null);
    // A premium template is refused on the free plan, so only offer those when entitled.
    const usable = plan?.plan === 'premium' ? templates : templates.filter((template) => !template.premium);
    const calm = usable.filter((template) => CALM_CATEGORIES.includes(template.category ?? ''));
    cachedTemplatePool = calm.length > 0 ? calm : usable;
    runLogger.info(
      `Mjudio template pool: ${cachedTemplatePool.length} candidate(s) ` +
        `(${cachedTemplatePool.map((template) => template.id).join(', ')})`,
    );
  }

  const pool = cachedTemplatePool;
  if (pool.length === 0) return undefined;
  const candidates = pool.length > 1 ? pool.filter((template) => template.id !== lastPickedTemplateId) : pool;
  const chosen = candidates[Math.floor(Math.random() * candidates.length)];

  if (chosen) {
    lastPickedTemplateId = chosen.id;
    runLogger.info(`Mjudio template: ${chosen.name} (${chosen.id})`);
  }
  return chosen?.id;
}

/** Exports are queued app-wide and the free plan refuses to even queue a second one. */
let exportChain: Promise<unknown> = Promise.resolve();

function serialize<T>(task: () => Promise<T>): Promise<T> {
  const next = exportChain.then(task, task);
  exportChain = next.catch(() => undefined);
  return next;
}

export interface ConvertOptions {
  /** Project/layer name. Never an original song title -- the naming policy applies here too. */
  projectName: string;
  outputPath: string;
  /** Usually from pickTemplate(). Omit to let this call roll its own random choice. */
  templateId?: string;
  /** Backdrop to send as artwork. Omit to let this call roll its own from BACKGROUND_DIR. */
  backgroundPath?: string;
}

/**
 * Asset C wrapper: one .wav in, one .mp4 out.
 *
 * Serialised because Mjudio runs a single export at a time app-wide.
 */
export function convertWavToMp4(wavPath: string, options: ConvertOptions): Promise<string> {
  return serialize(() => convertWavToMp4Inner(wavPath, options));
}

async function convertWavToMp4Inner(wavPath: string, options: ConvertOptions): Promise<string> {
  if (!fs.existsSync(wavPath)) throw new Error(`Audio file not found: ${wavPath}`);

  const templateID = options.templateId ?? (await pickTemplate());
  const created = (await call('POST', '/v1/projects', {
    json: { name: options.projectName, templateID, aspectRatio: 'landscape16x9' },
    timeoutMs: 60_000,
  })) as { id: string; layers?: Array<{ id: string; kind: string; name?: string; text?: string }> };

  const projectId = created.id;

  try {
    // The audio call blocks while the FFT analysis is cached; without it every
    // visualizer renders flat, so the long timeout is deliberate.
    const filename = path.basename(wavPath);
    await call('PUT', `/v1/projects/${projectId}/audio?filename=${encodeURIComponent(filename)}`, {
      body: new Uint8Array(fs.readFileSync(wavPath)),
      timeoutMs: 30 * 60_000,
    });

    const artworkPath = options.backgroundPath ?? pickBackground();
    if (artworkPath) {
      const artworkName = path.basename(artworkPath);
      await call('PUT', `/v1/projects/${projectId}/artwork?filename=${encodeURIComponent(artworkName)}`, {
        body: new Uint8Array(fs.readFileSync(artworkPath)),
        timeoutMs: 5 * 60_000,
      });
    }

    // Templates commonly carry a second text layer (seen as "Subtitle", shipping with
    // literal placeholder text like "Artist Name") alongside the title. The pipeline
    // has no artist to put there -- Suno tracks are AI-generated, not attributed to a
    // performer -- so every text layer other than the title is hidden rather than left
    // to render its raw template placeholder into the final video.
    const textLayers = created.layers?.filter((layer) => layer.kind === 'text') ?? [];
    const titleLayer = textLayers.find((layer) => layer.name?.trim().toLowerCase() === 'title') ?? textLayers[0];
    if (titleLayer) {
      await call('PATCH', `/v1/projects/${projectId}/layers/${titleLayer.id}`, {
        json: { text: options.projectName },
        timeoutMs: 60_000,
      });
    }
    for (const layer of textLayers) {
      if (layer.id === titleLayer?.id) continue;
      await call('PATCH', `/v1/projects/${projectId}/layers/${layer.id}`, {
        json: { hidden: true },
        timeoutMs: 60_000,
      });
    }

    const job = (await call('POST', `/v1/projects/${projectId}/exports`, {
      json: {
        resolution: config.mvmResolution,
        frameRate: config.mvmFrameRate,
        codec: config.mvmCodec,
        fileName: path.basename(options.outputPath),
      },
      timeoutMs: 60_000,
    })) as ExportJob;

    const finished = await waitForExport(job.id);
    if (finished.status !== 'completed') {
      throw new Error(`Mjudio export ${finished.status}: ${finished.errorMessage ?? 'no detail'}`);
    }

    const bytes = (await call('GET', `/v1/exports/${job.id}/file`, {
      raw: true,
      timeoutMs: 30 * 60_000,
    })) as Uint8Array;

    fs.mkdirSync(path.dirname(options.outputPath), { recursive: true });
    fs.writeFileSync(options.outputPath, bytes);

    // The container is not self-cleaning.
    await call('DELETE', `/v1/exports/${job.id}`, { timeoutMs: 60_000 }).catch(() => undefined);
    return options.outputPath;
  } finally {
    await call('DELETE', `/v1/projects/${projectId}`, { timeoutMs: 60_000 }).catch(() => undefined);
  }
}

async function waitForExport(jobId: string, timeoutMs = 60 * 60_000): Promise<ExportJob> {
  const deadline = Date.now() + timeoutMs;
  let lastProgress = -1;

  while (Date.now() < deadline) {
    const job = (await call('GET', `/v1/exports/${jobId}`, { timeoutMs: 30_000 })) as ExportJob;
    if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') return job;

    const percent = Math.round((job.progress ?? 0) * 100);
    if (percent >= lastProgress + 20) {
      runLogger.info(`Mjudio export ${jobId.slice(0, 8)}: ${job.status} ${percent}%`);
      lastProgress = percent;
    }
    await sleep(2000);
  }

  await call('DELETE', `/v1/exports/${jobId}`, { timeoutMs: 30_000 }).catch(() => undefined);
  throw new Error(`Mjudio export ${jobId} did not finish within ${Math.round(timeoutMs / 60_000)} minutes`);
}
