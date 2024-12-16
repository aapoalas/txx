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
const OUTPUT_PATH = resolve(TESTS_BASE_PATH, "rtmidi_output") as AbsoluteFilePath;

const LIB_BASE_PATH = "/home/stephane/deno/rtmidi/";
Deno.test("std::function", async (t) => {
    Deno.mkdirSync(OUTPUT_PATH, { recursive: true });
    build({
        basePath: LIB_BASE_PATH,
        outputPath: OUTPUT_PATH,
        files: [
            `${TESTS_BASE_PATH}/rtmidi/RtMidi.h`,
        ],
        imports: [
            {
                kind: "class",
                name: "RtMidi",
                constructors: true,
                destructors: true,
                methods: [
                    "getPortCount",
                    "getPortName",
                    "openPort",
                    "closePort"
                ]
            },

        ],
        include: ["/lib64/clang/14.0.6/include"],
    });
    await t.step("nullary", async (_t) => {
    });
});