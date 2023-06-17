# txx

Unsafe interop between Deno FFI and C++

The library is currently only tested and supported on Linux.

## Usage

The only entry point to the library is the `build` function exported from the
`mod.ts` file. It is called with an `ExportConfiguration` object which
determines from where, what and where to the txx build should generate bindings.

The txx build generates up to three TypeScript files per header file:

1. Types file exports struct, enum, and typedef definitions in Deno FFI format.
   The types file is always named `header.h.types.ts`.
2. Exports file exports only the Deno FFI function and variable bindings. The
   exports file is always named `header.h.ts`.
3. Classes file exports TypeScript class definitions of C++ classes. The class
   file is always named `header.h.classes.ts`.

The TypeScript files for each header are generated in the equivalent directory
location of the source header, relative to the `basePath` configuration. The
contents of the header files are determined by the `imports` configuration and
what those configured imports require for full functionality. Additionally the
build generates an `ffi.ts` file that exports all the loaded FFI bindings. The
library import path for the `Deno.dlopen()` call is a static string that has no
chance of working and must be changed manually after the build has completed.

After the build, the files should fully type-check with 0 errors. The bindings
should be usable as is except for the aforementioned library import path and the
TypeScript class definitions exported from classes files should provide a
type-safe entry point to the raw FFI bindings for further development. Note that
it is not safe to expose the raw classes to users: The classes extend
`Uint8Array` and thus they always carry a "mutable reference" to the class data
with them. Their APIs are always perhaps type-safe but they are definitely not
safe from bad JavaScript or `--no-check` usage: Allowing users free reign to
these classes will lead to segmentation faults and memory corruption. It is
always best to write a safe wrapping layer over the raw classes; preferably keep
the raw classes entirely hidden by way of JavaScript private class properties
and/or internal Symbol slots.

See `examples/basic_usage.ts` for a simple example of usage.

## `ExportConfiguration`

### `basePath`

This base path determines the path that the build considers to be the "root" of
all header files. When header files get translated to TypeScript files, the
output files are written into an equivalent directory path as the original
header file was in relative to the base path.

If a header file gets included from outside the base path, then its contents get
rolled into special "system" output files at the root of the output path.
Generally these system output files only include helper functions and C++ `std`
library definitions. If you find that your build generates large amounts of
definitions in the system files, your base path is likely too "low" in your
header directory.

### `outputPath`

This output path determines the path into which output files are written.

Notable output files are `${outputPath}/ffi.ts` which includes the
`Deno.dlopen()` call and exports all of the bindings from it, as well as
`${outputPath}/systemTypes.ts` which includes helper functions and (usually) C++
`std` library definitions.

### `imports`

This array defines which entries from the headers should be generated into the
bindings.

The currently supported imports are classes and functions. Variables (statics /
constants) are also mentioned in the types but are not yet supported by the
library.

Functions are fairly simple: Binding a function means that all of its parameter
types and its result type get generated in the output. The function is bound and
exported from the `${outputPath}/ffi.ts` file.

Classes are the most interesting thing here: Using the configuration you can
choose if and how constructors, destructors and methods are wanted in the
output. All function-like entries defined in this way include their parameter
types and result type in the generated output. Additionally, the class itself is
generated as a TypeScript class extending `Uint8Array` (or a base class if the
class inherits another class). These class definitions will include any wanted
constructors as static methods that return an instance of the class. As a result
your raw class usage will look something like this:

```ts
const u32 = 12;
const classEntry = MyClass.Constructor(u32);

classEntry.print(); // Calls the C++ method `lib::myClass::print()`

classEntry.delete(); // Calls the C++ destructor `lib::MyClass::~MyClass()`
```

### `files`

This array of files determines which headers are initially included into the
build. The list gets turned into a temporary header file of include commands,
which is then given to Clang as the entry point.

### `include`

This array of directories is the list of include paths given to Clang. It
determines where Clang will look for any included headers and in what order.

This list should include the same folders that the normal build of this dynamic
library done with as well as your Clang's C++ standard library headers
directory.

## Features

- Functions
- Classes
- Class inheritance
- Structs
- Enums
- Typedefs
- Basic class templates
- Partial class specializations (only partially done)

## Not yet supported

- Statics / constants (variables)
- Full heuristics for buffer vs pointer types for class references
- Deno-side inheritance of C++ classes
- Template aliases
- Namespaces with overlapping definitions: All namespaces are collapsed into
  one.
- Multiple inheritance
- Windows, Mac OS X
