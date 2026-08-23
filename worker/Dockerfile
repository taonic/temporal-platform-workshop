# The managed worker image.
#
# Pre-built and imported into k3s during sandbox provisioning, so challenge 4 is
# about config generation and deployment rather than about waiting for a build.
#
# pip rather than uv in here on purpose: uv is worth it for local iteration, but in
# the image it would add a second registry to depend on for no gain, and a sandbox
# that cannot reach ghcr.io is a sandbox that cannot start challenge 4.
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app

# Source before install: dependencies resolve from pyproject.toml, so the versions
# live in exactly one place rather than being restated here.
COPY pyproject.toml ./
COPY platform_sdk ./platform_sdk
COPY workflows ./workflows
RUN pip install --no-cache-dir .

# The shared schema travels with the image, so boot-time validation works in a pod
# where there is no checkout to find it in.
COPY schema/workerconfig.schema.json /etc/worker/workerconfig.schema.json

RUN useradd --uid 10001 --create-home worker
USER 10001

ENTRYPOINT ["python", "-m", "platform_sdk.main"]
CMD ["--config", "/etc/worker/worker-config.json"]
