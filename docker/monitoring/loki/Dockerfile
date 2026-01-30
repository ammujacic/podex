# Custom Loki image with config baked in
FROM grafana/loki:3.6.4

# Install wget for health checks (Alpine has busybox wget which may not support all options)
USER root
RUN apk add --no-cache wget
USER loki

# Copy config file into the image
COPY loki-config.yml /etc/loki/local-config.yaml

# Default command uses our config
CMD [ "-config.file=/etc/loki/local-config.yaml" ]
