FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json tsconfig*.json nest-cli.json ./
RUN npm ci
COPY src ./src
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PAAS_APPS_DIR=/data/paas-apps

# The deploy pipeline shells out to git, the docker CLI (talking to the host daemon through
# the mounted /var/run/docker.sock) and, for remote servers, ssh.
RUN apk add --no-cache git docker-cli openssh-client wget \
    && mkdir -p /data/paas-apps

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/dist ./dist

EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health >/dev/null || exit 1

# Runs as root on purpose: access to the Docker socket is required to manage containers.
CMD ["node", "dist/main"]
