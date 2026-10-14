import 'reflect-metadata';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { AiAnalysisService, buildAnthropicHeaders } from './ai-analysis.service.js';

describe('buildAnthropicHeaders', () => {
  it('includes anthropic-workspace-id only when a workspace is configured', () => {
    const withWorkspace = buildAnthropicHeaders('sk-ant-key', 'wrkspc_123');
    expect(withWorkspace['anthropic-workspace-id']).toBe('wrkspc_123');
    expect(withWorkspace['x-api-key']).toBe('sk-ant-key');
    expect(withWorkspace['anthropic-version']).toBeTruthy();

    expect('anthropic-workspace-id' in buildAnthropicHeaders('sk-ant-key')).toBe(false);
    expect('anthropic-workspace-id' in buildAnthropicHeaders('sk-ant-key', '   ')).toBe(false);
  });
});

describe('AiAnalysisService sends the workspace header on the real request', () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
    vi.unstubAllGlobals();
  });

  it('adds anthropic-workspace-id to the Messages API call when ANTHROPIC_WORKSPACE_ID is set', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
    process.env.ANTHROPIC_WORKSPACE_ID = 'wrkspc_test_123';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        content: [{ type: 'text', text: '{"issues":[],"ai_summary":"clean","risk_assessment":"low"}' }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await new AiAnalysisService().analyze('document', { a: 1 });

    expect(result.llm_unavailable).toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('https://api.anthropic.com/v1/messages');
    expect((init as { headers: Record<string, string> }).headers['anthropic-workspace-id']).toBe(
      'wrkspc_test_123',
    );
  });

  it('fails closed (unavailable, no request) when no API key is configured', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await new AiAnalysisService().analyze('document', { a: 1 });

    expect(result.llm_unavailable).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
