import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Git installs omit devDependencies, and bb shims only `@get-bb/plugin-sdk/app`
// in the frontend bundle, so app code must not import the bare SDK at runtime.
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(join(dir, entry.name)) : /\.tsx?$/.test(entry.name) ? [join(dir, entry.name)] : [],
  );

describe("packaging", () => {
  it("keeps runtime imports of the bare SDK out of code the app bundle reaches", () => {
    const offenders = ["app.tsx", ...files("app"), ...files("src")].filter((file) =>
      /^import\s+(?!type\b)[^;]*from\s+"@get-bb\/plugin-sdk";?$/m.test(readFileSync(file, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});
