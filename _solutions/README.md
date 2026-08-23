# Solutions

The five files a student writes, complete.

    make solve     put these into the tree
    make unsolve   put the prose stubs back
    make verify    solve, build, test, validate, unsolve

`make verify` is the important one. Solutions rot silently the first time an
interface changes underneath them, and a workshop whose answer key no longer
compiles is worse than one with no answer key.

Both this directory and `_stubs/` begin with an underscore because the Go
toolchain ignores such directories outright. Without that, `go build ./...` would
try to compile three copies of package `platform`.
