// Package terraform embeds the modules the reconciler applies.
//
// Embedding rather than shipping a directory means the platform worker is one
// binary with no runtime dependency on a checkout, which matters once it is a
// container image. Ported from temporal-terraform-demo, where the same trick is
// spelled embed.FS.
package terraform

import "embed"

//go:embed namespace/*.tf
var FS embed.FS
