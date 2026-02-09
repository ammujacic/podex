# Custom Promtail image with config baked in
FROM grafana/promtail:3.6.4

# Install wget for health checks (Promtail needs root for log access anyway)
USER root
RUN apt-get update && apt-get install -y --no-install-recommends wget \
    && rm -rf /var/lib/apt/lists/*

# Copy config file into the image
COPY promtail-config.yml /etc/promtail/config.yml

# Default command uses our config
CMD [ "-config.file=/etc/promtail/config.yml" ]
