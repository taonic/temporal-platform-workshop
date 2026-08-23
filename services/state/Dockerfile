FROM golang:1.25-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/tfstate ./services/state

FROM gcr.io/distroless/static-debian12
COPY --from=build /out/tfstate /tfstate
EXPOSE 8080
ENTRYPOINT ["/tfstate"]
