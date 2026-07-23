# Restock Alerts — production image (runs both the web server and the worker).
# The process to run is chosen by fly.toml [processes]; CMD is just the default.
FROM node:22-slim

# Prisma needs openssl at runtime on Debian.
RUN apt-get update -qq && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install ALL deps first — the build needs the toolchain (vite, @remix-run/dev).
# NODE_ENV is left unset here so `npm ci` includes devDependencies for the build step.
COPY package.json package-lock.json ./
RUN npm ci

# App source, Prisma client (for this image's platform), then the production build.
COPY . .
RUN npx prisma generate && npm run build

# Slim the image: drop build-only devDependencies. `tsx` (the worker's runtime) is a
# regular dependency, so it survives this prune.
RUN npm prune --omit=dev

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# Default process (web). fly.toml overrides per process group (web / worker).
CMD ["npm", "run", "start"]
