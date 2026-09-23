# syntax=docker/dockerfile:1
# Medusa v2 backend (server + admin). Multi-stage: the build stage compiles the
# app and the admin SPA into .medusa/server; the runtime stage contains only that
# output plus production dependencies.
ARG NODE_IMAGE=node:22-alpine

FROM ${NODE_IMAGE} AS build
WORKDIR /server
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
COPY package.json yarn.lock .yarnrc.yml ./
RUN yarn install --immutable
COPY . .
# Admin build-time settings are inlined into the dashboard bundle.
ARG MEDUSA_BACKEND_URL=/
ARG DISABLE_MEDUSA_ADMIN=false
RUN MEDUSA_BACKEND_URL=${MEDUSA_BACKEND_URL} DISABLE_MEDUSA_ADMIN=${DISABLE_MEDUSA_ADMIN} yarn build
# Production-only dependencies for the compiled server, pinned by the same lockfile.
WORKDIR /server/.medusa/server
RUN cp /server/yarn.lock /server/.yarnrc.yml . \
 && yarn workspaces focus --all --production \
 && rm -rf .yarn .yarnrc.yml

FROM ${NODE_IMAGE} AS runtime
WORKDIR /server
ENV NODE_ENV=production \
    PORT=9000
COPY --from=build --chown=node:node /server/.medusa/server ./
COPY --chown=node:node docker-entrypoint.sh ./
# Pre-create the upload dir so a mounted named volume inherits node ownership.
RUN mkdir -p static && chown node:node static
USER node
EXPOSE 9000
HEALTHCHECK --interval=5s --timeout=3s --start-period=120s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:9000/health || exit 1
ENTRYPOINT ["./docker-entrypoint.sh"]
