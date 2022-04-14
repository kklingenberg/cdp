FROM tiangolo/uvicorn-gunicorn-fastapi:python3.9
ARG EXPR
RUN test -n "$EXPR" || (echo "EXPR variable wasn't given" && false)
ENV EXPR $EXPR
COPY main.py /app/main.py
