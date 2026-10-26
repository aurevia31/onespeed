# OneSpeed Marketplace - Production Docker Image
FROM nginx:1.27-alpine

RUN apk add --no-cache nodejs

# Copy nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Admin credentials stay on the server and are never copied into the static web root.
COPY admin-auth-server.js /opt/onespeed/admin-auth-server.js

# Write the public Supabase client config from Render runtime environment variables.
COPY docker-entrypoint.d/40-onespeed-supabase-config.sh /docker-entrypoint.d/40-onespeed-supabase-config.sh
RUN chmod 755 /docker-entrypoint.d/40-onespeed-supabase-config.sh

# Copy the entire marketplace
COPY . /usr/share/nginx/html/

# Remove unnecessary files from the web root
RUN rm -f /usr/share/nginx/html/Dockerfile \
         /usr/share/nginx/html/docker-compose.yml \
         /usr/share/nginx/html/Makefile \
         /usr/share/nginx/html/.dockerignore \
         /usr/share/nginx/html/.env.example \
         /usr/share/nginx/html/nginx.conf \
         /usr/share/nginx/html/admin-auth-server.js \
         /usr/share/nginx/html/.gitignore \
    && rm -rf /usr/share/nginx/html/docker-entrypoint.d \
              /usr/share/nginx/html/tests \
    && rm -rf /usr/share/nginx/html/docker

# Health check
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ || exit 1

EXPOSE 80

CMD ["node", "/opt/onespeed/admin-auth-server.js"]
