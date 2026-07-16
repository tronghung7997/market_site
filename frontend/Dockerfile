# Override with --build-arg NODE_IMAGE=node:22-alpine when registry.k7 isn't reachable (e.g. local dev)
ARG NODE_IMAGE=registry.k7:5000/node:22-alpine

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json ./
RUN npm install

FROM ${NODE_IMAGE} AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG API_URL=http://marketplace-svc:8001
ENV API_URL=$API_URL
RUN mkdir -p public && npm run build

FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S app && adduser -S app -G app
COPY --from=builder --chown=app:app /app/.next/standalone ./
COPY --from=builder --chown=app:app /app/.next/static ./.next/static
COPY --from=builder --chown=app:app /app/public ./public

# debug tool
RUN apk update && apk add --no-cache curl nano vim

USER app
EXPOSE 3000
CMD ["node", "server.js"]
