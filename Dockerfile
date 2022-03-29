FROM node:16-alpine AS builder

RUN wget https://github.com/stedolan/jq/releases/download/jq-1.6/jq-linux64 -O /bin/jq && \
    chmod +x /bin/jq

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install

COPY . .
RUN npm run check-and-build


FROM alpine:3.15

WORKDIR /app
RUN apk add --update --no-cache 'nodejs<17'
COPY --from=builder /app/build/index.js index.js
COPY --from=builder /bin/jq /bin/jq

ENTRYPOINT ["node", "/app/index.js"]
