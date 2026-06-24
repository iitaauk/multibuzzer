# Build stage
FROM node:20.12.2-alpine AS builder

WORKDIR /usr/src/app

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

COPY . .
RUN yarn build

# Runner stage
FROM node:20.12.2-alpine

WORKDIR /usr/src/app

# Change ownership of the app directory to the node user
RUN chown node:node /usr/src/app

USER node

COPY --chown=node:node package.json yarn.lock ./
RUN yarn install --frozen-lockfile --production --ignore-engines

# Copy frontend build and backend source
COPY --chown=node:node --from=builder /usr/src/app/build ./build
COPY --chown=node:node --from=builder /usr/src/app/src ./src

# Expose application port
EXPOSE 4001

ENV NODE_ENV=production
ENV PORT=4001

CMD ["node", "-r", "esm", "src/server.js"]
