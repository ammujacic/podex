# Custom Loki image with config baked in
# Multi-stage build: copy Loki binary into Alpine for shell/wget/grep support
FROM grafana/loki:3.6.4 AS loki-binary

FROM alpine:3.21
RUN apk add --no-cache ca-certificates tzdata wget

# Copy Loki binary from official image
COPY --from=loki-binary /usr/bin/loki /usr/bin/loki

# Create loki user and data directories
RUN addgroup -g 10001 -S loki && \
    adduser -u 10001 -S loki -G loki && \
    mkdir -p /loki /etc/loki && \
    chown -R loki:loki /loki /etc/loki

# Copy config file into the image
COPY loki-config.yml /etc/loki/local-config.yaml
RUN chown loki:loki /etc/loki/local-config.yaml

USER loki
EXPOSE 3100

# Default command uses our config
ENTRYPOINT ["/usr/bin/loki"]
CMD ["-config.file=/etc/loki/local-config.yaml"]
