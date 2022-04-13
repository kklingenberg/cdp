FROM alpine:3.15

RUN wget https://github.com/stedolan/jq/releases/download/jq-1.6/jq-linux64 -O /bin/jq && \
    chmod +x /bin/jq && \
    apk add --update --no-cache curl

WORKDIR /app
COPY input-generator.sh .
RUN chmod +x input-generator.sh

ENTRYPOINT ["/app/input-generator.sh"]
