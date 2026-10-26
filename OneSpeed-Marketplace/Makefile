.PHONY: up down build logs restart clean

up:
	docker compose up --build -d
	@echo "OneSpeed Marketplace running at http://localhost:8080"

down:
	docker compose down

build:
	docker compose build

logs:
	docker compose logs -f

restart:
	docker compose restart

clean:
	docker compose down -v --rmi local
