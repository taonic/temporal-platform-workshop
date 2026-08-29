# The control plane, as an image.
#
# Built with the repo root as its context, like services/state. The Terraform
# module travels inside the binary via terraform/embed.go, so there is no
# checkout to mount and no module directory to keep in sync with the pod -- which
# is the reason that embed exists.
#
# The cost of that is the inner loop: a student who edits terraform/namespace or
# internal/platform must rebuild this image and restart the Deployment before the
# change is live. `make reload` is that loop; see the Makefile.
FROM golang:1.25-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/platform-worker ./cmd/platform-worker

# Terraform is a subprocess of the activity, so it has to be in the image. Alpine
# rather than distroless for exactly that reason: the provider plugin needs a
# libc and a writable scratch dir, and distroless gives it neither.
FROM alpine:3.20
RUN apk add --no-cache ca-certificates git

# TARGETARCH is filled in by buildkit and uses the same names HashiCorp does
# (amd64, arm64). Hardcoding amd64 here "works" on an Apple Silicon Mac only
# because Docker Desktop has QEMU binfmt enabled, so every terraform call in
# every activity runs emulated -- and on k3d or any arm64 host without binfmt it
# is an exec format error instead. Rule 8 in DESIGN.md is why this matters.
ARG TF_VERSION=1.9.8
ARG TARGETARCH
RUN wget -qO /tmp/tf.zip "https://releases.hashicorp.com/terraform/${TF_VERSION}/terraform_${TF_VERSION}_linux_${TARGETARCH}.zip" \
 && unzip -q /tmp/tf.zip -d /usr/local/bin && rm /tmp/tf.zip

# Warm the provider cache at build time, for the same reason the sandbox does it:
# a cold init against temporalio/temporalcloud is a two-minute stall that looks
# like a hung workflow.
ENV TF_PLUGIN_CACHE_DIR=/var/cache/terraform/plugins
RUN mkdir -p "$TF_PLUGIN_CACHE_DIR" && printf 'plugin_cache_dir = "%s"\n' "$TF_PLUGIN_CACHE_DIR" > /root/.terraformrc

COPY --from=build /out/platform-worker /usr/local/bin/platform-worker
WORKDIR /var/lib/platform
ENTRYPOINT ["/usr/local/bin/platform-worker"]
