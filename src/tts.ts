import { readEnvFile } from './env.js';

const DEFAULT_MODEL = 'tts-1';
const DEFAULT_VOICE = 'onyx';

export async function synthesizeSpeech(text: string): Promise<Buffer | null> {
  const env = readEnvFile(['OPENAI_API_KEY', 'TTS_VOICE']);
  const apiKey = env.OPENAI_API_KEY;

  if (!apiKey) {
    console.warn('OPENAI_API_KEY not set in .env — cannot synthesize speech');
    return null;
  }

  const voice = env.TTS_VOICE || DEFAULT_VOICE;

  try {
    const openaiModule = await import('openai');
    const OpenAI = openaiModule.default;
    const openai = new OpenAI({ apiKey });

    const response = await openai.audio.speech.create({
      model: DEFAULT_MODEL,
      voice: voice as 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer',
      input: text,
      response_format: 'opus',
    });

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (err) {
    console.error('OpenAI TTS failed:', err);
    return null;
  }
}
