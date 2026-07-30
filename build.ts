import tailwind from "bun-plugin-tailwind";
import { rm, mkdir, copyFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const outdir = path.join(root, "dist");

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

const result = await Bun.build({
  entrypoints: ["./src/index.ts"],
  outdir,

  plugins: [tailwind],

  target: "bun",
  minify: true,
  sourcemap: "none",

  compile: {
    outfile: path.join(outdir, "ytdl.exe"),
  },

  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
});

if (!result.success) {
  console.error("Build failed:");

  for (const log of result.logs) {
    console.error(log);
  }

  process.exit(1);
}

await copyFile(
  path.join(root, "src", "lib", "cookies_extract.py"),
  path.join(outdir, "cookies_extract.py"),
);

console.log("\nBuild complete.");
console.log(`Executable: ${path.join(outdir, "ytdl.exe")}`);
