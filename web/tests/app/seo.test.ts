import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { SITE_URL } from "../../src/brand";

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const html = read("index.html");

describe("SEO basics", () => {
  it("has a title, a description of search-snippet length, and a canonical on the brand domain", () => {
    expect(html.match(/<title>([^<]+)<\/title>/)![1].length).toBeLessThanOrEqual(65);
    const desc = html.match(/name="description" content="([^"]+)"/)![1];
    expect(desc.length).toBeGreaterThan(70);
    expect(desc.length).toBeLessThanOrEqual(175);
    expect(html).toContain(`<link rel="canonical" href="${SITE_URL}/" />`);
  });

  it("shares a large card whose image exists", () => {
    expect(html).toContain('name="twitter:card" content="summary_large_image"');
    const img = html.match(/property="og:image" content="([^"]+)"/)![1];
    expect(img.startsWith(SITE_URL)).toBe(true);
    expect(() => readFileSync(join(root, "public", img.slice(SITE_URL.length)))).not.toThrow();
  });

  it("ships valid JSON-LD without invented ratings", () => {
    const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1]);
    const types = ld["@graph"].map((n: { "@type": string }) => n["@type"]);
    expect(types).toEqual(["WebSite", "WebApplication"]);
    expect(JSON.stringify(ld)).not.toMatch(/aggregateRating|review/i);
  });

  it("gives crawlers text content inside #app", () => {
    const app = html.match(/<div id="app">([\s\S]*?)<\/div>\s*<script type="module"/)![1];
    expect(app).toMatch(/<h1>/);
    expect(app.replace(/<[^>]+>/g, "").length).toBeGreaterThan(400);
  });

  it("robots.txt points to a sitemap whose pages all exist, are canonical and are linked from the home page", () => {
    expect(read("public/robots.txt")).toContain(`Sitemap: ${SITE_URL}/sitemap.xml`);
    const urls = [...read("public/sitemap.xml").matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(urls[0]).toBe(`${SITE_URL}/`);
    expect(urls.length).toBeGreaterThan(1);
    for (const u of urls.slice(1)) {
      const path = u.slice(SITE_URL.length);
      const page = read(`public${path}index.html`);
      expect(page).toContain(`<link rel="canonical" href="${u}">`);
      expect(page).toMatch(/<h1>[^<]+<\/h1>/);
      expect(html).toContain(`href="${path}"`);
    }
  });

  it("keeps the 404 page out of the index", () => {
    expect(read("public/404.html")).toContain('name="robots" content="noindex"');
  });
});
