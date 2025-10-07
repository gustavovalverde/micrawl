# syntax=docker/dockerfile:1

ARG NODE_VERSION=22
ARG PNPM_VERSION=10.17.1
ARG WORK_DIR=/app

# Base stage with pnpm installed
FROM node:${NODE_VERSION}-alpine AS base

ARG PNPM_VERSION
ARG WORK_DIR

RUN npm install -g pnpm@${PNPM_VERSION}
WORKDIR ${WORK_DIR}

# Dev dependencies stage - install all dependencies with cache mounts
FROM base AS dev-dependencies

# Copy workspace config with bind mounts for better caching
RUN --mount=type=bind,source=pnpm-workspace.yaml,target=pnpm-workspace.yaml \
    --mount=type=bind,source=package.json,target=package.json \
    --mount=type=bind,source=pnpm-lock.yaml,target=pnpm-lock.yaml \
    --mount=type=bind,source=packages/core/package.json,target=packages/core/package.json \
    --mount=type=bind,source=mcp-server/package.json,target=mcp-server/package.json \
    --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# Production dependencies stage - prune dev dependencies
FROM base AS prod-dependencies

ARG WORK_DIR

COPY --link --from=dev-dependencies ${WORK_DIR}/node_modules ./node_modules
COPY --link pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY --link packages/core/package.json ./packages/core/package.json
COPY --link mcp-server/package.json ./mcp-server/package.json

# Prune dev dependencies with cache mount
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod

# Builder stage - compile TypeScript
FROM base AS builder

ARG WORK_DIR

COPY --link --from=dev-dependencies ${WORK_DIR}/node_modules ./node_modules
COPY --link pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY --link packages/core ./packages/core
COPY --link mcp-server ./mcp-server

# Build core package first
WORKDIR ${WORK_DIR}/packages/core
RUN pnpm run build

# Build MCP server
WORKDIR ${WORK_DIR}/mcp-server
RUN pnpm run build

# Production stage - minimal runtime image
FROM node:${NODE_VERSION}-alpine AS production

ARG PNPM_VERSION
ARG WORK_DIR

RUN npm install -g pnpm@${PNPM_VERSION}

# Install Chromium dependencies
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    nodejs \
    yarn

# Set Chromium path for Playwright
ENV CHROMIUM_PATH=/usr/bin/chromium-browser \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser

WORKDIR ${WORK_DIR}

# Copy workspace configuration
COPY --link pnpm-workspace.yaml package.json pnpm-lock.yaml ./

# Copy production node_modules from prod-dependencies stage
COPY --link --from=prod-dependencies ${WORK_DIR}/node_modules ./node_modules
COPY --link --from=prod-dependencies ${WORK_DIR}/packages/core/package.json ./packages/core/package.json

# Copy built packages from builder
COPY --link --from=builder ${WORK_DIR}/packages/core/dist ./packages/core/dist
COPY --link --from=builder ${WORK_DIR}/mcp-server/package.json ./mcp-server/package.json
COPY --link --from=builder ${WORK_DIR}/mcp-server/dist ./mcp-server/dist

# Set working directory to MCP server
WORKDIR ${WORK_DIR}/mcp-server

# Environment variables (can be overridden at runtime)
ENV NODE_ENV=production \
    MICRAWL_DOCS_DIR=/app/data/docs \
    MICRAWL_LLMS_DIR=/app/data/llms \
    MICRAWL_RESOURCE_MANIFEST=/app/data/.micrawl/registry.json \
    SCRAPER_DEFAULT_TIMEOUT_MS=45000 \
    SCRAPER_TEXT_ONLY_DEFAULT=true \
    SCRAPER_DEFAULT_DRIVER=playwright

# Create data directory for persistence
RUN mkdir -p /app/data/docs /app/data/llms /app/data/.micrawl

# Volume for persistent storage
VOLUME ["/app/data"]

# Run as non-root user for security
RUN addgroup -g 1001 -S micrawl && \
    adduser -S -D -H -u 1001 -h /app -s /sbin/nologin -G micrawl micrawl && \
    chown -R micrawl:micrawl /app/data

USER micrawl

# Expose stdio for MCP protocol (no HTTP port needed)
# MCP clients connect via stdin/stdout when running the container

# Health check (optional - checks if Node process is running)
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "process.exit(0)"

# Run the MCP server
ENTRYPOINT ["node", "dist/stdio.js"]

# To use with Docker:
# docker build -t micrawl-mcp -f mcp-server/Dockerfile .
# docker run -i --rm \
#   -v $(pwd)/data:/app/data \
#   -e SCRAPER_DEFAULT_TIMEOUT_MS=60000 \
#   micrawl-mcp