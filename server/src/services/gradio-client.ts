import { Client } from "@gradio/client";
import { config } from '../config/index.js';

let clientInstance: Client | null = null;
let connectionPromise: Promise<Client> | null = null;

function normalizeAceStepBase(url: string): string {
  const trimmed = url.replace(/\/+$/, '');
  return trimmed.endsWith('/gradio_api')
    ? trimmed.slice(0, -'/gradio_api'.length)
    : trimmed;
}

async function endpointReturnsJson(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(url, {
      headers: {
        accept: "application/json",
      },
      signal: controller.signal,
    });

    if (!response.ok) return false;
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('json')) {
      const text = await response.text();
      return !text.trim().startsWith('<') && text.trim().startsWith('{');
    }

    const payload = await response.json();
    return typeof payload === "object" && payload !== null;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Get a lazy-initialized Gradio client connected to the ACE-Step Gradio app.
 * Caches the connection for reuse across requests.
 */
export async function getGradioClient(): Promise<Client> {
  if (clientInstance) return clientInstance;
  if (connectionPromise) return connectionPromise;

  connectionPromise = (async () => {
    try {
      const baseUrl = normalizeAceStepBase(config.acestep.apiUrl);
      const available = await isGradioAvailable();
      if (!available) {
        throw new Error(
          `ACE-Step Gradio is not ready at ${baseUrl}. ` +
          'The endpoint is not returning the expected JSON API. Check that the ACE-Step service is fully started and that ACESTEP_API_URL points to the Gradio server instead of an HTML page.'
        );
      }

      const client = await Client.connect(baseUrl, {
        events: ["data", "status"],
      });
      clientInstance = client;
      console.log(`[Gradio] Connected to ${baseUrl}`);
      return client;
    } catch (error) {
      console.error(`[Gradio] Failed to connect to ${normalizeAceStepBase(config.acestep.apiUrl)}:`, error);
      throw error;
    } finally {
      connectionPromise = null;
    }
  })();

  return connectionPromise;
}

/**
 * Reset the cached Gradio client, forcing a new connection on next use.
 */
export function resetGradioClient(): void {
  clientInstance = null;
  connectionPromise = null;
}

/**
 * Check if the Gradio app is reachable.
 * Tries multiple well-known endpoints to handle version differences.
 */
export async function isGradioAvailable(): Promise<boolean> {
  const baseUrl = normalizeAceStepBase(config.acestep.apiUrl);
  const candidates = [
    `${baseUrl}/gradio_api/info`, // Gradio 5+
    `${baseUrl}/info`,            // Gradio 4.x fallback
    `${baseUrl}/config`,          // Gradio config fallback
  ];

  for (const url of candidates) {
    if (await endpointReturnsJson(url)) return true;
  }
  return false;
}
