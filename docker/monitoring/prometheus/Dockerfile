# Custom Prometheus image with config baked in
FROM prom/prometheus:v2.48.0

# Copy config file into the image
COPY prometheus.yml /etc/prometheus/prometheus.yml

# Default command uses our config
CMD [ "--config.file=/etc/prometheus/prometheus.yml", \
      "--storage.tsdb.path=/prometheus", \
      "--storage.tsdb.retention.time=30d", \
      "--web.enable-lifecycle", \
      "--web.enable-admin-api" ]
