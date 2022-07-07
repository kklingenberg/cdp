FROM golang:1.18-alpine AS golangbuilder

WORKDIR /src
COPY stream-jsonnet .
RUN go build


FROM node:16-alpine AS nodejsbuilder

RUN wget https://github.com/stedolan/jq/releases/download/jq-1.6/jq-linux64 -O /bin/jq && \
    chmod +x /bin/jq
COPY --from=golangbuilder /src/stream-jsonnet /bin/stream-jsonnet

WORKDIR /src
COPY package.json package-lock.json ./
RUN npm install

COPY . .
RUN npm run check-and-build


FROM alpine:3.15

WORKDIR /src
RUN apk add --update --no-cache 'nodejs<17'
COPY --from=nodejsbuilder /src/build/index.js index.js
COPY --from=nodejsbuilder /bin/jq /bin/jq
COPY --from=golangbuilder /src/stream-jsonnet /bin/stream-jsonnet

ENTRYPOINT ["node", "/src/index.js"]
