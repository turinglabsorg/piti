import { describe, it, expect, vi } from "vitest";
import { createAuthMiddleware } from "../../packages/gateway/src/bot/middleware/auth.js";

// Minimal mock for Telegraf context
function mockCtx(telegramId: number, username?: string) {
  return {
    from: { id: telegramId, username },
    reply: vi.fn(),
  } as any;
}

describe("Auth Middleware", () => {
  it("allows all users when TELEGRAM_ALLOWED_USERS is empty", async () => {
    const middleware = createAuthMiddleware("");
    const next = vi.fn();

    await middleware(mockCtx(12345, "alice"), next);
    expect(next).toHaveBeenCalled();

    await middleware(mockCtx(99999, "bob"), vi.fn().mockImplementation(() => {}));
  });

  it("allows listed users when restriction is set", async () => {
    const middleware = createAuthMiddleware("12345,67890");
    const next = vi.fn();

    await middleware(mockCtx(12345), next);
    expect(next).toHaveBeenCalled();
  });

  it("blocks unlisted users when restriction is set", async () => {
    const middleware = createAuthMiddleware("12345,67890");
    const ctx = mockCtx(99999, "hacker");
    const next = vi.fn();

    await middleware(ctx, next);
    expect(next).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining("not authorized")
    );
  });

  it("handles spaces in comma-separated list", async () => {
    const middleware = createAuthMiddleware(" 12345 , 67890 , 11111 ");
    const next = vi.fn();

    await middleware(mockCtx(67890), next);
    expect(next).toHaveBeenCalled();
  });

  it("handles single user restriction", async () => {
    const middleware = createAuthMiddleware("12345");
    const next1 = vi.fn();
    const next2 = vi.fn();

    await middleware(mockCtx(12345), next1);
    expect(next1).toHaveBeenCalled();

    const ctx = mockCtx(99999);
    await middleware(ctx, next2);
    expect(next2).not.toHaveBeenCalled();
  });

  it("skips if no from.id", async () => {
    const middleware = createAuthMiddleware("12345");
    const next = vi.fn();
    const ctx = { from: undefined, reply: vi.fn() } as any;

    await middleware(ctx, next);
    // Should not call next or reply — just bail
    expect(next).not.toHaveBeenCalled();
    expect(ctx.reply).not.toHaveBeenCalled();
  });
});
