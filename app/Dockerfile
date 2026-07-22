FROM node:24-alpine

WORKDIR /workspace

# Build this image from the repository root so sibling workspace packages are available.
COPY . .
COPY app/.npmrc.docker app/.npmrc

RUN corepack enable && pnpm install --frozen-lockfile

WORKDIR /workspace/app
