FROM alpine:3.15
RUN apk add --update --no-cache nginx
CMD ["nginx", "-g", "daemon off;"]
