package workerconfig

// The schema is authored once at schema/workerconfig.schema.json and copied here
// so it can be embedded -- go:embed cannot reach outside its own package
// directory, and cannot follow symlinks. `make sync-schema` keeps the copy honest
// and a test fails if it drifts.
//
//go:generate cp ../../schema/workerconfig.schema.json schema/workerconfig.schema.json
