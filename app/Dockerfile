FROM oven/bun:1-alpine

WORKDIR /workspace

# Build this image from the repository root so sibling workspace packages are available.
COPY . .
COPY app/.npmrc.docker app/.npmrc

RUN bun install

WORKDIR /workspace/app
