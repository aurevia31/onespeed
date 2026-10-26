# OneSpeed Marketplace - Production Docker Image
FROM nginx:1.27-alpine

# Copy nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy the entire marketplace
COPY . /usr/share/nginx/html/

# Remove unnecessary files from the web root
RUN rm -f /usr/share/nginx/html/Dockerfile \
         /usr/share/nginx/html/docker-compose.yml \
         /usr/share/nginx/html/Makefile \
         /usr/share/nginx/html/.dockerignore \
         /usr/share/nginx/html/.env.example \
         /usr/share/nginx/html/nginx.conf \
    && rm -rf /usr/share/nginx/html/docker

# Health check
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ || exit 1

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
