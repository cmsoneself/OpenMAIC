/**
 * Agnes AI Image Generation Adapter
 *
 * API: POST https://apihub.agnes-ai.com/v1/images/generations
 * Docs: https://agnes-ai.com/doc/agnes-image-20-flash
 *
 * Key differences from OpenAI:
 * 1. Uses `size` field ("WxH" string) instead of separate dimensions
 * 2. response_format goes inside `extra_body`
 * 3. No `n` parameter (always 1 image)
 *
 * Supported models:
 * - agnes-image-2.0-flash
 * - agnes-image-2.1-flash
 */

import type {
  ImageGenerationConfig,
  ImageGenerationOptions,
  ImageGenerationResult,
} from '../types';

const DEFAULT_MODEL = 'agnes-image-2.0-flash';
const DEFAULT_BASE_URL = 'https://apihub.agnes-ai.com/v1';

/** Convert width/height or aspect ratio to "WxH" format. */
function toSizeString(options: ImageGenerationOptions): string {
  if (options.width && options.height) {
    return `${options.width}x${options.height}`;
  }
  // Default size map for aspect ratios at 1024 base width
  const SIZE_MAP: Record<string, string> = {
    '16:9': '1024x576',
    '4:3': '1024x768',
    '1:1': '1024x1024',
    '9:16': '576x1024',
  };
  return SIZE_MAP[options.aspectRatio ?? '1:1'] || '1024x1024';
}

/**
 * Connectivity test — sends a minimal request to validate the API key.
 */
export async function testAgnesImageConnectivity(
  config: ImageGenerationConfig,
): Promise<{ success: boolean; message: string }> {
  const baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  try {
    const response = await fetch(`${baseUrl}/images/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model || DEFAULT_MODEL,
        prompt: 'test',
        size: '1024x1024',
      }),
    });
    if (response.status === 401 || response.status === 403) {
      const text = await response.text();
      return { success: false, message: `Agnes Image auth failed (${response.status}): ${text}` };
    }
    return { success: true, message: 'Connected to Agnes Image' };
  } catch (err) {
    return { success: false, message: `Agnes Image connectivity error: ${err}` };
  }
}

/**
 * Generate an image using Agnes AI Image API.
 */
export async function generateWithAgnesImage(
  config: ImageGenerationConfig,
  options: ImageGenerationOptions,
): Promise<ImageGenerationResult> {
  const baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  const size = toSizeString(options);
  const [width, height] = size.split('x').map(Number);

  const body: Record<string, unknown> = {
    model: config.model || DEFAULT_MODEL,
    prompt: options.prompt,
    size,
    extra_body: {
      response_format: 'url',
    },
  };

  const response = await fetch(`${baseUrl}/images/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Agnes image generation failed (${response.status}): ${text}`);
  }

  const data = (await response.json()) as {
    data?: Array<{ url?: string | null; b64_json?: string | null; revised_prompt?: string | null }>;
  };

  const imageData = data.data?.[0];
  if (!imageData) {
    throw new Error('Agnes returned empty image response');
  }

  return {
    url: imageData.url ?? undefined,
    base64: imageData.b64_json ?? undefined,
    width: width || 1024,
    height: height || 1024,
  };
}
