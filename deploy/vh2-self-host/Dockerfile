FROM node:22-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates python3 python3-pil tzdata \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY horde_mcp_bridge.py ./
COPY virtual_humans ./virtual_humans
COPY world-packs ./world-packs

RUN mkdir -p /data/horde-studio && chown -R node:node /data

ENV PYTHONUNBUFFERED=1 \
    HORDE_CONFIG_DIR=/data/horde-studio \
    HORDE_SERVER_LISTEN_HOST=0.0.0.0 \
    HORDE_SERVER_HOST=0.0.0.0 \
    HORDE_SERVER_PORT=8080 \
    HORDE_VH2_REMOTE_MODE=1

VOLUME ["/data"]
EXPOSE 8080
USER node
CMD ["python3", "-u", "horde_mcp_bridge.py"]
