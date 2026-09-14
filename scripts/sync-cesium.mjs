import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const sourceRoot = join(root, "node_modules", "cesium", "Build", "Cesium");
const destinationRoot = join(root, "public", "cesium");
const directories = ["Assets", "ThirdParty", "Widgets", "Workers"];

await rm(destinationRoot, { recursive: true, force: true });
await mkdir(destinationRoot, { recursive: true });

for (const directory of directories) {
  await cp(join(sourceRoot, directory), join(destinationRoot, directory), {
    recursive: true,
  });
}

console.log(`Cesium runtime assets copied to ${destinationRoot}`);
