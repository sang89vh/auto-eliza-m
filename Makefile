.PHONY: sleeppiano-install sleeppiano-login sleeppiano-migrate sleeppiano install start-backend start-frontend reset-status start-all restart-backend commit docker-build docker-run docker-stop docker-clean help python-init stop-all build up down restart logs clean start

# Variables
DOCKER_COMPOSE = docker-compose
DOCKER = docker

# Install dependencies
install:
	npm install

# Start backend server
start-backend:
	npm run server

# Start frontend development server
start-frontend:
	npm start

# Reset all songs status to 1
reset-status:
	npm run reset-status

# Start both backend and frontend (in separate terminals)
start-all:
	@echo "Starting backend server..."
	@npm run server & \
	echo "Starting frontend server..." && \
	npm start

# Restart backend server
restart-backend:
	@echo "Stopping existing backend server..."
	@pkill -f "node server.js" || true
	@echo "Starting backend server..."
	@npm run server

# Commit changes with timestamp
commit:
	@echo "Adding all changes to git..."
	@git add .
	@echo "Committing changes with timestamp..."
	@git commit -m "Update: $(shell date '+%Y-%m-%d %H:%M:%S')"

# SleepPiano pipeline (see sleeppiano/README.md)
sleeppiano-install:
	@echo "Installing SleepPiano dependencies..."
	cd sleeppiano && npm install && npx playwright install chromium

sleeppiano-login:
	@echo "Opening browsers so you can sign in to Suno and YouTube..."
	cd sleeppiano && npm run setup:login

sleeppiano-migrate:
	@echo "Applying the piano_* schema migration..."
	cd sleeppiano && npm run migrate

sleeppiano:
	@echo "Starting SleepPiano on http://localhost:3999 ..."
	cd sleeppiano && npm start

# Docker commands
docker-build:
	@echo "Building Docker images..."
	$(DOCKER_COMPOSE) build

docker-run:
	@echo "Starting Docker containers..."
	$(DOCKER_COMPOSE) up -d

docker-stop:
	@echo "Stopping Docker containers..."
	$(DOCKER_COMPOSE) down

docker-clean: docker-stop
	@echo "Cleaning up Docker resources..."
	$(DOCKER_COMPOSE) down --volumes --remove-orphans
	$(DOCKER) system prune -f

# Python init
python-init:
	python3 -m venv venv
	. venv/bin/activate && pip install -r requirements.txt

# Stop both frontend and backend servers
stop-all:
	@echo "Stopping all servers..."
	@pkill -f "node server.js" || true
	@pkill -f "react-scripts start" || true
	@kill -9 $(lsof -t -i :3001) || true
	@echo "All servers stopped"

# Docker Compose commands
build:
	@echo "Building Docker images..."
	$(DOCKER_COMPOSE) build

up:
	@echo "Starting containers..."
	$(DOCKER_COMPOSE) up -d

down:
	@echo "Stopping containers..."
	$(DOCKER_COMPOSE) down

restart:
	@echo "Restarting containers..."
	$(DOCKER_COMPOSE) restart

logs:
	@echo "Showing container logs..."
	$(DOCKER_COMPOSE) logs -f

clean:
	@echo "Cleaning up Docker resources..."
	$(DOCKER_COMPOSE) down --volumes --remove-orphans
	$(DOCKER) system prune -f

# Build and start containers
start: build up
	@echo "Application is ready!"

# Show help
help:
	@echo "Available commands:"
	@echo "  make install        - Install all dependencies"
	@echo "  make start-backend  - Start the backend server"
	@echo "  make start-frontend - Start the frontend development server"
	@echo "  make reset-status   - Reset all songs status to 1"
	@echo "  make start-all      - Start both backend and frontend servers"
	@echo "  make stop-all       - Stop both frontend and backend servers"
	@echo "  make restart-backend - Stop and restart the backend server"
	@echo "  make commit         - Add all changes and commit with timestamp"
	@echo "  make sleeppiano-install - Install SleepPiano deps + Playwright Chromium"
	@echo "  make sleeppiano-login   - Sign in to Suno and YouTube (one time)"
	@echo "  make sleeppiano-migrate - Apply the piano_* schema migration"
	@echo "  make sleeppiano         - Start the SleepPiano pipeline app"
	@echo "  make build          - Build Docker images"
	@echo "  make up             - Start Docker containers"
	@echo "  make down           - Stop Docker containers"
	@echo "  make restart        - Restart Docker containers"
	@echo "  make logs           - View container logs"
	@echo "  make clean          - Clean up Docker resources"
	@echo "  make start          - Build and start containers"
	@echo "  make help           - Show this help message" 