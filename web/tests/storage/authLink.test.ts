// Account mails link to our own domain with a one-time token hash. The page must
// recognise such a link, keep the token out of the address bar and tell the account
// page what the link was for; the templates must actually use that link form.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const load = async (search: string, hash = "") => {
  const replaced: string[] = [];
  vi.stubGlobal("window", {
    location: { search, hash, pathname: "/" },
    history: { replaceState: (_s: unknown, _t: string, url: string) => replaced.push(url) },
  });
  vi.resetModules();
  const sync = await import("../../src/storage/sync");
  return { sync, replaced };
};

afterEach(() => vi.unstubAllGlobals());

describe("mail link with token hash", () => {
  it("is recognised and removed from the address bar, other parameters stay", async () => {
    const { sync, replaced } = await load("?token_hash=abc123&type=recovery&ref=x", "#/konto");
    expect(sync.getAuthCallback()).toEqual({ type: "recovery", error: null });
    expect(replaced).toEqual(["/?ref=x#/konto"]);
  });

  it("treats a magic link like a sign-in and ignores unknown types", async () => {
    expect((await load("?token_hash=abc&type=magiclink")).sync.getAuthCallback()?.type).toBe("signup");
    const { sync, replaced } = await load("?token_hash=abc&type=bogus");
    expect(sync.getAuthCallback()).toBeNull();
    expect(replaced).toEqual([]);
  });
});

describe("e-mail templates", () => {
  it.each([
    ["confirm-signup.html", "signup"],
    ["magic-link.html", "magiclink"],
    ["reset-password.html", "recovery"],
    ["change-email.html", "email_change"],
  ])("%s links to our own domain, not to the Supabase verify URL", (file, type) => {
    const html = readFileSync(join(__dirname, "..", "..", "supabase", "email-templates", file), "utf8");
    expect(html).toContain(`{{ .SiteURL }}/?token_hash={{ .TokenHash }}&type=${type}`);
    expect(html).not.toContain("ConfirmationURL");
  });
});
