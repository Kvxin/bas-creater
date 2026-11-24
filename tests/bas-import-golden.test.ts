import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { convertParsedBas } from "../src/utils/basImport";
import { parseBas } from "./helpers/basParser";
import { assertGolden, stabilizeImport, toGoldenJson } from "./helpers/golden";

const fixtureDir = path.resolve(import.meta.dirname, "fixtures/bas-import");
const fixtureNames = fs
  .readdirSync(fixtureDir)
  .filter((file) => file.endsWith(".bas"))
  .map((file) => file.slice(0, -".bas".length))
  .sort();

for (const name of fixtureNames) {
  test(`bas import golden: ${name}`, () => {
    const source = fs.readFileSync(path.join(fixtureDir, `${name}.bas`), "utf8");
    const result = stabilizeImport(convertParsedBas(parseBas(source)));
    assertGolden(path.join(fixtureDir, `${name}.json`), toGoldenJson(result));
  });
}
