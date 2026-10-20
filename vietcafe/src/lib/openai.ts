import OpenAI from 'openai';
import { config } from './config.js';
import { SYSTEM_PROMPT } from './prompts.js';

export interface SunoPromptVariant {
  variant: number;
  style_prompt: string;
  vocal?: string;
  ambience?: string;
  suggested_bpm?: number;
  key_feel?: string;
}

export interface PromptGenerationResult {
  input?: { song_title?: string; artist?: string; composer?: string };
  analysis?: {
    genre?: string;
    mood?: string;
    tempo_feel?: string;
    harmonic_color?: string;
    summary?: string;
  };
  /** Original Vietnamese lyrics with [Verse]/[Chorus] section tags; shared by both variants. */
  lyrics?: string;
  suno_prompts?: SunoPromptVariant[];
  video_title_suggestion?: string;
  exclude_styles?: string[];
  suno_settings?: { instrumental_mode?: boolean; lyrics_language?: string };
}

let client: OpenAI | null = null;

export function openai(): OpenAI {
  if (!client) {
    if (!config.openaiApiKey) throw new Error('OPENAI_API_KEY is not set');
    client = new OpenAI({ apiKey: config.openaiApiKey });
  }
  return client;
}

/**
 * The multi-line lyrics field invites a failure the piano pipeline never saw: the
 * model intermittently emits raw newlines inside the JSON string instead of \\n,
 * which is illegal JSON. Walk the text and escape control characters that occur
 * inside string literals; everything outside strings is left untouched.
 */
export function escapeControlCharsInStrings(candidate: string): string {
  let result = '';
  let inString = false;
  let escaped = false;
  for (const char of candidate) {
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      } else if (char === '\n') {
        result += '\\n';
        continue;
      } else if (char === '\r') {
        result += '\\r';
        continue;
      } else if (char === '\t') {
        result += '\\t';
        continue;
      }
    } else if (char === '"') {
      inString = true;
    }
    result += char;
  }
  return result;
}

/**
 * The model is asked for bare JSON, but models still occasionally wrap it in a
 * markdown fence, add a sentence around it, or leave raw newlines inside the
 * lyrics string. Recover all three cases before giving up.
 */
export function extractJson(raw: string): PromptGenerationResult {
  const text = raw.trim();

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [fenced?.[1]?.trim(), text].filter((value): value is string => !!value);

  for (const candidate of candidates) {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    const sliced = start !== -1 && end > start ? candidate.slice(start, end + 1) : null;
    for (const attempt of [candidate, sliced, sliced ? escapeControlCharsInStrings(sliced) : null]) {
      if (!attempt) continue;
      try {
        return JSON.parse(attempt) as PromptGenerationResult;
      } catch {
        // fall through to the next attempt
      }
    }
  }

  // Head *and* tail: a stray brace or a truncated completion both show up at the end,
  // and a head-only excerpt made this failure look like truncation when it was not.
  const tail = text.length > 240 ? ` … [last 120 chars] ${text.slice(-120)}` : '';
  throw new Error(`Response was not valid JSON (${text.length} chars): ${text.slice(0, 240)}${tail}`);
}

/** One Chat Completions round trip. Callers own the retry/validation loop. */
export async function generatePrompts(userMessage: string, extraInstructions: string[] = []): Promise<PromptGenerationResult> {
  const content = [userMessage, ...extraInstructions].join('\n\n');

  const response = await openai().chat.completions.create({
    model: config.openaiModel,
    // Constrain the completion to a JSON object at the API level. Without it the model
    // intermittently closes the root object early -- a stray `}` immediately after the
    // multi-line `lyrics` string -- so JSON.parse returns a complete {input, analysis,
    // lyrics} value and rejects the rest as trailing content, burning one retry in
    // roughly one call in ten. The option requires the word "JSON" in the messages,
    // which SYSTEM_PROMPT supplies.
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content },
    ],
  });

  const choice = response.choices[0];
  // A completion cut off at the token limit is also unparseable; report that as its own
  // cause rather than as a malformed response.
  if (choice?.finish_reason === 'length') {
    throw new Error(
      'OpenAI stopped at the output token limit (finish_reason=length) after ' +
        `${response.usage?.completion_tokens ?? '?'} completion tokens, so the JSON is incomplete`,
    );
  }

  const raw = choice?.message?.content ?? '';
  if (!raw.trim()) throw new Error('OpenAI returned an empty message');
  return extractJson(raw);
}

/**
 * Pre-flight. `gpt-5-luna` is the owner's name for the model and may not be the
 * API's string, so this fails loudly and names the model eliza-m actually uses
 * rather than silently substituting one.
 */
export async function verifyModel(): Promise<void> {
  try {
    await openai().models.retrieve(config.openaiModel);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (/404|not.?found|does not exist|model_not_found/i.test(detail)) {
      throw new Error(
        `OPENAI_MODEL="${config.openaiModel}" was rejected by the API. ` +
          'Set OPENAI_MODEL in .env to a model string your key can use — ' +
          'the eliza-m project uses gpt-4.1-2025-04-14.',
      );
    }
    throw new Error(`Could not verify OPENAI_MODEL="${config.openaiModel}": ${detail}`);
  }
}
