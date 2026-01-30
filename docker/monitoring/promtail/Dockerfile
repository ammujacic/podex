# Custom Promtail image with config baked in
FROM grafana/promtail:2.9.0

# Copy config file into the image
COPY promtail-config.yml /etc/promtail/config.yml

# Default command uses our config
CMD [ "-config.file=/etc/promtail/config.yml" ]
