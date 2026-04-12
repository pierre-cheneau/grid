// LLM provider abstraction for the forge command.
//
// Detects which provider the user has configured via environment variables
// and calls the appropriate API. Uses Node's built-in fetch (stable since v18).
// No new dependencies.

export interface LLMProvider {
  readonly name: string;
  generate(prompt: string): Promise<string>;
}

function anthropicProvider(apiKey: string): LLMProvider {
  return {
    name: 'Anthropic',
    async generate(prompt: string): Promise<string> {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4096,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Anthropic API error ${res.status}: ${body.slice(0, 200)}`);
      }
      const data = (await res.json()) as { content: Array<{ text: string }> };
      return data.content[0]?.text ?? '';
    },
  };
}

function openaiProvider(apiKey: string, baseUrl?: string): LLMProvider {
  const url = baseUrl ?? 'https://api.openai.com/v1';
  const name = baseUrl ? 'OpenAI-compatible' : 'OpenAI';
  return {
    name,
    async generate(prompt: string): Promise<string> {
      const res = await fetch(`${url}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          max_tokens: 4096,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`${name} API error ${res.status}: ${body.slice(0, 200)}`);
      }
      const data = (await res.json()) as {
        choices: Array<{ message: { content: string } }>;
      };
      return data.choices[0]?.message.content ?? '';
    },
  };
}

function groqProvider(apiKey: string): LLMProvider {
  return {
    name: 'Groq',
    async generate(prompt: string): Promise<string> {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          max_tokens: 4096,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Groq API error ${res.status}: ${body.slice(0, 200)}`);
      }
      const data = (await res.json()) as {
        choices: Array<{ message: { content: string } }>;
      };
      return data.choices[0]?.message.content ?? '';
    },
  };
}

function ollamaProvider(host: string): LLMProvider {
  return {
    name: 'Ollama',
    async generate(prompt: string): Promise<string> {
      const res = await fetch(`${host}/api/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'llama3.1',
          prompt,
          stream: false,
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Ollama error ${res.status}: ${body.slice(0, 200)}`);
      }
      const data = (await res.json()) as { response: string };
      return data.response ?? '';
    },
  };
}

/** Detect which provider the user has configured. Returns null if none. */
export function detectProvider(): LLMProvider | null {
  const anthropic = process.env['ANTHROPIC_API_KEY'];
  if (anthropic) return anthropicProvider(anthropic);

  const openai = process.env['OPENAI_API_KEY'];
  if (openai) return openaiProvider(openai);

  const groq = process.env['GROQ_API_KEY'];
  if (groq) return groqProvider(groq);

  const ollama = process.env['OLLAMA_HOST'];
  if (ollama) return ollamaProvider(ollama);

  return null;
}

/** Print a friendly help message when no provider is detected. */
export function printProviderHelp(): void {
  process.stderr.write(`
forge needs an LLM to write your daemon. set one of these and try again:

  ANTHROPIC_API_KEY  — get one at console.anthropic.com
  OPENAI_API_KEY     — get one at platform.openai.com
  GROQ_API_KEY       — get one at console.groq.com
  OLLAMA_HOST        — install Ollama locally for free, no key needed
                       https://ollama.com

forge calls the LLM directly from your machine. no GRID infrastructure is
involved. your description and the daemon code never touch any GRID server,
because there is no GRID server.
`);
}
