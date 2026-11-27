// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { TokenPayload } from 'google-auth-library';
import { createAIService } from '../../server/ai';
import type { AISession } from '../types/ai';

const now = 1_800_000_000_000;
const host = 'localhost:5173';
const clientId = 'test-client.apps.googleusercontent.com';
const book = { id: 'B023', title: 'Giải Một Bài Toán Như Thế Nào', author: 'George Pólya', category: 'Toán học & Tư duy', description: 'Phương pháp giải bài toán.', available_copies: 2, shelf: 'B1-01' };
const providerReply = (ids = ['B023']) => new Response(JSON.stringify({ status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text: JSON.stringify({ text: 'Mình tìm được sách giúp bạn học toán.', bookIds: ids, query: 'toán', suggestions: ['Còn sách nào khác không?'] }) }] }] }), { status: 200 });

async function setup(fetcher = vi.fn<typeof fetch>().mockResolvedValue(providerReply())) {
  let nonce = '';
  const verifier = vi.fn(async (_token: string, _audience: string) => ({ sub: 'google-123', name: 'Google Reader', email: 'private@example.test', email_verified: true, aud: clientId, iss: 'https://accounts.google.com', exp: now / 1000 + 3600, iat: now / 1000, nonce }) as TokenPayload);
  const service = createAIService({ apiKey: 'test-api-key', googleClientId: clientId }, { fetch: fetcher, verifyGoogleToken: verifier, now: () => now });
  const initial = await service({ method: 'GET', path: '/api/ai/session', host });
  nonce = (initial.body as AISession).csrfToken;
  const csrfCookie = `libmate_csrf=${nonce}`;
  const base = { host, origin: `http://${host}`, cookie: csrfCookie, csrf: nonce };
  const login = await service({ ...base, method: 'POST', path: '/api/ai/session', body: { credential: 'google-id-token' } });
  const sessionCookie = String(login.headers?.['Set-Cookie']).split(';')[0];
  const loggedIn = { ...base, cookie: `${csrfCookie}; ${sessionCookie}` };
  return { service, fetcher, verifier, initial, login, base, loggedIn };
}

describe('Google sign-in and Gemini server', () => {
  it('xác minh token ở máy chủ và tạo cookie HttpOnly; không trả API key hay ID token về trình duyệt', async () => {
    const { verifier, initial, login } = await setup();
    expect(verifier).toHaveBeenCalledWith('google-id-token', clientId);
    expect(login.status).toBe(200);
    expect(login.headers?.['Set-Cookie']).toContain('HttpOnly; SameSite=Strict');
    expect((login.body as AISession).user?.id).toBe('google-123');
    expect(JSON.stringify([initial.body, login.body])).not.toContain('test-api-key');
    expect(JSON.stringify(login.body)).not.toContain('google-id-token');
  });

  it('chặn gọi AI khi chưa đăng nhập Google, dù đã có API key', async () => {
    const { service, fetcher, base } = await setup();
    const result = await service({ ...base, method: 'POST', path: '/api/ai/chat', body: { message: 'học toán', catalog: [book] } });
    expect(result.status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('chặn yêu cầu giả mạo origin hoặc CSRF', async () => {
    const { service, fetcher, loggedIn } = await setup();
    const input = { ...loggedIn, method: 'POST', path: '/api/ai/chat', body: { message: 'học toán', catalog: [book] } };
    expect((await service({ ...input, origin: 'https://evil.example' })).status).toBe(403);
    expect((await service({ ...input, csrf: 'a'.repeat(64) })).status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('không chấp nhận token sai nonce hoặc hết hạn', async () => {
    const { service, verifier, base } = await setup();
    verifier.mockResolvedValueOnce({ sub: 'fake', email_verified: true, exp: now / 1000 + 3600, nonce: 'incorrect' } as TokenPayload);
    expect((await service({ ...base, method: 'POST', path: '/api/ai/session', body: { credential: 'bad-token' } })).status).toBe(401);
    verifier.mockResolvedValueOnce({ sub: 'fake', email_verified: true, exp: now / 1000 - 1, nonce: base.csrf } as TokenPayload);
    expect((await service({ ...base, method: 'POST', path: '/api/ai/session', body: { credential: 'expired-token' } })).status).toBe(401);
  });

  it('gửi yêu cầu Gemini đúng endpoint, chọn sách trong danh mục và không gửi danh tính Google', async () => {
    const { service, fetcher, loggedIn } = await setup();
    const result = await service({ ...loggedIn, method: 'POST', path: '/api/ai/chat', body: { message: 'Em muốn học toán', catalog: [book] } });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ bookIds: ['B023'], model: 'gemini-3.5-flash-lite' });
    expect(fetcher.mock.calls[0][0]).toBe('https://generativelanguage.googleapis.com/v1beta/interactions');
    const sent = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(sent.store).toBe(false);
    expect(sent.response_format.mime_type).toBe('application/json');
    expect(sent.input).toContain('B023');
    expect(sent.input).not.toContain('private@example.test');
    expect(sent.input).not.toContain('Google Reader');
  });

  it('từ chối ID sách bịa, sách đã xem khi hỏi thêm và sách hết bản khi có bộ lọc', async () => {
    for (const [reply, extra] of [
      [providerReply(['UNKNOWN']), {}],
      [providerReply(), { excludeBookIds: ['B023'] }],
      [providerReply(), { onlyAvailable: true, catalog: [{ ...book, available_copies: 0 }] }],
    ] as const) {
      const { service, loggedIn } = await setup(vi.fn<typeof fetch>().mockResolvedValue(reply));
      const result = await service({ ...loggedIn, method: 'POST', path: '/api/ai/chat', body: { message: 'học toán', catalog: [book], ...extra } });
      expect(result.status).toBe(502);
    }
  });

  it('xử lý hết quota và không lộ lỗi hay key từ nhà cung cấp', async () => {
    const { service, loggedIn } = await setup(vi.fn<typeof fetch>().mockResolvedValue(new Response('secret upstream details', { status: 429 })));
    const result = await service({ ...loggedIn, method: 'POST', path: '/api/ai/chat', body: { message: 'học toán', catalog: [book] } });
    expect(result.status).toBe(429);
    expect(result.body).toMatchObject({ code: 'AI_QUOTA' });
    expect(JSON.stringify(result.body)).not.toContain('secret upstream details');
  });

  it('đăng xuất vô hiệu hóa phiên; giả cookie không vượt qua được xác thực', async () => {
    const { service, loggedIn } = await setup();
    await service({ ...loggedIn, method: 'DELETE', path: '/api/ai/session' });
    expect((await service({ ...loggedIn, method: 'POST', path: '/api/ai/chat', body: { message: 'học toán', catalog: [book] } })).status).toBe(401);
  });
});
