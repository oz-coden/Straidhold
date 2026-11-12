import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
const sections = ["Straidhold Web prototype — third-party runtime notices"];
for (const [folder, entry] of Object.entries(lock.packages)) {
  if (!folder.startsWith("node_modules/") || entry.dev) continue;
  let files;
  try {
    files = await readdir(folder);
  } catch (error) {
    if (entry.optional && error.code === "ENOENT") continue;
    throw error;
  }
  const metadata = JSON.parse(await readFile(join(folder, "package.json"), "utf8"));
  const notices = files.filter((name) => /^(license|licence|notice|copying)(\.|$)/i.test(name));
  const text = await Promise.all(notices.map((name) => readFile(join(folder, name), "utf8")));
  sections.push(`${metadata.name} ${metadata.version} (${metadata.license})\n\n${text.join("\n\n").trim()}`);
}
await writeFile("dist/THIRD-PARTY-NOTICES.txt", sections.join("\n\n----------------------------------------\n\n") + "\n");
