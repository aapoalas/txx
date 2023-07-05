import {
  dirname,
  fromFileUrl,
  resolve,
} from "https://deno.land/std@0.170.0/path/mod.ts";
import { build } from "../lib/mod.ts";
import { AbsoluteFilePath } from "../lib/types.d.ts";

const TESTS_BASE_PATH = dirname(
  fromFileUrl(import.meta.url),
) as AbsoluteFilePath;
const OUTPUT_PATH = resolve(TESTS_BASE_PATH, "output") as AbsoluteFilePath;

Deno.test("std::function", async (t) => {
  Deno.mkdirSync(OUTPUT_PATH, { recursive: true });
  build({
    basePath: TESTS_BASE_PATH,
    files: [`${TESTS_BASE_PATH}/std_function.h`],
    imports: [{
      kind: "class",
      constructors: true,
      destructors: true,
      methods: true,
      name: "MyClass",
    }, {
      kind: "var",
      name: "kValue",
    }],
    include: [TESTS_BASE_PATH, "/lib64/clang/15.0.7/include"],
    outputPath: OUTPUT_PATH,
  });
  await t.step("nullary", async (_t) => {
  });
});
