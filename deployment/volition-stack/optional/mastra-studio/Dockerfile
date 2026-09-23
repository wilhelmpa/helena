FROM node:24.21.0-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS build
WORKDIR /app
ENV MASTRA_TELEMETRY_DISABLED=true DO_NOT_TRACK=1
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY src ./src
COPY catalog ./catalog
RUN npm run build

FROM node:24.21.0-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6
WORKDIR /app
ENV NODE_ENV=production MASTRA_TELEMETRY_DISABLED=true DO_NOT_TRACK=1 \
    MASTRA_HIDE_CLOUD_CTA=true MASTRA_AUTO_DETECT_URL=true MASTRA_AGENT_SIGNALS=false \
    MASTRA_STUDIO_PATH=.mastra/output/studio STUDIO_PROXY_HOST=0.0.0.0
COPY --from=build --chown=node:node /app/.mastra/output ./.mastra/output
COPY --from=build --chown=node:node /app/src ./src
COPY --chown=node:node start.mjs readonly-proxy.mjs event-ingress.mjs ./
COPY --chown=node:node catalog ./catalog
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 4111
CMD ["node", "start.mjs"]
