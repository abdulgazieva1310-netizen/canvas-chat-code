FROM debian:bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        default-jdk-headless g++ node-typescript nodejs python3 \
    && rm -rf /var/lib/apt/lists/*

COPY execute.py /runner/execute.py
RUN chmod 0555 /runner/execute.py
USER 65534:65534
WORKDIR /
