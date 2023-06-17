#!/usr/bin/env -S deno run --unstable --allow-env=LIBCLANG_PATH --allow-ffi --allow-write

import { build } from "../lib/mod.ts";

const LIB_BASE_PATH = "/path/to/sources/";

build({
  basePath: LIB_BASE_PATH,
  outputPath: "/path/to/output",
  files: [
    `${LIB_BASE_PATH}some/header.h`,
    `${LIB_BASE_PATH}another/deeper/header.h`,
  ],
  imports: [
    {
      kind: "class",
      name: "DataClass",
      constructors: true,
      destructors: true,
      methods: false,
    },
    {
      kind: "class",
      name: "MyClass",
      constructors: true,
      destructors: true,
      methods: [
        "methodA",
        "methodB",
      ],
    },
  ],
  include: [
    `${LIB_BASE_PATH}some`,
    `${LIB_BASE_PATH}another`,
    "/lib64/clang/14.0.6/include",
  ],
});
