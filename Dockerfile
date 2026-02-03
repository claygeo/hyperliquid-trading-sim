# ---- Base ----
FROM node:20-alpine AS base
WORKDIR /app

# ---- Install server dependencies ----
FROM base AS server-deps
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev

# ---- Install all server dependencies (including dev for build) ----
FROM base AS server-build-deps
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci

# ---- Build server ----
FROM server-build-deps AS server-build
COPY server/ ./server/
COPY shared/ ./shared/
RUN cd server && npm run build

# ---- Install client dependencies ----
FROM base AS client-build
COPY client/package.json client/package-lock.json ./client/
RUN cd client && npm ci
COPY client/ ./client/
ARG VITE_API_URL
ARG VITE_WS_URL
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
RUN cd client && npm run build

# ---- Production ----
FROM node:20-alpine AS production
WORKDIR /app

# Security: run as non-root
RUN addgroup -g 1001 -S appgroup && \
    adduser -S appuser -u 1001 -G appgroup

# Copy production server dependencies
COPY --from=server-deps /app/server/node_modules ./server/node_modules
COPY --from=server-build /app/server/dist ./server/dist
COPY --from=server-build /app/server/package.json ./server/package.json

# Copy built client (can be served by a reverse proxy or static host)
COPY --from=client-build /app/client/dist ./client/dist

# Copy shared types
COPY shared/ ./shared/

USER appuser

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/health || exit 1

CMD ["node", "server/dist/index.js"]
