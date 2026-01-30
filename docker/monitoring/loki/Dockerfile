# Custom Loki image with config baked in
FROM grafana/loki:2.9.0

# Copy config file into the image
COPY loki-config.yml /etc/loki/local-config.yaml

# Default command uses our config
CMD [ "-config.file=/etc/loki/local-config.yaml" ]
