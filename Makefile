.PHONY: dev build up down logs setup-rich-menu seed

# Local dev
dev:
	docker compose up -d
	@echo "✅ Services started — Backend: http://localhost:3000 | Admin: http://localhost/admin"

# Build fresh
build:
	docker compose build --no-cache

up:
	docker compose up -d

down:
	docker compose down

logs:
	docker compose logs -f backend

# Setup LINE Rich Menu
setup-rich-menu:
	docker compose exec backend node scripts/setupRichMenu.js

# Seed sample data
seed:
	docker compose exec backend node scripts/seed.js

# Restart backend only
restart:
	docker compose restart backend

# DB shell
db:
	docker compose exec postgres psql -U postgres -d crm_line_oa
